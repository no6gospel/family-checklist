-- =====================================================================
-- 003 · 서비스 관리자(admin)
--   - profiles.is_admin = true 인 계정은 모든 목록(비공개 포함)에 Owner로 자동 참가합니다.
--     · 관리자로 지정되는 순간 기존 목록 전체에 Owner로 들어가고
--     · 이후 새로 만들어지는 목록에도 자동으로 Owner로 들어갑니다.
--   - 관리자의 참여는 다른 사람이 내보내거나 Owner 아래로 바꿀 수 없고, 스스로 나갈 수도 없습니다.
--   - 관리자 지정·해제는 앱이 아니라 Supabase SQL Editor 에서만 합니다 (supabase/admin.sql 7번).
-- 이미 설치된 DB에서 이 파일을 SQL Editor로 한 번 실행합니다. (새 설치는 schema.sql 에 포함)
-- =====================================================================

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
