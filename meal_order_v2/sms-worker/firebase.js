import { FIREBASE } from '../js/firebase-config.js';
import { validateProxy, duplicateOrders, PROXY_SOURCE } from '../js/vip-rules.js';
import { CONFIG } from '../js/config.js';
let credentials;
export class ApiError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const root = `projects/${FIREBASE.config.projectId}/databases/(default)/documents`;
const base = 'https://firestore.googleapis.com/v1/';
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function firebaseToken(env) {
  if (!env.FIREBASE_ADMIN_EMAIL || !env.FIREBASE_ADMIN_PASSWORD) throw new ApiError('Firebase 관리자 연결 설정이 필요합니다. 배포 안내의 관리자 계정 설정을 완료해주세요.', 503);
  if (credentials?.email === env.FIREBASE_ADMIN_EMAIL && credentials.expiresAt > Date.now()) return credentials.token;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE.config.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.FIREBASE_ADMIN_EMAIL, password: env.FIREBASE_ADMIN_PASSWORD, returnSecureToken: true }), signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || !data.idToken) throw new ApiError('Firebase 관리자 계정 연결에 실패했습니다. 서버 설정을 확인해주세요.', 503);
  credentials = { email: env.FIREBASE_ADMIN_EMAIL, token: data.idToken, expiresAt: Date.now() + (Number(data.expiresIn) - 60) * 1000 };
  return credentials.token;
}
function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('timestampValue' in value) return value.timestampValue;
  return null;
}
function decodeDocument(document) { return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)])); }
async function firestore(path, env, body, authenticated = false) {
  const token = authenticated ? await firebaseToken(env) : null;
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status === 403 ? 'Firebase 관리자 권한 또는 마감 규칙이 요청을 거부했습니다. 관리자 등록 문서와 게시된 규칙을 확인해주세요.' : 'Firebase 요청에 실패했습니다.', response.status === 403 ? 403 : 502);
  return data;
}
export async function allOrders(env, date) {
  const query = { from: [{ collectionId: FIREBASE.collection }] };
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError('식사 날짜를 확인해주세요.');
    query.where = { fieldFilter: { field: { fieldPath: 'date' }, op: 'EQUAL', value: { stringValue: date } } };
  }
  const data = await firestore(root + ':runQuery', env, { structuredQuery: query });
  return data.filter(item => item.document).map(item => decodeDocument(item.document));
}
function checkProxy(row) { try { validateProxy(row); } catch (error) { throw new ApiError(error.message); } }
async function documentName(id) { return `${root}/${FIREBASE.collection}/${await digest(id)}`; }
export async function proxySave(env, body) {
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 100) throw new ApiError('한 번에 1~100명을 입력해주세요.');
  const unique = new Set();
  const rows = body.rows.map(input => {
    if (!/^proxy:[a-f0-9-]{36}$/i.test(input.id || '') || unique.has(input.id)) throw new ApiError('신청 식별자가 중복되거나 올바르지 않습니다.');
    unique.add(input.id);
    const row = { id: input.id, requesterKey: JSON.stringify(['vip-proxy', input.id]), group: 'vip', empId: '', phone: '', company: String(input.company || '').trim(), name: String(input.name || '').trim(), date: input.date, meal: 'lunch', location: '사무실', menu: input.menu, source: PROXY_SOURCE, quantity: 1 };
    checkProxy(row); return row;
  });
  const all = await allOrders(env);
  for (const row of rows) {
    const previous = all.find(item => item.id === row.id);
    if (previous) checkProxy(previous);
  }
  const duplicates = rows.flatMap(row => duplicateOrders(all.filter(item => !unique.has(item.id)), row).map(match => ({ id: row.id, date: row.date, name: row.name, group: match.group })));
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (rows[i].date === rows[j].date && rows[i].name === rows[j].name) duplicates.push({ id: rows[j].id, date: rows[j].date, name: rows[j].name, group: 'vip' });
  if (duplicates.length && !body.confirmDuplicates) return { duplicates };
  const writes = await Promise.all(rows.map(async row => ({ update: { name: await documentName(row.id), fields: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }])) }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] })));
  await firestore(root + ':commit', env, { writes }, true);
  return { saved: rows.length, duplicates: [] };
}
export async function deleteOrders(env, body) {
  if (!Array.isArray(body.ids) || body.ids.length > 2000 || body.ids.some(id => typeof id !== 'string' || id.length > 1000)) throw new ApiError('삭제할 신청을 확인해주세요.');
  const all = await allOrders(env);
  const ids = new Set(body.ids);
  const targets = all.filter(row => ids.has(row.id));
  targets.filter(row => row.source === PROXY_SOURCE).forEach(checkProxy);
  let deleted = 0;
  try {
    for (let i = 0; i < targets.length; i += 450) {
      const chunk = targets.slice(i, i + 450);
      const writes = await Promise.all(chunk.map(async row => ({ delete: await documentName(row.id) })));
      await firestore(root + ':commit', env, { writes }, chunk.some(row => row.source === PROXY_SOURCE));
      deleted += chunk.length;
    }
  } catch (error) { error.partialDeletion = deleted > 0; throw error; }
  return { deleted };
}
