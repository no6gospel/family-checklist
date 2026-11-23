-- =====================================================================
-- 가족 공유 체크리스트 · Supabase 스키마
-- 실행 위치: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
-- 새 프로젝트에서 한 번만 실행합니다. (다시 실행하려면 맨 아래 "초기화" 참고)
-- =====================================================================
-- 구조
--   app_private 스키마: 실제 데이터(외부 API로 직접 접근 불가)
--   public.checklist_* 함수: 화면이 호출하는 유일한 통로. 로그인 사용자와 역할을 함수 안에서 검사합니다.
-- =====================================================================

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 설정값 (가입 코드 등)
create table app_private.settings (
  key   text primary key,
  value text not null
);
-- ⚠️ 설치 후 반드시 가족만 아는 값으로 바꾸십시오 (supabase/admin.sql 1번)
insert into app_private.settings(key, value) values ('signup_code', 'CHANGE-ME');

-- 사용자 프로필 (Supabase 로그인 계정과 1:1)
create table app_private.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 20),
  created_at   timestamptz not null default now()
);

-- 목록 (내용 전체를 JSON 하나로 저장)
--   data 형식:
--   { "name": "제목", "date": "2026-11-23" | "",
--     "categories": [ { "id", "name", "subs": [ { "id", "name" } ] } ],
--     "tasks": [ { "id", "text", "cat", "sub", "due", "done",
--                  "assignees": [uuid...], "createdBy": uuid, "createdAt": ISO문자열 } ] }
create table app_private.lists (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('standard', 'simple')),
  data       jsonb not null,
  version    bigint not null default 1,          -- 편집 충돌 감지용
  closed_at  timestamptz,                        -- null = 진행 중
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()  -- 완료 체크 포함 모든 변경 시각
);

-- 목록 참여자와 역할
create table app_private.members (
  list_id  uuid not null references app_private.lists(id) on delete cascade,
  user_id  uuid not null references app_private.profiles(id) on delete cascade,
  role     text not null check (role in ('owner', 'co-owner', 'member', 'guest')),
  added_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index members_user_idx on app_private.members(user_id);

-- 사용자별 즐겨찾기
create table app_private.favorites (
  user_id uuid not null references app_private.profiles(id) on delete cascade,
  list_id uuid not null references app_private.lists(id) on delete cascade,
  primary key (user_id, list_id)
);

revoke all on all tables in schema app_private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. 가입 처리 (auth.users 트리거)
--    화면은 signUp 시 user_metadata 에 username, display_name, signup_code 를 넣어 보냅니다.
--    가입 코드가 틀리면 계정 자체가 만들어지지 않습니다.
-- ---------------------------------------------------------------------

create function app_private.before_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  select value into v_code from app_private.settings where key = 'signup_code';
  if v_code is null or coalesce(new.raw_user_meta_data->>'signup_code', '') <> v_code then
    raise exception 'invalid_signup_code';
  end if;
  if lower(coalesce(new.raw_user_meta_data->>'username', '')) !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid_username';
  end if;
  if length(btrim(coalesce(new.raw_user_meta_data->>'display_name', ''))) not between 1 and 20 then
    raise exception 'invalid_display_name';
  end if;
  -- 가입 코드는 계정 정보에 남기지 않습니다.
  new.raw_user_meta_data := new.raw_user_meta_data - 'signup_code';
  return new;
end $$;

create function app_private.after_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.profiles(id, username, display_name)
  values (new.id,
          lower(new.raw_user_meta_data->>'username'),
          btrim(new.raw_user_meta_data->>'display_name'));
  return new;
end $$;

create trigger checklist_before_signup
  before insert on auth.users
  for each row execute function app_private.before_signup();

create trigger checklist_after_signup
  after insert on auth.users
  for each row execute function app_private.after_signup();

-- Supabase Auth는 가입 직후 사용자 정보를 한 번 더 저장(update)하므로, 그때도 가입 코드를 지웁니다.
create function app_private.strip_signup_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ? 'signup_code' then
    new.raw_user_meta_data := new.raw_user_meta_data - 'signup_code';
  end if;
  return new;
end $$;

create trigger checklist_strip_signup_code
  before update on auth.users
  for each row execute function app_private.strip_signup_code();

-- ---------------------------------------------------------------------
-- 3. 내부 도우미 함수
-- ---------------------------------------------------------------------

-- 로그인한 사용자 ID (로그인 안 했으면 오류)
create function app_private.uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from app_private.profiles where id = v) then raise exception 'profile_missing'; end if;
  return v;
