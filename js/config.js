// =====================================================================
// 배포 설정 — Supabase 대시보드 → Project Settings → API (또는 Connect) 에서 복사해 넣습니다.
//
// 이 두 값(Project URL, anon/publishable key)은 브라우저에 공개되도록 만들어진 값이라
// GitHub에 올려도 됩니다. 데이터는 로그인과 DB 함수의 권한 검사로 보호됩니다.
// ⚠️ service_role / secret 키는 절대 여기에 넣지 마십시오.
// =====================================================================

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-OR-PUBLISHABLE-KEY';

// 아이디를 Supabase 로그인용 이메일로 바꿀 때 붙이는 도메인입니다. (메일은 보내지 않습니다)
//   예: 아이디 mom → mom@family-checklist.app
// ⚠️ 가족이 가입한 뒤에는 바꾸지 마십시오. 바꾸면 기존 계정으로 로그인할 수 없습니다.
// 첫 가입 시험에서 "이메일 형식" 오류가 나면 다른 도메인으로 바꿔 다시 시험하십시오(설치 가이드 6단계).
export const EMAIL_DOMAIN = 'family-checklist.app';
