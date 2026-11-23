# 설치 가이드 — Supabase + GitHub Pages

기준일: 2026-11-23 · 예상 소요 시간: 30~40분 · 비용: 0원 (Supabase Free, GitHub Free)

완성되면 이렇게 동작합니다.

```
가족 휴대폰/PC ──▶ GitHub Pages (화면: index.html, js, css)
                     │  아이디·비밀번호 로그인, 목록 읽기/저장
                     ▼
                  Supabase (로그인 계정 + PostgreSQL DB)
```

> 대시보드의 메뉴 이름은 Supabase·GitHub가 자주 바꿉니다. 이름이 조금 다르면 비슷한 메뉴를 찾아 주세요.
> 비밀번호·가입 코드·DB 비밀번호는 이 문서나 AI 대화에 적지 마십시오.

---

## 1단계. Supabase 프로젝트 만들기

1. https://supabase.com 에 로그인합니다(GitHub 계정으로 로그인하면 편합니다).
2. **New project**를 누릅니다.
   - Name: 원하는 이름(예: `family-checklist`)
   - Database Password: **Generate**로 만들고 안전한 곳에 보관합니다(앱에서는 쓰지 않습니다).
   - Region: **Northeast Asia (Seoul)**
   - Plan: Free
3. 프로젝트가 준비될 때까지 1~2분 기다립니다.

## 2단계. 로그인 설정 (중요)

**Authentication → Sign In / Providers (또는 Providers) → Email** 에서 다음과 같이 설정합니다.

| 항목 | 설정 | 이유 |
|---|---|---|
| Enable Email provider | **켜기** | 아이디를 내부적으로 이메일 형식으로 저장합니다 |
| **Confirm email** | **끄기** | 켜져 있으면 존재하지 않는 주소로 확인 메일을 보내려다 가입이 막힙니다 |
| Allow new users to sign up | 켜기 | 가족 가입용입니다. 가입은 "가입 코드"로 제한됩니다 |
| Minimum password length (있으면) | 8 | 화면의 규칙과 맞춥니다 |

**Save**를 누릅니다.

## 3단계. DB 만들기 (SQL 실행)

1. 왼쪽 메뉴 **SQL Editor → New query**를 엽니다.
2. 이 프로젝트의 `supabase/schema.sql` 파일 내용을 **전부** 복사해 붙여 넣고 **Run**을 누릅니다.
3. 아래쪽에 `Success. No rows returned`가 나오면 성공입니다.
   - 오류가 나면 오류 문구 전체를 복사해 두십시오. 이미 한 번 실행한 상태라면 `already exists`가 나옵니다. 이 경우 파일 맨 아래 "초기화" 주석을 참고하십시오.
4. **가입 코드를 바꿉니다.** New query에 아래 한 줄을 입력하고, `<새 가입 코드>`를 가족만 알 값으로 바꿔 실행합니다.

   ```sql
   update app_private.settings set value = '<새 가입 코드>' where key = 'signup_code';
   ```

   실행한 뒤 쿼리 탭은 저장하지 않고 닫습니다.

> 이 SQL은 PGlite(브라우저용 PostgreSQL)에서 74개 시나리오 시험을 통과했습니다. 실제 Supabase에서의 첫 실행은 이 단계가 처음입니다.

## 4단계. 연결 정보 복사

**Project Settings → API Keys**(또는 상단 **Connect** 버튼)에서 두 가지를 찾습니다.

- **Project URL**: `https://xxxxxxxx.supabase.co`
- **anon public** 키(`eyJ...`로 시작) 또는 **Publishable key**(`sb_publishable_...`)

> ⚠️ `service_role` / `secret` 키는 **절대** 쓰지 마십시오. 이 키는 모든 권한 검사를 건너뜁니다.

