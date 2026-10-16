import { SMS } from './sms-config.js';
const KEY = 'aurora.admin.session.v1';
let session;
function read() {
  if (session === undefined) {
    try { session = JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { session = null; }
  }
  if (session && session.expiresAt <= Date.now()) clearSession();
  return session;
}
export function clearSession() {
  session = null;
  try { sessionStorage.removeItem(KEY); } catch { /* Memory-only sessions still work. */ }
}
export function sessionToken() { return read()?.token || ''; }
export function expireSession() {
  clearSession();
  globalThis.dispatchEvent?.(new Event('admin-session-expired'));
}
export async function adminRequest(path, body, authenticated = true) {
  if (!SMS.endpoint) throw new Error('관리자 서버 연결 설정이 필요합니다.');
  const url = new URL(path, new URL(SMS.endpoint).origin);
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${sessionToken()}` } : {}) },
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({ error: '관리자 서버 응답을 확인할 수 없습니다. 배포 상태를 확인해주세요.' }));
  if (!response.ok) {
    if (response.status === 401 && authenticated) expireSession();
    const error = new Error(data.error || '관리자 요청에 실패했습니다.');
    error.code = data.code; error.partialDeletion = data.partialDeletion;
    error.isAdminResponse = true;
    throw error;
  }
  return data;
}
export async function loginAdmin(password) {
  const data = await adminRequest('/auth/login', { password }, false);
  session = { token: data.token, expiresAt: data.expiresAt };
  try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch { /* Keep in memory. */ }
  return session;
}
export async function verifyAdmin() {
  if (!sessionToken()) return false;
  try { await adminRequest('/auth/verify'); return true; } catch { return false; }
}
export async function logoutAdmin() {
  try { if (sessionToken()) await adminRequest('/auth/logout'); } finally { clearSession(); }
}
