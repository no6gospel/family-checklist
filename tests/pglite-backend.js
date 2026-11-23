// 시험 전용: 브라우저 안의 PostgreSQL(PGlite)에 Supabase의 auth 부분을 흉내 내고 supabase/schema.sql 을 올립니다.
// 실제 Supabase와 같지는 않습니다(권한 역할·인증 서버는 단순화). DB 함수의 논리·권한 검사 시험용입니다.
import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js';

const AUTH_STUB = `
create schema if not exists auth;
create schema if not exists extensions;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
`;

export async function createBackend() {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  const schema = await (await fetch(new URL('../supabase/schema.sql', import.meta.url), { cache: 'no-store' })).text();
  await db.exec(schema);
  const passwords = new Map();   // email → password (시험용 평문)

  async function as(userId) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  }

  return {
    db,
    async signUp(email, password, meta) {
      try {
        const r = await db.query(`insert into auth.users(email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
          [email, JSON.stringify(meta ?? {})]);
        passwords.set(email, password);
        return { id: r.rows[0].id };
      } catch (e) {
        if (/duplicate key/.test(e.message)) return { error: { message: 'User already registered', code: 'user_already_exists' } };
        return { error: { message: 'Database error saving new user', detail: e.message } };
      }
    },
    async signIn(email, password) {
      if (passwords.get(email) !== password) return { error: { message: 'Invalid login credentials' } };
      const r = await db.query(`select id from auth.users where email = $1`, [email]);
      return { id: r.rows[0].id };
    },
    setPassword(email, password) { passwords.set(email, password); },
    async rpc(userId, name, args = {}) {
      if (!/^checklist_[a-z_]+$/.test(name)) return { data: null, error: { message: 'bad function' } };
      const keys = Object.keys(args);
      const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const vals = keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]);
      try {
        await as(userId);
        const res = await db.query(sql, vals);
        return { data: res.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  };
}
