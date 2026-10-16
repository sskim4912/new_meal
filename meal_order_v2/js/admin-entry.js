import { loginAdmin, verifyAdmin } from './admin-session.js';
let pending;
export async function requireAdmin() {
  if (await verifyAdmin()) return true;
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<h2>관리자 접근</h2><form><label>비밀번호<input type="password" required autocomplete="current-password" /></label><p class="status error" aria-live="polite"></p><div class="actions"><button type="button">취소</button><button class="primary">확인</button></div></form>';
    document.body.append(dialog);
    let accepted = false, busy = false;
    dialog.querySelector('button[type=button]').onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); pending = null; resolve(accepted); }, { once: true });
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      busy = true;
      dialog.querySelectorAll('button').forEach(button => button.disabled = true);
      try { await loginAdmin(dialog.querySelector('input').value); accepted = true; dialog.close(); }
      catch (error) { dialog.querySelector('p').textContent = error.message; }
      finally { busy = false; dialog.querySelectorAll('button').forEach(button => button.disabled = false); }
    };
    dialog.showModal();
  });
  return pending;
}
