import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { FIREBASE } from '../js/firebase-config.js';
import { CONFIG } from '../js/config.js';
import { kstToday, addDays } from '../js/utils.js';
import { normalizeProfile, requesterKey, orderId, validateChange } from '../js/meal-rules.js';

const target = '2026-10-14';
const start = Date.parse(`${target}T13:00:00+09:00`);
const end = Date.parse(`${target}T14:00:00+09:00`);
assert.equal(CONFIG.deadlines.breakfast.time, '14:00');
assert.equal(CONFIG.deadlines.dinner.time, '14:00');
const profile = normalizeProfile('gs', { empId: `CHECK-${randomUUID().slice(0, 20)}`, name: '마감 시간 점검 자동 삭제' });
const key = requesterKey(profile);
const rows = [['dinner', target], ['breakfast', addDays(target, 1)]].map(([meal, date]) => ({
  ...profile, requesterKey: key, id: orderId(key, date, meal), date, meal,
  menu: CONFIG.menus[0], location: '',
}));
rows.forEach(row => validateChange(row, start + 30 * 60 * 1000));
if (process.argv.includes('--dry-run')) {
  console.log('PASS: planned dinner/breakfast payloads are valid at 13:30 KST; no network requests made.');
  process.exit(0);
}
assert.equal(kstToday(), target, 'This one-time check must run on the planned date.');
assert(Date.now() >= start && Date.now() < end, 'Outside the actual 13:00–14:00 KST window; no records written.');
const root = `projects/${FIREBASE.config.projectId}/databases/(default)/documents`;
const api = 'https://firestore.googleapis.com/v1/';
const names = rows.map(row => `${root}/${FIREBASE.collection}/${createHash('sha256').update(row.id).digest('hex')}`);
const report = { targetDate: target, startedAt: new Date().toISOString(), status: 'running', cleanup: [] };
async function request(path, method = 'GET', body) {
  const response = await fetch(api + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
try {
  const writes = rows.map((row, i) => ({
    update: { name: names[i], fields: Object.fromEntries(Object.entries(row).map(([field, value]) => [field, { stringValue: value }])) },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: false },
  }));
  const result = await request(root + ':commit', 'POST', { writes });
  report.httpStatus = result.status;
  report.serverError = result.data?.error?.status;
  assert.equal(result.status, 200, `Firebase rejected the two meals: ${report.serverError ?? result.status}`);
  report.serverCommitTime = result.data.commitTime;
  const committed = Date.parse(report.serverCommitTime);
  assert(committed >= start && committed < end, 'Server commit time is outside the required window.');
  for (let i = 0; i < names.length; i++) {
    const saved = await request(names[i]);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.fields.meal.stringValue, rows[i].meal);
    assert.equal(saved.data.fields.date.stringValue, rows[i].date);
  }
  report.status = 'passed';
  console.log(`PASS: actual dinner and next-day breakfast saved during 13–14 KST. Server commit time: ${report.serverCommitTime}`);
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  for (const name of names) {
    try {
      const removed = await request(name, 'DELETE');
      report.cleanup.push(removed.status);
      assert([200, 404].includes(removed.status), 'Synthetic record cleanup failed.');
    } catch (error) {
      report.status = 'failed';
      report.cleanupError = error.message;
      process.exitCode = 1;
    }
  }
  await writeFile('live-deadline-report.json', JSON.stringify(report, null, 2));
}
