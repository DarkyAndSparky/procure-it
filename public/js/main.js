// ── Offline detection ────────────────────────────────────────────────────────
function updateOnlineStatus() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  banner.style.display = navigator.onLine ? 'none' : 'block';
}
window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Also ping the server periodically
setInterval(async () => {
  try {
    await fetch('/api/stats', { method: 'HEAD', cache: 'no-store' });
    document.getElementById('offline-banner').style.display = 'none';
  } catch(e) {
    document.getElementById('offline-banner').style.display = 'block';
  }
}, 30000);

// ── Init ──────────────────────────────────────────────────────────────────────
applyTheme(localStorage.getItem('zakupki_theme') || 'auto');
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('zakupki_theme') || 'auto') === 'auto') applyTheme('auto');
});

// Set today date immediately and re-set after async init
(function() {
  const today = new Date();
  const pad = n => String(n).padStart(2,'0');
  const iso = today.getFullYear() + '-' + pad(today.getMonth()+1) + '-' + pad(today.getDate());
  const el = document.getElementById('f-date');
  if (el) el.value = iso;
  window._today = iso;
})();

document.getElementById('f-invoice').addEventListener('change', function() {
  const f = this.files[0];
  if (f) document.getElementById('invoice-name').textContent = '📎 ' + f.name;
});
document.getElementById('f-import-excel').addEventListener('change', function() {
  const f = this.files[0];
  if (f) importFromExcel(f);
});

// Async init
(async () => {
  const authed = await checkAuth();
  if (!authed) return; // ждём логина
  await load();
  await loadConfig();
  // Подставляем поставщика по умолчанию сразу после загрузки конфига,
  // иначе поле пустое до первого нажатия «Новая заявка» / Ctrl+N.
  const supplierField = document.getElementById('f-supplier');
  if (supplierField && !supplierField.value && appConfig.supplierName) {
    supplierField.value = appConfig.supplierName;
  }
  populateOrgSelect();
  populateTemplateSelect();
  await populateAddressList();
  addRow('', 1, 'шт', 0);
  initDragDrop();
  // Re-apply today's date in case it was reset
  const el = document.getElementById('f-date');
  if (el && !el.value && window._today) el.value = window._today;
})();

// Версия в сайдбаре — полностью независимый вызов, вне общей цепочки
// инициализации выше. Не завязан ни на checkAuth()/authed (который может
// рано вернуть false, например пока не сменён пароль по умолчанию —
// тогда весь блок над этим комментарием обрывается на `return` и до
// версии очередь просто не доходит), ни на успех load()/loadConfig() и
// остального init. Если токена ещё нет или прав не хватает — молча
// остаётся «…»; повторный вызов после логина/смены пароля — см.
// refreshVersionBadge() в auth.js/users.js, который эту же попытку
// переигрывает уже с валидным токеном.
refreshVersionBadge();
