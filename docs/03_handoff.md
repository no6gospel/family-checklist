# 1차 개발 정리 · 2차 개발 인수인계

작성일: 2026-11-23 · 대상: 2차 개발 담당자(사람 또는 AI)

이 문서 하나로 **지금 무엇이 어떻게 돌아가는지**, **건드릴 때 무엇을 조심해야 하는지**를 파악할 수 있게 정리했습니다.
설치 절차는 [02_setup-guide.md](02_setup-guide.md)를, 1차 개발을 시작할 때의 설계 판단은 [01_review.md](01_review.md)를 보십시오.

> **먼저 읽을 것:** [§7 반드시 지켜야 할 것](#7-반드시-지켜야-할-것-깨지기-쉬운-곳)과 [§8 의도적으로 뺀 기능](#8-의도적으로-뺀-기능--버그가-아님). 이 둘을 모르고 고치면 운영 중인 가족 데이터나 로그인이 깨질 수 있습니다.

---

## 1. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 서비스 | 가족(5명 안팎) 전용 공유 체크리스트 웹앱 |
| 사이트 | https://no6gospel.github.io/family-checklist/ (GitHub Pages, `main` 브랜치 루트) |
| 저장소 | https://github.com/no6gospel/family-checklist (공개 저장소 — 비밀값 금지) |
| 백엔드 | Supabase 프로젝트 1개 (도쿄 리전, Free 플랜). 로그인 = Supabase Auth, 데이터 = PostgreSQL |
| 화면 기술 | 빌드 도구 없는 순수 HTML/CSS/JS(ES 모듈). `supabase-js@2.45.4`를 jsDelivr CDN에서 불러옴 |
| 상태 | **운영 중.** 가족 계정 가입 완료, 실제 목록 사용 중, 서비스 관리자 1명 지정 |
| 개발 환경 제약 | 1차 개발 PC에는 Node·Python이 없음. 로컬 시험은 PowerShell 서버(`tests/serve.ps1`)와 브라우저용 PostgreSQL(PGlite)로 함 |

```
가족 휴대폰/PC ──HTTPS──▶ GitHub Pages (index.html, css/, js/)
                              │  supabase-js (publishable key)
                              ▼
                     Supabase Auth  ──트리거──▶  app_private.profiles
                     PostgREST /rpc ──────────▶  public.checklist_* 함수 (security definer)
                                                     │ 권한 검사 후
                                                     ▼
                                               app_private.* 테이블 (외부 직접 접근 불가)
```

---

## 2. 파일 구조

```
index.html                    시작 파일. css/js를 ?v=버전 으로 불러옴(캐시 방지)
css/style.css                 전체 스타일. 휴대폰 규칙은 @media (max-width:800px), 터치는 (pointer:coarse)
js/config.js                  Supabase URL, publishable key, EMAIL_DOMAIN   ← 공개값만
js/app.js                     화면 동작 전체(약 1,500줄, 단일 파일)
supabase/schema.sql           새 설치용 전체 DB 스크립트(테이블·함수·트리거·권한). 002·003 내용 포함
supabase/migrations/002_*.sql 기존 DB 업그레이드: 가족 공개 목록·참가 요청
supabase/migrations/003_*.sql 기존 DB 업그레이드: 서비스 관리자
supabase/admin.sql            운영자용 SQL 모음(가입 코드 변경, 비밀번호 재설정, 관리자 지정 등)
docs/01_review.md             1차 착수 시 기존 자료 검토와 설계 변경 이유
docs/02_setup-guide.md        새 환경 설치·운영 가이드
docs/03_handoff.md            이 문서
tests/serve.ps1               로컬 정적 서버(http://localhost:8765)
tests/sql-test.html           DB 함수 시나리오 시험 117개 (PGlite)
tests/app-mock.html           Supabase 없이 화면 전체 시험 (가입 코드: family)
tests/pglite-backend.js       PGlite에 auth 흉내 + schema.sql 로드
tests/mock-supabase.js        supabase-js 대용 가짜 클라이언트
.claude/launch.json           Claude Code 미리보기용 서버 설정
_original/                    이전 AI 환경 자료 원본(실명 포함) — .gitignore로 제외, 저장소에 없음
```

---

## 3. 인증(로그인) 구조

### 3.1 아이디 로그인을 이메일 없이 구현한 방법
- Supabase Auth는 이메일/전화번호 기반입니다. 그래서 화면에서 **`아이디@EMAIL_DOMAIN`** 형식의 가짜 이메일로 바꿔 가입·로그인합니다(`js/app.js`의 `toEmail()`).
- 실제 메일은 보내지 않습니다. Supabase 대시보드에서 **Confirm email이 꺼져 있어야** 합니다.
- 아이디 규칙: 영문 소문자·숫자·밑줄 3~20자. 대문자는 소문자로 바꿉니다. 화면, DB check 제약, 트리거가 모두 같은 규칙입니다.

### 3.2 가입 제한 (가족 공용 가입 코드)
- `app_private.settings`의 `signup_code` 값과 가입 시 보낸 `user_metadata.signup_code`가 같아야 계정이 만들어집니다.
- 검사는 `auth.users`의 **BEFORE INSERT 트리거**(`checklist_before_signup`)가 합니다. 코드가 틀리면 계정 자체가 생기지 않습니다.
- 가입 직후 **AFTER INSERT 트리거**(`checklist_after_signup`)가 `app_private.profiles` 행을 만듭니다.
- **BEFORE UPDATE 트리거**(`checklist_strip_signup_code`)가 계정 정보에서 가입 코드를 지웁니다. 이유는 §7-2를 보십시오.

### 3.3 비밀번호·관리
- 비밀번호 재설정은 앱에 없습니다. `supabase/admin.sql` 3번(bcrypt로 `encrypted_password` 갱신 + `auth.sessions` 삭제)을 씁니다.
- 본인 비밀번호 변경은 앱의 **내 계정**에서 합니다. 현재 비밀번호로 다시 로그인해 확인한 뒤 `auth.updateUser`를 호출합니다.

---

## 4. 데이터 구조

### 4.1 테이블 (`app_private` 스키마 — anon/authenticated 권한 없음, RLS도 켬)
| 테이블 | 용도 | 핵심 컬럼 |
|---|---|---|
| `settings` | 설정값 | `key`, `value` (`signup_code`) |
| `profiles` | 사용자 | `id`(=auth.users.id), `username`(unique), `display_name`, `is_admin` |
| `lists` | 목록 | `id`, `kind`(standard/simple), **`data` jsonb**, `version`, `closed_at`, `is_public`, `updated_at` |
| `members` | 목록별 역할 | `(list_id, user_id)` PK, `role`(owner/co-owner/member/guest) |
| `favorites` | 사용자별 즐겨찾기 | `(user_id, list_id)` |
| `join_requests` | 일반 목록 참가 요청 | `(list_id, user_id)`, `requested_at` |

### 4.2 목록 내용(`lists.data`)은 JSON 문서 하나
```jsonc
{
  "name": "여행 준비",              // 1~70자
  "date": "2026-11-23" | "",        // Simple 전용(일반 목록은 반드시 "")
  "categories": [                   // 최대 100개
    { "id": "uuid", "name": "준비물", "subs": [ { "id": "uuid", "name": "서류" } ] }  // Simple은 subs 항상 []
  ],
  "tasks": [                        // 최대 2000개, 전체 1MB 이하
    { "id": "uuid", "text": "여권",  // 1~160자
      "cat": "카테고리id", "sub": "서브id" | "",
      "due": "YYYY-MM-DD" | "",       // Simple은 ""
      "done": false,
      "assignees": ["user uuid"],     // Simple은 []
      "createdBy": "user uuid", "createdAt": "ISO 문자열" }
  ]
}
```
- 순서는 배열 순서 그대로입니다. 카테고리 순서는 `categories`, 항목 순서는 `tasks`이고, 화면은 카테고리·서브별로 걸러서 보여 줍니다.
- 서버 검증은 `app_private.validate(data, kind)`가 합니다. 글자 수·개수 상한은 **화면의 `LIMIT` 상수와 일치**해야 합니다.

### 4.3 화면이 호출하는 함수 (모두 `public.checklist_*`, `security definer`, authenticated만 실행 가능)
| 함수 | 하는 일 | 권한 |
|---|---|---|
| `checklist_me` / `set_display_name` / `family` | 내 정보, 이름 변경, 가족 전체 | 로그인 |
| `checklist_lists` | 내가 참여한 목록 전체(내용 포함) | 로그인 |
| `checklist_public_lists` | 참여하지 않은 가족 공개 진행 중 목록(이름·요약만) | 로그인 |
| `checklist_create` | 목록 생성 + 만든 사람 Owner | 로그인 |
| `checklist_save(id, version, data)` | 목록 편집 저장(버전 검사, 완료 상태는 서버 값 유지) | Owner·Co-owner, 진행 중 |
| `checklist_toggle(id, task, done)` | 항목 하나 완료 체크(버전 안 올림) | Owner·Co-owner·Member, 진행 중 |
| `checklist_set_closed` / `checklist_delete` | 종결·재개 / 최종 삭제 | 종결: Owner·Co-owner, 삭제: Owner(종결 상태만) |
| `checklist_favorite` | 즐겨찾기 | 참여자 |
| `checklist_members` / `add_member` / `set_role` / `remove_member` | 참여자 관리 | §5 권한표 |
| `checklist_join` / `cancel_join` | 공개 목록 참가(일반=요청, Simple=즉시 Co-owner) / 요청 취소 | 로그인 |
| `checklist_requests` / `approve` / `reject` | 참가 요청 조회·승인(역할 지정)·거절 | Owner·Co-owner |
| `checklist_set_public` | 공개/비공개 전환 | Owner·Co-owner |

오류는 `raise exception '짧은_영문_코드'`로 돌려줍니다(예: `not_authorized`, `version_conflict`, `last_owner`, `admin_protected`). 화면의 `ERR` 표가 이 코드를 한국어 문구로 바꿉니다. **새 오류 코드를 만들면 `ERR`에도 추가**하십시오.

### 4.4 트리거
| 트리거 | 위치 | 하는 일 |
|---|---|---|
| `checklist_before_signup` | auth.users BEFORE INSERT | 가입 코드·아이디·이름 검사 |
| `checklist_after_signup` | auth.users AFTER INSERT | profiles 생성 |
| `checklist_strip_signup_code` | auth.users BEFORE UPDATE | 계정 정보에서 가입 코드 제거 |
| `checklist_admin_autojoin` | lists AFTER INSERT | 관리자를 새 목록 Owner로 추가 |
| `checklist_admin_granted` | profiles AFTER UPDATE OF is_admin | 관리자 지정 시 모든 목록에 Owner로 추가 |

---

## 5. 권한 규칙 (현재 운영 기준)

| 기능 | Owner | Co-owner | Member | Guest | 비참여 가족 |
|---|---|---|---|---|---|
| 목록 내용 보기 | ✔ | ✔ | ✔ | ✔ | ✖ (공개 목록은 이름·Owner·항목 수만) |
| 완료 체크 | ✔ | ✔ | ✔ | ✖ | ✖ |
| 항목·분류 편집, 순서 변경, 복제 | ✔ | ✔ | ✖ | ✖ | ✖ |
| 종결·재개 | ✔ | ✔ | ✖ | ✖ | ✖ |
| 종결 목록 최종 삭제 | ✔ | ✖ | ✖ | ✖ | ✖ |
| 참여자 추가·역할 변경·요청 승인 | 모든 역할 | Owner 제외 | ✖ | ✖ | ✖ |
| 참여자 내보내기 | ✔ | ✖ | ✖ | ✖ | ✖ |
| 공개/비공개 전환 | ✔ | ✔ | ✖ | ✖ | ✖ |
| 스스로 나가기 | ✔(마지막 Owner 제외) | ✔ | ✔ | ✔ | — |
| 참가 | — | — | — | — | 일반: 요청→승인 / Simple: 즉시 Co-owner |

- **마지막 Owner**는 강등하거나 내보낼 수 없습니다. 목록 행을 `for update`로 잠가 동시 요청도 막습니다.
- **종결 목록**은 읽기 전용입니다. 재개, 최종 삭제, 즐겨찾기, 스스로 나가기만 됩니다.
- **서비스 관리자(`profiles.is_admin`)** 는 모든 목록(비공개·종결 포함)에 실제 `members` 행으로 Owner 참가합니다. 아무도 내보내거나 강등할 수 없고, 스스로 나갈 수도 없습니다(`admin_protected`). 지정·해제는 SQL로만 합니다(`admin.sql` 7번). 현재 관리자 1명이 지정되어 있습니다.

---

## 6. 화면(`js/app.js`) 구조

| 구역 | 내용 |
|---|---|
| 상단 상수 | `LIMIT`(글자 수), `TEMPLATES`, `ERR`(오류 문구), `ROLE_LABEL` |
| `S` 상태 객체 | `me`, `family`, `lists`, `publicLists`, `sel`, `search`, `filter`, `picked`, `pending`, `epoch`, `editing`, `drag` |
| 저장 흐름 | `edit(mutator)`: 화면에 먼저 반영 → `enqueue`로 순서대로 `checklist_save`. 실패하면 `S.epoch++`로 뒤에 예약된 저장을 취소하고 최신 상태를 다시 불러옴 |
| 완료 체크 | `toggleTask()` → `checklist_toggle` (편집과 별개라 충돌이 없음) |
| 갱신 | 30초마다, 그리고 화면 복귀 시 `maybeRefresh()`. 편집 중·대화상자 열림·드래그 중·저장 중에는 건너뜀. 실시간 구독은 없음 |
| 렌더링 | `renderAll` → `renderSidebar` / `renderMain` → `renderGroups`. 문자열 템플릿 + `esc()`로 이스케이프. **사용자 입력은 반드시 `esc()`를 거쳐 출력** |
| 이벤트 | `document`에 click/submit/change/input 핸들러를 하나씩 두고 `data-action`, 폼 `id`로 분기 |
| 드래그 | Pointer Events 방식(마우스·터치 공통). `.grip`에 `touch-action:none`. 6px 움직이면 시작, 화면 끝에서 자동 스크롤. HTML5 DnD는 쓰지 않음 |
| 브라우저 저장 | `checklist.sel`(마지막 목록), `checklist.collapsed`(카테고리 접힘), Supabase 세션. 모두 기기별 |

---

## 7. 반드시 지켜야 할 것 (깨지기 쉬운 곳)

1. **`EMAIL_DOMAIN`(`js/config.js`)을 절대 바꾸지 마십시오.** 바꾸는 순간 기존 가족 전원이 로그인할 수 없습니다. 바꿔야 한다면 `auth.users.email`을 일괄 변경하는 이전 작업을 먼저 해야 합니다. 현재 값 `family-checklist.app`은 실제 Supabase에서 가입이 되는 것을 확인했습니다.
2. **Supabase Auth의 숨은 동작:**
   - 가입 직후 사용자 정보를 한 번 더 UPDATE합니다. 그래서 INSERT 트리거에서 지운 메타데이터가 되살아났고, 이를 BEFORE UPDATE 트리거로 막았습니다.
   - 트리거에서 `raise exception`한 문구가 가입 API 응답에 **그대로**(`invalid_signup_code`, HTTP 500) 옵니다. 화면은 이 코드와 "Database error" 둘 다 처리합니다.
   - **PGlite 시험은 이 동작을 흉내 내지 못합니다.** auth 관련 변경은 반드시 실제 Supabase에서 확인하십시오.
3. **DB 변경 절차:**
   - 새 기능은 `supabase/migrations/00N_*.sql`로 만듭니다. 같은 내용을 `schema.sql`의 `-- 5. 실행 권한` 바로 위에 `>>> 00N BEGIN` / `<<< 00N END` 블록으로도 넣습니다(새 설치용).
   - **다시 실행해도 안전하게** 작성합니다(`if not exists`, `create or replace`, `drop trigger if exists`). 시험 페이지가 재실행을 검사합니다.
   - 마이그레이션 끝에 **권한 정리 블록**(public.checklist_* 전체에 anon revoke, authenticated grant)을 반드시 붙입니다. Supabase는 public 함수를 만들면 anon에게도 실행 권한을 기본으로 줍니다.
   - 운영 적용은 SQL Editor에서 합니다. "destructive operation" 경고가 뜨면 **문장을 하나씩 확인한 뒤** 실행하십시오(revoke, drop trigger만으로도 경고가 뜹니다).
4. **같은 이름의 함수를 인자 타입만 바꿔 새로 만들지 마십시오.** PostgREST가 어느 함수를 부를지 정하지 못해 호출이 실패합니다. 실제로 이 프로젝트에는 이전 AI가 만든 `checklist_save(p_id text …)` 같은 함수 28개가 남아 있어 충돌했고, 1차에서 삭제했습니다. 시그니처를 바꿀 때는 `drop function` 후 다시 만드십시오.
5. **완료 상태(`done`)는 `checklist_toggle`만 바꿉니다.** `checklist_save`는 기존 항목의 `done`을 DB 값으로 덮어씁니다(동시 체크 보호). "모두 체크 해제" 같은 기능이 필요하면 **전용 RPC를 새로 만드십시오.** save로는 되지 않습니다.
6. **글자 수·개수 상한은 세 곳이 일치해야 합니다:** 화면 `LIMIT`, 입력창 `maxlength`, `app_private.validate()`.
7. **항목에 새 필드를 추가할 때:** `validate()`는 모르는 키를 막지 않지만, Simple 금지 규칙과 복제·백업 가져오기(`submitDuplicate`, `importBackup`)에서 그 필드를 어떻게 처리할지 정해야 합니다.
8. **관리자는 실제 `members` 행입니다.**
   - "Owner 수" 계산에 관리자도 포함됩니다. 그래서 원래 만든 사람도 Owner를 내려놓을 수 있습니다(관리자가 남아 있으므로).
   - 관리자를 해제해도 참여 행은 남습니다.
9. **화면을 배포할 때마다 `index.html`의 `?v=` 값 두 곳(css, js)을 올리십시오.** GitHub Pages는 최대 10분 캐시하므로, 올리지 않으면 가족 휴대폰에서 예전 화면이 계속 보입니다. 현재 값은 `20261124-1`입니다. `config.js`는 `app.js`가 상대 경로로 불러오므로 함께 캐시될 수 있습니다. 설정을 바꿨다면 같이 확인하십시오.
10. **저장소는 공개입니다.** `config.js`에는 URL과 **publishable key**만 둡니다. secret/service_role 키, 가입 코드, 실제 비밀번호, 가족 실명·아이디는 커밋하지 마십시오. `_original/`은 실명 때문에 제외되어 있습니다.
11. **Supabase Free 플랜 제약:**
    - 7일 동안 쓰지 않으면 일시정지됩니다(대시보드에서 Restore하면 데이터는 유지).
    - **백업 다운로드가 없습니다.** 앱의 "백업 내보내기"(JSON)가 유일한 백업 수단입니다. 가져오기는 "새 목록으로 추가"만 하고, 참여자·담당자·종결 상태는 복원하지 않습니다.
12. **supabase-js는 `2.45.4`로 고정**되어 있습니다(CDN). 올릴 때는 `rpc`, `auth.signUp/signInWithPassword/updateUser/onAuthStateChange` 동작과 publishable key 호환을 확인하십시오. Supabase는 기존 anon 키를 2027년 초에 없앤다고 안내했고, 이 프로젝트는 이미 publishable key를 씁니다.
13. **`schema.sql` 맨 아래 "초기화" 주석은 모든 목록 데이터를 지웁니다.** 운영 DB에서는 실행하지 마십시오.

---

## 8. 의도적으로 뺀 기능 — 버그가 아님

최초 제작지시서(`_original/01_build-instructions.md`, 저장소 밖)에 있었지만 가족 규모에 맞춰 **1차에서 일부러 빼거나 바꾼** 것들입니다. 되살리려면 사용자와 먼저 상의하십시오.

| 지시서 내용 | 1차 결정 |
|---|---|
| Cognito + Lambda + DynamoDB 인증 | Supabase Auth + 가짜 이메일 도메인 |
| 관리자 발급 1회용 가입 초대(48시간) | 가족 공용 가입 코드(SQL로 변경) |
| 1회용 목록 초대 코드 | 아이디로 직접 추가 + 가족 공개 목록 [참가](요청·승인) |
| 앱 안 관리자 모드(별도 비밀번호, 15분 인증) | 관리자 권한은 DB 플래그, 운영 작업은 SQL Editor |
| 앱에서 관리자가 임시 비밀번호 발급 | `admin.sql` 3번 |
| 항목 변경 이력, 관리자 감사 로그 | 없음(지시서도 "이력 없음"으로 정리) |
| 미저장 내용 다운로드(충돌 시) | 모든 동작이 즉시 저장되므로 생략. 충돌 시 최신 상태를 다시 불러오고 안내 |
| 실시간 동기화 | 30초 폴링 + 화면 복귀 시 갱신 |
| Simple 날짜 연·월·일 선택 상자 | 기본 날짜 선택기 + "날짜 선택 안 함" |

---

## 9. 시험 방법

| 시험 | 방법 | 마지막 결과 |
|---|---|---|
| DB 함수 시나리오 | `tests/serve.ps1` 실행 → `http://localhost:8765/tests/sql-test.html` | **117/117 통과** (권한, 검증, 충돌, 공개·참가, 관리자, 마이그레이션 재실행) |
| 화면 전체 | `http://localhost:8765/tests/app-mock.html` (가입 코드 `family`, DB는 새로고침하면 초기화) | 가입·편집·드래그·공유·관리자 표시 확인 |
| 실제 환경 | 배포 사이트 + 운영 Supabase | 가입, 틀린 코드 차단, 비로그인 차단, 목록 생성·체크·추가·드래그·종결·삭제, 공개 목록 표시, 관리자 자동 Owner 확인 |

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\serve.ps1
```

**아직 실제 환경에서 확인하지 못한 것**
- 두 사람이 실제로 동시에 편집할 때의 충돌 안내
- 실제 아이폰·안드로이드에서의 터치 드래그와 휴대폰 화면 배치(브라우저의 휴대폰 크기 화면으로만 확인)
- 실제 계정끼리의 참가 요청 → 승인 흐름(가짜 DB에서는 확인)
- `admin.sql` 3번 비밀번호 재설정, 백업 가져오기
- 목록 수천 항목 규모의 성능

---

## 10. 운영 정보

- **Supabase 대시보드:** 프로젝트 소유자의 계정으로 로그인합니다(GitHub 연동). 프로젝트 ref는 `js/config.js`의 URL에 있습니다.
- **현재 가입 코드:** 사용자만 압니다. 문서·저장소·대화에 남기지 않습니다. 확인이 필요하면 SQL Editor에서 `app_private.settings`를 조회하십시오.
- **관리자 확인:** `select username from app_private.profiles where is_admin;`
- **배포:** `main`에 push하면 1~3분 뒤 Pages에 반영됩니다(§7-9 버전 번호 주의).

---

## 11. 2차 개발 후보 (참고용, 확정 아님)

- 실시간 반영(Supabase Realtime): 지금은 데이터가 비공개 스키마에 있어 그대로는 구독할 수 없습니다. 변경 알림용 공개 테이블이나 broadcast가 필요합니다.
- 홈 화면 앱(PWA manifest·아이콘), 오프라인 표시
- 앱 안 관리자 화면(가입 코드 변경, 비밀번호 재설정): 지금은 SQL Editor로만 할 수 있습니다. 만든다면 반드시 서버 함수에서 `is_admin`을 검사해야 합니다.
- 항목 순서 변경 시 저장 데이터 크기: 목록 전체를 매번 저장하므로, 수천 항목이 되면 부분 저장 RPC를 검토하십시오.
- `js/app.js` 단일 파일 분리: 커지면 모듈로 나누는 것을 권합니다(빌드 도구 없이 ES 모듈로 가능).

---

## 12. 1차 개발 이력 (2026-11-23)

| 커밋 | 내용 |
|---|---|
| `0f4d0f4` | 첫 배포: 화면, schema.sql, 문서, 시험 도구 |
| `92e9b61` | Supabase 연결 설정(config.js) — 기존 프로젝트를 재사용하고, 이전 AI가 남긴 함수 28개와 스키마를 사용자 승인 후 삭제 |
| `2afe539` | 가입 오류 문구 처리 보강 |
| `5fec88e` | 가입 코드가 계정 정보에 남던 문제 수정(BEFORE UPDATE 트리거) |
| `c1458ac` | 가족 공개 목록·참가 요청(002) |
| `7ce0479` | 카테고리 접기/펼치기, 휴대폰 간격 축소 |
| `1cdd447` | 화면 파일 버전 번호(캐시 방지) |
| `35534da` | 서비스 관리자(003), 관리자 계정 지정 |
| 그 외 | README·가이드 갱신 |

기능 변화 순서: 기본 기능(목록·항목·역할·종결·복제·백업) → 휴대폰 터치 드래그(Pointer Events로 교체) → 가족 공개·참가 → 카테고리 접기·휴대폰 간격 축소 → 서비스 관리자.
