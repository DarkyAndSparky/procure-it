document.addEventListener('keydown', function(e) {
  // Ignore when typing in inputs/textareas
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  const ctrl = e.ctrlKey || e.metaKey;

  // Ctrl+S — сохранить заявку
  if (ctrl && e.key === 's') {
    e.preventDefault();
    const page = document.getElementById('page-new');
    if (page && page.style.display !== 'none') saveRequest();
    return;
  }

  // Ctrl+N — новая заявка
  if (ctrl && e.key === 'n') {
    e.preventDefault();
    clearForm();
    showPage('new');
    return;
  }

  // Ctrl+R — реестр
  if (ctrl && e.key === 'r') {
    e.preventDefault();
    showPage('registry');
    return;
  }

  // Ctrl+Enter — добавить строку позиции
  if (ctrl && e.key === 'Enter') {
    e.preventDefault();
    const page = document.getElementById('page-new');
    if (page && page.style.display !== 'none') addRow();
    return;
  }

  // Escape — закрыть модалку / отменить редактирование
  if (e.key === 'Escape') {
    const modal = document.getElementById('org-modal');
    if (modal && modal.style.display !== 'none') { closeOrgModal(); return; }
    if (editingId) { cancelEdit(); return; }
    return;
  }

  // ? — показать подсказки
  if (e.key === '?' && !ctrl) {
    showShortcutsHelp();
    return;
  }
});