end $$;

create function app_private.role_of(p_list uuid, p_user uuid) returns text
language sql stable set search_path = '' as $$
  select role from app_private.members where list_id = p_list and user_id = p_user
$$;

-- 날짜 문자열 검사: '' 또는 실제 존재하는 YYYY-MM-DD
create function app_private.is_valid_date(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p = '' then return true; end if;
  if p !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(p::date, 'YYYY-MM-DD') = p;
exception when others then
  return false;
end $$;

-- 목록 내용 구조 검사
--   상한: 카테고리 100개, 카테고리당 서브 50개, 항목 2000개, 전체 1MB
--   글자 수: 목록 이름 70자, 분류 이름 70자, 항목 160자 (화면 입력 제한과 동일)
create function app_private.validate(p_data jsonb, p_kind text) returns void
language plpgsql stable set search_path = '' as $$
declare
  c jsonb; s jsonb; t jsonb; a jsonb;
  cat_ids text[] := '{}'; sub_ids text[]; task_ids text[] := '{}';
begin
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text) > 1048576 then
    raise exception 'invalid_data';
  end if;
  if jsonb_typeof(p_data->'name') is distinct from 'string' or length(btrim(p_data->>'name')) not between 1 and 70 then
    raise exception 'invalid_name';
  end if;
  if p_data ? 'date' and jsonb_typeof(p_data->'date') is distinct from 'string' then raise exception 'invalid_date'; end if;
  if not app_private.is_valid_date(coalesce(p_data->>'date', '')) then raise exception 'invalid_date'; end if;
  if p_kind = 'standard' and coalesce(p_data->>'date', '') <> '' then raise exception 'simple_field_forbidden'; end if;

  if jsonb_typeof(p_data->'categories') is distinct from 'array' or jsonb_array_length(p_data->'categories') > 100
     or jsonb_typeof(p_data->'tasks') is distinct from 'array' or jsonb_array_length(p_data->'tasks') > 2000 then
    raise exception 'invalid_structure';
  end if;

  for c in select value from jsonb_array_elements(p_data->'categories') loop
    if jsonb_typeof(c) is distinct from 'object'
       or jsonb_typeof(c->'id') is distinct from 'string' or length(c->>'id') not between 1 and 100 or (c->>'id') = any(cat_ids)
       or jsonb_typeof(c->'name') is distinct from 'string' or length(btrim(c->>'name')) not between 1 and 70
       or jsonb_typeof(c->'subs') is distinct from 'array' or jsonb_array_length(c->'subs') > 50 then
      raise exception 'invalid_category';
    end if;
    if p_kind = 'simple' and jsonb_array_length(c->'subs') > 0 then raise exception 'simple_field_forbidden'; end if;
    cat_ids := array_append(cat_ids, c->>'id');
    sub_ids := '{}';
    for s in select value from jsonb_array_elements(c->'subs') loop
      if jsonb_typeof(s) is distinct from 'object'
         or jsonb_typeof(s->'id') is distinct from 'string' or length(s->>'id') not between 1 and 100 or (s->>'id') = any(sub_ids)
         or jsonb_typeof(s->'name') is distinct from 'string' or length(btrim(s->>'name')) not between 1 and 70 then
        raise exception 'invalid_category';
      end if;
      sub_ids := array_append(sub_ids, s->>'id');
    end loop;
  end loop;

  for t in select value from jsonb_array_elements(p_data->'tasks') loop
    if jsonb_typeof(t) is distinct from 'object'
       or jsonb_typeof(t->'id') is distinct from 'string' or length(t->>'id') not between 1 and 100 or (t->>'id') = any(task_ids)
       or jsonb_typeof(t->'text') is distinct from 'string' or length(btrim(t->>'text')) not between 1 and 160
       or jsonb_typeof(t->'done') is distinct from 'boolean'
       or jsonb_typeof(t->'cat') is distinct from 'string' then
      raise exception 'invalid_task';
    end if;
    task_ids := array_append(task_ids, t->>'id');

    if not ((t->>'cat') = any(cat_ids)) then raise exception 'invalid_task_category'; end if;
    if coalesce(t->>'sub', '') <> '' and not exists (
         select 1 from jsonb_array_elements(p_data->'categories') q
         cross join lateral jsonb_array_elements(q->'subs') z
         where q->>'id' = t->>'cat' and z->>'id' = t->>'sub') then
      raise exception 'invalid_task_category';
    end if;
    if not app_private.is_valid_date(coalesce(t->>'due', '')) then raise exception 'invalid_date'; end if;

    if t ? 'assignees' then
      if jsonb_typeof(t->'assignees') is distinct from 'array' or jsonb_array_length(t->'assignees') > 20 then
        raise exception 'invalid_task';
      end if;
      for a in select value from jsonb_array_elements(t->'assignees') loop
        if jsonb_typeof(a) is distinct from 'string'
           or (a #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'invalid_task';
        end if;
      end loop;
    end if;

    if p_kind = 'simple' and (
         coalesce(t->>'sub', '') <> '' or coalesce(t->>'due', '') <> ''
         or coalesce(jsonb_array_length(case when jsonb_typeof(t->'assignees') = 'array' then t->'assignees' end), 0) > 0) then
      raise exception 'simple_field_forbidden';
    end if;
  end loop;
end $$;

-- 목록 한 개를 화면용 JSON으로
create function app_private.list_json(p_list uuid, p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', l.id, 'kind', l.kind, 'data', l.data, 'version', l.version,
    'closed_at', l.closed_at, 'created_at', l.created_at, 'updated_at', l.updated_at,
    'role', m.role,
    'favorite', exists (select 1 from app_private.favorites f where f.list_id = l.id and f.user_id = p_user))
  from app_private.lists l
  join app_private.members m on m.list_id = l.id and m.user_id = p_user
  where l.id = p_list
$$;

-- ---------------------------------------------------------------------
-- 4. 화면이 호출하는 함수 (public.checklist_*)
--    오류는 짧은 영문 코드(raise exception 'not_authorized' 등)로 돌려주고,
--    화면(app.js)이 한국어 문구로 바꿔 보여 줍니다.
-- ---------------------------------------------------------------------

-- 내 정보
create function public.checklist_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  return (select jsonb_build_object('id', id, 'username', username, 'display_name', display_name)
          from app_private.profiles where id = u);
end $$;

-- 표시 이름 변경
create function public.checklist_set_display_name(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 20 then raise exception 'invalid_display_name'; end if;
  update app_private.profiles set display_name = btrim(p_name) where id = u;
  return public.checklist_me();
end $$;

-- 가족 전체 목록 (참여자 추가 선택, 담당자 이름 표시용)
create function public.checklist_family() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'username', username, 'display_name', display_name)
                                    order by display_name)
                   from app_private.profiles), '[]'::jsonb);
