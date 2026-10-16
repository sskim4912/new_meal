import { logoutAdmin, sessionToken } from './admin-session.js';
import { confirmAction } from './utils.js';
import { navigationDirty, navigationBusy, markNavigationLeaving } from './navigation-state.js';

let moving = false;
const nav = document.querySelector('.site-nav');
function updateNavigation() {
  document.querySelectorAll('[data-logout]').forEach(button => button.hidden = !sessionToken());
}
function message(text) {
  let element = document.getElementById('navigationStatus');
  if (!element) {
    element = document.createElement('p'); element.id = 'navigationStatus';
    element.className = 'navigation-status'; element.setAttribute('role', 'status');
    document.querySelector('header').after(element);
  }
  element.textContent = text;
}
async function leave(event, logout) {
  event.preventDefault();
  if (moving) return;
  if (navigationBusy()) { message('저장·처리 중입니다. 완료된 후 이동해 주세요.'); return; }
  const target = event.currentTarget;
  if (navigationDirty() && !(await confirmAction(logout ? '로그아웃 후 홈으로 이동' : '화면 이동', '저장하지 않은 내용을 지우고 이동할까요?'))) return;
  moving = true;
  if (nav) nav.setAttribute('aria-busy', 'true');
  try {
    if (logout) {
      try { await logoutAdmin(); }
      catch { try { sessionStorage.setItem('aurora.logout.notice', '이 기기의 로그인은 종료했습니다. 서버 로그아웃 확인에는 실패했습니다.'); } catch { /* Storage can be unavailable. */ } }
    }
    markNavigationLeaving();
    const url = new URL(logout ? 'index.html' : target.getAttribute('href'), document.baseURI);
    if (logout || url.pathname.endsWith('/index.html')) {
      url.searchParams.set('start', 'new'); url.searchParams.set('refresh', String(Date.now()));
    }
    window.location.assign(url.href);
  } catch (error) { moving = false; nav?.removeAttribute('aria-busy'); message(error.message); }
}
document.querySelectorAll('[data-home],[data-logout]').forEach(control => control.addEventListener('click', event => leave(event, true)));
document.querySelectorAll('.site-nav a').forEach(link => {
  const current = location.pathname.split('/').pop() || 'index.html';
  if (new URL(link.href).pathname.split('/').pop() === current) link.setAttribute('aria-current', 'page');
  link.addEventListener('click', event => leave(event, false));
});
window.addEventListener('admin-session-changed', updateNavigation);
window.addEventListener('admin-session-expired', updateNavigation);
updateNavigation();
setInterval(updateNavigation, 15000);
try {
  const notice = sessionStorage.getItem('aurora.logout.notice');
  if (notice) { message(notice); sessionStorage.removeItem('aurora.logout.notice'); }
} catch { /* Storage can be unavailable. */ }
