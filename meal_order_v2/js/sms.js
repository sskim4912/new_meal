import { CONFIG, price } from './config.js';
import { actualOrders, aggregate } from './aggregate.js';
export function normalizePhone(value) {
  const phone = String(value).replace(/[\s()-]/g, '');
  if (!/^01[016789]\d{7,8}$/.test(phone)) throw new Error('수신 휴대폰 번호를 확인해주세요.');
  return phone;
}
export function buildMealMessage(rows, query) {
  const actual = actualOrders(rows);
  if (!query || !actual.length) throw new Error('조회된 실제 식사 신청이 없습니다.');
  const period = query.mode === 'day' ? query.date : query.month;
  const lines = [`[${CONFIG.projectName} 식사 신청 집계]`, `${period} · ${query.mode === 'day' ? '일별' : '월별'} · ${query.group === 'all' ? '전체' : CONFIG.groups[query.group] ?? query.group}`, `총 ${actual.length}개 / ${actual.reduce((sum,r)=>sum+price(r.menu),0).toLocaleString('ko-KR')}원(부가세 포함)`];
  for (const [meal, title] of Object.entries(CONFIG.meals)) {
    const selected = actual.filter(r=>r.meal===meal);
    if (!selected.length) continue;
    lines.push('', `■ ${title} — ${selected.length}개`);
    const fields = query.mode==='month' ? ['date','group','location','menu'] : ['group','location','menu'];
    for (const b of aggregate(selected,fields)) {
      const values=b.values.map((v,i)=>fields[i]==='group' ? CONFIG.groups[v] ?? v : v).filter(v=>v!=='—');
      lines.push(`${values.join(' · ')} ${b.quantity}개`);
    }
  }
  const text=lines.join('\n');
  if (new TextEncoder().encode(text).length>2000) throw new Error('문자 내용이 너무 깁니다. 일별 또는 신청자 구분으로 조회 범위를 줄여주세요.');
  return text;
}
export async function requestSms({ endpoint, token, to, text, requestId }, fetcher=fetch) {
  const url=new URL(endpoint);
  if (url.protocol!=='https:' || url.username || url.password) throw new Error('HTTPS 문자 서버 주소를 설정해주세요.');
  const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({to:normalizePhone(to),text,requestId}),signal:AbortSignal.timeout(25000)});
  let data;
  try { data=await response.json(); } catch { throw new Error('서버 응답을 확인할 수 없습니다. 자동 재발송하지 말고 솔라피 발송 내역을 확인해주세요.'); }
  if (!response.ok || data.status!=='accepted') throw new Error(data.error || '발송 접수를 확인하지 못했습니다. 솔라피 발송 내역을 확인해주세요.');
  return data;
}