end $$;

-- 내가 참여한 목록 전체
create function public.checklist_lists() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  return coalesce((select jsonb_agg(app_private.list_json(m.list_id, u) order by l.created_at)
                   from app_private.members m join app_private.lists l on l.id = m.list_id
                   where m.user_id = u), '[]'::jsonb);
end $$;

-- 목록 만들기 (만든 사람이 Owner) — 목록 생성과 Owner 등록은 한 트랜잭션
create function public.checklist_create(p_kind text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); v_id uuid;
begin
  if p_kind not in ('standard', 'simple') then raise exception 'invalid_data'; end if;
  perform app_private.validate(p_data, p_kind);
  -- 새 목록의 참여자는 나뿐이므로 담당자도 나만 가능
  if exists (select 1 from jsonb_array_elements(p_data->'tasks') t
             cross join lateral jsonb_array_elements_text(coalesce(t->'assignees', '[]'::jsonb)) a(v)
             where a.v <> u::text) then
    raise exception 'invalid_assignee';
  end if;
  insert into app_private.lists(kind, data) values (p_kind, p_data) returning id into v_id;
  insert into app_private.members(list_id, user_id, role) values (v_id, u, 'owner');
  return app_private.list_json(v_id, u);
end $$;

-- 목록 편집 저장 (Owner·Co-owner, 진행 중, 버전 일치)
--   완료 상태(done)는 DB의 현재 값을 유지합니다. 완료 체크는 checklist_toggle 로만 바뀝니다.
create function public.checklist_save(p_id uuid, p_version bigint, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := app_private.uid();
  l app_private.lists%rowtype;
  r text;
  merged jsonb;
begin
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner') then raise exception 'not_authorized'; end if;
  if l.closed_at is not null then raise exception 'list_closed'; end if;
  if l.version is distinct from p_version then raise exception 'version_conflict'; end if;

  perform app_private.validate(p_data, l.kind);

  -- 새로 지정한 담당자는 현재 참여자여야 함 (이전부터 지정돼 있던 사람은 나갔어도 유지 가능)
  if exists (
    select 1
    from jsonb_array_elements(p_data->'tasks') t
    cross join lateral jsonb_array_elements_text(coalesce(t->'assignees', '[]'::jsonb)) a(v)
    where not exists (select 1 from app_private.members m where m.list_id = p_id and m.user_id::text = a.v)
      and not exists (select 1 from jsonb_array_elements(l.data->'tasks') o
                      where o->>'id' = t->>'id' and coalesce(o->'assignees', '[]'::jsonb) ? a.v)
  ) then
    raise exception 'invalid_assignee';
  end if;

  -- 기존 항목의 완료 상태는 서버 값 유지
  select coalesce(jsonb_agg(
           case when o.v is null then t.v else t.v || jsonb_build_object('done', o.v->'done') end
           order by t.ord), '[]'::jsonb)
    into merged
  from jsonb_array_elements(p_data->'tasks') with ordinality t(v, ord)
  left join lateral (select x as v from jsonb_array_elements(l.data->'tasks') x
                     where x->>'id' = t.v->>'id' limit 1) o on true;

  update app_private.lists
     set data = jsonb_set(p_data, '{tasks}', merged),
         version = version + 1,
         updated_at = now()
   where id = p_id;
  return app_private.list_json(p_id, u);
end $$;

-- 완료 체크 (Owner·Co-owner·Member, 진행 중) — 버전을 올리지 않으므로 동시 체크 충돌 없음
create function public.checklist_toggle(p_id uuid, p_task text, p_done boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := app_private.uid();
  l app_private.lists%rowtype;
  r text;
  idx int;
begin
  if p_done is null then raise exception 'invalid_data'; end if;
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner', 'member') then raise exception 'not_authorized'; end if;
  if l.closed_at is not null then raise exception 'list_closed'; end if;

  select (ord - 1)::int into idx
  from jsonb_array_elements(l.data->'tasks') with ordinality x(v, ord)
  where v->>'id' = p_task;
  if idx is null then raise exception 'task_not_found'; end if;

  update app_private.lists
     set data = jsonb_set(data, array['tasks', idx::text, 'done'], to_jsonb(p_done)),
         updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- 종결 / 재개 (Owner·Co-owner)
create function public.checklist_set_closed(p_id uuid, p_closed boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype; r text;
begin
  if p_closed is null then raise exception 'invalid_data'; end if;
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner') then raise exception 'not_authorized'; end if;
  update app_private.lists
     set closed_at = case when p_closed then coalesce(closed_at, now()) else null end,
         version = version + 1,
         updated_at = now()
   where id = p_id;
  return app_private.list_json(p_id, u);
end $$;

-- 최종 삭제 (Owner, 종결된 목록만)
create function public.checklist_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype;
begin
  select * into l from app_private.lists where id = p_id for update;
  if l.id is null or app_private.role_of(p_id, u) is null then raise exception 'not_found'; end if;
  if app_private.role_of(p_id, u) <> 'owner' then raise exception 'not_authorized'; end if;
  if l.closed_at is null then raise exception 'list_not_closed'; end if;
  delete from app_private.lists where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- 즐겨찾기 (참여자 누구나, 종결 목록 포함)
create function public.checklist_favorite(p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  if app_private.role_of(p_id, u) is null then raise exception 'not_found'; end if;
  if p_on then
    insert into app_private.favorites(user_id, list_id) values (u, p_id) on conflict do nothing;
  else
    delete from app_private.favorites where user_id = u and list_id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 참여자 목록 (참여자 누구나)
create function public.checklist_members(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  if app_private.role_of(p_id, u) is null then raise exception 'not_found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.id, 'username', p.username,
                                        'display_name', p.display_name, 'role', m.role)
                     order by case m.role when 'owner' then 1 when 'co-owner' then 2 when 'member' then 3 else 4 end,
                              p.display_name)
    from app_private.members m join app_private.profiles p on p.id = m.user_id
    where m.list_id = p_id), '[]'::jsonb);
end $$;

-- 참여자 추가 (아이디로) — Owner: 모든 역할 / Co-owner: Owner 제외
create function public.checklist_add_member(p_id uuid, p_username text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype; r text; target uuid;
begin
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner') or p_role not in ('owner', 'co-owner', 'member', 'guest')
     or (r = 'co-owner' and p_role = 'owner') then
    raise exception 'not_authorized';
  end if;
  if l.closed_at is not null then raise exception 'list_closed'; end if;
  select id into target from app_private.profiles where username = lower(btrim(p_username));
  if target is null then raise exception 'user_not_found'; end if;
  if app_private.role_of(p_id, target) is not null then raise exception 'already_member'; end if;
  insert into app_private.members(list_id, user_id, role) values (p_id, target, p_role);
  return public.checklist_members(p_id);
end $$;

-- 역할 변경 — Owner: 모두 / Co-owner: Owner가 아닌 사람을 Owner가 아닌 역할로
create function public.checklist_set_role(p_id uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype; r text; old_role text;
begin
  select * into l from app_private.lists where id = p_id for update;   -- 동시 요청 직렬화
  r := app_private.role_of(p_id, u);
  old_role := app_private.role_of(p_id, p_user);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if old_role is null then raise exception 'user_not_found'; end if;
  if r not in ('owner', 'co-owner') or p_role not in ('owner', 'co-owner', 'member', 'guest')
     or (r = 'co-owner' and (old_role = 'owner' or p_role = 'owner')) then
    raise exception 'not_authorized';
  end if;
  if l.closed_at is not null then raise exception 'list_closed'; end if;
  if old_role = 'owner' and p_role <> 'owner'
     and (select count(*) from app_private.members where list_id = p_id and role = 'owner') <= 1 then
    raise exception 'last_owner';
  end if;
  update app_private.members set role = p_role where list_id = p_id and user_id = p_user;
  return public.checklist_members(p_id);
end $$;

-- 참여자 제거 — Owner만 다른 사람 제거 가능 / 누구나 스스로 나가기 가능 / 마지막 Owner는 불가
create function public.checklist_remove_member(p_id uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype; r text; old_role text;
begin
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  old_role := app_private.role_of(p_id, p_user);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if old_role is null then raise exception 'user_not_found'; end if;
  if p_user <> u then
    if r <> 'owner' then raise exception 'not_authorized'; end if;
    if l.closed_at is not null then raise exception 'list_closed'; end if;
  end if;
  if old_role = 'owner'
     and (select count(*) from app_private.members where list_id = p_id and role = 'owner') <= 1 then
    raise exception 'last_owner';
  end if;
  delete from app_private.favorites where list_id = p_id and user_id = p_user;
  delete from app_private.members where list_id = p_id and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 4-2. 가족 공개 목록과 참가 요청 (migrations/002_public_join.sql 과 같은 내용)
-- ---------------------------------------------------------------------
-- >>> 002 BEGIN
alter table app_private.lists add column if not exists is_public boolean not null default true;

create table if not exists app_private.join_requests (
  list_id      uuid not null references app_private.lists(id) on delete cascade,
  user_id      uuid not null references app_private.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
alter table app_private.join_requests enable row level security;
revoke all on app_private.join_requests from public, anon, authenticated;

-- 목록 JSON에 공개 여부와 (Owner/Co-owner에게만) 대기 중인 참가 요청 수 추가
create or replace function app_private.list_json(p_list uuid, p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', l.id, 'kind', l.kind, 'data', l.data, 'version', l.version,
    'closed_at', l.closed_at, 'created_at', l.created_at, 'updated_at', l.updated_at,
    'role', m.role, 'is_public', l.is_public,
    'favorite', exists (select 1 from app_private.favorites f where f.list_id = l.id and f.user_id = p_user),
    'pending', case when m.role in ('owner', 'co-owner')
                    then (select count(*) from app_private.join_requests r where r.list_id = l.id) else 0 end)
  from app_private.lists l
  join app_private.members m on m.list_id = l.id and m.user_id = p_user
  where l.id = p_list
$$;

-- 아이디로 직접 추가할 때 남아 있던 참가 요청은 정리
create or replace function public.checklist_add_member(p_id uuid, p_username text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype; r text; target uuid;
begin
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner') or p_role not in ('owner', 'co-owner', 'member', 'guest')
     or (r = 'co-owner' and p_role = 'owner') then
    raise exception 'not_authorized';
  end if;
  if l.closed_at is not null then raise exception 'list_closed'; end if;
  select id into target from app_private.profiles where username = lower(btrim(p_username));
  if target is null then raise exception 'user_not_found'; end if;
  if app_private.role_of(p_id, target) is not null then raise exception 'already_member'; end if;
  insert into app_private.members(list_id, user_id, role) values (p_id, target, p_role);
  delete from app_private.join_requests where list_id = p_id and user_id = target;
  return public.checklist_members(p_id);
end $$;

-- 내가 참여하지 않은 '가족 공개' 진행 중 목록 (이름·유형·Owner·항목 수만, 내용은 참가 후)
create or replace function public.checklist_public_lists() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'kind', l.kind, 'name', l.data->>'name', 'date', coalesce(l.data->>'date', ''),
             'tasks', jsonb_array_length(l.data->'tasks'), 'created_at', l.created_at,
             'owners', (select coalesce(jsonb_agg(p.display_name order by p.display_name), '[]'::jsonb)
                        from app_private.members m join app_private.profiles p on p.id = m.user_id
                        where m.list_id = l.id and m.role = 'owner'),
             'requested', exists (select 1 from app_private.join_requests r where r.list_id = l.id and r.user_id = u))
           order by l.created_at)
    from app_private.lists l
    where l.is_public and l.closed_at is null
      and not exists (select 1 from app_private.members m where m.list_id = l.id and m.user_id = u)), '[]'::jsonb);
end $$;

-- 참가: 일반 목록은 요청, Simple 목록은 바로 Co-owner
create or replace function public.checklist_join(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype;
begin
  select * into l from app_private.lists where id = p_id for update;
  if l.id is null or not l.is_public then raise exception 'not_public'; end if;
  if l.closed_at is not null then raise exception 'list_closed'; end if;
  if app_private.role_of(p_id, u) is not null then raise exception 'already_member'; end if;
  if l.kind = 'simple' then
    insert into app_private.members(list_id, user_id, role) values (p_id, u, 'co-owner');
    delete from app_private.join_requests where list_id = p_id and user_id = u;
    return jsonb_build_object('joined', true, 'list', app_private.list_json(p_id, u));
  end if;
  insert into app_private.join_requests(list_id, user_id) values (p_id, u) on conflict do nothing;
  return jsonb_build_object('requested', true);
end $$;

-- 내 참가 요청 취소
create or replace function public.checklist_cancel_join(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  delete from app_private.join_requests where list_id = p_id and user_id = u;
  return jsonb_build_object('ok', true);
end $$;

-- 대기 중인 참가 요청 (Owner·Co-owner)
create or replace function public.checklist_requests(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid(); r text := app_private.role_of(p_id, u);
begin
  if r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner') then raise exception 'not_authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.id, 'username', p.username, 'display_name', p.display_name,
                                        'requested_at', q.requested_at) order by q.requested_at)
    from app_private.join_requests q join app_private.profiles p on p.id = q.user_id
    where q.list_id = p_id), '[]'::jsonb);
end $$;

-- 승인: 역할 지정 (Owner: 모든 역할 / Co-owner: Owner 제외)
create or replace function public.checklist_approve(p_id uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype; r text;
begin
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner') or p_role not in ('owner', 'co-owner', 'member', 'guest')
     or (r = 'co-owner' and p_role = 'owner') then
    raise exception 'not_authorized';
  end if;
  if l.closed_at is not null then raise exception 'list_closed'; end if;
  if not exists (select 1 from app_private.join_requests where list_id = p_id and user_id = p_user) then
    raise exception 'request_not_found';
  end if;
  if app_private.role_of(p_id, p_user) is null then
    insert into app_private.members(list_id, user_id, role) values (p_id, p_user, p_role);
  end if;
  delete from app_private.join_requests where list_id = p_id and user_id = p_user;
  return public.checklist_requests(p_id);
end $$;

-- 거절 (Owner·Co-owner)
create or replace function public.checklist_reject(p_id uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); r text := app_private.role_of(p_id, u);
begin
  if r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner') then raise exception 'not_authorized'; end if;
  delete from app_private.join_requests where list_id = p_id and user_id = p_user;
  return public.checklist_requests(p_id);
end $$;

-- 공개 / 비공개 전환 (Owner·Co-owner)
create or replace function public.checklist_set_public(p_id uuid, p_public boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); r text := app_private.role_of(p_id, u);
begin
  if p_public is null then raise exception 'invalid_data'; end if;
  if r is null then raise exception 'not_found'; end if;
  if r not in ('owner', 'co-owner') then raise exception 'not_authorized'; end if;
  update app_private.lists set is_public = p_public, updated_at = now() where id = p_id;
  return app_private.list_json(p_id, u);
end $$;
-- <<< 002 END

-- ---------------------------------------------------------------------
-- 4-3. 서비스 관리자 (migrations/003_admin.sql 과 같은 내용)
-- ---------------------------------------------------------------------
-- >>> 003 BEGIN
alter table app_private.profiles add column if not exists is_admin boolean not null default false;

create or replace function app_private.is_admin(p_user uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select is_admin from app_private.profiles where id = p_user), false)
$$;

-- 관리자 전원을 모든 목록의 Owner로 맞춤
create or replace function app_private.sync_admin_memberships() returns void
language sql security definer set search_path = '' as $$
  insert into app_private.members(list_id, user_id, role)
  select l.id, p.id, 'owner' from app_private.lists l cross join app_private.profiles p where p.is_admin
  on conflict (list_id, user_id) do update set role = 'owner' where app_private.members.role <> 'owner';
  delete from app_private.join_requests q
   using app_private.profiles p where p.id = q.user_id and p.is_admin;
$$;

-- 새 목록이 생기면 관리자를 Owner로 넣음
create or replace function app_private.admin_autojoin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.members(list_id, user_id, role)
  select new.id, p.id, 'owner' from app_private.profiles p where p.is_admin
  on conflict (list_id, user_id) do update set role = 'owner';
  return new;
end $$;
drop trigger if exists checklist_admin_autojoin on app_private.lists;
create trigger checklist_admin_autojoin
  after insert on app_private.lists
  for each row execute function app_private.admin_autojoin();

-- 관리자로 지정되면 기존 목록 전체에 Owner로 참가
create or replace function app_private.admin_granted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_admin and not coalesce(old.is_admin, false) then
    perform app_private.sync_admin_memberships();
  end if;
  return new;
end $$;
drop trigger if exists checklist_admin_granted on app_private.profiles;
create trigger checklist_admin_granted
  after update of is_admin on app_private.profiles
  for each row execute function app_private.admin_granted();

-- 내 정보 / 가족 / 참여자에 관리자 여부 표시
create or replace function public.checklist_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  return (select jsonb_build_object('id', id, 'username', username, 'display_name', display_name, 'is_admin', is_admin)
          from app_private.profiles where id = u);
end $$;

create or replace function public.checklist_family() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'username', username, 'display_name', display_name,
                                                       'is_admin', is_admin) order by display_name)
                   from app_private.profiles), '[]'::jsonb);