## 5단계. `js/config.js` 수정

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';      // 4단계의 Project URL
export const SUPABASE_ANON_KEY = 'eyJ... 또는 sb_publishable_...'; // 4단계의 anon/publishable 키
export const EMAIL_DOMAIN = 'family-checklist.app';                // 6단계 시험 후 확정
```

URL과 anon 키는 공개되도록 만들어진 값이므로 GitHub에 올려도 됩니다. 데이터는 로그인과 DB 함수의 권한 검사로 보호됩니다.

## 6단계. 내 PC에서 먼저 시험 (가입 1회)

Node나 Python 없이 PowerShell만으로 시험 서버를 띄웁니다. 프로젝트 폴더에서 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\serve.ps1
```

1. 브라우저에서 `http://localhost:8765` 를 엽니다.
2. **가입** 탭에서 3단계의 가입 코드, 본인 아이디, 표시 이름, 비밀번호로 가입합니다.
3. 결과에 따라 다음과 같이 합니다.
   - 목록 화면으로 들어가면 **성공**입니다. 이제 `EMAIL_DOMAIN`을 **절대 바꾸지 마십시오.**
   - "관리자 설정 문제로 가입할 수 없습니다 (EMAIL_DOMAIN 확인)"가 나오면 Supabase가 그 도메인을 거부한 것입니다. `config.js`의 `EMAIL_DOMAIN`을 다른 값(예: `checklist.family-app.net`)으로 바꾸고 새로고침한 뒤 다시 가입합니다.
   - "가입 코드가 맞지 않습니다"가 나오면 3단계 4번의 코드를 확인합니다.
   - "Confirm email 설정을 꺼 달라"가 나오면 2단계를 확인합니다. 이때 계정은 이미 만들어졌으므로 **Authentication → Users**에서 그 사용자를 지운 뒤 다시 가입합니다.
4. 목록 하나를 만들고 항목을 체크해 봅니다.
5. PowerShell 창에서 `Ctrl+C`로 서버를 끕니다.

> 참고: `tests/app-mock.html`은 Supabase 없이 브라우저 안의 가짜 DB로 화면을 시험하는 페이지(가입 코드 `family`)이고, `tests/sql-test.html`은 DB 함수 시험 페이지입니다. 둘 다 실제 데이터와 무관합니다.

## 7단계. GitHub에 올리기

### 7-1. 저장소 만들기
1. https://github.com 에서 **New repository**를 누릅니다.
2. 이름을 정합니다(예: `family-checklist`). 이 이름이 주소에 들어갑니다.
3. **Public**을 선택합니다(GitHub Free에서 Pages를 쓰려면 공개 저장소여야 합니다). README 추가는 체크하지 않고 **Create repository**를 누릅니다.

> 공개해도 괜찮은 이유: 코드에는 비밀값이 없고, 가족 데이터는 GitHub이 아니라 Supabase에 있습니다. 실명이 들어간 `_original/` 폴더는 `.gitignore`로 제외돼 있습니다.

### 7-2. 코드 올리기 (Git 명령)
프로젝트 폴더에서 PowerShell로 한 줄씩 실행합니다. `<깃허브아이디>`와 `<저장소이름>`은 바꿔서 입력합니다.

```powershell
git init -b main
```
```powershell
git add .
```
```powershell
git status
```
`git status` 목록에 `_original/`이나 백업 파일(`checklist-backup-*.json`)이 **없는지** 확인합니다.
```powershell
git commit -m "가족 체크리스트 첫 배포"
```
```powershell
git remote add origin https://github.com/<깃허브아이디>/<저장소이름>.git
```
```powershell
git push -u origin main
```
처음 push할 때 GitHub 로그인 창이 뜨면 브라우저로 로그인합니다.

> Git 명령이 어렵다면: 저장소 화면의 **uploading an existing file** 링크를 누르고 `index.html`, `css`, `js`, `supabase`, `docs`, `tests`, `README.md`, `.gitignore`를 끌어다 놓은 뒤 **Commit changes**를 눌러도 됩니다. 이때 `_original` 폴더는 올리지 마십시오.

