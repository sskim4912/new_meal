// 인증 정보 없이 보호 경로만 점검합니다. 로그인·주문 저장·문자 발송은 하지 않습니다.
import assert from 'node:assert/strict';
import { SMS } from '../js/sms-config.js';
const origin = new URL(SMS.endpoint).origin;
for (const path of ['/auth/verify', '/vip/list', '/vip/save', '/reports/preview', '/send']) {
  const response = await fetch(origin + path, {
    method: 'POST', headers: { Origin: 'https://sskim4912.github.io', 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.equal(response.status, 401, `${path}: administrator session gate unavailable (${response.status})`);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://sskim4912.github.io');
  assert.match(data.error || '', /로그인/);
  console.log(`PASS: ${path} requires administrator login; CORS is configured.`);
}
console.log('No credentials used, no orders written, no SMS sent.');
