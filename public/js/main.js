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
  populateOrgSelect();
  populateTemplateSelect();
  await populateAddressList();
  addRow('', 1, 'шт', 0);
  initDragDrop();
  // Re-apply today's date in case it was reset
  const el = document.getElementById('f-date');
  if (el && !el.value && window._today) el.value = window._today;
})();