### 7-3. GitHub Pages 켜기
1. 저장소 **Settings → Pages**로 갑니다.
2. Source: **Deploy from a branch**, Branch: **main**, 폴더: **/(root)** → **Save**를 누릅니다.
3. 1~3분 뒤 같은 화면 위쪽에 `https://<깃허브아이디>.github.io/<저장소이름>/` 주소가 나타납니다.
4. 그 주소로 접속해 6단계에서 만든 계정으로 로그인합니다.

## 8단계. 가족 초대

1. 가족에게 **사이트 주소**와 **가입 코드**를 직접 전달합니다(카톡 등).
2. 각자 **가입** 탭에서 아이디·표시 이름·비밀번호를 정해 가입합니다.
3. 목록을 함께 쓰는 방법은 두 가지입니다.
   - **참가(기본):** 새 목록은 가족 공개로 만들어집니다. 다른 가족은 왼쪽 **가족 공개 목록**에서 [참가]를 누릅니다.
     - 일반 목록: 참가 요청이 오면 Owner/Co-owner가 **멤버** 창에서 역할을 정해 **승인**합니다. 요청이 있으면 멤버 버튼에 "참가 요청 N"이 표시됩니다.
     - Simple 목록: 참가하면 바로 Co-owner가 됩니다.
   - **직접 추가:** **멤버** 버튼 → **가족 추가**에서 사람과 역할을 골라 넣습니다.
   - 공개하고 싶지 않은 목록은 **멤버** 창 맨 위의 "가족 공개" 체크를 끕니다.
4. 모두 가입했으면 3단계 4번의 SQL로 **가입 코드를 다른 값으로 바꿔** 더 이상 가입할 수 없게 합니다.
5. 휴대폰에서는 브라우저 메뉴의 **홈 화면에 추가**를 쓰면 앱처럼 열 수 있습니다.

### 역할 안내

| 역할 | 할 수 있는 일 |
|---|---|
| Owner | 모든 작업 + 참여자 내보내기 + 종결 목록 최종 삭제 |
| Co-owner | 항목·분류 편집, 복제, 종결·재개, 참여자 추가·역할 변경(Owner 제외) |
| Member | 완료 체크 |
| Guest | 보기만 |

누구나 자기 즐겨찾기를 설정하고, 목록에서 스스로 나갈 수 있습니다(마지막 Owner는 나갈 수 없음).

---

## 운영

### 비밀번호를 잊은 가족이 있을 때
`supabase/admin.sql`의 **3번**을 SQL Editor에서 실행합니다. 임시 비밀번호를 정해 넣고 실행한 뒤 본인에게 알려 주면, 본인이 로그인해서 **내 계정 → 비밀번호 변경**으로 바꿉니다. 두 번째 문장이 기존 로그인을 끊습니다.

### 관리자(나) 본인의 비밀번호를 잊었을 때
같은 방법을 씁니다. Supabase 대시보드에 로그인할 수 있으면 언제든 복구할 수 있습니다. 그러니 **Supabase 계정(또는 연결한 GitHub 계정)만 잘 지키면 됩니다.**

### 계정 삭제
`admin.sql` **4번**으로 그 사람이 유일한 Owner인 목록이 없는지 확인하고, 있으면 소유권을 넘깁니다. 그다음 **Authentication → Users**에서 삭제합니다.

### 일시정지 주의 (무료 플랜)
Supabase Free 프로젝트는 **7일 동안 사용이 없으면 일시정지**될 수 있습니다. 앱이 열리지 않으면 Supabase 대시보드에 들어가 프로젝트의 **Restore**를 누르면 됩니다(데이터는 유지). 정책은 바뀔 수 있으니 대시보드 안내를 확인하십시오.

