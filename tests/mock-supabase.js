// 시험 전용: supabase-js 대신 PGlite 백엔드를 쓰는 가짜 클라이언트 (app.js가 쓰는 기능만 구현)
import { createBackend } from './pglite-backend.js';

const ready = createBackend().then(async b => {
  await b.db.query(`update app_private.settings set value = 'family' where key = 'signup_code'`);
  window.__backend = b;            // 콘솔에서 직접 확인용
  return b;
});

export function createClient() {
  let session = null;
  const listeners = [];
  const emit = ev => listeners.forEach(fn => fn(ev, session));
  return {
    auth: {
      async getSession() { await ready; return { data: { session } }; },
      onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) {
        const b = await ready;
        const r = await b.signIn(email, password);
        if (r.error) return { data: {}, error: r.error };
        session = { user: { id: r.id, email } }; emit('SIGNED_IN');
        return { data: { session }, error: null };
      },
      async signUp({ email, password, options }) {
        const b = await ready;
        if (password.length < 6) return { data: {}, error: { message: 'Password should be at least 6 characters' } };
        const r = await b.signUp(email, password, options?.data);
        if (r.error) return { data: {}, error: r.error };
        session = { user: { id: r.id, email } }; emit('SIGNED_IN');
        return { data: { session, user: session.user }, error: null };
      },
      async updateUser({ password }) {
        const b = await ready;
        b.setPassword(session.user.email, password);
        return { data: {}, error: null };
      },
      async signOut() { session = null; emit('SIGNED_OUT'); return { error: null }; },
    },
    async rpc(name, args) {
      const b = await ready;
      return b.rpc(session?.user.id ?? null, name, args);
    },
  };
}