end $$;

create or replace function public.checklist_members(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := app_private.uid();
begin
  if app_private.role_of(p_id, u) is null then raise exception 'not_found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.id, 'username', p.username,
                                        'display_name', p.display_name, 'role', m.role, 'is_admin', p.is_admin)
                     order by case m.role when 'owner' then 1 when 'co-owner' then 2 when 'member' then 3 else 4 end,
                              p.display_name)
    from app_private.members m join app_private.profiles p on p.id = m.user_id
    where m.list_id = p_id), '[]'::jsonb);
end $$;

-- 목록 만들기: 관리자가 만들면 자동 참가 트리거와 겹치므로 on conflict 처리
create or replace function public.checklist_create(p_kind text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); v_id uuid;
begin
  if p_kind not in ('standard', 'simple') then raise exception 'invalid_data'; end if;
  perform app_private.validate(p_data, p_kind);
  if exists (select 1 from jsonb_array_elements(p_data->'tasks') t
             cross join lateral jsonb_array_elements_text(coalesce(t->'assignees', '[]'::jsonb)) a(v)
             where a.v <> u::text) then
    raise exception 'invalid_assignee';
  end if;
  insert into app_private.lists(kind, data) values (p_kind, p_data) returning id into v_id;
  insert into app_private.members(list_id, user_id, role) values (v_id, u, 'owner')
  on conflict (list_id, user_id) do update set role = 'owner';
  return app_private.list_json(v_id, u);
