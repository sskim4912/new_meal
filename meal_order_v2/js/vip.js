import { CONFIG } from './config.js';
import { $, escapeHTML as esc, kstToday, addDays, status, confirmAction } from './utils.js';
import { requireAdmin } from './admin-entry.js';
import { adminRequest, logoutAdmin } from './admin-session.js';
import { validateProxy, proxyDeadline, PROXY_SOURCE } from './vip-rules.js';

let activeDate = kstToday();
if (Date.now() >= proxyDeadline(activeDate)) activeDate = addDays(activeDate, 1);
let drafts = [blank()], rows = [], loadedDate = null, busy = false, loading = false, version = 0;
const selected = new Set(), edits = new Map();
$('vipDate').value = activeDate;
$('vipDate').min = kstToday();
$('vipQueryDate').value = activeDate;
const closed = date => !date || Date.now() >= proxyDeadline(date);
const draftsDirty = () => drafts.some(row => row.company.trim() || row.name.trim());
const dirty = () => draftsDirty() || edits.size > 0;
function blank() { return { id: `proxy:${crypto.randomUUID()}`, company: '', name: '', menu: CONFIG.menuRules.lunch.only[0] }; }
function menuOptions(value) { return CONFIG.menuRules.lunch.only.map(menu => `<option ${menu === value ? 'selected' : ''}>${esc(menu)}</option>`).join(''); }
function input(field, value, label, max) { return `<input data-field="${field}" aria-label="${esc(label)}" maxlength="${max}" value="${esc(value || '')}">`; }
function cell(label, value, cls = '') { return `<td data-label="${label}" class="${cls}">${value}</td>`; }
function header(labels) { return `<thead><tr>${labels.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>`; }
function renderDrafts() {
  $('vipDraftRows').innerHTML = `<table class="vip-table vip-draft-table"><caption class="sr-only">신규 대리신청 입력</caption>${header(['순번','소속','이름','중식메뉴','수량','작업'])}<tbody>${drafts.map((row, index) => `<tr data-draft="${index}">
    ${cell('순번', String(index + 1), 'vip-number')}
    ${cell('소속', input('company', row.company, `${index + 1}번 소속`, 80))}
    ${cell('이름', input('name', row.name, `${index + 1}번 이름`, 40))}
    ${cell('중식메뉴', `<select data-field="menu" aria-label="${index + 1}번 중식메뉴">${menuOptions(row.menu)}</select>`)}
    ${cell('수량', '<span class="vip-quantity">1</span>')}
    ${cell('작업', `<button data-draft-remove="${index}" class="vip-quiet">행 제거</button>`, 'vip-work')}
  </tr>`).join('')}</tbody></table>`;
  updateDisabled();
}
function renderRows() {
  $('vipRows').innerHTML = rows.length ? `<table class="vip-table vip-saved-table"><caption class="sr-only">저장된 대리신청 내역</caption>${header(['순번','소속','이름','중식메뉴','수량','대리입력자 이름','선택','작업'])}<tbody>${rows.map((saved, index) => {
    const row = edits.get(saved.id) || saved, editing = edits.has(row.id);
    return `<tr data-row="${index}" class="${editing ? 'is-editing' : ''}">
      ${cell('순번', String(index + 1), 'vip-number')}
      ${cell('소속', editing ? input('company', row.company, `${index + 1}번 소속`, 80) : esc(row.company))}
      ${cell('이름', editing ? input('name', row.name, `${index + 1}번 이름`, 40) : `<strong>${esc(row.name)}</strong>`)}
      ${cell('중식메뉴', editing ? `<select data-field="menu" aria-label="${index + 1}번 중식메뉴">${menuOptions(row.menu)}</select>` : esc(row.menu))}
      ${cell('수량', '<span class="vip-quantity">1</span>')}
      ${cell('대리입력자 이름', editing ? input('operatorName', row.operatorName, `${index + 1}번 대리입력자 이름`, 10) : esc(row.operatorName || '미기록'))}
      ${cell('선택', `<label class="vip-row-choice"><input type="checkbox" data-select="${index}" aria-label="${index + 1}번 신청 선택" ${selected.has(row.id) ? 'checked' : ''}><span class="sr-only">${index + 1}번 신청 선택</span></label>`, 'vip-select-cell')}
      ${cell('작업', `<div class="vip-row-actions">${editing ? `<button data-save="${index}" class="primary">저장</button><button data-cancel="${index}">수정 취소</button>` : `<button data-edit="${index}">수정</button><button data-remove="${index}" class="danger">삭제</button>`}</div>`, 'vip-work')}
    </tr>`;
  }).join('')}</tbody></table>` : '';
  $('vipEmpty').hidden = rows.length > 0 || loading || !loadedDate;
  $('vipSummary').textContent = loading ? '신청 내역 조회 중' : loadedDate ? `${loadedDate} 신청 내역 · 총 ${rows.length}명` : '';
  updateDisabled();
}
function updateDisabled() {
  const newLocked = busy || closed(activeDate), listLocked = busy || closed(loadedDate);
  $('vipDraftRows').querySelectorAll('input,select,button').forEach(control => control.disabled = newLocked);
  $('vipRows').querySelectorAll('input,select,button').forEach(control => control.disabled = listLocked);
  $('vipDate').disabled = busy;
  $('vipOperator').disabled = newLocked;
  $('vipAdd').disabled = newLocked;
  $('vipSubmit').disabled = newLocked || !drafts.length;
  $('vipQueryDate').disabled = busy;
  $('vipReload').disabled = busy;
  $('vipLogout').disabled = busy;
  $('vipSelectAll').disabled = listLocked || !rows.length;
  $('vipSelectAll').checked = rows.length > 0 && selected.size === rows.length;
  $('vipSelectAll').indeterminate = selected.size > 0 && selected.size < rows.length;
  $('vipSelectedCount').textContent = `선택 ${selected.size}건`;
  $('vipDeleteSelected').disabled = listLocked || !selected.size;
  $('vipNewDeadline').hidden = !closed(activeDate);
  $('vipListDeadline').hidden = !loadedDate || !closed(loadedDate);
}
async function load(date) {
  const current = ++version;
  loading = true; busy = true; loadedDate = null; rows = []; selected.clear(); edits.clear();
  status('vipQueryStatus', '신청 내역을 조회하고 있습니다.'); renderRows();
  try {
    const data = await adminRequest('/vip/list', { date });
    if (current !== version) return false;
    rows = data.rows; loadedDate = date;
    status('vipQueryStatus', '');
    return true;
  } catch (error) {
    status('vipQueryStatus', `신청 내역을 불러오지 못했습니다. ${error.message}`, true);
    return false;
  } finally { loading = false; busy = false; renderRows(); }
}
function lock(preserve = false) {
  version++;
  $('vipContent').hidden = true; $('vipLogout').hidden = true; $('vipLogin').hidden = false;
  if (!preserve) {
    drafts = [blank()]; rows = []; loadedDate = null; selected.clear(); edits.clear();
    $('vipOperator').value = ''; status('vipStatus', ''); status('vipQueryStatus', '');
    renderDrafts(); renderRows();
  }
}
async function enter() {
  if (!(await requireAdmin())) return;
  $('vipContent').hidden = false; $('vipLogout').hidden = false; $('vipLogin').hidden = true;
  renderDrafts(); renderRows();
  if (!edits.size) await load($('vipQueryDate').value);
}
$('vipLogin').onclick = enter;
$('vipLogout').onclick = async () => {
  if (dirty() && !(await confirmAction('로그아웃', '저장하지 않은 입력을 지우고 로그아웃할까요?'))) return;
  try { await logoutAdmin(); } finally { lock(); }
};
window.addEventListener('admin-session-expired', () => {
  lock(true); status('vipStatus', '관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.', true);
});
$('vipDate').onchange = async () => {
  if (busy) return;
  if (draftsDirty() && !(await confirmAction('식사 날짜 변경', '작성 중인 신규 신청을 지우고 날짜를 변경할까요?'))) { $('vipDate').value = activeDate; return; }
  const date = $('vipDate').value;
  activeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : kstToday();
  $('vipDate').value = activeDate;
  drafts = [blank()]; status('vipStatus', ''); renderDrafts();
};
async function query() {
  if (busy) return;
  const date = $('vipQueryDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { status('vipQueryStatus', '조회할 식사 날짜를 선택해 주세요.', true); return; }
  if (edits.size && !(await confirmAction('신청 내역 조회', '수정 중인 내용을 취소하고 다시 조회할까요?'))) { $('vipQueryDate').value = loadedDate; return; }
  await load(date);
}
$('vipReload').onclick = query;
$('vipQueryDate').onchange = query;
$('vipAdd').onclick = () => { if (!busy && !closed(activeDate)) { drafts.push(blank()); renderDrafts(); } };
$('vipDraftRows').addEventListener('input', event => {
  if (busy || closed(activeDate)) return;
  const index = Number(event.target.closest('[data-draft]')?.dataset.draft), field = event.target.dataset.field;
  if (drafts[index] && ['company','name','menu'].includes(field)) drafts[index][field] = event.target.value;
});
$('vipDraftRows').addEventListener('change', event => { if (event.target.dataset.field === 'menu') event.target.dispatchEvent(new Event('input', { bubbles: true })); });
$('vipDraftRows').addEventListener('click', event => {
  const button = event.target.closest('[data-draft-remove]');
  if (!button || busy || closed(activeDate)) return;
  drafts.splice(Number(button.dataset.draftRemove), 1); renderDrafts();
});
$('vipSelectAll').onchange = () => {
  if (busy || closed(loadedDate)) return;
  selected.clear(); if ($('vipSelectAll').checked) rows.forEach(row => selected.add(row.id)); renderRows();
};
$('vipRows').addEventListener('change', event => {
  if (busy || closed(loadedDate)) return;
  if (event.target.dataset.select !== undefined) {
    const row = rows[Number(event.target.dataset.select)];
    if (event.target.checked) selected.add(row.id); else selected.delete(row.id);
    updateDisabled();
  } else if (event.target.dataset.field === 'menu') event.target.dispatchEvent(new Event('input', { bubbles: true }));
});
$('vipRows').addEventListener('input', event => {
  if (busy || closed(loadedDate)) return;
  const saved = rows[Number(event.target.closest('[data-row]')?.dataset.row)], field = event.target.dataset.field;
  if (saved && edits.has(saved.id) && ['company','name','menu','operatorName'].includes(field)) edits.get(saved.id)[field] = event.target.value;
});
function order(row, date, operatorName) {
  return { id: row.id, company: row.company.trim(), name: row.name.trim(), menu: row.menu, date, group: 'vip', meal: 'lunch', location: '사무실', quantity: 1, source: PROXY_SOURCE, empId: '', phone: '', operatorName: (operatorName || '').trim() };
}
async function save(targets, date, isNew) {
  const statusId = isNew ? 'vipStatus' : 'vipQueryStatus';
  if (busy || closed(date)) return;
  let pending;
  try {
    if (!targets.length) throw new Error('저장할 신청자를 입력해 주세요.');
    pending = targets.map(row => order(row, date, isNew ? $('vipOperator').value : row.operatorName));
    pending.forEach(row => { validateProxy(row); if (!row.operatorName) throw new Error('대리입력자 이름을 입력해 주세요.'); });
    if (pending.length > 100) throw new Error('한 번에 최대 100명까지 신청할 수 있습니다.');
  } catch (error) { status(statusId, error.message, true); return; }
  if (!(await confirmAction(isNew ? '신규 대리신청 저장' : '대리신청 수정', `${date} · 중식 ${pending.length}명의 신청을 저장할까요?${isNew && edits.size ? '\n아래 목록에서 수정 중인 내용은 취소됩니다.' : ''}`))) return;
  if (busy || closed(date)) { updateDisabled(); return; }
  busy = true; updateDisabled();
  try {
    let data = await adminRequest('/vip/save', { rows: pending });
    if (data.duplicates?.length) {
      const names = [...new Set(data.duplicates.map(row => `${row.date} · ${row.name} (${CONFIG.groups[row.group] || row.group})`))];
      if (!(await confirmAction('중복 신청 경고', `같은 날짜·이름의 중식 신청이 있습니다.\n\n${names.join('\n')}\n\n동명이인 또는 별도 신청임을 확인한 후 계속할까요?`))) return;
      if (closed(date)) throw new Error('식사일 오전 10:00 마감이 지났습니다.');
      data = await adminRequest('/vip/save', { rows: pending, confirmDuplicates: true });
    }
    if (isNew) {
      drafts = [blank()]; renderDrafts(); $('vipQueryDate').value = date;
      const refreshed = await load(date);
      status(statusId, `${data.saved}건의 신청을 저장했습니다.${refreshed ? ' 아래 신청 내역에서 확인하세요.' : ' 아래 조회 버튼으로 저장 내역을 다시 확인해 주세요.'}`);
    } else {
      const saved = new Map(pending.map(row => [row.id, row]));
      rows = rows.map(row => saved.get(row.id) || row); saved.forEach((row, id) => edits.delete(id)); renderRows();
      status(statusId, `${data.saved}건의 신청을 수정했습니다.`);
    }
  } catch (error) { status(statusId, error.message, true); }
  finally { busy = false; updateDisabled(); }
}
async function remove(targets) {
  if (!targets.length || busy || closed(loadedDate)) return;
  const date = loadedDate;
  if (!(await confirmAction('신청 삭제', `${date} 중식 신청 ${targets.length}건을 삭제하시겠습니까?`))) return;
  if (busy || loadedDate !== date || closed(date)) return;
  busy = true; updateDisabled();
  try {
    await adminRequest('/orders/delete', { ids: targets.map(row => row.id) });
    const ids = new Set(targets.map(row => row.id)); rows = rows.filter(row => !ids.has(row.id));
    ids.forEach(id => { selected.delete(id); edits.delete(id); }); renderRows();
    status('vipQueryStatus', `${targets.length}건의 신청을 삭제했습니다.`);
  } catch (error) { status('vipQueryStatus', error.message, true); }
  finally { busy = false; updateDisabled(); }
}
$('vipRows').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || busy || closed(loadedDate)) return;
  const row = rows[Number(button.closest('[data-row]').dataset.row)];
  if (button.dataset.edit !== undefined) { edits.set(row.id, { ...row }); renderRows(); }
  if (button.dataset.cancel !== undefined) { edits.delete(row.id); renderRows(); }
  if (button.dataset.save !== undefined) await save([edits.get(row.id)], loadedDate, false);
  if (button.dataset.remove !== undefined) await remove([row]);
});
$('vipSubmit').onclick = () => save(drafts, activeDate, true);
$('vipDeleteSelected').onclick = () => remove(rows.filter(row => selected.has(row.id)));
setInterval(updateDisabled, 1000);
window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
enter();
