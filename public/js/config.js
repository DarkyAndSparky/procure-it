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
    backupFolder:      document.getElementById('cfg-backup-folder')?.value.trim() || '',
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
  const bf = document.getElementById('cfg-backup-folder');
  if (bf) bf.value = appConfig.backupFolder || '';

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

// ── Полная страница «О системе» — динамический список зависимостей ─────────
async function loadSystemInfoPage() {
  const el = document.getElementById('about-page-content');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Загрузка…</div>';
  let info;
  try {
    info = await api('GET', '/api/system-info');
  } catch(e) {
    el.innerHTML = `<div class="card"><div style="color:var(--danger)">Не удалось загрузить: ${esc(e.message)}</div></div>`;
    return;
  }

  const fmtUptime = fmtUptimeShared;
  const fmtBytes = fmtBytesShared;

  const depRow = (d) => `
    <tr data-pkg="${esc(d.name)}">
      <td style="padding:6px 10px;font-family:monospace;font-size:12px">${esc(d.name)}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;color:${d.installed ? 'var(--success)' : 'var(--danger)'}">${esc(d.installed || '— не установлен')}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:11px;color:var(--text-muted)">${esc(d.range)}</td>
      <td class="outdated-cell" style="padding:6px 10px;font-family:monospace;font-size:12px;display:none"></td>
    </tr>`;

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><span class="card-title">ℹ️ ${esc(info.name)}</span></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;align-items:baseline">
          <span style="color:var(--text-muted)">Версия</span><span style="font-family:monospace;font-weight:600">${esc(info.version)}</span>
          <span style="color:var(--text-muted)">Описание</span><span>${esc(info.description || '—')}</span>
          <span style="color:var(--text-muted)">Лицензия</span><span><a href="#" onclick="downloadLicense();return false;" style="color:var(--accent);text-decoration:underline dotted" title="Скачать текст лицензии">${esc(info.license)} — скачать</a></span>
          <span style="color:var(--text-muted)">Автор</span><span>${esc(info.author)}</span>
          <span style="color:var(--text-muted)">Репозиторий</span><span><a href="${esc(info.repository)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(info.repository)}</a></span>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px" id="about-env-card">
      <div class="card-header"><span class="card-title">🖥️ Окружение</span><span style="font-size:10px;color:var(--text-muted);font-weight:400">обновляется каждые 10 сек</span></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;align-items:baseline">
          <span style="color:var(--text-muted)">Node.js</span><span style="font-family:monospace">${esc(info.node)}</span>
          <span style="color:var(--text-muted)">Платформа</span><span style="font-family:monospace">${esc(info.platform)} / ${esc(info.arch)}</span>
          <span style="color:var(--text-muted)">Время работы</span><span id="about-env-uptime">${fmtUptime(info.uptimeSec)}</span>
          <span style="color:var(--text-muted)">Память процесса</span><span id="about-env-memory">${info.memoryMB} МБ</span>
          <span style="color:var(--text-muted)">PID</span><span style="font-family:monospace">${info.pid}</span>
          <span style="color:var(--text-muted)">Размер БД</span><span id="about-env-dbsize">${fmtBytes(info.dbSizeBytes)}</span>
          <span style="color:var(--text-muted)">Последний бэкап</span><span id="about-env-lastbackup">${fmtLastBackup(info.lastBackupAt)}</span>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><span class="card-title">🧰 Технологии</span></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;font-size:13px">
          ${buildTechStackHtml(info)}
        </div>
      </div>
    </div>

    ${(info.recentChanges && info.recentChanges.length) ? `
    <details class="card" style="margin-bottom:16px;padding:0">
      <summary style="cursor:pointer;padding:14px 16px;font-weight:600;list-style:none;display:flex;align-items:center;gap:8px">
        <span style="font-size:15px">📋</span> Последние изменения
        <span style="font-size:11px;color:var(--text-muted);font-weight:400;margin-left:auto">полного CHANGELOG нет — короткая курируемая сводка</span>
      </summary>
      <div style="padding:0 16px 14px">
        ${info.recentChanges.map(rel => `
          <div style="margin-top:8px">
            <div style="font-family:monospace;font-weight:600;font-size:12px;color:var(--accent)">${esc(rel.version)} <span style="color:var(--text-muted);font-weight:400">— ${esc(rel.date)}</span></div>
            <ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--text-secondary);line-height:1.7">
              ${rel.items.map(i => `<li>${esc(i)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    </details>` : ''}

    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><span class="card-title">📊 Данные</span></div>
      <div class="card-body">
        <div style="display:flex;gap:24px;flex-wrap:wrap">
          <div><div style="font-size:22px;font-weight:700">${info.counts?.requests ?? '—'}</div><div style="font-size:11px;color:var(--text-muted)">заявок</div></div>
          <div><div style="font-size:22px;font-weight:700">${info.counts?.orgs ?? '—'}</div><div style="font-size:11px;color:var(--text-muted)">организаций</div></div>
          <div><div style="font-size:22px;font-weight:700">${info.counts?.users ?? '—'}</div><div style="font-size:11px;color:var(--text-muted)">пользователей</div></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title">📦 Зависимости (${info.dependencies.length})</span>
        <button class="btn btn-sm" id="btn-check-outdated" onclick="checkOutdatedPackages()" style="margin-left:auto">🔄 Проверить обновления</button>
      </div>
      <div id="outdated-summary" style="padding:0 16px;font-size:11px;color:var(--text-muted)"></div>
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="padding:6px 10px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Пакет</th>
            <th style="padding:6px 10px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Установлено</th>
            <th style="padding:6px 10px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Диапазон в package.json</th>
            <th id="outdated-col-header" style="padding:6px 10px;text-align:left;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border);display:none">Доступное обновление</th>
          </tr></thead>
          <tbody id="deps-tbody">${info.dependencies.map(depRow).join('')}</tbody>
        </table>
      </div>
    </div>

    ${info.devDependencies.length ? `
    <div class="card">
      <div class="card-header"><span class="card-title">🛠️ Dev-зависимости (${info.devDependencies.length})</span></div>
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse">
          <tbody>${info.devDependencies.map(depRow).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}
  `;
  startAboutEnvPolling();
}

// ── Технологии — курируемое описание стека поверх сырого списка зависимостей.
// Показываем только те пункты, чей пакет реально присутствует в
// dependencies (плюс несколько фактов о самой платформе, которые не npm-
// пакеты — Vanilla JS на фронтенде, HTTPS, SQLite-движок), чтобы список не
// был статичным враньём, если стек поменяется.
function buildTechStackHtml(info) {
  const installedNames = new Set([...(info.dependencies||[]), ...(info.devDependencies||[])].map(d => d.name));
  const has = (name) => installedNames.has(name);

  const items = [
    { cond: true,                    icon: '🟢', title: 'Node.js + Express', desc: 'Backend-сервер и REST API' },
    { cond: has('sql.js'),           icon: '🗄️', title: 'SQLite (sql.js)', desc: 'Файловая БД, без отдельного сервера СУБД' },
    { cond: has('docx'),             icon: '📄', title: 'docx', desc: 'Генерация .docx спецификаций на сервере' },
    { cond: true,                    icon: '📊', title: 'SheetJS (xlsx)', desc: 'Генерация Excel-расчётов и импорт прайсов' },
    { cond: has('helmet'),           icon: '🛡️', title: 'Helmet', desc: 'HTTP security headers' },
    { cond: has('express-rate-limit'), icon: '⏱️', title: 'express-rate-limit', desc: 'Rate limiting (защита от перебора/спама запросов)' },
    { cond: has('compression'),      icon: '🗜️', title: 'compression', desc: 'Gzip-сжатие ответов' },
    { cond: has('cors'),             icon: '🌐', title: 'CORS', desc: 'Ограничение доступа к API локальной сетью' },
    { cond: has('morgan'),           icon: '📝', title: 'morgan', desc: 'Логирование HTTP-запросов' },
    { cond: has('selfsigned'),       icon: '🔒', title: 'selfsigned / openssl', desc: 'Автогенерация self-signed TLS-сертификата (HTTPS)' },
    { cond: has('playwright'),       icon: '🎭', title: 'Playwright', desc: 'Скриншоты/рендер (используется точечно)' },
    { cond: true,                    icon: '🍦', title: 'Vanilla JS + HTML/CSS', desc: 'Фронтенд без фреймворков и сборщиков' },
    { cond: true,                    icon: '📁', title: 'WebDAV / SMB', desc: 'Раскладка файлов в сетевую папку (Nextcloud, шары Windows)' },
    { cond: true,                    icon: '🔗', title: 'Bitrix24 REST (webhook)', desc: 'Интеграция создания сделок' },
  ];

  return items.filter(i => i.cond).map(i => `
    <div style="display:flex;gap:8px;align-items:flex-start">
      <span style="font-size:16px;line-height:1.3">${i.icon}</span>
      <div>
        <div style="font-weight:600">${esc(i.title)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${esc(i.desc)}</div>
      </div>
    </div>`).join('');
}

// ── Автообновление карточки «Окружение» — время работы и память процесса
// живые и меняются постоянно; без обновления они выглядели бы застывшими
// сразу после открытия страницы.
let aboutEnvPollTimer = null;
function startAboutEnvPolling() {
  if (aboutEnvPollTimer) clearInterval(aboutEnvPollTimer);
  aboutEnvPollTimer = setInterval(async () => {
    const card = document.getElementById('about-env-card');
    if (!card) { clearInterval(aboutEnvPollTimer); aboutEnvPollTimer = null; return; } // ушли со страницы
    try {
      const info = await api('GET', '/api/system-info');
      const up = document.getElementById('about-env-uptime');
      const mem = document.getElementById('about-env-memory');
      const dbs = document.getElementById('about-env-dbsize');
      const lb = document.getElementById('about-env-lastbackup');
      if (up)  up.textContent  = fmtUptimeShared(info.uptimeSec);
      if (mem) mem.textContent = info.memoryMB + ' МБ';
      if (dbs) dbs.textContent = fmtBytesShared(info.dbSizeBytes);
      if (lb)  lb.textContent  = fmtLastBackup(info.lastBackupAt);
    } catch(e) { /* тихо — просто пропускаем один тик обновления */ }
  }, 10000);
}
function fmtUptimeShared(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} д`);
  if (h) parts.push(`${h} ч`);
  parts.push(`${m} мин`);
  return parts.join(' ');
}
function fmtBytesShared(b) {
  return b > 1024*1024 ? `${(b/1024/1024).toFixed(1)} МБ` : `${(b/1024).toFixed(0)} КБ`;
}
function fmtLastBackup(iso) {
  if (!iso) return 'ещё не было';
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  const rel = diffMin < 1 ? 'только что'
    : diffMin < 60 ? `${diffMin} мин назад`
    : diffMin < 1440 ? `${Math.floor(diffMin/60)} ч назад`
    : `${Math.floor(diffMin/1440)} дн назад`;
  const abs = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${abs} (${rel})`;
}

// ── Проверка устаревших пакетов — по клику (не автоматически: требует
// интернет и обращение к npm registry, что может быть медленным/недоступным
// в изолированной сети развёртывания).
async function checkOutdatedPackages() {
  const btn = document.getElementById('btn-check-outdated');
  const summary = document.getElementById('outdated-summary');
  const colHeader = document.getElementById('outdated-col-header');
  if (!btn) return;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Проверка…';
  summary.textContent = '';

  try {
    const result = await api('GET', '/api/system-info/outdated');
    colHeader.style.display = '';
    document.querySelectorAll('.outdated-cell').forEach(td => td.style.display = '');

    const outdatedMap = {};
    (result.outdated || []).forEach(o => { outdatedMap[o.name] = o; });

    document.querySelectorAll('#deps-tbody tr[data-pkg]').forEach(tr => {
      const pkg = tr.getAttribute('data-pkg');
      const cell = tr.querySelector('.outdated-cell');
      const o = outdatedMap[pkg];
      if (!o) {
        cell.innerHTML = `<span style="color:var(--success)">актуально</span>`;
        return;
      }
      // Находка (замечено пользователем): npm outdated даёт и wanted
      // (максимум в рамках нашего же диапазона версий в package.json —
      // например ^4.18.2), и latest (абсолютный последний релиз на npm,
      // ВКЛЮЧАЯ мажоры, от которых мы сознательно отказались — Express 5
      // при том, что мы намеренно на 4.x, см. ROADMAP.md). Раньше здесь
      // показывался только latest и всегда жёлтым — то есть пакет,
      // полностью актуальный В РАМКАХ нашего диапазона (current===wanted),
      // выглядел как «пора обновить» точно так же, как пакет, реально
      // отстающий от собственного диапазона (current!==wanted). Разделяем:
      // реальная просрочка в рамках диапазона — предупреждение с wanted;
      // просто более новый мажор вне диапазона — нейтральная информация,
      // не тревога.
      if (o.current !== o.wanted) {
        cell.innerHTML = `<span style="color:var(--warning)">${esc(o.wanted)}</span>`;
        cell.title = `Доступно обновление в рамках вашего диапазона версий (package.json). Последняя версия на npm вообще: ${o.latest}`;
      } else {
        cell.innerHTML = `<span style="color:var(--success)">актуально</span>` +
          (o.latest !== o.wanted ? ` <span style="color:var(--text-muted)" title="Новая мажорная версия — требует ручного решения об апгрейде, package.json её сознательно не запрашивает">(есть ${esc(o.latest)})</span>` : '');
      }
    });

    // Тот же принцип для сводки — считаем «устаревшими» пакеты, реально
    // отстающие от собственного диапазона (current!==wanted), а не любой
    // пакет, для которого на npm вышла более новая мажорная версия.
    const actionable = (result.outdated || []).filter(o => o.current !== o.wanted);
    const n = actionable.length;
    summary.textContent = n > 0
      ? `⚠️ Устаревших пакетов (в рамках вашего диапазона версий): ${n} — проверено ${new Date(result.checkedAt).toLocaleString('ru-RU')}`
      : `✅ Все пакеты актуальны в рамках своих диапазонов версий — проверено ${new Date(result.checkedAt).toLocaleString('ru-RU')}`;
    summary.style.color = n > 0 ? 'var(--warning)' : 'var(--success)';
  } catch(e) {
    summary.textContent = '❌ ' + e.message;
    summary.style.color = 'var(--danger)';
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}
