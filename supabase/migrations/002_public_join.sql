-- =====================================================================
-- 002 · 가족 공개 목록과 참가 요청
--   - 모든 목록은 기본으로 '가족 공개' : 멤버가 아닌 가족도 목록 이름을 보고 [참가]할 수 있음
--   - 일반 목록: 참가 → 요청 대기 → Owner/Co-owner가 역할을 정해 승인(또는 거절)
--   - Simple 목록: 참가 → 바로 Co-owner
--   - Owner/Co-owner는 목록을 비공개로 바꿀 수 있음
-- 이미 schema.sql 을 실행한 프로젝트에서 이 파일을 SQL Editor 로 한 번 실행합니다.
-- (새로 설치하는 경우 schema.sql 에 같은 내용이 들어 있으므로 실행하지 않아도 됩니다)
-- =====================================================================

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

-- 실행 권한 다시 정리
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
