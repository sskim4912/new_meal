import { CONFIG } from './config.js';
import { $, escapeHTML as esc, kstToday, status, confirmAction } from './utils.js';
import { requireAdmin } from './admin-entry.js';
import { adminRequest, logoutAdmin } from './admin-session.js';
import { validateProxy, proxyDeadline, PROXY_SOURCE } from './vip-rules.js';
let rows = [], dirty = false, busy = false, activeDate = kstToday(), version = 0;
$('vipDate').value = activeDate;
$('vipDate').min = kstToday();
const closed = () => Date.now() >= proxyDeadline(activeDate);
function blank() { return { id: `proxy:${crypto.randomUUID()}`, company: '', name: '', menu: CONFIG.menuRules.lunch.only[0], fresh: true }; }
function render() {
  $('vipRows').innerHTML = `<table><thead><tr>${['순번','소속','이름','중식 메뉴','수량','작업'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map((row,index)=>`<tr data-row="${index}"><td>${index+1}</td><td><input data-field="company" aria-label="${index+1}번 소속" maxlength="80" value="${esc(row.company)}"></td><td><input data-field="name" aria-label="${index+1}번 이름" maxlength="40" value="${esc(row.name)}"></td><td><select data-field="menu" aria-label="${index+1}번 중식 메뉴">${CONFIG.menuRules.lunch.only.map(menu=>`<option ${menu===row.menu?'selected':''}>${esc(menu)}</option>`).join('')}</select></td><td>1</td><td><button data-remove="${index}" class="danger">${row.fresh?'행 삭제':'신청 취소'}</button></td></tr>`).join('')}</tbody></table>`;
  updateDisabled();
}
function updateDisabled() {
  $('vipRows').querySelectorAll('input,select,button').forEach(control=>control.disabled=busy||closed());
  $('vipAdd').disabled=busy||closed();$('vipSubmit').disabled=busy||closed()||!rows.length;
  $('vipDate').disabled=busy;$('vipReload').disabled=busy;$('vipLogout').disabled=busy;
}
function lock(preserve=false) { version++; $('vipContent').hidden=true;$('vipLogin').hidden=false;if(!preserve){rows=[];dirty=false;$('vipRows').replaceChildren();} }
async function load() {
  const current=++version;busy=true;updateDisabled();
  try {
    const data=await adminRequest('/vip/list',{date:activeDate});
    if(current!==version)return;
    rows=data.rows.map(row=>({...row,fresh:false}));if(!rows.length&&!closed())rows=[blank()];dirty=false;render();
    status('vipStatus',closed()?'해당 식사일의 10:00 마감이 지났습니다. 미래 날짜를 선택해주세요.':'기존 대리신청을 불러왔습니다.');
    return true;
  }catch(error){status('vipStatus',error.message,true);return false;}finally{busy=false;updateDisabled();}
}
async function enter() {
  if(await requireAdmin()){$('vipContent').hidden=false;$('vipLogin').hidden=true;if(dirty&&rows.length)render();else await load();}
}
$('vipLogin').onclick=enter;
$('vipLogout').onclick=async()=>{if(dirty&&!(await confirmAction('로그아웃','저장하지 않은 입력을 지우고 로그아웃할까요?')))return;try{await logoutAdmin();}finally{lock();}};
window.addEventListener('admin-session-expired',()=>{lock(true);status('vipStatus','관리자 로그인이 만료되었습니다. 다시 로그인해주세요.',true);});
$('vipDate').onchange=async()=>{
  if(dirty&&!(await confirmAction('날짜 변경','저장하지 않은 입력을 지우고 다른 날짜를 조회할까요?'))){$('vipDate').value=activeDate;return;}
  activeDate=$('vipDate').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(activeDate)){activeDate=kstToday();$('vipDate').value=activeDate;}
  await load();
};
$('vipReload').onclick=async()=>{if(!dirty||await confirmAction('다시 조회','저장하지 않은 입력을 지우고 다시 조회할까요?'))await load();};
$('vipAdd').onclick=()=>{if(busy||closed())return;rows.push(blank());dirty=true;render();};
$('vipRows').addEventListener('input',event=>{
  if(busy||closed())return;
  const index=Number(event.target.closest('[data-row]')?.dataset.row),field=event.target.dataset.field;
  if(rows[index]&&['company','name','menu'].includes(field)){rows[index][field]=event.target.value;rows[index].changed=true;dirty=true;}
});
$('vipRows').addEventListener('change',event=>{
  if(event.target.dataset.field==='menu')event.target.dispatchEvent(new Event('input',{bubbles:true}));
});
$('vipRows').addEventListener('click',async event=>{
  const button=event.target.closest('[data-remove]');if(!button||busy||closed())return;
  const index=Number(button.dataset.remove),row=rows[index];
  if(row.fresh){rows.splice(index,1);dirty=true;render();return;}
  if(!(await confirmAction('신청 취소',`${row.name}님의 ${activeDate} 중식을 취소할까요?`)))return;
  busy=true;updateDisabled();
  try{await adminRequest('/orders/delete',{ids:[row.id]});rows.splice(index,1);render();status('vipStatus','신청을 취소했습니다.');}
  catch(error){status('vipStatus',error.message,true);}finally{busy=false;updateDisabled();}
});
$('vipSubmit').onclick=async()=>{
  if(busy)return;
  const pending=rows.filter(row=>row.fresh||row.changed).map(row=>({...row,date:activeDate,group:'vip',meal:'lunch',location:'사무실',quantity:1,source:PROXY_SOURCE,empId:'',phone:''}));
  try{if(!pending.length)throw new Error('저장할 변경 내역이 없습니다.');pending.forEach(row=>validateProxy(row));}
  catch(error){status('vipStatus',error.message,true);return;}
  if(!(await confirmAction('대리신청 제출',`${activeDate} · 사무실 중식 ${pending.length}명의 신규·수정 내역을 저장할까요?`)))return;
  busy=true;updateDisabled();
  try{
    let data=await adminRequest('/vip/save',{rows:pending});
    if(data.duplicates?.length){
      const names=[...new Set(data.duplicates.map(row=>`${row.date} · ${row.name} (${CONFIG.groups[row.group]||row.group})`))];
      if(!(await confirmAction('중복 신청 경고',`같은 날짜·이름의 중식 신청이 있습니다. 기존 신청은 관리자 집계에서 확인할 수 있습니다.\n\n${names.join('\n')}\n\n동명이인 또는 별도 신청임을 확인한 후 계속할까요?`)))return;
      data=await adminRequest('/vip/save',{rows:pending,confirmDuplicates:true});
    }
    rows=rows.map(row=>({...row,fresh:false,changed:false}));dirty=false;render();
    const loaded=await load();status('vipStatus',loaded?`${data.saved}건을 관리자 대리신청으로 저장했습니다.`:`${data.saved}건은 저장됐지만 재조회에 실패했습니다. 다시 조회해주세요.`,!loaded);
  }catch(error){status('vipStatus',error.message,true);}finally{busy=false;updateDisabled();}
};
setInterval(updateDisabled,30000);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
enter();
