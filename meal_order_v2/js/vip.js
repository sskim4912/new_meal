import { CONFIG } from './config.js';
import { $, escapeHTML as esc, kstToday, status, confirmAction } from './utils.js';
import { requireAdmin } from './admin-entry.js';
import { adminRequest, logoutAdmin } from './admin-session.js';
import { validateProxy, proxyDeadline, PROXY_SOURCE } from './vip-rules.js';
let rows = [], dirty = false, busy = false, activeDate = kstToday(), version = 0;
const selected = new Set(), edits = new Map();
$('vipDate').value = activeDate;
$('vipDate').min = kstToday();
const closed = () => Date.now() >= proxyDeadline(activeDate);
function blank() { return { id: `proxy:${crypto.randomUUID()}`, company: '', name: '', menu: CONFIG.menuRules.lunch.only[0], operatorName: $('vipOperator').value.trim(), fresh: true }; }
function render() {
  const ids = new Set(rows.map(row=>row.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  $('vipRows').innerHTML = `<table><thead><tr>${['선택','순번','소속','이름','중식메뉴','수량','대리입력자 이름','작업'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map((row,index)=>{
    const editing = row.fresh || edits.has(row.id);
    return `<tr data-row="${index}"><td><input type="checkbox" data-select="${index}" aria-label="${index+1}번 선택" ${selected.has(row.id)?'checked':''}></td><td>${index+1}</td><td><input data-field="company" aria-label="${index+1}번 소속" maxlength="80" value="${esc(row.company)}" ${editing?'':'disabled'}></td><td><input data-field="name" aria-label="${index+1}번 이름" maxlength="40" value="${esc(row.name)}" ${editing?'':'disabled'}></td><td><select data-field="menu" aria-label="${index+1}번 중식메뉴" ${editing?'':'disabled'}>${CONFIG.menuRules.lunch.only.map(menu=>`<option ${menu===row.menu?'selected':''}>${esc(menu)}</option>`).join('')}</select></td><td>1</td><td><input data-field="operatorName" aria-label="${index+1}번 대리입력자 이름" maxlength="40" value="${esc(row.operatorName||'')}" placeholder="${editing?'이름 입력':'미기록'}" ${editing?'':'disabled'}></td><td>${row.fresh?'':editing?`<button data-save="${index}">저장</button><button data-cancel="${index}">취소</button>`:`<button data-edit="${index}">수정</button>`}<button data-remove="${index}" class="danger">삭제</button></td></tr>`;
  }).join('')}</tbody></table>`;
  updateDisabled();
}
function updateDisabled() {
  const unavailable=busy||closed();
  $('vipRows').querySelectorAll('tr[data-row]').forEach(tr=>{
    const row=rows[Number(tr.dataset.row)];
    tr.querySelectorAll('input,select,button').forEach(control=>control.disabled=unavailable||Boolean(control.dataset.field&&!row.fresh&&!edits.has(row.id)));
  });
  $('vipAdd').disabled=unavailable;$('vipSubmit').disabled=unavailable||!rows.length;
  $('vipDate').disabled=busy;$('vipReload').disabled=busy;$('vipLogout').disabled=busy;$('vipOperator').disabled=unavailable;
  $('vipSelectAll').disabled=unavailable||!rows.length;
  $('vipSelectAll').checked=rows.length>0&&selected.size===rows.length;
  $('vipSelectAll').indeterminate=selected.size>0&&selected.size<rows.length;
  $('vipSelectedCount').textContent=`선택 ${selected.size}건`;
  $('vipDeleteSelected').disabled=unavailable||!selected.size;
}
function refreshDirty() { dirty=rows.some(row=>row.fresh||row.changed); }
function lock(preserve=false) { version++; $('vipContent').hidden=true;$('vipLogin').hidden=false;if(!preserve){rows=[];selected.clear();edits.clear();dirty=false;$('vipRows').replaceChildren();} }
async function load() {
  const current=++version;busy=true;updateDisabled();
  try {
    const data=await adminRequest('/vip/list',{date:activeDate});
    if(current!==version)return;
    selected.clear();edits.clear();rows=data.rows.map(row=>({...row,fresh:false}));if(!rows.length&&!closed())rows=[blank()];dirty=false;render();
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
  rows=[];selected.clear();edits.clear();dirty=false;render();
  await load();
};
$('vipReload').onclick=async()=>{if(!dirty||await confirmAction('다시 조회','저장하지 않은 입력을 지우고 다시 조회할까요?'))await load();};
$('vipAdd').onclick=()=>{if(busy||closed())return;rows.push(blank());dirty=true;render();};
$('vipOperator').oninput=()=>{
  if(busy||closed())return;
  rows.filter(row=>row.fresh).forEach(row=>{
    if(!row.operatorName||row.operatorName===row.defaultOperator){row.operatorName=$('vipOperator').value.trim();row.defaultOperator=row.operatorName;}
  });
  refreshDirty();render();
};
$('vipSelectAll').onchange=()=>{
  if(busy||closed())return;
  selected.clear();if($('vipSelectAll').checked)rows.forEach(row=>selected.add(row.id));render();
};
$('vipDeleteSelected').onclick=()=>removeRows(rows.filter(row=>selected.has(row.id)));
$('vipRows').addEventListener('input',event=>{
  if(busy||closed())return;
  const index=Number(event.target.closest('[data-row]')?.dataset.row),field=event.target.dataset.field;
  if(rows[index]&&['company','name','menu','operatorName'].includes(field)&&(rows[index].fresh||edits.has(rows[index].id))){rows[index][field]=event.target.value;rows[index].changed=true;dirty=true;}
});
$('vipRows').addEventListener('change',event=>{
  if(event.target.dataset.select!==undefined){const row=rows[Number(event.target.dataset.select)];if(row&&!busy&&!closed()){if(event.target.checked)selected.add(row.id);else selected.delete(row.id);updateDisabled();}return;}
  if(event.target.dataset.field==='menu')event.target.dispatchEvent(new Event('input',{bubbles:true}));
});
async function removeRows(targets) {
  if(!targets.length||busy||closed())return;
  const date=activeDate;
  if(!(await confirmAction('신청 삭제',`${date} 중식 신청 ${targets.length}건을 삭제하시겠습니까? 저장하지 않은 행도 함께 삭제됩니다.`)))return;
  if(busy||date!==activeDate||closed())return;
  busy=true;updateDisabled();
  try{
    const ids=targets.filter(row=>!row.fresh).map(row=>row.id);
    if(ids.length)await adminRequest('/orders/delete',{ids});
    const removed=new Set(targets.map(row=>row.id));
    rows=rows.filter(row=>!removed.has(row.id));removed.forEach(id=>{selected.delete(id);edits.delete(id);});
    refreshDirty();render();status('vipStatus',`${targets.length}건의 신청을 삭제했습니다.`);
  }catch(error){status('vipStatus',error.message,true);}finally{busy=false;updateDisabled();}
}
$('vipRows').addEventListener('click',async event=>{
  if(busy||closed())return;
  const button=event.target.closest('button');if(!button)return;
  const index=Number(button.closest('[data-row]').dataset.row),row=rows[index];
  if(button.dataset.edit!==undefined){edits.set(row.id,{...row});render();}
  if(button.dataset.cancel!==undefined){rows[index]=edits.get(row.id);edits.delete(row.id);refreshDirty();render();}
  if(button.dataset.save!==undefined)await saveRows([row]);
  if(button.dataset.remove!==undefined)await removeRows([row]);
});
function order(row) { return {id:row.id,company:row.company.trim(),name:row.name.trim(),menu:row.menu,date:activeDate,group:'vip',meal:'lunch',location:'사무실',quantity:1,source:PROXY_SOURCE,empId:'',phone:'',operatorName:(row.operatorName||'').trim()}; }
async function saveRows(targets) {
  if(busy||closed())return;
  const date=activeDate;
  const pending=targets.filter(row=>row.fresh||row.changed).map(order);
  try{if(!pending.length)throw new Error('저장할 변경 내역이 없습니다.');pending.forEach(row=>{validateProxy(row);if(!row.operatorName)throw new Error('대리입력자 이름을 입력해주세요.');});}
  catch(error){status('vipStatus',error.message,true);return;}
  if(!(await confirmAction('대리신청 제출',`${activeDate} · 사무실 중식 ${pending.length}명의 신규·수정 내역을 저장할까요?`)))return;
  if(busy||date!==activeDate||closed())return;
  busy=true;updateDisabled();
  try{
    let data=await adminRequest('/vip/save',{rows:pending});
    if(data.duplicates?.length){
      const names=[...new Set(data.duplicates.map(row=>`${row.date} · ${row.name} (${CONFIG.groups[row.group]||row.group})`))];
      if(!(await confirmAction('중복 신청 경고',`같은 날짜·이름의 중식 신청이 있습니다. 기존 신청은 관리자 집계에서 확인할 수 있습니다.\n\n${names.join('\n')}\n\n동명이인 또는 별도 신청임을 확인한 후 계속할까요?`)))return;
      data=await adminRequest('/vip/save',{rows:pending,confirmDuplicates:true});
    }
    const saved=new Map(pending.map(row=>[row.id,row]));
    rows=rows.map(row=>saved.has(row.id)?{...saved.get(row.id),fresh:false,changed:false}:row);
    saved.forEach((row,id)=>edits.delete(id));refreshDirty();render();
    status('vipStatus',`${data.saved}건을 관리자 대리신청으로 저장했습니다.`);
  }catch(error){status('vipStatus',error.message,true);}finally{busy=false;updateDisabled();}
}
$('vipSubmit').onclick=()=>saveRows(rows);
setInterval(updateDisabled,30000);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
enter();
