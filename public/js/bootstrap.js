/**
 * public/js/bootstrap.js
 *
 * Хвост Фазы 5/6: реальная точка старта приложения. Classic script — та
 * же причина, что и в остальных файлах (см. auth.js).
 *
 * КРИТИЧНО: этот файл должен подключаться ПОСЛЕДНИМ из всех <script>
 * в index.html — render() в конце требует, чтобы все остальные функции
 * (renderDashboard, renderHistory, renderSettings и т.д.) уже были
 * определены. Раз он последний по договорённости, это тоже безопасно
 * относительно classic-скриптов: имена резолвятся в момент вызова
 * (внутри document.addEventListener колбэков — уже после полной загрузки),
 * а сами вызовы _initThemeBtn()/_updateAuthUI()/render() внизу — синхронные,
 * выполняются сразу же по мере того, как парсер доходит до этого файла,
 * то есть уже после того, как все предыдущие <script>-теги отработали.
 *
 * Второй addEventListener('unhandledrejection', ...) — да, дублирует тот,
 * что уже есть в module-level инициализации ui-utils.js/index.html
 * (window.onerror-блок в самом начале <head>). Оба регистрируются и оба
 * сработают на реальный reject — это унаследованное поведение из
 * оригинала, не баг, который я вношу сейчас, просто переносится как есть.
 */

document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
  if(e.key==='Enter'&&(document.getElementById('m-pwd')||document.getElementById('m-login'))&&document.getElementById('modal-overlay').classList.contains('open'))doLogin();
});

// Global error safety net
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise rejection:', e.reason);
  const app = document.getElementById('app');
  if (app && app.innerHTML.includes('spinner')) {
    app.innerHTML = `<div class="card" style="max-width:500px">
      <div style="color:var(--danger-text);font-weight:700;margin-bottom:8px">${t('msg_load_error_title')}</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px">${String(e.reason)}</div>
      <div style="font-size:12px;color:var(--muted)">${t('msg_check_console')}</div>
      <button class="btn btn-primary" style="margin-top:12px" data-action="render">${t('btn_try_again')}</button>
    </div>`;
  }
});

_initThemeBtn();
_updateAuthUI();
applyLang(); // LOC-1: раньше вызывался только по клику на переключатель —
             // сохранённый в localStorage язык при обычной перезагрузке
             // страницы не применялся к шапке/статичным подсказкам.
render();