function showShortcutsHelp() {
  const existing = document.getElementById('shortcuts-modal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'shortcuts-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.4)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <span style="font-size:15px;font-weight:600">Горячие клавиши</span>
        <button onclick="document.getElementById('shortcuts-modal').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">×</button>
      </div>
      ${[
        ['Ctrl+S', 'Сохранить заявку'],
        ['Ctrl+N', 'Новая заявка'],
        ['Ctrl+R', 'Открыть реестр'],
        ['Ctrl+Enter', 'Добавить строку позиции'],
        ['Alt+↑ / Alt+↓', 'Переместить строку позиции (фокус в поле строки)'],
        ['Escape', 'Закрыть / Отменить'],
        ['?', 'Показать эту подсказку'],
      ].map(([k,v]) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span style="color:var(--text-secondary)">${v}</span>
          <kbd style="background:var(--surface-alt);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:12px;font-family:monospace">${k}</kbd>
        </div>`).join('')}
    </div>`;
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

// ── Config / Settings ────────────────────────────────────────────────────────
const DEFAULT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>`;

let appConfig = {
  appName: 'Закупки ИТ',
  appSubtitle: 'Управление заявками',
  logoBase64: '',
  accentLight: '#2563eb',
  accentDark: '#60a5fa',
};

async function loadConfig() {
  try {
    const cfg = await api('GET', '/api/settings');
    appConfig = { ...appConfig, ...cfg };
    applyConfig();
  } catch(e) { /* use defaults */ }
}

function applyConfig() {
  // App name & subtitle in sidebar
  const h1 = document.querySelector('.sidebar-logo h1');
  const sub = document.querySelector('.sidebar-logo span');
  if (h1) h1.textContent = appConfig.appName || 'Закупки ИТ';
  if (sub) sub.textContent = appConfig.appSubtitle || 'Управление заявками';

  // Logo
  const logoEl = document.getElementById('sidebar-logo-img');
  if (logoEl) {
    if (appConfig.logoBase64) {
      logoEl.innerHTML = `<img src="${appConfig.logoBase64}" style="height:28px;width:auto;display:block" alt="logo">`;
    } else {
      logoEl.innerHTML = DEFAULT_LOGO_SVG;
    }
  }

  // Accent colors based on current theme
  const isDark = document.documentElement.classList.contains('dark') ||
    (!document.documentElement.classList.contains('light') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const accent = isDark ? (appConfig.accentDark || '#60a5fa') : (appConfig.accentLight || '#2563eb');
  document.documentElement.style.setProperty('--accent', accent);

  // Update page title
  document.title = (appConfig.appName || 'Закупки ИТ') + ' — IT Assets';

  // Кнопка «Bitrix24» видна только если интеграция настроена (задан webhook)
  const bitrixBtn = document.getElementById('btn-bitrix');
  if (bitrixBtn) bitrixBtn.style.display = appConfig.bitrixWebhook ? '' : 'none';
}

async function saveConfig() {
  const name    = document.getElementById('cfg-app-name')?.value.trim();
  const sub     = document.getElementById('cfg-app-subtitle')?.value.trim();
  const accL    = document.getElementById('cfg-accent-light')?.value;
  const accD    = document.getElementById('cfg-accent-dark')?.value;

  const payload = {
    appName:       name    || 'Закупки ИТ',
    appSubtitle:   sub     || 'Управление заявками',
    logoBase64:    appConfig.logoBase64 || '',
    accentLight:   accL    || '#2563eb',
    accentDark:    accD    || '#60a5fa',
    bitrixWebhook: document.getElementById('cfg-bitrix-webhook')?.value.trim() || '',
    statusWebhook: document.getElementById('cfg-status-webhook')?.value.trim() || '',
    networkFolder: document.getElementById('cfg-network-folder')?.value.trim() || '',
    networkUser:   document.getElementById('cfg-network-user')?.value.trim() || '',
    networkPass:   document.getElementById('cfg-network-pass')?.value || '',
    supplierName:      document.getElementById('cfg-supplier-name')?.value.trim() || '',
    supplierSignatory: document.getElementById('cfg-supplier-signatory')?.value.trim() || '',
    supplierStamp:     document.getElementById('cfg-supplier-stamp')?.checked ? '1' : '0',
  };

  await api('PUT', '/api/settings', payload);
  appConfig = { ...appConfig, ...payload };
  applyConfig();
  toast('✓ Настройки сохранены');
}

async function resetConfig() {
  if (!confirm('Сбросить все настройки к умолчаниям?')) return;
  const defaults = {
    appName: 'Закупки ИТ', appSubtitle: 'Управление заявками',
    logoBase64: '', accentLight: '#2563eb', accentDark: '#60a5fa',
  };
  await api('PUT', '/api/settings', defaults);
  appConfig = { ...defaults };
  applyConfig();
  // Reset form
  if (document.getElementById('cfg-app-name')) {
    document.getElementById('cfg-app-name').value = defaults.appName;
    document.getElementById('cfg-app-subtitle').value = defaults.appSubtitle;
    document.getElementById('cfg-accent-light').value = defaults.accentLight;
    document.getElementById('cfg-accent-light-hex').value = defaults.accentLight;
    document.getElementById('cfg-accent-dark').value = defaults.accentDark;
    document.getElementById('cfg-accent-dark-hex').value = defaults.accentDark;
  }
  updateConfigPreview();
  toast('↺ Настройки сброшены');
}

function saveThemePref(theme) {
  localStorage.setItem('zakupki_theme', theme);
  applyConfig(); // reapply accent for new theme
  // Highlight active theme button
  ['auto','light','dark'].forEach(t => {
    const btn = document.getElementById(`theme-${t}-btn`);
    if (btn) {
      btn.style.background = t === theme ? 'var(--accent)' : '';
      btn.style.borderColor = t === theme ? 'var(--accent)' : '';
      btn.style.color = t === theme ? '#fff' : '';
    }
  });
}

function previewLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    appConfig.logoBase64 = e.target.result;
    updateConfigPreview();
    // Show in sidebar immediately
    applyConfig();
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  appConfig.logoBase64 = '';
  document.getElementById('cfg-logo-file').value = '';
  updateConfigPreview();
  applyConfig();
}

function updateConfigPreview() {
  const name    = document.getElementById('cfg-app-name')?.value || 'Закупки ИТ';
  const sub     = document.getElementById('cfg-app-subtitle')?.value || 'Управление заявками';
  const accL    = document.getElementById('cfg-accent-light')?.value || '#2563eb';
  const accD    = document.getElementById('cfg-accent-dark')?.value || '#60a5fa';
  const logoHtml = appConfig.logoBase64
    ? `<img src="${appConfig.logoBase64}" style="height:24px;width:auto" alt="logo">`
    : DEFAULT_LOGO_SVG.replace('width="28" height="28"', 'width="24" height="24"');

  ['light','dark'].forEach(t => {
    const n = document.getElementById(`prev-name-${t}`);
    const s = document.getElementById(`prev-sub-${t}`);
    const l = document.getElementById(`prev-logo-${t}`);
    const b = document.getElementById(`prev-accent-${t}-bar`);
    if (n) n.textContent = name;
    if (s) s.textContent = sub;
    if (l) l.innerHTML = logoHtml;
    if (b) b.style.background = t === 'light' ? accL : accD;
  });

  // Sync hex inputs
  const hexL = document.getElementById('cfg-accent-light-hex');
  const hexD = document.getElementById('cfg-accent-dark-hex');
  if (hexL && hexL !== document.activeElement) hexL.value = accL;
  if (hexD && hexD !== document.activeElement) hexD.value = accD;
}

function syncColorFromHex(theme) {
  const hex = document.getElementById(`cfg-accent-${theme}-hex`)?.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    document.getElementById(`cfg-accent-${theme}`).value = hex;
    updateConfigPreview();
  }
}

function setAccentPreset(light, dark) {
  document.getElementById('cfg-accent-light').value = light;
  document.getElementById('cfg-accent-dark').value = dark;
  document.getElementById('cfg-accent-light-hex').value = light;
  document.getElementById('cfg-accent-dark-hex').value = dark;
  updateConfigPreview();
}

function populateConfigPage() {
  if (!document.getElementById('cfg-app-name')) return;
  document.getElementById('cfg-app-name').value = appConfig.appName || 'Закупки ИТ';
  document.getElementById('cfg-app-subtitle').value = appConfig.appSubtitle || 'Управление заявками';
  document.getElementById('cfg-accent-light').value = appConfig.accentLight || '#2563eb';
  document.getElementById('cfg-accent-light-hex').value = appConfig.accentLight || '#2563eb';
  document.getElementById('cfg-accent-dark').value = appConfig.accentDark || '#60a5fa';
  document.getElementById('cfg-accent-dark-hex').value = appConfig.accentDark || '#60a5fa';
  const wh = document.getElementById('cfg-bitrix-webhook');
  if (wh) wh.value = appConfig.bitrixWebhook || '';
  const swh = document.getElementById('cfg-status-webhook');
  if (swh) swh.value = appConfig.statusWebhook || '';
  const nf = document.getElementById('cfg-network-folder');
  if (nf) nf.value = appConfig.networkFolder || '';
  const nu = document.getElementById('cfg-network-user');
  if (nu) nu.value = appConfig.networkUser || '';
  // Don't pre-fill password field for security
  const sn = document.getElementById('cfg-supplier-name');
  if (sn) sn.value = appConfig.supplierName || '';
  const ss = document.getElementById('cfg-supplier-signatory');
  if (ss) ss.value = appConfig.supplierSignatory || '';
  const st = document.getElementById('cfg-supplier-stamp');
  if (st) st.checked = appConfig.supplierStamp === '1';

  // Highlight active theme btn
  const curTheme = localStorage.getItem('zakupki_theme') || 'auto';
  saveThemePref(curTheme);

  updateConfigPreview();
}

// ── MIT-лицензия — скачивание текста по клику ───────────────────────────────
function downloadLicense() {
  const year = new Date().getFullYear();
  const text = `MIT License

Copyright (c) ${year} DarkyAndSparky

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'LICENSE.txt';
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}