### 백업
무료 플랜에는 백업 파일 다운로드가 없습니다. 그래서 앱에 백업 기능을 넣었습니다.
- 한 달에 한 번 정도 왼쪽 아래 **백업 내보내기**를 눌러 파일을 저장합니다. 내가 참여한 목록 전체가 저장됩니다.
- 복원할 때는 **백업 가져오기**를 씁니다. 백업의 목록이 **새 목록으로 추가**되고 기존 목록은 바뀌지 않습니다. 참여자·담당자·종결 상태는 복원되지 않습니다.
- 백업 파일은 GitHub에 올리지 마십시오(`.gitignore` 처리돼 있음).
- 처음 설치한 뒤 **한 번은 내보내기 → 가져오기를 직접 해 보고** 목록이 제대로 복원되는지 확인하십시오.

### DB 업그레이드
`supabase/migrations/`의 파일은 **이미 설치된 DB**에 새 기능을 더하는 SQL입니다. 새로 설치할 때는 `schema.sql`에 이미 들어 있으므로 실행하지 않습니다.
- `002_public_join.sql`: 가족 공개 목록과 참가 요청. 2026-11-23 현재 운영 DB에 적용했습니다. 이 업그레이드로 기존 목록도 모두 가족 공개가 됐습니다.

### 화면 수정·재배포
코드를 고쳤다면 먼저 `index.html`의 `?v=` 값 두 곳(css, js)을 새 값으로 바꿉니다. 그래야 가족의 휴대폰이 예전 파일을 계속 쓰지 않습니다. 그다음 `git add .` → `git commit -m "설명"` → `git push`를 실행하면 1~3분 뒤 Pages에 반영됩니다. 데이터는 Supabase에 있으므로 영향이 없습니다. 휴대폰에 이전 화면이 보이면 새로고침합니다.

---

## 실제 환경 확인 목록 (배포 후 1회)

PGlite 시험으로 DB 논리는 확인했지만, 실제 Supabase와 GitHub Pages 조합에서는 아래를 한 번씩 직접 확인해 주십시오.

- [ ] 6단계: 가짜 이메일 도메인으로 가입·로그인이 됨
- [ ] 틀린 가입 코드로는 가입이 안 됨
- [ ] 두 번째 계정(가족 또는 테스트 계정)에 목록을 공유하기 전에는 그 계정에서 목록이 보이지 않음
- [ ] Member로 공유하면 완료 체크만 되고 편집 버튼이 보이지 않음
- [ ] 두 기기에서 동시에 체크해도 오류 없이 반영됨(30초 안에, 또는 화면 전환 시 갱신)
- [ ] 실제 휴대폰(아이폰·안드로이드)에서 ☰ 를 손가락으로 끌어 항목·카테고리를 옮길 수 있고, 끄는 동안 화면이 스크롤되지 않음
- [ ] `admin.sql` 3번으로 비밀번호 재설정 후 새 비밀번호로 로그인됨
- [ ] 백업 내보내기 → 가져오기로 목록이 새로 생김
- [ ] (선택) 브라우저 개발자 도구에서 로그아웃 상태로 `checklist_lists`를 호출하면 거부됨

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| "설정이 필요합니다" 화면 | `js/config.js`의 URL·키를 넣고 다시 push 했는지 |
| 가입 시 "가입 코드가 맞지 않습니다" | 3단계 4번의 코드. 앞뒤 공백 없이 입력 |
| 가입 시 "EMAIL_DOMAIN 확인" | 6단계 3번 참고 |
| 로그인 시 "Confirm email 끄기" 안내 | 2단계 |
| "계정 정보가 없습니다" | `schema.sql`을 실행하기 **전에** 만든 계정입니다. Users에서 지우고 다시 가입 |
| 저장 시 "다른 가족이 먼저 수정했습니다" | 정상 동작입니다. 최신 내용을 불러왔으니 방금 작업을 다시 하면 됩니다 |
| 앱 전체가 열리지 않음 | Supabase 프로젝트가 일시정지됐는지(운영 → 일시정지 주의) |