end $$;

-- 역할 변경: 관리자의 Owner 역할은 바꿀 수 없음
create or replace function public.checklist_set_role(p_id uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype; r text; old_role text;
begin
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  old_role := app_private.role_of(p_id, p_user);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if old_role is null then raise exception 'user_not_found'; end if;
  if app_private.is_admin(p_user) and p_role <> 'owner' then raise exception 'admin_protected'; end if;
  if r not in ('owner', 'co-owner') or p_role not in ('owner', 'co-owner', 'member', 'guest')
     or (r = 'co-owner' and (old_role = 'owner' or p_role = 'owner')) then
    raise exception 'not_authorized';
  end if;
  if l.closed_at is not null then raise exception 'list_closed'; end if;
  if old_role = 'owner' and p_role <> 'owner'
     and (select count(*) from app_private.members where list_id = p_id and role = 'owner') <= 1 then
    raise exception 'last_owner';
  end if;
  update app_private.members set role = p_role where list_id = p_id and user_id = p_user;
  return public.checklist_members(p_id);
end $$;

-- 참여자 제거/나가기: 관리자는 내보낼 수 없고 스스로 나갈 수도 없음
create or replace function public.checklist_remove_member(p_id uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.uid(); l app_private.lists%rowtype; r text; old_role text;
begin
  select * into l from app_private.lists where id = p_id for update;
  r := app_private.role_of(p_id, u);
  old_role := app_private.role_of(p_id, p_user);
  if l.id is null or r is null then raise exception 'not_found'; end if;
  if old_role is null then raise exception 'user_not_found'; end if;
  if app_private.is_admin(p_user) then raise exception 'admin_protected'; end if;
  if p_user <> u then
    if r <> 'owner' then raise exception 'not_authorized'; end if;
    if l.closed_at is not null then raise exception 'list_closed'; end if;
  end if;
  if old_role = 'owner'
     and (select count(*) from app_private.members where list_id = p_id and role = 'owner') <= 1 then
    raise exception 'last_owner';
  end if;
  delete from app_private.favorites where list_id = p_id and user_id = p_user;
  delete from app_private.members where list_id = p_id and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;
-- <<< 003 END

-- ---------------------------------------------------------------------
-- 5. 실행 권한: 로그인한 사용자(authenticated)만 public.checklist_* 실행 가능
-- ---------------------------------------------------------------------
revoke all on all functions in schema app_private from public, anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'checklist\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- =====================================================================
-- (참고) 처음부터 다시 설치해야 할 때만 아래 주석을 풀어 먼저 실행하십시오.
-- ⚠️ 모든 목록 데이터가 삭제됩니다. 로그인 계정(auth.users)은 남습니다.
-- ---------------------------------------------------------------------
-- drop trigger if exists checklist_before_signup on auth.users;
-- drop trigger if exists checklist_after_signup on auth.users;
-- drop trigger if exists checklist_strip_signup_code on auth.users;
-- drop function if exists public.checklist_me, public.checklist_set_display_name, public.checklist_family,
--   public.checklist_lists, public.checklist_create, public.checklist_save, public.checklist_toggle,
--   public.checklist_set_closed, public.checklist_delete, public.checklist_favorite, public.checklist_members,
--   public.checklist_add_member, public.checklist_set_role, public.checklist_remove_member,
--   public.checklist_public_lists, public.checklist_join, public.checklist_cancel_join, public.checklist_requests,
--   public.checklist_approve, public.checklist_reject, public.checklist_set_public;
-- drop schema if exists app_private cascade;
-- =====================================================================
