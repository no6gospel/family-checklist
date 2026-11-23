// =====================================================================
// 우리 가족 체크리스트 — 화면 코드
//   데이터: Supabase (DB 함수 public.checklist_* 만 호출)
//   로그인: Supabase Auth (아이디 → 아이디@EMAIL_DOMAIN 으로 변환, 메일 발송 없음)
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_DOMAIN } from './config.js';

// ---------------------------------------------------------------------
// 기본 도구
// ---------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const fmtDateTime = iso => {
  if (!iso) return '확인 불가';
  const d = new Date(iso);
  return isNaN(d) ? '확인 불가' : `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const ROLE_LABEL = { owner: 'Owner', 'co-owner': 'Co-owner', member: 'Member', guest: 'Guest' };
const ROLE_DESC = { owner: '모든 권한', 'co-owner': '편집·종결·참여자 추가', member: '완료 체크', guest: '보기만' };
const LIMIT = { listName: 70, catName: 70, task: 160, display: 20 };

const TEMPLATES = {
  empty:   { label: '빈 목록',    cats: [['기본', []]] },
  travel:  { label: '여행',       cats: [['출발 전', ['숙소 예약', '교통편 확인', '여행자 보험']], ['준비물', ['여권·신분증', '충전기', '상비약']]] },
  baby:    { label: '출산·육아',  cats: [['출산 준비', ['출산 가방 싸기', '병원 일정 확인']], ['육아 용품', ['기저귀', '젖병', '손수건']]] },
  meeting: { label: '회의',       cats: [['회의 전', ['안건 정리', '참석자 확인']], ['회의 후', ['회의록 공유', '후속 조치 정리']]] },
};

// ---------------------------------------------------------------------
// 오류 문구
// ---------------------------------------------------------------------
const ERR = {
  not_authenticated: '로그인이 필요합니다. 다시 로그인해 주세요.',
  profile_missing: '계정 정보가 없습니다. 관리자에게 문의해 주세요.',
  not_found: '목록을 찾을 수 없거나 접근 권한이 없습니다. 최신 상태로 다시 불러왔습니다.',
  not_authorized: '이 작업을 할 권한이 없습니다.',
  list_closed: '종결된 목록입니다. 재개한 뒤 수정해 주세요.',
  list_not_closed: '진행 중인 목록은 삭제할 수 없습니다. 먼저 종결해 주세요.',
  version_conflict: '다른 가족이 먼저 수정했습니다. 최신 내용을 불러왔으니 방금 작업을 다시 해 주세요.',
  last_owner: '마지막 Owner는 내보내거나 역할을 바꿀 수 없습니다. 다른 사람을 먼저 Owner로 지정해 주세요.',
  user_not_found: '해당 가족을 찾을 수 없습니다.',
  already_member: '이미 참여 중인 사람입니다.',
  invalid_assignee: '담당자는 이 목록의 참여자 중에서만 새로 지정할 수 있습니다.',
  task_not_found: '이미 삭제된 항목입니다. 최신 내용을 불러왔습니다.',
  invalid_display_name: '표시 이름은 1~20자로 입력해 주세요.',
  simple_field_forbidden: 'Simple 목록에서는 서브카테고리·담당자·마감일을 쓸 수 없습니다.',
  invalid_date: '날짜가 올바르지 않습니다.',
  invalid_name: '목록 이름은 1~70자로 입력해 주세요.',
  not_public: '비공개로 바뀌었거나 없는 목록입니다. 목록을 새로 불러왔습니다.',
  request_not_found: '이미 처리된 참가 요청입니다.',
};

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function toAppError(err) {
  if (err instanceof AppError) return err;
  const raw = String(err?.message ?? err ?? '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return new AppError('network', '연결에 실패했습니다. 인터넷 연결을 확인해 주세요. 저장됐는지 확실하지 않으면 새로고침해서 확인해 주세요.');
  }
  if (/jwt|not_authenticated/i.test(raw)) return new AppError('auth', ERR.not_authenticated);
  const code = Object.keys(ERR).find(k => raw === k || raw.startsWith(k + ' ') || raw.startsWith(k + ':'));
  if (code) return new AppError(code, ERR[code]);
  if (/^invalid_/.test(raw)) return new AppError('invalid', '입력 내용이 올바르지 않습니다. 확인 후 다시 시도해 주세요.');
  console.error('[checklist]', err);
  return new AppError('unknown', '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

// ---------------------------------------------------------------------
// Supabase 연결
// ---------------------------------------------------------------------
const configured = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR-') && !SUPABASE_ANON_KEY.includes('YOUR-');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
const toEmail = username => `${username}@${EMAIL_DOMAIN}`;

async function rpc(name, args = {}) {
  let res;
  try { res = await sb.rpc(name, args); } catch (e) { throw toAppError(e); }
  if (res.error) {
    const e = toAppError(res.error);
    if (e.code === 'auth') onAuthLost();
    throw e;
  }
  return res.data;
}

// ---------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------
const S = {
  me: null,            // { id, username, display_name }
  family: [],          // 가족 전체 프로필
  lists: [],           // 내가 참여한 목록
  publicLists: [],     // 내가 참여하지 않은 가족 공개 목록 (이름·요약만)
  sel: null,           // 선택한 목록 id
  search: '',
  filter: 'all',       // all | open | done
  closedQuery: '',
  picked: new Set(),   // 이동 선택한 항목 id
  pending: 0,          // 진행 중인 저장 요청 수
  epoch: 0,            // 저장 실패 시 증가 → 이전에 예약된 저장은 취소
  editing: false,      // 이름 바로 수정 중
  drag: null,
  pop: null,           // 삭제 확인 팝업의 실행 함수
  authTab: 'login',
};

const cur = () => S.lists.find(l => l.id === S.sel) ?? null;
const perms = l => {
  const r = l?.role, open = !!l && !l.closed_at;
  return {
    edit: open && (r === 'owner' || r === 'co-owner'),
    check: open && (r === 'owner' || r === 'co-owner' || r === 'member'),
    close: r === 'owner' || r === 'co-owner',
    del: !!l && !open && r === 'owner',
    manage: open && (r === 'owner' || r === 'co-owner'),
  };
};
const personName = id => S.family.find(p => p.id === id)?.display_name ?? '알 수 없음';
const listTitle = l => (l.kind === 'simple' ? '[Sim] ' : '') + l.data.name + (l.kind === 'simple' && l.data.date ? ' · ' + l.data.date : '');
const sortedActive = () => S.lists.filter(l => !l.closed_at)
  .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.created_at.localeCompare(b.created_at));
const putList = l => {
  const i = S.lists.findIndex(x => x.id === l.id);
  if (i >= 0) S.lists[i] = l; else S.lists.push(l);
};
const rememberSel = () => { try { localStorage.setItem('checklist.sel', S.sel ?? ''); } catch { /* 저장 불가 환경 무시 */ } };
const recallSel = () => { try { return localStorage.getItem('checklist.sel') || null; } catch { return null; } };

// 카테고리 접기 상태: 사용자별·기기별로 이 브라우저에만 저장 ({ 목록id: [카테고리id, ...] })
let collapsed = {};
try { collapsed = JSON.parse(localStorage.getItem('checklist.collapsed') || '{}') || {}; } catch { collapsed = {}; }
const isCollapsed = (listId, catId) => !!collapsed[listId]?.includes(catId);
function setCollapsed(listId, catIds, on) {
  const set = new Set(collapsed[listId] ?? []);
  catIds.forEach(id => (on ? set.add(id) : set.delete(id)));
  if (set.size) collapsed[listId] = [...set]; else delete collapsed[listId];
  try { localStorage.setItem('checklist.collapsed', JSON.stringify(collapsed)); } catch { /* 저장 불가 환경 무시 */ }
}

function ensureSelection() {
  if (!cur()) S.sel = sortedActive()[0]?.id ?? S.lists[0]?.id ?? null;
}

// ---------------------------------------------------------------------
// 알림 / 대화상자 / 삭제 확인 팝업
// ---------------------------------------------------------------------
let toastTimer;
function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 7000 : 3500);
}

function openDialog(title, html) {
  closePop();
  $('#dlgTitle').textContent = title;
  $('#dlgBody').innerHTML = html;
  const d = $('#dlg');
  if (!d.open) d.showModal();
  $('#dlgBody').querySelector('input:not([type=hidden]):not([disabled]), select, textarea')?.focus();
}
function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }
const dialogOpen = () => $('#dlg').open;

function openPop(button, message, onConfirm) {
  closePop();
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '확인');
  pop.innerHTML = `<div>${esc(message)}</div><div class="row">
      <button type="button" class="small" data-action="pop-cancel">${onConfirm ? '취소' : '닫기'}</button>
      ${onConfirm ? '<button type="button" class="small danger" data-action="pop-confirm">삭제</button>' : ''}</div>`;
  document.body.append(pop);
  const r = button.getBoundingClientRect();
  const left = Math.min(Math.max(12, r.right - pop.offsetWidth), window.innerWidth - pop.offsetWidth - 12);
  let top = r.bottom + 7;
  if (top + pop.offsetHeight > window.innerHeight - 12) top = Math.max(12, r.top - pop.offsetHeight - 7);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  S.pop = onConfirm;
  pop.querySelector('button').focus();
}
function closePop() { $('.pop')?.remove(); S.pop = null; }

// ---------------------------------------------------------------------
// 데이터 불러오기 / 저장
// ---------------------------------------------------------------------
async function loadAll() {
  const [me, family, lists, pub] = await Promise.all([rpc('checklist_me'), rpc('checklist_family'), rpc('checklist_lists'), rpc('checklist_public_lists')]);
  S.me = me; S.family = family; S.lists = lists; S.publicLists = pub;
  if (!S.sel) S.sel = recallSel();
  ensureSelection();
}

async function refreshLists() {
  try {
    const [lists, family, pub] = await Promise.all([rpc('checklist_lists'), rpc('checklist_family'), rpc('checklist_public_lists')]);
    S.lists = lists; S.family = family; S.publicLists = pub;
    ensureSelection();
  } catch (e) { toast(e.message, true); }
}

// 저장 요청을 한 줄로 세워 순서대로 보냅니다.
let chain = Promise.resolve();
function enqueue(job) {
  S.pending++;
  const run = chain.then(job).catch(e => toast(toAppError(e).message, true)).finally(() => { S.pending--; });
  chain = run;
  return run;
}

// 편집(Owner·Co-owner): 화면에 먼저 반영하고 서버에 저장. 충돌·실패 시 최신 내용으로 되돌림
function edit(mutator) {
  const l = cur();
  if (!l || !perms(l).edit) return;
  const draft = structuredClone(l.data);
  if (mutator(draft, l) === false) return;
  l.data = draft;
  renderMain();
  const id = l.id, epoch = S.epoch;
  enqueue(async () => {
    if (epoch !== S.epoch) return;                    // 앞선 저장이 실패했으면 이어진 저장은 보내지 않음
    const latest = S.lists.find(x => x.id === id);
    if (!latest) return;
    try {
      putList(await rpc('checklist_save', { p_id: id, p_version: latest.version, p_data: draft }));
    } catch (e) {
      S.epoch++;
      toast(e.message, true);
      await refreshLists();
    }
    renderAll();
  });
}

// 완료 체크(Owner·Co-owner·Member): 항목 하나만 바꾸므로 동시 체크해도 충돌 없음
function toggleTask(taskId) {
  const l = cur();
  if (!l || !perms(l).check) return;
  const t = l.data.tasks.find(x => x.id === taskId);
  if (!t) return;
  const done = !t.done, id = l.id;
  t.done = done;
  renderMain();
  enqueue(async () => {
    try {
      await rpc('checklist_toggle', { p_id: id, p_task: taskId, p_done: done });
      const again = S.lists.find(x => x.id === id)?.data.tasks.find(x => x.id === taskId);
      if (again && again.done !== done) { again.done = done; renderMain(); }
    } catch (e) {
      toast(e.message, true);
      await refreshLists();
      renderAll();
    }
  });
}

// 목록 단위 작업(종결·삭제·즐겨찾기 등)
async function listAction(fn) {
  S.pending++;
  try { await fn(); } catch (e) { toast(toAppError(e).message, true); await refreshLists(); }
  finally { S.pending--; }
  renderAll();
}

// 30초마다, 그리고 화면으로 돌아올 때 최신 상태 확인 (편집 중이면 건너뜀)
const signature = (lists, pub) => lists.map(l => `${l.id}:${l.version}:${l.updated_at}:${l.role}:${l.favorite}:${l.pending}:${l.is_public}`).join('|')
  + '#' + pub.map(p => `${p.id}:${p.name}:${p.tasks}:${p.requested}`).join('|');
async function maybeRefresh() {
  const busy = () => !S.me || document.hidden || S.pending || S.editing || S.drag || dialogOpen() || $('.pop');
  if (busy()) return;
  try {
    const [lists, pub] = await Promise.all([rpc('checklist_lists'), rpc('checklist_public_lists')]);
    if (busy()) return;
    if (signature(lists, pub) !== signature(S.lists, S.publicLists)) {
      S.lists = lists; S.publicLists = pub;
      ensureSelection();
      renderAll();
    }
  } catch { /* 다음 주기에 다시 시도 */ }
}
setInterval(maybeRefresh, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeRefresh(); });

// ---------------------------------------------------------------------
// 로그인 / 가입 / 계정
// ---------------------------------------------------------------------
function onAuthLost() {
  if (!S.me) return;
  S.me = null; S.lists = []; S.family = []; S.authTab = 'login';
  closeDialog();
  renderAll();
  toast(ERR.not_authenticated, true);
}

function authErrorMessage(error, mode) {
  const msg = String(error?.message ?? '');
  const code = String(error?.code ?? '');
  if (/failed to fetch|network/i.test(msg)) return '연결에 실패했습니다. 인터넷 연결을 확인해 주세요.';
  if (mode === 'login') {
    if (/invalid login credentials/i.test(msg)) return '아이디 또는 비밀번호를 확인해 주세요.';
    if (/email not confirmed/i.test(msg)) return '관리자 설정이 필요합니다. (Supabase에서 Confirm email 끄기)';
    if (/rate limit|too many/i.test(msg)) return '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    return '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (/already registered|already exists/i.test(msg) || code === 'user_already_exists') return '이미 사용 중인 아이디입니다.';
  if (/invalid_username/.test(msg)) return '아이디는 영문 소문자·숫자·밑줄(_) 3~20자로 입력해 주세요.';
  if (/invalid_display_name/.test(msg)) return '표시 이름은 1~20자로 입력해 주세요.';
  if (/invalid_signup_code|database error/i.test(msg)) return '가입 코드가 맞지 않습니다. 가족 관리자에게 가입 코드를 확인해 주세요.';
  if (/email address .* invalid|email_address_invalid/i.test(msg) || code === 'email_address_invalid') {
    return '관리자 설정 문제로 가입할 수 없습니다. (config.js의 EMAIL_DOMAIN 확인 필요)';
  }
  if (/password/i.test(msg)) return '비밀번호가 너무 짧거나 단순합니다. 다른 비밀번호를 사용해 주세요.';
  if (/rate limit|too many/i.test(msg)) return '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (/signups not allowed|signup is disabled/i.test(msg)) return '현재 가입이 닫혀 있습니다. 관리자에게 문의해 주세요.';
  console.error('[checklist] signup', error);
  return '가입하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

async function doLogin(form) {
  const username = form.username.value.trim().toLowerCase();
  const password = form.password.value;
  const out = $('.form-error', form);
  if (!USERNAME_RE.test(username)) { out.textContent = '아이디 또는 비밀번호를 확인해 주세요.'; return; }
  setBusy(form, true);
  const { error } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
  if (error) { out.textContent = authErrorMessage(error, 'login'); setBusy(form, false); return; }
  await start();
}

async function doSignup(form) {
  const out = $('.form-error', form);
  const username = form.username.value.trim().toLowerCase();
  const display = form.display.value.trim();
  const code = form.code.value.trim();
  const pw = form.password.value, pw2 = form.password2.value;
  if (!code) { out.textContent = '가입 코드를 입력해 주세요.'; return; }
  if (!USERNAME_RE.test(username)) { out.textContent = '아이디는 영문 소문자·숫자·밑줄(_) 3~20자로 입력해 주세요.'; return; }
  if (display.length < 1 || display.length > LIMIT.display) { out.textContent = '표시 이름은 1~20자로 입력해 주세요.'; return; }
  if (pw.length < 8) { out.textContent = '비밀번호는 8자 이상으로 입력해 주세요.'; return; }
  if (pw !== pw2) { out.textContent = '비밀번호 확인이 일치하지 않습니다.'; return; }
  setBusy(form, true);
  const { data, error } = await sb.auth.signUp({
    email: toEmail(username), password: pw,
    options: { data: { username, display_name: display, signup_code: code } },
  });
  if (error) { out.textContent = authErrorMessage(error, 'signup'); setBusy(form, false); return; }
  if (!data.session) {
    out.textContent = '계정은 만들어졌지만 바로 로그인되지 않았습니다. 관리자에게 Supabase의 Confirm email 설정을 꺼 달라고 요청해 주세요.';
    setBusy(form, false);
    return;
  }
  await start();
  toast(`${display}님, 환영합니다!`);
}

async function changePassword(form) {
  const out = $('.form-error', form);
  const current = form.current.value, pw = form.password.value, pw2 = form.password2.value;
  if (pw.length < 8) { out.textContent = '새 비밀번호는 8자 이상으로 입력해 주세요.'; return; }
  if (pw !== pw2) { out.textContent = '새 비밀번호 확인이 일치하지 않습니다.'; return; }
  setBusy(form, true);
  const check = await sb.auth.signInWithPassword({ email: toEmail(S.me.username), password: current });
  if (check.error) { out.textContent = '현재 비밀번호가 맞지 않습니다.'; setBusy(form, false); return; }
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) { out.textContent = authErrorMessage(error, 'signup'); setBusy(form, false); return; }
  closeDialog();
  toast('비밀번호를 변경했습니다.');
}

async function logout() {
  closeDialog();
  S.me = null; S.lists = []; S.family = []; S.sel = null; S.picked.clear(); S.authTab = 'login';
  renderAll();
  await sb.auth.signOut();
}

function setBusy(form, busy) { $$('button, input, select, textarea', form).forEach(x => { x.disabled = busy; }); }

// ---------------------------------------------------------------------
// 화면 그리기
// ---------------------------------------------------------------------
function renderAll() {
  closePop();
  renderUserbox();
  if (!configured) {
    $('#app').innerHTML = `<div class="auth"><h2>설정이 필요합니다</h2><p class="hint">js/config.js 파일에 Supabase 주소와 anon 키를 넣은 뒤 다시 배포해 주세요. (설치 가이드 5단계)</p></div>`;
    return;
  }
  if (!S.me) return renderAuth();
  $('#app').innerHTML = `<div class="layout"><aside class="sidebar" id="sidebar"></aside><main class="main" id="main"></main></div>`;
  renderSidebar();
  renderMain();
}

function renderUserbox() {
  $('#userbox').innerHTML = S.me
    ? `<span class="user-name">${esc(S.me.display_name)} (${esc(S.me.username)})</span>
       <button type="button" class="small" data-action="account">내 계정</button>`
    : '';
}

function renderAuth() {
  const login = S.authTab === 'login';
  $('#app').innerHTML = `
  <section class="auth">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${login}" data-action="auth-tab" data-tab="login">로그인</button>
      <button type="button" role="tab" aria-selected="${!login}" data-action="auth-tab" data-tab="signup">가입</button>
    </div>
    ${login ? `
    <form id="loginForm" class="fields" novalidate>
      <div><label for="lu">아이디</label><input id="lu" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
      <div><label for="lp">비밀번호</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div>
      <p class="form-error" role="alert"></p>
      <button class="primary">로그인</button>
      <p class="hint">비밀번호를 잊었으면 가족 관리자에게 재설정을 요청해 주세요.</p>
    </form>` : `
    <form id="signupForm" class="fields" novalidate>
      <div><label for="sc">가입 코드</label><input id="sc" name="code" autocomplete="off" required><p class="hint">가족 관리자에게 받은 코드입니다.</p></div>
      <div><label for="su">아이디</label><input id="su" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required><p class="hint">영문 소문자·숫자·밑줄(_) 3~20자. 대문자는 소문자로 바뀝니다.</p></div>
      <div><label for="sd">표시 이름</label><input id="sd" name="display" maxlength="20" placeholder="예: 엄마, 민수" required></div>
      <div class="twocol">
        <div><label for="sp">비밀번호</label><input id="sp" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
        <div><label for="sp2">비밀번호 확인</label><input id="sp2" name="password2" type="password" autocomplete="new-password" minlength="8" required></div>
      </div>
      <p class="form-error" role="alert"></p>
      <button class="primary">가입하기</button>
    </form>`}
  </section>`;
  $('#app input')?.focus();
}

function renderSidebar() {
  const box = $('#sidebar');
  if (!box) return;
  const count = l => `${l.data.tasks.filter(t => t.done).length}/${l.data.tasks.length}`;
  const btn = l => `<button type="button" class="list-btn ${l.id === S.sel ? 'active' : ''}" data-action="select" data-id="${esc(l.id)}">
      <span class="list-name">${l.favorite ? '★ ' : ''}${esc(listTitle(l))}</span>
      <span class="list-count">${l.pending ? `<span class="req-badge" title="참가 요청">요청 ${l.pending}</span> ` : ''}${count(l)}</span></button>`;
  const pubRow = p => {
    const title = (p.kind === 'simple' ? '[Sim] ' : '') + p.name + (p.kind === 'simple' && p.date ? ' · ' + p.date : '');
    const action = p.requested
      ? `<span class="helper">승인 대기 중</span> <button type="button" class="small" data-action="cancel-join" data-id="${esc(p.id)}">요청 취소</button>`
      : `<button type="button" class="small primary" data-action="join" data-id="${esc(p.id)}" data-kind="${esc(p.kind)}" data-name="${esc(title)}">참가</button>`;
    return `<div class="pub-row"><div class="pub-name">${esc(title)}</div>
      <div class="pub-meta">Owner ${esc(p.owners.join(', ') || '-')} · 항목 ${p.tasks}개</div><div class="row">${action}</div></div>`;
  };
  const active = sortedActive();
  const q = S.closedQuery.trim().toLowerCase();
  const closed = S.lists.filter(l => l.closed_at)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.closed_at.localeCompare(a.closed_at))
    .filter(l => !q || `${listTitle(l)} ${ymd(new Date(l.closed_at))}`.toLowerCase().includes(q));
  const closedTotal = S.lists.filter(l => l.closed_at).length;
  box.innerHTML = `
    <div class="side-head"><h2>내 목록</h2><button type="button" class="primary small" data-action="new-list">＋ 새 목록</button></div>
    <div class="section-title">진행 중</div>
    ${active.map(btn).join('') || '<p class="helper">진행 중인 목록이 없습니다.</p>'}
    ${S.publicLists.length ? `<div class="section-title">가족 공개 목록 · 참가 가능</div>${S.publicLists.map(pubRow).join('')}` : ''}
    <details id="closedBox" ${S.closedOpen ? 'open' : ''}>
      <summary class="section-title">종결된 목록 (${closedTotal})</summary>
      <input id="closedSearch" value="${esc(S.closedQuery)}" placeholder="이름 또는 종결일(2026-11-23) 검색" aria-label="종결 목록 검색">
      <div id="closedLists">${closed.map(btn).join('') || '<p class="helper">표시할 종결 목록이 없습니다.</p>'}</div>
    </details>
    <div class="side-tools">
      <button type="button" class="small" data-action="export">백업 내보내기</button>
      <button type="button" class="small" data-action="import">백업 가져오기</button>
      <button type="button" class="small" data-action="reload">새로고침</button>
      <input type="file" id="importFile" accept="application/json,.json" class="hidden">
    </div>`;
}

function renderMain() {
  const box = $('#main');
  if (!box) return;
  renderSidebar();
  const l = cur();
  if (!l) {
    box.innerHTML = `<div class="empty"><div><div class="eyebrow">START</div><strong>아직 참여 중인 목록이 없습니다.</strong>
      <p>새 목록을 만들거나, 왼쪽 '가족 공개 목록'에서 [참가]를 눌러 주세요.<br>(내 아이디: <b>${esc(S.me.username)}</b>)</p><br>
      <button type="button" class="primary" data-action="new-list">＋ 첫 목록 만들기</button></div></div>`;
    return;
  }
  const p = perms(l);
  const done = l.data.tasks.filter(t => t.done).length, total = l.data.tasks.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  box.innerHTML = `
    <div class="hero">
      <div>
        <div class="tag">${l.kind === 'simple' ? 'SIMPLE LIST' : 'STANDARD LIST'}${l.closed_at ? ' / CLOSED' : ''}</div>
        <div class="title-line">
          <h2>${esc(listTitle(l))}</h2>
          ${p.edit ? '<button type="button" class="small" data-action="edit-list">목록 수정</button>' : ''}
        </div>
        <div class="members-line">
          <span class="role-badge" title="${esc(ROLE_DESC[l.role])}">내 역할 · ${esc(ROLE_LABEL[l.role])}</span>
          <span class="helper">${l.is_public ? '가족 공개' : '비공개'}</span>
          <button type="button" class="small ${l.pending ? 'primary' : ''}" data-action="members">멤버${l.pending ? ` · 참가 요청 ${l.pending}` : ''}</button>
        </div>
      </div>
      <div class="actions">
        <button type="button" data-action="favorite">${l.favorite ? '★ 즐겨찾기' : '☆ 즐겨찾기'}</button>
        ${p.edit ? '<button type="button" data-action="duplicate">복제</button>' : ''}
        ${p.close ? `<button type="button" data-action="toggle-closed">${l.closed_at ? '재개' : '종결'}</button>` : ''}
        ${p.del ? '<button type="button" class="danger" data-action="final-delete">최종 삭제</button>' : ''}
      </div>
    </div>
    ${l.closed_at ? `<p class="closed-note">${esc(ymd(new Date(l.closed_at)))}에 종결된 목록입니다. 읽기 전용이며, 수정하려면 재개해 주세요.</p>` : ''}
    <div class="stats"><strong>${pct}%</strong><span>${done} / ${total} 완료</span><div class="progress"><i style="width:${pct}%"></i></div></div>
    <div class="toolbar">
      <input class="search" id="search" type="search" value="${esc(S.search)}" placeholder="항목 검색" aria-label="항목 검색">
      <select id="filter" aria-label="완료 상태 필터">
        <option value="all" ${S.filter === 'all' ? 'selected' : ''}>전체</option>
        <option value="open" ${S.filter === 'open' ? 'selected' : ''}>진행 중</option>
        <option value="done" ${S.filter === 'done' ? 'selected' : ''}>완료</option>
      </select>
      ${l.data.categories.length > 1 ? `<button type="button" class="small" data-action="fold-all">${
        l.data.categories.every(c => isCollapsed(l.id, c.id)) ? '모두 펼치기' : '모두 접기'}</button>` : ''}
    </div>
    <div id="pickedBar"></div>
    ${p.edit ? '<p class="helper" style="margin-top:8px">☰ 를 누른 채 끌어서 순서·분류를 바꿉니다(휴대폰도 동일). 여러 항목은 선택 상자를 체크한 뒤 그중 하나의 ☰ 를 끌면 함께 옮겨집니다.</p>' : ''}
    <div class="groups" id="groups"></div>
    ${p.edit ? '<div style="margin-top:16px"><button type="button" data-action="add-cat">＋ 카테고리 추가</button></div>' : ''}`;
  renderGroups();
}

function renderPickedBar() {
  const bar = $('#pickedBar');
  if (!bar) return;
  const l = cur();
  const ids = new Set(l?.data.tasks.map(t => t.id));
  [...S.picked].forEach(id => { if (!ids.has(id)) S.picked.delete(id); });
  bar.innerHTML = S.picked.size && perms(l).edit
    ? `<div class="picked-bar"><b>${S.picked.size}개 선택</b>
        <button type="button" class="small primary" data-action="move-picked">선택 항목 이동</button>
        <button type="button" class="small" data-action="clear-picked">선택 해제</button></div>`
    : '';
}

function renderGroups() {
  const box = $('#groups');
  const l = cur();
  if (!box || !l) return;
  const p = perms(l);
  const q = S.search.trim().toLowerCase();
  const visible = t => (!q || t.text.toLowerCase().includes(q)) && (S.filter === 'all' || (S.filter === 'done' ? t.done : !t.done));
  let shown = 0;

  const taskRow = (t, cat, sub) => {
    shown++;
    const meta = [];
    if (t.due) meta.push(`마감 ${esc(t.due)}`);
    if (t.assignees?.length) meta.push('담당 ' + t.assignees.map(id => esc(personName(id))).join(', '));
    return `<div class="task ${t.done ? 'done' : ''}" data-drop="task" data-id="${esc(t.id)}" data-cat="${esc(cat)}" data-sub="${esc(sub)}">
      <button type="button" class="done-btn ${t.done ? 'is-done' : ''}" data-action="toggle" data-id="${esc(t.id)}" aria-pressed="${t.done}" ${p.check ? '' : 'disabled'}>${t.done ? '완료됨' : '완료'}</button>
      <div class="task-body">
        <div class="task-text-row"><span class="task-title" data-name="task" data-id="${esc(t.id)}">${esc(t.text)}</span>
          ${p.edit ? `<button type="button" class="link" data-action="rename" data-kind="task" data-id="${esc(t.id)}" aria-label="${esc(t.text)} 이름 수정">(수정)</button>` : ''}</div>
        ${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}
      </div>
      <div class="task-actions">
        <span class="task-links"><button type="button" data-action="detail" data-id="${esc(t.id)}">상세</button>${p.edit
          ? `<button type="button" data-action="delete-task" data-id="${esc(t.id)}">삭제</button>` : ''}</span>
        ${p.edit ? `<input type="checkbox" class="pick" data-action="pick" data-id="${esc(t.id)}" aria-label="${esc(t.text)} 이동 선택" ${S.picked.has(t.id) ? 'checked' : ''}>
        <span class="grip" data-drag="task" data-id="${esc(t.id)}" title="끌어서 이동" aria-hidden="true">☰</span>` : ''}
      </div></div>`;
  };

  const bucket = (cat, sub) => {
    const items = l.data.tasks.filter(t => t.cat === cat.id && (t.sub || '') === sub);
    const rows = items.filter(visible).map(t => taskRow(t, cat.id, sub)).join('');
    const quick = p.edit ? `<form class="quick-add" data-form="quick" data-cat="${esc(cat.id)}" data-sub="${esc(sub)}">
        <input maxlength="${LIMIT.task}" placeholder="새 항목" aria-label="${esc(cat.name)} 새 항목" enterkeyhint="done">
        <button class="primary small">추가</button>
        <button type="button" class="small" data-action="batch" data-cat="${esc(cat.id)}" data-sub="${esc(sub)}">여러 항목 추가</button></form>` : '';
    return `<div data-drop="bucket" data-cat="${esc(cat.id)}" data-sub="${esc(sub)}">${rows}${quick}</div>`;
  };

  const html = l.data.categories.map(cat => {
    const catTasks = l.data.tasks.filter(t => t.cat === cat.id);
    const catDone = catTasks.filter(t => t.done).length;
    const folded = isCollapsed(l.id, cat.id) && !q;      // 검색 중에는 접힌 카테고리도 펼쳐서 결과 표시
    return `
    <section class="group ${folded ? 'folded' : ''}" data-drop="category" data-id="${esc(cat.id)}">
      <div class="group-head">
        <div class="cat-title">
          ${p.edit ? `<span class="grip" data-drag="category" data-id="${esc(cat.id)}" title="끌어서 이동" aria-hidden="true">☰</span>` : ''}
          <h3><span data-name="cat" data-id="${esc(cat.id)}">${esc(cat.name)}</span>
            ${p.edit ? `<button type="button" class="link" data-action="rename" data-kind="cat" data-id="${esc(cat.id)}">(수정)</button>` : ''}</h3>
          <span class="cat-count${catTasks.length && catDone === catTasks.length ? ' all-done' : ''}">항목 ${catTasks.length}개 / 완료 ${catDone}개</span>
          <button type="button" class="link fold-btn" data-action="fold" data-id="${esc(cat.id)}" aria-expanded="${!folded}"
            aria-label="${esc(cat.name)} ${folded ? '펼치기' : '접기'}">${folded ? '펼치기 ▾' : '접기 ▴'}</button>
        </div>
        <div class="row cat-tools">
          ${p.edit && l.kind === 'standard' ? `<button type="button" class="small" data-action="add-sub" data-id="${esc(cat.id)}">＋ 하위</button>` : ''}
          ${p.edit ? `<button type="button" class="small" data-action="delete-cat" data-id="${esc(cat.id)}">삭제</button>` : ''}</div>
      </div>
      ${folded ? '' : `${bucket(cat, '')}
      ${(cat.subs || []).map(s => `
        <div class="subgroup" data-drop="subcategory" data-id="${esc(s.id)}" data-cat="${esc(cat.id)}">
          <div class="sub-head">
            <div class="sub-title">
              ${p.edit ? `<span class="grip" data-drag="subcategory" data-id="${esc(s.id)}" data-cat="${esc(cat.id)}" title="끌어서 이동" aria-hidden="true">☰</span>` : ''}
              <h4><span data-name="sub" data-id="${esc(s.id)}">${esc(s.name)}</span>
                ${p.edit ? `<button type="button" class="link" data-action="rename" data-kind="sub" data-id="${esc(s.id)}" data-cat="${esc(cat.id)}">(수정)</button>` : ''}</h4>
            </div>
            <div class="row">
              ${p.edit ? `<button type="button" class="small" data-action="delete-sub" data-id="${esc(s.id)}" data-cat="${esc(cat.id)}">삭제</button>` : ''}</div>
          </div>
          ${bucket(cat, s.id)}
        </div>`).join('')}`}
    </section>`;
  }).join('');

  let note = '';
  if (!l.data.categories.length) note = `<p class="helper">${p.edit ? '아래 [＋ 카테고리 추가]로 시작해 주세요.' : '아직 항목이 없습니다.'}</p>`;
  else if (!shown && (q || S.filter !== 'all') && l.data.tasks.length) note = '<p class="helper" style="margin:10px 0">조건에 맞는 항목이 없습니다.</p>';
  box.innerHTML = note + html;
  renderPickedBar();
}

// ---------------------------------------------------------------------
// 목록 만들기·수정·복제
// ---------------------------------------------------------------------
function makeTask(text, cat, sub = '') {
  return { id: newId(), text, cat, sub, due: '', done: false, assignees: [], createdBy: S.me.id, createdAt: new Date().toISOString() };
}

function buildData(name, kind, date, templateKey) {
  const data = { name, date: kind === 'simple' ? date : '', categories: [], tasks: [] };
  for (const [catName, items] of TEMPLATES[templateKey].cats) {
    const c = { id: newId(), name: catName, subs: [] };
    data.categories.push(c);
    for (const text of items) data.tasks.push(makeTask(text, c.id));
  }
  return data;
}

function dateFieldHtml(value, show) {
  return `<div id="dateField" class="${show ? '' : 'hidden'}">
    <label for="listDate">목록 날짜</label>
    <input id="listDate" name="date" type="date" value="${esc(value)}" ${value ? '' : 'disabled'}>
    <label class="inline" style="margin-top:8px"><input type="checkbox" id="noDate" ${value ? '' : 'checked'}> 날짜 선택 안 함</label>
    <p class="hint">목록 날짜는 표시용입니다. 마감일이나 알림이 아닙니다.</p></div>`;
}

function newListDialog() {
  openDialog('새 목록 만들기', `
  <form id="newListForm" class="fields">
    <div><label for="listName">목록 이름</label>
      <input id="listName" name="name" maxlength="${LIMIT.listName}" required placeholder="예: 여행 준비">
      <div class="row" style="margin-top:8px">
        <button type="button" class="small" data-action="preset" data-value="장보기">장보기</button>
        <button type="button" class="small" data-action="preset" data-value="준비물">준비물</button></div></div>
    <div class="twocol">
      <div><label>목록 유형</label><input type="hidden" name="kind" value="standard">
        <div class="kind-buttons" role="group" aria-label="목록 유형">
          <button type="button" data-action="kind" data-value="standard" aria-pressed="true">일반</button>
          <button type="button" data-action="kind" data-value="simple" aria-pressed="false">Simple</button></div>
        <p class="hint" id="kindHint">카테고리·하위 카테고리·마감일·담당자를 씁니다.</p></div>
      <div><label for="tpl">시작 템플릿</label><select id="tpl" name="template">
        ${Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
    </div>
    ${dateFieldHtml(today(), false)}
    <p class="hint">새 목록은 <b>가족 공개</b>로 만들어집니다. 다른 가족이 이름을 보고 [참가]할 수 있습니다(일반 목록은 승인 필요, Simple 목록은 바로 Co-owner). 멤버 창에서 비공개로 바꿀 수 있습니다.</p>
    <p class="form-error" role="alert"></p>
    <div class="dialog-foot"><button type="button" data-action="close-dialog">취소</button><button class="primary">만들기</button></div>
  </form>`);
}

async function submitNewList(form) {
  const name = form.name.value.trim();
  const kind = form.kind.value;
  if (!name) return;
  const date = kind === 'simple' && !$('#noDate').checked ? form.date.value : '';
  const data = buildData(name, kind, date, form.template.value);
  setBusy(form, true);
  try {
    const created = await rpc('checklist_create', { p_kind: kind, p_data: data });
    putList(created);
    S.sel = created.id; S.search = ''; S.filter = 'all'; S.picked.clear(); rememberSel();
    closeDialog();
    renderAll();
  } catch (e) {
    $('.form-error', form).textContent = toAppError(e).message;
    setBusy(form, false);
  }
}

function editListDialog() {
  const l = cur();
  openDialog('목록 수정', `
  <form id="editListForm" class="fields">
    <div><label for="eln">목록 이름</label><input id="eln" name="name" maxlength="${LIMIT.listName}" required value="${esc(l.data.name)}"></div>
    ${l.kind === 'simple' ? dateFieldHtml(l.data.date || '', true) : ''}
    <p class="hint">목록 유형(일반/Simple)은 바꿀 수 없습니다.</p>
    <div class="dialog-foot"><button type="button" data-action="close-dialog">취소</button><button class="primary">저장</button></div>
  </form>`);
}

function submitEditList(form) {
  const name = form.name.value.trim();
  if (!name) return;
  const l = cur();
  const date = l.kind === 'simple' && !$('#noDate').checked ? form.date.value : '';
  closeDialog();
  edit(d => { d.name = name; d.date = l.kind === 'simple' ? date : ''; });
}

function duplicateDialog() {
  const l = cur();
  openDialog('목록 복제', `
  <form id="dupForm" class="fields">
    <div><label for="dn">새 목록 이름</label><input id="dn" name="name" maxlength="${LIMIT.listName}" required value="${esc((l.data.name + ' 복사').slice(0, LIMIT.listName))}"></div>
    ${l.kind === 'standard' ? '<label class="inline"><input type="checkbox" name="clearDue" checked> 마감일 비우기</label>' : ''}
    <div class="info-box">카테고리와 항목만 복사합니다. 완료 표시는 모두 해제되고, 참여자·담당자는 복사하지 않습니다. 새 목록의 Owner는 나 혼자입니다.</div>
    <p class="form-error" role="alert"></p>
    <div class="dialog-foot"><button type="button" data-action="close-dialog">취소</button><button class="primary">복제</button></div>
  </form>`);
}

async function submitDuplicate(form) {
  const l = cur();
  const name = form.name.value.trim();
  if (!name) return;
  const clearDue = !!form.clearDue?.checked;
  const data = structuredClone(l.data);
  data.name = name;
  data.tasks = data.tasks.map(t => ({ ...t, id: newId(), done: false, assignees: [], due: clearDue ? '' : (t.due || ''),
                                       createdBy: S.me.id, createdAt: new Date().toISOString() }));
  setBusy(form, true);
  try {
    const created = await rpc('checklist_create', { p_kind: l.kind, p_data: data });
    putList(created);
    S.sel = created.id; S.picked.clear(); rememberSel();
    closeDialog();
    renderAll();
    toast('복제했습니다.');
  } catch (e) {
    const err = toAppError(e);
    $('.form-error', form).textContent = err.code === 'network'
      ? '연결이 끊겨 복제됐는지 알 수 없습니다. 창을 닫고 [새로고침]으로 목록이 생겼는지 먼저 확인해 주세요.'
      : err.message;
    setBusy(form, false);
  }
}

// ---------------------------------------------------------------------
// 항목·분류 편집
// ---------------------------------------------------------------------
function quickAdd(form) {
  const input = $('input', form);
  const text = input.value.trim();
  if (!text) return;
  const { cat, sub } = form.dataset;
  input.value = '';
  edit(d => { d.tasks.push(makeTask(text.slice(0, LIMIT.task), cat, sub || '')); });
  requestAnimationFrame(() => $(`form[data-form="quick"][data-cat="${CSS.escape(cat)}"][data-sub="${CSS.escape(sub || '')}"] input`)?.focus());
}

function batchDialog(catId, subId) {
  const l = cur();
  const cat = l.data.categories.find(c => c.id === catId) ?? l.data.categories[0];
  const sub = cat?.subs.find(s => s.id === subId);
  openDialog('여러 항목 추가', `
  <form id="batchForm" class="fields">
    <div><label for="bt">한 줄에 한 항목</label><textarea id="bt" name="text" required placeholder="우유&#10;빵&#10;과일"></textarea>
      <p class="hint">빈 줄은 건너뜁니다. 항목당 160자까지.</p></div>
    <div><label for="bc">카테고리</label><input id="bc" name="cat" list="bcList" maxlength="${LIMIT.catName}" required value="${esc(cat?.name ?? '')}">
      <datalist id="bcList">${l.data.categories.map(c => `<option value="${esc(c.name)}"></option>`).join('')}</datalist></div>
    ${l.kind === 'standard' ? `<div><label for="bs">서브카테고리 (선택)</label><input id="bs" name="sub" list="bsList" maxlength="${LIMIT.catName}" value="${esc(sub?.name ?? '')}">
      <datalist id="bsList">${(cat?.subs ?? []).map(s => `<option value="${esc(s.name)}"></option>`).join('')}</datalist></div>` : ''}
    <p class="hint">없는 분류 이름을 쓰면 새로 만들고, 같은 이름이 있으면 그 분류를 사용합니다.</p>
    <p class="form-error" role="alert"></p>
    <div class="dialog-foot"><button type="button" data-action="close-dialog">취소</button><button class="primary">추가</button></div>
  </form>`);
}

function submitBatch(form) {
  const l = cur();
  const items = form.text.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const catName = form.cat.value.trim();
  const subName = l.kind === 'standard' ? (form.sub?.value.trim() ?? '') : '';
  const out = $('.form-error', form);
  if (!items.length) { out.textContent = '항목을 한 줄에 하나씩 입력해 주세요.'; return; }
  if (items.some(x => x.length > LIMIT.task)) { out.textContent = '160자를 넘는 줄이 있습니다.'; return; }
  if (!catName) { out.textContent = '카테고리 이름을 입력해 주세요.'; return; }
  closeDialog();
  edit(d => {
    let cat = d.categories.find(c => c.name.trim() === catName);
    if (!cat) { cat = { id: newId(), name: catName, subs: [] }; d.categories.push(cat); }
    let sub = '';
    if (subName) {
      let s = cat.subs.find(x => x.name.trim() === subName);
      if (!s) { s = { id: newId(), name: subName }; cat.subs.push(s); }
      sub = s.id;
    }
    for (const text of items) d.tasks.push(makeTask(text, cat.id, sub));
  });
  toast(`${items.length}개 항목을 추가했습니다.`);
}

function catDialog(parentId) {
  const l = cur();
  const parent = parentId ? l.data.categories.find(c => c.id === parentId) : null;
  openDialog(parent ? `‘${parent.name}’ 하위 카테고리 추가` : '카테고리 추가', `
  <form id="catForm" class="fields" data-parent="${esc(parentId ?? '')}">
    <div><label for="cn">이름</label><input id="cn" name="name" maxlength="${LIMIT.catName}" required></div>
    <div class="dialog-foot"><button type="button" data-action="close-dialog">취소</button><button class="primary">추가</button></div>
  </form>`);
}

function submitCat(form) {
  const name = form.name.value.trim();
  if (!name) return;
  const parent = form.dataset.parent;
  closeDialog();
  edit(d => {
    if (parent) {
      const c = d.categories.find(x => x.id === parent);
      if (!c) return false;
      c.subs.push({ id: newId(), name });
    } else {
      d.categories.push({ id: newId(), name, subs: [] });
    }
  });
}

// 이름 바로 수정 (항목·카테고리·서브카테고리)
function beginRename(btn) {
  if (S.editing) { toast('수정 중인 이름을 먼저 저장하거나 취소해 주세요.'); return; }
  const { kind, id } = btn.dataset;
  const span = $(`[data-name="${kind}"][data-id="${CSS.escape(id)}"]`);
  if (!span) return;
  S.editing = true;
  const input = document.createElement('input');
  input.className = 'inline-name';
  input.value = span.textContent;
  input.maxLength = kind === 'task' ? LIMIT.task : LIMIT.catName;
  input.setAttribute('aria-label', '새 이름');
  input.dataset.kind = kind; input.dataset.id = id; input.dataset.cat = btn.dataset.cat ?? '';
  span.replaceWith(input);
  btn.outerHTML = `<button type="button" class="small primary" data-action="rename-save">저장</button>
                   <button type="button" class="small" data-action="rename-cancel">취소</button>`;
  input.focus(); input.select();
}

function saveRename() {
  const input = $('.inline-name');
  if (!input) return;
  const value = input.value.trim();
  if (!value) { input.setCustomValidity('이름을 입력해 주세요.'); input.reportValidity(); input.addEventListener('input', () => input.setCustomValidity(''), { once: true }); return; }
  const { kind, id, cat } = input.dataset;
  S.editing = false;
  edit(d => {
    if (kind === 'task') { const t = d.tasks.find(x => x.id === id); if (!t) return false; t.text = value; }
    else if (kind === 'cat') { const c = d.categories.find(x => x.id === id); if (!c) return false; c.name = value; }
    else { const s = d.categories.find(x => x.id === cat)?.subs.find(x => x.id === id); if (!s) return false; s.name = value; }
  });
}
function cancelRename() { S.editing = false; renderGroups(); }

// 항목 상세 (보기 + 수정)
async function detailDialog(taskId) {
  const l = cur();
  const t = l.data.tasks.find(x => x.id === taskId);
  if (!t) return;
  const p = perms(l);
  let members = [];
  if (l.kind === 'standard') {
    try { members = await rpc('checklist_members', { p_id: l.id }); } catch (e) { toast(e.message, true); }
  }
  const memberIds = new Set(members.map(m => m.user_id));
  const assigned = new Set(t.assignees ?? []);
  const assigneeOptions = [
    ...members.map(m => ({ id: m.user_id, label: `${m.display_name} (${ROLE_LABEL[m.role]})`, left: false })),
    ...[...assigned].filter(id => !memberIds.has(id)).map(id => ({ id, label: `${personName(id)} (나간 참여자)`, left: true })),
  ];
  const dis = p.edit ? '' : 'disabled';
  const catOptions = l.data.categories.map(c => `<option value="${esc(c.id)}" ${c.id === t.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  openDialog('항목 상세', `
  <form id="detailForm" class="fields" data-id="${esc(t.id)}">
    <div><label for="dt">항목 이름</label><input id="dt" name="text" maxlength="${LIMIT.task}" required value="${esc(t.text)}" ${dis}></div>
    <div class="twocol">
      <div><label for="dc">카테고리</label><select id="dc" name="cat" ${dis}>${catOptions}</select></div>
      ${l.kind === 'standard' ? `<div><label for="ds">서브카테고리</label><select id="ds" name="sub" ${dis}>${subOptions(l, t.cat, t.sub)}</select></div>` : ''}
    </div>
    ${l.kind === 'standard' ? `
    <div><label for="dd">마감일 (선택)</label><input id="dd" name="due" type="date" value="${esc(t.due || '')}" ${dis}></div>
    <div><label>담당자</label><div class="check-list">
      ${assigneeOptions.map(o => `<label class="inline"><input type="checkbox" name="assignee" value="${esc(o.id)}" ${assigned.has(o.id) ? 'checked' : ''} ${dis}> ${esc(o.label)}</label>`).join('') || '<span class="helper">참여자 정보를 불러오지 못했습니다.</span>'}
    </div><p class="hint">나간 참여자는 기존 지정만 유지되며 새로 지정할 수 없습니다.</p></div>` : ''}
    <div class="info-box">상태: ${t.done ? '완료' : '진행 중'}<br>등록: ${esc(t.createdBy ? personName(t.createdBy) : '확인 불가')} · ${esc(fmtDateTime(t.createdAt))}</div>
    <div class="dialog-foot"><button type="button" data-action="close-dialog">닫기</button>${p.edit ? '<button class="primary">저장</button>' : ''}</div>
  </form>`);
}

function subOptions(l, catId, selected = '') {
  const c = l.data.categories.find(x => x.id === catId);
  return '<option value="">없음</option>' + (c?.subs ?? []).map(s => `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}

function submitDetail(form) {
  const l = cur();
  const id = form.dataset.id;
  const text = form.text.value.trim();
  if (!text) return;
  const cat = form.cat.value;
  const sub = l.kind === 'standard' ? form.sub.value : '';
  const due = l.kind === 'standard' ? form.due.value : '';
  const assignees = l.kind === 'standard' ? $$('input[name=assignee]:checked', form).map(x => x.value) : [];
  closeDialog();
  edit(d => {
    const t = d.tasks.find(x => x.id === id);
    if (!t) return false;
    const moved = t.cat !== cat || (t.sub || '') !== sub;
    Object.assign(t, { text, cat, sub, due, assignees });
    if (moved) {                                       // 분류가 바뀌면 새 분류의 끝으로
      d.tasks = d.tasks.filter(x => x.id !== id);
      insertAtBucketEnd(d, [t], cat, sub);
    }
  });
}

function insertAtBucketEnd(d, moving, cat, sub) {
  const idx = d.tasks.map((t, i) => (t.cat === cat && (t.sub || '') === sub ? i : -1)).filter(i => i >= 0);
  d.tasks.splice(idx.length ? idx[idx.length - 1] + 1 : d.tasks.length, 0, ...moving);
}

// 선택 항목 이동 (휴대폰에서도 사용 가능)
function moveDialog() {
  const l = cur();
  if (!S.picked.size) return;
  const opts = l.data.categories.flatMap(c => [
    `<option value="${esc(c.id)}|">${esc(c.name)}</option>`,
    ...(c.subs ?? []).map(s => `<option value="${esc(c.id)}|${esc(s.id)}">${esc(c.name)} › ${esc(s.name)}</option>`),
  ]).join('');
  openDialog('선택 항목 이동', `
  <form id="moveForm" class="fields">
    <p>선택한 <b>${S.picked.size}개</b> 항목을 아래 분류의 맨 끝으로 옮깁니다. (검색·필터로 가려진 항목도 선택돼 있으면 함께 옮겨집니다)</p>
    <div><label for="mt">옮길 위치</label><select id="mt" name="target">${opts}</select></div>
    <p class="hint">마감일·담당자·완료 상태는 바뀌지 않습니다.</p>
    <div class="dialog-foot"><button type="button" data-action="close-dialog">취소</button><button class="primary">이동</button></div>
  </form>`);
}

function submitMove(form) {
  const [cat, sub] = form.target.value.split('|');
  const ids = new Set(S.picked);
  closeDialog();
  S.picked.clear();
  edit(d => {
    const moving = d.tasks.filter(t => ids.has(t.id));
    if (!moving.length) return false;
    moving.forEach(t => { t.cat = cat; t.sub = sub || ''; });
    d.tasks = d.tasks.filter(t => !ids.has(t.id));
    insertAtBucketEnd(d, moving, cat, sub || '');
  });
}

function askDelete(btn) {
  const l = cur();
  const { action, id, cat } = btn.dataset;
  if (action === 'delete-task') {
    openPop(btn, '이 항목을 삭제할까요?', () => { S.picked.delete(id); edit(d => { d.tasks = d.tasks.filter(t => t.id !== id); }); });
  } else if (action === 'delete-cat') {
    const c = l.data.categories.find(x => x.id === id);
    if (l.data.tasks.some(t => t.cat === id)) return openPop(btn, `‘${c.name}’에 항목이 있어 삭제할 수 없습니다. 항목을 다른 분류로 옮기거나 삭제한 뒤 다시 시도해 주세요.`, null);
    openPop(btn, `‘${c.name}’ 카테고리${c.subs.length ? '와 하위 카테고리' : ''}를 삭제할까요?`, () => edit(d => { d.categories = d.categories.filter(x => x.id !== id); }));
  } else if (action === 'delete-sub') {
    const s = l.data.categories.find(x => x.id === cat)?.subs.find(x => x.id === id);
    if (!s) return;
    if (l.data.tasks.some(t => t.cat === cat && t.sub === id)) return openPop(btn, `‘${s.name}’에 항목이 있어 삭제할 수 없습니다. 항목을 옮기거나 삭제한 뒤 다시 시도해 주세요.`, null);
    openPop(btn, `‘${s.name}’ 하위 카테고리를 삭제할까요?`, () => edit(d => {
      const c = d.categories.find(x => x.id === cat);
      if (c) c.subs = c.subs.filter(x => x.id !== id);
    }));
  } else if (action === 'final-delete') {
    openPop(btn, `‘${l.data.name}’ 목록과 모든 항목을 영구 삭제합니다. 되돌릴 수 없습니다. 삭제할까요?`, () => listAction(async () => {
      await rpc('checklist_delete', { p_id: l.id });
      S.lists = S.lists.filter(x => x.id !== l.id);
      S.sel = null; ensureSelection(); rememberSel();
      toast('삭제했습니다.');
    }));
  }
}

// ---------------------------------------------------------------------
// 드래그 앤 드롭 — 포인터 이벤트 방식이라 PC(마우스)와 휴대폰(터치) 모두 ☰ 를 끌어서 이동
//   ☰ 를 누른 채 6px 이상 움직이면 끌기 시작, 화면 위·아래 끝에 가까이 가면 자동 스크롤
// ---------------------------------------------------------------------
function clearDropMarks() { $$('.insert-before, .insert-after').forEach(x => x.classList.remove('insert-before', 'insert-after')); }

function dragLabel(d) {
  const l = cur();
  if (d.type === 'task') {
    return d.ids.length > 1 ? `항목 ${d.ids.length}개` : (l.data.tasks.find(t => t.id === d.ids[0])?.text ?? '항목');
  }
  if (d.type === 'category') return l.data.categories.find(c => c.id === d.id)?.name ?? '카테고리';
  return l.data.categories.find(c => c.id === d.cat)?.subs.find(s => s.id === d.id)?.name ?? '하위 카테고리';
}

function activateDrag(d) {
  d.active = true;
  document.body.classList.add('dragging');
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = '☰ ' + dragLabel(d);
  document.body.append(ghost);
  d.ghost = ghost;
  const sel = d.type === 'task' ? d.ids.map(id => `[data-drop="task"][data-id="${CSS.escape(id)}"]`).join(',')
    : d.type === 'category' ? `[data-drop="category"][data-id="${CSS.escape(d.id)}"]`
    : `[data-drop="subcategory"][data-id="${CSS.escape(d.id)}"]`;
  $$(sel).forEach(el => el.classList.add('drag-src'));
  requestAnimationFrame(autoScroll);
}

function updateDropTarget() {
  const d = S.drag;
  d.ghost.style.left = d.x + 'px';
  d.ghost.style.top = d.y + 'px';
  clearDropMarks();
  d.target = null;
  const el = document.elementFromPoint(d.x, d.y);
  if (!el) return;
  const target = d.type === 'category' ? el.closest('[data-drop="category"]')
    : d.type === 'subcategory' ? el.closest('[data-drop="subcategory"]')
    : el.closest('[data-drop="task"], [data-drop="bucket"]');
  if (!target) return;
  if ((d.type === 'category' && target.dataset.id === d.id)
    || (d.type === 'subcategory' && (target.dataset.id === d.id || target.dataset.cat !== d.cat))
    || (d.type === 'task' && target.dataset.drop === 'task' && d.ids.includes(target.dataset.id))) return;
  const r = target.getBoundingClientRect();
  d.after = d.y > r.top + r.height / 2;
  d.target = target;
  if (target.dataset.drop === 'bucket') {
    const form = $('.quick-add', target);
    (form ?? target).classList.add(form ? 'insert-before' : 'insert-after');
  } else {
    target.classList.add(d.after ? 'insert-after' : 'insert-before');
  }
}

function autoScroll() {
  const d = S.drag;
  if (!d?.active) return;
  const edge = 70;
  let dy = 0;
  if (d.y < edge) dy = -Math.ceil((edge - d.y) / 5);
  else if (d.y > window.innerHeight - edge) dy = Math.ceil((d.y - (window.innerHeight - edge)) / 5);
  if (dy) { window.scrollBy(0, dy); updateDropTarget(); }
  requestAnimationFrame(autoScroll);
}

function endDrag() {
  const d = S.drag;
  S.drag = null;
  if (!d) return;
  d.ghost?.remove();
  clearDropMarks();
  $$('.drag-src').forEach(el => el.classList.remove('drag-src'));
  document.body.classList.remove('dragging');
  try { d.handle.releasePointerCapture?.(d.pointerId); } catch { /* 이미 해제됨 */ }
}

document.addEventListener('pointerdown', e => {
  const h = e.target.closest?.('.grip[data-drag]');
  if (!h || e.button > 0 || S.drag || !perms(cur()).edit) return;
  e.preventDefault();
  const { drag, id, cat } = h.dataset;
  S.drag = {
    type: drag, id, cat,
    ids: drag === 'task' ? (S.picked.has(id) ? [...S.picked] : [id]) : null,
    x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
    pointerId: e.pointerId, handle: h, active: false, target: null, after: false,
  };
  try { h.setPointerCapture(e.pointerId); } catch { /* 지원하지 않는 브라우저 */ }
});

document.addEventListener('pointermove', e => {
  const d = S.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  d.x = e.clientX; d.y = e.clientY;
  if (!d.active) {
    if (Math.hypot(d.x - d.startX, d.y - d.startY) < 6) return;
    activateDrag(d);
  }
  e.preventDefault();
  updateDropTarget();
}, { passive: false });

document.addEventListener('pointerup', e => {
  const d = S.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const target = d.active ? d.target : null;
  const after = d.after;
  endDrag();
  if (target) performDrop(d, target, after);
});
document.addEventListener('pointercancel', e => { if (S.drag && e.pointerId === S.drag.pointerId) endDrag(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.drag) endDrag(); });

function performDrop(d, target, after) {
  if (d.type === 'category' || d.type === 'subcategory') {
    edit(data => {
      const arr = d.type === 'category' ? data.categories : data.categories.find(c => c.id === d.cat)?.subs;
      if (!arr || target.dataset.id === d.id) return false;
      const from = arr.findIndex(x => x.id === d.id);
      if (from < 0) return false;
      const [item] = arr.splice(from, 1);
      const to = arr.findIndex(x => x.id === target.dataset.id);
      if (to < 0) return false;
      arr.splice(to + (after ? 1 : 0), 0, item);
    });
    return;
  }
  const ids = new Set(d.ids);
  const cat = target.dataset.cat, sub = target.dataset.sub || '';
  S.picked.clear();
  edit(data => {
    if (!data.categories.some(c => c.id === cat && (!sub || c.subs.some(s => s.id === sub)))) return false;
    const moving = data.tasks.filter(t => ids.has(t.id));
    const rest = data.tasks.filter(t => !ids.has(t.id));
    moving.forEach(t => { t.cat = cat; t.sub = sub; });
    if (target.dataset.drop === 'task') {
      let i = rest.findIndex(t => t.id === target.dataset.id);
      if (i < 0) return false;
      if (after) i++;
      rest.splice(i, 0, ...moving);
      data.tasks = rest;
    } else {
      data.tasks = rest;
      insertAtBucketEnd(data, moving, cat, sub);
    }
  });
}

// ---------------------------------------------------------------------
// 멤버 관리
// ---------------------------------------------------------------------
async function membersDialog() {
  const l = cur();
  const p = perms(l);
  const myRole = l.role;
  const isManager = myRole === 'owner' || myRole === 'co-owner';
  let members, requests = [];
  try {
    [members, requests] = await Promise.all([
      rpc('checklist_members', { p_id: l.id }),
      isManager ? rpc('checklist_requests', { p_id: l.id }) : Promise.resolve([]),
    ]);
  } catch (e) { toast(e.message, true); return; }
  const grantable = ['member', 'guest', 'co-owner', ...(myRole === 'owner' ? ['owner'] : [])];
  const requestRows = requests.map(q => `<div class="member-row">
      <div class="who"><b>${esc(q.display_name)}</b> <span class="helper">${esc(q.username)} · ${esc(fmtDateTime(q.requested_at))}</span></div>
      <select data-role-for="${esc(q.user_id)}" aria-label="${esc(q.display_name)} 승인 역할" ${p.manage ? '' : 'disabled'}>
        ${grantable.map(r => `<option value="${r}">${ROLE_LABEL[r]} · ${ROLE_DESC[r]}</option>`).join('')}</select>
      <button type="button" class="small primary" data-action="approve" data-user="${esc(q.user_id)}" ${p.manage ? '' : 'disabled'}>승인</button>
      <button type="button" class="small" data-action="reject" data-user="${esc(q.user_id)}" data-name="${esc(q.display_name)}">거절</button>
    </div>`).join('');
  const publicBox = isManager ? `
    <label class="inline"><input type="checkbox" data-action="set-public" ${l.is_public ? 'checked' : ''}>
      가족 공개 — 멤버가 아닌 가족도 목록 이름을 보고 참가할 수 있음</label>
    <p class="hint">${l.kind === 'simple' ? 'Simple 목록은 [참가]하면 바로 Co-owner가 됩니다.' : '일반 목록은 [참가]하면 요청이 오고, Owner·Co-owner가 역할을 정해 승인합니다.'}</p>
    ${l.kind === 'standard' || requests.length ? `<div class="divider"></div><h3 style="font-size:15px;margin-bottom:6px">참가 요청 (${requests.length})</h3>
      ${requestRows || '<p class="helper">대기 중인 요청이 없습니다.</p>'}
      ${requests.length && !p.manage ? '<p class="hint">종결된 목록은 재개한 뒤 승인할 수 있습니다.</p>' : ''}` : ''}
    <div class="divider"></div>` : '';
  const roleOptions = (selected, allowOwner) => ['owner', 'co-owner', 'member', 'guest']
    .filter(r => allowOwner || r !== 'owner' || r === selected)
    .map(r => `<option value="${r}" ${r === selected ? 'selected' : ''} ${!allowOwner && r === 'owner' ? 'disabled' : ''}>${ROLE_LABEL[r]} · ${ROLE_DESC[r]}</option>`).join('');
  const rows = members.map(m => {
    const isMe = m.user_id === S.me.id;
    const canChange = p.manage && (myRole === 'owner' || m.role !== 'owner');
    const canRemove = !isMe && p.manage && myRole === 'owner';
    return `<div class="member-row">
      <div class="who"><b>${esc(m.display_name)}</b> <span class="helper">${esc(m.username)}${isMe ? ' · 나' : ''}</span></div>
      ${canChange
        ? `<select data-action="set-role" data-user="${esc(m.user_id)}" aria-label="${esc(m.display_name)} 역할">${roleOptions(m.role, myRole === 'owner')}</select>`
        : `<span class="role-badge">${ROLE_LABEL[m.role]}</span>`}
      ${canRemove ? `<button type="button" class="small" data-action="remove-member" data-user="${esc(m.user_id)}" data-name="${esc(m.display_name)}">내보내기</button>` : ''}
    </div>`;
  }).join('');
  const inList = new Set(members.map(m => m.user_id));
  const candidates = S.family.filter(f => !inList.has(f.id));
  const addForm = p.manage ? `
    <div class="divider"></div>
    <form id="addMemberForm" class="fields">
      <div><label for="am">가족 추가</label>
        ${candidates.length ? `<select id="am" name="username">${candidates.map(f => `<option value="${esc(f.username)}">${esc(f.display_name)} (${esc(f.username)})</option>`).join('')}</select>`
                            : '<p class="helper">추가할 수 있는 가족이 없습니다. 먼저 가족이 가입해야 합니다.</p>'}</div>
      ${candidates.length ? `<div><label for="ar">역할</label><select id="ar" name="role">
        ${['member', 'guest', 'co-owner', ...(myRole === 'owner' ? ['owner'] : [])].map(r => `<option value="${r}">${ROLE_LABEL[r]} · ${ROLE_DESC[r]}</option>`).join('')}</select></div>
      <button class="primary">추가</button>` : ''}
    </form>` : (l.closed_at ? '<p class="hint" style="margin-top:12px">종결된 목록은 참여자를 바꿀 수 없습니다.</p>' : '');
  openDialog(`멤버 · ${l.data.name}`, `
    ${publicBox}
    <h3 style="font-size:15px;margin-bottom:6px">참여자 (${members.length})</h3>
    <div>${rows}</div>
    ${addForm}
    <div class="divider"></div>
    <div class="row" style="justify-content:space-between">
      <span class="hint">권한: Owner 전체 · Co-owner 편집·종결·추가 · Member 완료 체크 · Guest 보기</span>
      <button type="button" class="small" data-action="leave-list">이 목록에서 나가기</button>
    </div>`);
}

// 가족 공개 목록 참가: 일반 목록은 요청, Simple 목록은 바로 Co-owner
async function joinList(b) {
  const simple = b.dataset.kind === 'simple';
  const msg = simple
    ? `‘${b.dataset.name}’에 참가할까요?\nSimple 목록이라 바로 Co-owner(편집 가능)로 참여합니다.`
    : `‘${b.dataset.name}’에 참가를 요청할까요?\nOwner 또는 Co-owner가 역할을 정해 승인하면 참여됩니다.`;
  if (!confirm(msg)) return;
  S.pending++;
  try {
    const res = await rpc('checklist_join', { p_id: b.dataset.id });
    if (res.joined) {
      putList(res.list);
      S.sel = res.list.id; S.search = ''; S.filter = 'all'; S.picked.clear(); rememberSel();
      toast('참가했습니다. Co-owner로 편집할 수 있습니다.');
    } else {
      toast('참가를 요청했습니다. 승인되면 내 목록에 나타납니다.');
    }
    await refreshLists();
  } catch (e) { toast(toAppError(e).message, true); await refreshLists(); }
  finally { S.pending--; }
  renderAll();
}

async function memberOp(fn, okMessage) {
  S.pending++;
  try { await fn(); await refreshLists(); if (okMessage) toast(okMessage); }
  catch (e) { toast(toAppError(e).message, true); }
  finally { S.pending--; }
  renderAll();
  if (cur()) await membersDialog(); else closeDialog();
}

// ---------------------------------------------------------------------
// 내 계정
// ---------------------------------------------------------------------
function accountDialog() {
  openDialog('내 계정', `
  <form id="nameForm" class="fields">
    <div><label for="an">표시 이름</label><input id="an" name="name" maxlength="${LIMIT.display}" required value="${esc(S.me.display_name)}">
      <p class="hint">아이디: ${esc(S.me.username)} (아이디는 바꿀 수 없습니다)</p></div>
    <p class="form-error" role="alert"></p>
    <div class="row"><button class="primary">이름 저장</button></div>
  </form>
  <div class="divider"></div>
  <form id="pwForm" class="fields">
    <div><label for="pc">현재 비밀번호</label><input id="pc" name="current" type="password" autocomplete="current-password" required></div>
    <div class="twocol">
      <div><label for="pn">새 비밀번호</label><input id="pn" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
      <div><label for="pn2">새 비밀번호 확인</label><input id="pn2" name="password2" type="password" autocomplete="new-password" minlength="8" required></div>
    </div>
    <p class="form-error" role="alert"></p>
    <div class="row"><button class="primary">비밀번호 변경</button></div>
  </form>
  <div class="divider"></div>
  <div class="row" style="justify-content:flex-end"><button type="button" data-action="logout">로그아웃</button></div>`);
}

async function submitName(form) {
  const name = form.name.value.trim();
  if (!name) return;
  setBusy(form, true);
  try {
    S.me = await rpc('checklist_set_display_name', { p_name: name });
    S.family = await rpc('checklist_family');
    closeDialog(); renderAll(); toast('이름을 바꿨습니다.');
  } catch (e) { $('.form-error', form).textContent = toAppError(e).message; setBusy(form, false); }
}

// ---------------------------------------------------------------------
// 백업 내보내기 / 가져오기
// ---------------------------------------------------------------------
function exportBackup() {
  const payload = {
    format: 'family-checklist-v1',
    exportedAt: new Date().toISOString(),
    exportedBy: S.me.username,
    lists: S.lists.map(l => ({ kind: l.kind, closed_at: l.closed_at, data: l.data })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `checklist-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('내가 참여한 목록 전체를 파일로 저장했습니다. [백업 가져오기]로 복원할 수 있습니다.');
}

async function importBackup(file) {
  let payload;
  try { payload = JSON.parse(await file.text()); } catch { toast('백업 파일을 읽을 수 없습니다.', true); return; }
  const lists = payload?.format === 'family-checklist-v1' && Array.isArray(payload.lists) ? payload.lists : null;
  if (!lists || !lists.every(x => x && ['standard', 'simple'].includes(x.kind) && x.data && Array.isArray(x.data.tasks) && Array.isArray(x.data.categories))) {
    toast('이 앱의 백업 파일이 아닙니다.', true); return;
  }
  if (!confirm(`백업의 목록 ${lists.length}개를 '새 목록'으로 추가합니다.\n기존 목록은 바뀌지 않습니다. 참여자·담당자·종결 상태는 복원되지 않으며, 내가 Owner가 됩니다.\n계속할까요?`)) return;
  let ok = 0, fail = 0;
  S.pending++;
  for (const x of lists) {
    const data = structuredClone(x.data);
    data.date = x.kind === 'simple' ? (data.date || '') : '';
    data.tasks = data.tasks.map(t => ({ ...t, assignees: [] }));
    try { putList(await rpc('checklist_create', { p_kind: x.kind, p_data: data })); ok++; }
    catch { fail++; }
  }
  S.pending--;
  ensureSelection();
  renderAll();
  toast(`가져오기 완료: ${ok}개 추가${fail ? `, ${fail}개 실패(형식 오류)` : ''}`, fail > 0);
}

// ---------------------------------------------------------------------
// 이벤트 연결 (한 곳에서 처리)
// ---------------------------------------------------------------------
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action]');
  if (!b) { if (!e.target.closest('.pop')) closePop(); return; }
  const a = b.dataset.action;
  if (b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type !== 'checkbox')) return;
  const l = cur();

  switch (a) {
    case 'pop-cancel': return closePop();
    case 'pop-confirm': { const fn = S.pop; closePop(); fn?.(); return; }
    case 'close-dialog': return closeDialog();
    case 'auth-tab': S.authTab = b.dataset.tab; return renderAuth();
    case 'account': return accountDialog();
    case 'logout': return logout();
    case 'new-list': return newListDialog();
    case 'preset': $('#listName').value = b.dataset.value; return;
    case 'kind': {
      const kind = b.dataset.value;
      const form = b.closest('form');
      form.kind.value = kind;
      $$('[data-action="kind"]', form).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.value === kind)));
      $('#dateField').classList.toggle('hidden', kind !== 'simple');
      $('#kindHint').textContent = kind === 'simple' ? '카테고리 한 단계와 항목·완료만 씁니다. 날짜를 표시할 수 있습니다.' : '카테고리·하위 카테고리·마감일·담당자를 씁니다.';
      return;
    }
    case 'select':
      if (S.editing) cancelRename();
      S.sel = b.dataset.id; S.search = ''; S.filter = 'all'; S.picked.clear(); rememberSel();
      renderMain();
      if (window.matchMedia('(max-width: 800px)').matches) $('#main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    case 'reload': await refreshLists(); renderAll(); toast('최신 상태로 불러왔습니다.'); return;
    case 'export': return exportBackup();
    case 'import': return $('#importFile').click();
    case 'join': return joinList(b);
    case 'cancel-join':
      return listAction(async () => { await rpc('checklist_cancel_join', { p_id: b.dataset.id }); await refreshLists(); toast('참가 요청을 취소했습니다.'); });
  }
  if (!l) return;

  switch (a) {
    case 'favorite': {
      const on = !l.favorite;
      return listAction(async () => { await rpc('checklist_favorite', { p_id: l.id, p_on: on }); l.favorite = on; });
    }
    case 'toggle-closed': {
      const closing = !l.closed_at;
      if (!confirm(closing ? '목록을 종결할까요? 미완료 항목이 있어도 종결할 수 있고, 종결 후에는 읽기 전용이 됩니다.' : '목록을 재개할까요?')) return;
      return listAction(async () => { putList(await rpc('checklist_set_closed', { p_id: l.id, p_closed: closing })); S.picked.clear(); });
    }
    case 'final-delete': case 'delete-task': case 'delete-cat': case 'delete-sub': return askDelete(b);
    case 'members': return membersDialog();
    case 'fold':
      setCollapsed(l.id, [b.dataset.id], !isCollapsed(l.id, b.dataset.id));
      return renderGroups();
    case 'fold-all': {
      const ids = l.data.categories.map(c => c.id);
      setCollapsed(l.id, ids, !ids.every(id => isCollapsed(l.id, id)));
      return renderMain();
    }
    case 'detail': return detailDialog(b.dataset.id);
    case 'toggle': return toggleTask(b.dataset.id);
  }
  if (a === 'approve') {
    const role = $(`select[data-role-for="${CSS.escape(b.dataset.user)}"]`)?.value ?? 'member';
    return memberOp(() => rpc('checklist_approve', { p_id: l.id, p_user: b.dataset.user, p_role: role }), `승인했습니다 (${ROLE_LABEL[role]}).`);
  }
  if (a === 'reject') {
    if (!confirm(`${b.dataset.name}님의 참가 요청을 거절할까요?`)) return;
    return memberOp(() => rpc('checklist_reject', { p_id: l.id, p_user: b.dataset.user }), '거절했습니다.');
  }
  if (a === 'remove-member') {
    if (!confirm(`${b.dataset.name}님을 이 목록에서 내보낼까요?`)) return;
    return memberOp(() => rpc('checklist_remove_member', { p_id: l.id, p_user: b.dataset.user }), '내보냈습니다.');
  }
  if (a === 'leave-list') {
    if (!confirm('이 목록에서 나갈까요? 다시 참여하려면 Owner나 Co-owner가 추가해 줘야 합니다.')) return;
    S.pending++;
    try {
      await rpc('checklist_remove_member', { p_id: l.id, p_user: S.me.id });
      S.lists = S.lists.filter(x => x.id !== l.id); S.sel = null; ensureSelection(); rememberSel();
      closeDialog(); toast('목록에서 나갔습니다.');
    } catch (err) { toast(toAppError(err).message, true); }
    finally { S.pending--; }
    return renderAll();
  }
  if (!perms(l).edit) return;
  switch (a) {
    case 'edit-list': return editListDialog();
    case 'duplicate': return duplicateDialog();
    case 'add-cat': return catDialog(null);
    case 'add-sub': return catDialog(b.dataset.id);
    case 'batch': return batchDialog(b.dataset.cat, b.dataset.sub);
    case 'rename': return beginRename(b);
    case 'rename-save': return saveRename();
    case 'rename-cancel': return cancelRename();
    case 'move-picked': return moveDialog();
    case 'clear-picked': S.picked.clear(); return renderGroups();
    case 'pick': if (b.checked) S.picked.add(b.dataset.id); else S.picked.delete(b.dataset.id); return renderPickedBar();
  }
});

