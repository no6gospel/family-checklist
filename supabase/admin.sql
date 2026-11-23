-- =====================================================================
-- 관리자용 SQL 모음 (Supabase 대시보드 → SQL Editor 에서 필요한 부분만 골라 실행)
-- 이 파일 자체는 실행하지 마십시오. 각 블록의 '꺾쇠 괄호' 값을 바꾼 뒤 그 블록만 실행합니다.
-- ⚠️ 실제 비밀번호·가입 코드를 이 파일에 저장하거나 GitHub에 올리지 마십시오.
--    SQL Editor 에서 입력·실행한 뒤 저장하지 않고 닫으면 됩니다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 가족 가입 코드 바꾸기 (설치 직후 반드시 1회)
--    가입 화면에서 이 코드를 입력해야 계정이 만들어집니다.
--    가족이 모두 가입한 뒤 다른 값으로 바꿔 두면 사실상 가입이 닫힙니다.
-- ---------------------------------------------------------------------
update app_private.settings set value = '<새 가입 코드>' where key = 'signup_code';


-- ---------------------------------------------------------------------
-- 2. 가입한 가족 확인
-- ---------------------------------------------------------------------
select p.username, p.display_name, p.created_at, u.last_sign_in_at
from app_private.profiles p join auth.users u on u.id = p.id
order by p.created_at;


-- ---------------------------------------------------------------------
-- 3. 비밀번호 잊은 가족의 비밀번호 재설정
--    임시 비밀번호를 정해 실행하고, 본인에게 직접 알려 준 뒤
--    본인이 로그인해서 [내 계정 → 비밀번호 변경]으로 바꾸게 합니다.
--    두 번째 문장은 그 사람의 기존 로그인(다른 기기 포함)을 모두 끊습니다.
-- ---------------------------------------------------------------------
update auth.users
   set encrypted_password = extensions.crypt('<임시 비밀번호 8자 이상>', extensions.gen_salt('bf'))
 where id = (select id from app_private.profiles where username = '<아이디>');

delete from auth.sessions
 where user_id = (select id from app_private.profiles where username = '<아이디>');


-- ---------------------------------------------------------------------
-- 4. 목록 소유권 넘기기 (계정 삭제 전, 또는 Owner가 없는 목록 정리)
--    <아이디> 가 참여 중인 목록과 역할 보기
-- ---------------------------------------------------------------------
select l.id, l.data->>'name' as list_name, m.role,
       (select count(*) from app_private.members x where x.list_id = l.id and x.role = 'owner') as owner_count
from app_private.members m join app_private.lists l on l.id = m.list_id
where m.user_id = (select id from app_private.profiles where username = '<아이디>');

-- 특정 목록에서 다른 가족을 Owner로 지정 (이미 참여자면 역할 변경, 아니면 추가)
insert into app_private.members(list_id, user_id, role)
values ('<목록 id>', (select id from app_private.profiles where username = '<새 Owner 아이디>'), 'owner')
on conflict (list_id, user_id) do update set role = 'owner';


-- ---------------------------------------------------------------------
-- 5. 계정 삭제
--    대시보드 → Authentication → Users → 해당 사용자(아이디@도메인) → Delete user
--    삭제하면 그 사람의 참여 정보·즐겨찾기도 함께 지워집니다. 목록 자체는 남습니다.
--    먼저 4번으로 그 사람이 '유일한 Owner'인 목록이 없는지 확인하십시오.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 7. 서비스 관리자(admin) 지정 / 해제
--    관리자는 모든 목록(비공개 포함)에 Owner로 자동 참가하며, 다른 사람이 내보내거나 강등할 수 없습니다.
--    지정하는 순간 기존 목록 전체에 Owner로 들어갑니다.
-- ---------------------------------------------------------------------
update app_private.profiles set is_admin = true where username = '<아이디>';

-- 현재 관리자 확인
select username, display_name from app_private.profiles where is_admin;

-- 해제 (참여 정보는 남습니다. 필요하면 각 목록의 Owner가 멤버 창에서 내보내면 됩니다)
update app_private.profiles set is_admin = false where username = '<아이디>';


-- ---------------------------------------------------------------------
-- 6. 사용량 확인 (목록 수, 항목 수)
-- ---------------------------------------------------------------------
select count(*) as lists,
       sum(jsonb_array_length(data->'tasks')) as tasks,
       pg_size_pretty(sum(pg_column_size(data))::bigint) as data_size
from app_private.lists;
