import { CONFIG, price } from './config.js';
import { kstToday } from './utils.js';
export function lunchSnapshot(rows, date, at = new Date().toISOString()) {
  const items = rows.filter(row => row.date === date && row.meal === 'lunch' && row.menu !== CONFIG.noOrder).map(row => ({ id: row.id, location: row.location, menu: row.menu }));
  const locations = Object.fromEntries(CONFIG.locations.map(location => [location, items.filter(row => row.location === location).length]));
  return { date, at, total: items.length, locations, items };
}
export function kstTime(iso) { return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }); }
const signed = n => n > 0 ? `+${n}` : n < 0 ? String(n) : '변동 없음';
export function buildLunchReport(snapshot, kind, first) {
  if (!['first', 'final'].includes(kind)) throw new Error('집계 종류를 확인해주세요.');
  const lines = [`[${CONFIG.projectName} 중식 ${kind === 'first' ? '1차' : '최종'} 집계]`, `식사일: ${snapshot.date}`, `집계 기준: ${kstTime(snapshot.at)} (KST)`, '', `전체: ${snapshot.total}개`];
  if (kind === 'final') {
    const amount = snapshot.items.reduce((sum, item) => sum + price(item.menu), 0);
    lines.push(`총 금액: ${amount.toLocaleString('ko-KR')}원 (부가세 포함)`);
    if (!first) lines.push('1차 발송 기록 없음');
    else {
      const old = new Map(first.items.map(item => [item.id, item]));
      const current = new Map(snapshot.items.map(item => [item.id, item]));
      const added = snapshot.items.filter(item => !old.has(item.id)).length;
      const removed = first.items.filter(item => !current.has(item.id)).length;
      const changed = snapshot.items.filter(item => old.has(item.id) && (old.get(item.id).location !== item.location || old.get(item.id).menu !== item.menu)).length;
      lines.push(`1차 대비: ${signed(snapshot.total - first.total)}${snapshot.total === first.total ? '' : '개'}`, `추가 ${added}개 / 취소 ${removed}개 / 변경 ${changed}개`, `1차 기준: ${kstTime(first.at)} (KST)`);
    }
  }
  for (const [location, count] of Object.entries(snapshot.locations)) lines.push(`${location}: ${count}개${kind === 'final' && first ? ` (${signed(count - (first.locations[location] || 0))})` : ''}`);
  if (new TextEncoder().encode(lines.join('\n')).length > 2000) throw new Error('문자 길이 제한을 초과했습니다.');
  return lines.join('\n');
}