document.addEventListener('submit', e => {
  const f = e.target;
  e.preventDefault();
  if (f.dataset.form === 'quick') return quickAdd(f);
  switch (f.id) {
    case 'loginForm': return doLogin(f);
    case 'signupForm': return doSignup(f);
    case 'pwForm': return changePassword(f);
    case 'nameForm': return submitName(f);
    case 'newListForm': return submitNewList(f);
    case 'editListForm': return submitEditList(f);
    case 'dupForm': return submitDuplicate(f);
    case 'batchForm': return submitBatch(f);
    case 'catForm': return submitCat(f);
    case 'detailForm': return submitDetail(f);
    case 'moveForm': return submitMove(f);
    case 'addMemberForm': {
      const l = cur();
      return memberOp(() => rpc('checklist_add_member', { p_id: l.id, p_username: f.username.value, p_role: f.role.value }), '추가했습니다.');
    }
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'filter') { S.filter = t.value; return renderGroups(); }
  if (t.id === 'noDate') { $('#listDate').disabled = t.checked; if (!t.checked && !$('#listDate').value) $('#listDate').value = today(); return; }
  if (t.id === 'dc' && $('#ds')) { $('#ds').innerHTML = subOptions(cur(), t.value); return; }
  if (t.id === 'importFile' && t.files[0]) { const file = t.files[0]; t.value = ''; return importBackup(file); }
  if (t.dataset.action === 'set-public') {
    const l = cur(), on = t.checked;
    return memberOp(async () => { putList(await rpc('checklist_set_public', { p_id: l.id, p_public: on })); },
      on ? '가족 공개로 바꿨습니다.' : '비공개로 바꿨습니다. 멤버가 아닌 가족에게는 더 이상 보이지 않습니다.');
  }
  if (t.dataset.action === 'set-role') {
    const l = cur();
    return memberOp(() => rpc('checklist_set_role', { p_id: l.id, p_user: t.dataset.user, p_role: t.value }), '역할을 바꿨습니다.');
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'search') { S.search = t.value; return renderGroups(); }
  if (t.id === 'closedSearch') {
    S.closedQuery = t.value;
    const pos = t.selectionStart;
    renderSidebar();
    const again = $('#closedSearch');
    again.focus(); again.setSelectionRange(pos, pos);
    return;
  }
  if (t.id === 'bc') {
    const c = cur()?.data.categories.find(x => x.name.trim() === t.value.trim());
    const dl = $('#bsList');
    if (dl) dl.innerHTML = (c?.subs ?? []).map(s => `<option value="${esc(s.name)}"></option>`).join('');
  }
});

document.addEventListener('toggle', e => { if (e.target.id === 'closedBox') S.closedOpen = e.target.open; }, true);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePop();
  if (e.target.classList?.contains('inline-name')) {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveRename(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
  }
});
window.addEventListener('scroll', closePop, true);
window.addEventListener('beforeunload', e => { if (S.pending) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
async function start() {
  try {
    await loadAll();
  } catch (e) {
    S.me = null;
    renderAll();
    toast(toAppError(e).message, true);
    return;
  }
  renderAll();
}

(async () => {
  if (!configured) return renderAll();
  sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT' && S.me) onAuthLost(); });
  const { data } = await sb.auth.getSession();
  if (data.session) await start(); else renderAll();
})();
