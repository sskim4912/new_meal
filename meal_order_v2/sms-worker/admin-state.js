import { digest } from './firebase.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
export async function sameSecret(left, right) {
  const a = await digest(left), b = await digest(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export class AdminState {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    return this.state.blockConcurrencyWhile(async () => {
      const body = await request.json();
      const path = new URL(request.url).pathname;
      if (path === '/login') {
        if (!this.env.ADMIN_PASSWORD) return json({ error: '관리자 서버의 ADMIN_PASSWORD 설정이 필요합니다.', }, 503);
        const key = `attempt:${await digest(body.ip || 'unknown')}`;
        let attempt = await this.state.storage.get(key);
        if (!attempt || attempt.until <= Date.now()) attempt = { count: 0, until: Date.now() + 15 * 60000 };
        if (attempt.count >= 5) return json({ error: '로그인 시도가 많습니다. 15분 후 다시 시도해주세요.' }, 429);
        if (!(await sameSecret(String(body.password || ''), this.env.ADMIN_PASSWORD))) {
          attempt.count++; await this.state.storage.put(key, attempt);
          await this.state.storage.setAlarm(Date.now() + 60000);
          return json({ error: '비밀번호를 확인해주세요.' }, 401);
        }
        await this.state.storage.delete(key);
        const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const session = { expiresAt: Date.now() + 8 * 3600000 };
        await this.state.storage.put(`session:${await digest(token)}`, session);
        await this.state.storage.setAlarm(Date.now() + 60000);
        return json({ token, ...session });
      }
      if (path === '/verify' || path === '/logout') {
        const key = `session:${await digest(body.token || '')}`;
        const session = await this.state.storage.get(key);
        if (path === '/logout') { await this.state.storage.delete(key); return json({ ok: true }); }
        if (!session || session.expiresAt <= Date.now()) return json({ error: '관리자 로그인이 만료되었습니다. 다시 로그인해주세요.' }, 401);
        return json({ ok: true, expiresAt: session.expiresAt });
      }
      if (path === '/snapshot/get') return json({ snapshot: await this.state.storage.get(`first:${body.date}`) || null });
      if (path === '/snapshot/set') { await this.state.storage.put(`first:${body.snapshot.date}`, body.snapshot); return json({ ok: true }); }
      if (path === '/preview/set') {
        const id = crypto.randomUUID();
        await this.state.storage.put(`preview:${id}`, { ...body.preview, expiresAt: Date.now() + 5 * 60000 });
        await this.state.storage.setAlarm(Date.now() + 60000);
        return json({ id });
      }
      if (path === '/preview/get') {
        const preview = await this.state.storage.get(`preview:${body.id}`);
        if (!preview || preview.expiresAt <= Date.now()) return json({ error: '문자 미리보기가 만료되었습니다. 집계를 다시 확인해주세요.' }, 409);
        return json({ preview });
      }
      return json({ error: '경로를 확인해주세요.' }, 404);
    });
  }
  async alarm() {
    const records = await this.state.storage.list();
    let pending = false;
    for (const [key, value] of records) {
      if (!key.startsWith('session:') && !key.startsWith('attempt:') && !key.startsWith('preview:')) continue;
      if ((value.expiresAt || value.until) <= Date.now()) await this.state.storage.delete(key);
      else pending = true;
    }
    if (pending) await this.state.storage.setAlarm(Date.now() + 60000);
  }
}
