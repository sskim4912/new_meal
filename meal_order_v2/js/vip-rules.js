import { CONFIG } from './config.js';
import { kstToday } from './utils.js';
export const PROXY_SOURCE = 'admin-proxy';
export function proxyDeadline(date) { return Date.parse(`${date}T10:00:00+09:00`); }
export function validateProxy(row, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date)
    throw new Error('올바른 식사 날짜를 선택해주세요.');
  if (row.date < kstToday(new Date(now)) || now >= proxyDeadline(row.date)) throw new Error('VIP·본사출장의 신규·수정·취소는 식사일 10:00 전까지만 가능합니다.');
  if (row.group !== 'vip' || row.meal !== 'lunch' || row.location !== '사무실' || row.source !== PROXY_SOURCE || row.quantity !== 1 || !CONFIG.menuRules.lunch.only.includes(row.menu))
    throw new Error('관리자 대리신청은 중식·사무실·수량 1만 가능합니다.');
  if (!String(row.company || '').trim() || row.company.length > 80 || !String(row.name || '').trim() || row.name.length > 40)
    throw new Error('소속과 이름을 입력해주세요.');
  if (row.empId !== '' || row.phone !== '') throw new Error('대리신청의 사번·연락처는 비워주세요.');
}
export function duplicateOrders(rows, candidate) {
  return rows.filter(row => row.date === candidate.date && row.meal === 'lunch' && row.menu !== CONFIG.noOrder && row.name.trim() === candidate.name.trim() && row.id !== candidate.id);
}
