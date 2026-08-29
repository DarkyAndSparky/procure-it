/**
 * public/js/ui-utils.js
 *
 * Фаза 5, шаг 2: первый кусок JS, вынесенный из public/index.html.
 * Намеренно НЕ ES-module (type="module") — весь остальной код в index.html
 * всё ещё classic-скрипты, и один из них синхронно вызывает render() в самом
 * конце парсинга страницы (до DOMContentLoaded). Модули выполняются deferred,
 * то есть позже — если сделать этот файл модулем, esc()/toast() будут undefined
 * в момент первого рендера. Полный переход на ES-модули — отдельный,
 * скоординированный шаг (когда ВСЕ скрипты станут модулями одновременно).
 *
 * Пока что это просто вынесенный файл с обычными глобальными функциями —
 * ровно то же поведение, что было инлайново в index.html, один в один.
 *
 * Подключается как <script src="/js/ui-utils.js"> ПЕРЕД остальными
 * скриптами index.html — функции должны существовать глобально до того,
 * как их вызовут.
 */

// ─── Форматирование ────────────────────────────────────────────────────────────
function sc(s){return s==='используется'?'s-used':s==='резерв'?'s-reserve':'s-off';}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fd(d){if(!d)return'—';try{return d.slice(0,10).split('-').reverse().join('.');}catch{return d;}}

// ─── Буфер обмена ───────────────────────────────────────────────────────────────
function copyToClipboard(text, successMsg) {
  successMsg = successMsg ?? t('msg_copied');
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(() => toast(successMsg, 'success'))
      .catch(() => _copyFallback(text, successMsg));
  } else {
    _copyFallback(text, successMsg);
  }
}
function _copyFallback(text, successMsg) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(el);
  el.select();
  try { document.execCommand('copy'); toast(successMsg, 'success'); }
  catch(e) { toast(t('msg_copy_failed'), 'error'); }
  document.body.removeChild(el);
}

// ─── Фаза 6: замена самомодифицирующих inline-обработчиков ──────────────────────
// oninput="this.value=this.value.toUpperCase()" (встречается 5 раз по проекту)
function forceUppercase() { this.value = this.value.toUpperCase(); }

// Заглушка для случаев onclick="event.stopPropagation()" БЕЗ вызова функции —
// обычно на обёртке-контейнере (например <td>), чтобы клик по пустому месту
// внутри неё не всплывал до onclick родительской строки таблицы. При
// делегировании через closest([data-action]) этого не нужно объяснять через
// stopPropagation — достаточно повесить data-action="_noop" на сам контейнер:
// closest() найдёт ближайшее совпадение и не пойдёт выше, ровно тот же эффект.
function _noop() {}

// Было onmousedown="event.preventDefault()" — типично для автокомплитов,
// чтобы клик по варианту не отбирал фокус у поля ввода раньше клика.
function _preventDefault(e) { e.preventDefault(); }

// ─── Модалки и тосты ─────────────────────────────────────────────────────────────
function showModal(html){document.getElementById('modal-box').innerHTML=html;document.getElementById('modal-overlay').classList.add('open');}
function closeModal(e){
  if (window._forcePinChangeMode) return; // модалка смены дефолтного PIN не закрывается стороной
  if(!e||e.target===document.getElementById('modal-overlay'))document.getElementById('modal-overlay').classList.remove('open');
}
// SEC-8: /api/export/csv теперь требует авторизацию (requireAuth), а этот
// проект аутентифицирует запросы через заголовки (x-user-id/x-edit-password),
// не через cookie — обычная ссылка <a href> их передать не может. Поэтому
// скачивание идёт через fetch() с нужными заголовками + blob.
async function downloadWithAuth(url, filename) {
  try {
    const r = await fetch(url, { headers: ah() });
    if (!r.ok) {
      let msg = t('msg_download_error');
      try { msg = (await r.json()).error || msg; } catch(e) {}
      return toast(msg, 'error');
    }
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch(e) { toast(t('msg_download_connection_error'), 'error'); }
}

function toast(msg,type=''){
  const el=document.createElement('div');el.className='toast-msg '+type;el.textContent=msg;
  document.getElementById('toast').appendChild(el);setTimeout(()=>el.remove(),3000);}
