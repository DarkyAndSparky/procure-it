/**
 * public/js/views/settings-general.js
 *
 * Фаза 5, шаг 25: вкладка настроек "Общие" — название/логотип компании,
 * цветовая тема (light/dark accent), диагностика БД, миграция, бэкап-
 * кнопки (сами обработчики бэкапа в index.html), вынесенная из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 *
 * _updateLogoEl() вызывается из router.js (render()) как внешний глобал —
 * резолвится в момент вызова, порядок подключения не критичен (все
 * синхронные скрипты успевают отработать до первого реального render()).
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js). Карточка
 * «О системе» и loadSystemInfo() (INFRA-5) сюда же попали — при их
 * добавлении файл ещё не был локализован, поэтому переведены заодно.
 */

function _renderGeneralPanel(isAdmin, db_company_name='', db_logo_svg='', db_version='') {
  return `
        <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">${t('company_name_logo_title')}</div>
      <div class="form-row"><label>${t('field_company_name')}</label>
        <input id="company-name-inp" placeholder="IT ASSETS"
          value="${db_company_name||''}" ${!isAdmin?'disabled':''}/>
      </div>
      ${isAdmin ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-action="saveCompanyName">${t('btn_save_name')}</button>
        <button class="btn btn-ghost btn-sm" data-action="resetCompanyName">${t('btn_reset')}</button>
      </div>` : ''}
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">${t('lbl_logo')}</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">
          ${t('msg_logo_hint')}
        </div>
        <div id="logo-preview" style="margin-bottom:10px;min-height:50px;background:var(--surface);border:1px dashed var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;padding:6px 12px">
          <span style="font-size:12px;color:var(--muted)">${t('msg_logo_not_set')}</span>
        </div>
        ${isAdmin ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="file" id="logo-svg-file" accept=".svg,.png,.jpg,.jpeg,.webp,image/*" style="font-size:12px;flex:1;min-width:0"/>
          <button class="btn btn-primary btn-sm" data-action="saveLogoSvg">${t('btn_upload')}</button>
          <button class="btn btn-ghost btn-sm" data-action="clearLogoSvg">${t('btn_remove')}</button>
        </div>` : ''}
      </div>
    </div>

    ${isAdmin ? `
    <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">${t('accent_color_title')}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">
        ${t('msg_accent_color_hint')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- Светлая тема -->
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:8px;opacity:.7">${t('lbl_light_theme')}</div>
          <div id="preview-light" style="margin-bottom:10px;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.15)"></div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="color" id="st-accent-light" value="#e94560" style="width:40px;height:32px;padding:2px;border-radius:6px;border:1px solid var(--border);cursor:pointer"
              data-oninput-action="_livePreview"/>
            <label style="font-size:12px;color:var(--muted)">${t('lbl_accent')}</label>
          </div>
        </div>
        <!-- Тёмная тема -->
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:8px;opacity:.7">${t('lbl_dark_theme')}</div>
          <div id="preview-dark" style="margin-bottom:10px;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="color" id="st-accent-dark" value="#e94560" style="width:40px;height:32px;padding:2px;border-radius:6px;border:1px solid var(--border);cursor:pointer"
              data-oninput-action="_livePreview"/>
            <label style="font-size:12px;color:var(--muted)">${t('lbl_accent')}</label>
          </div>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-action="saveStyleSettings">${t('btn_save_style')}</button>
        <button class="btn btn-ghost btn-sm" data-action="_resetStyles">${t('btn_reset_icon')}</button>
        <span style="font-size:11px;color:var(--muted)">${t('msg_applies_immediately')}</span>
      </div>
    </div>` : ''}



    <div class="card" style="max-width:520px;margin-bottom:14px">

    <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">${t('backup_title')}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">
        ${t('msg_autobackup_hint')}
      </div>
      ${isAdmin ? `
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-primary btn-sm" data-action="createBackup">${t('btn_create_backup')}</button>
        <button class="btn btn-ghost btn-sm" data-action="loadBackupList">${t('btn_refresh_list')}</button>
      </div>
      <div id="backup-list" style="font-size:12px">
        <div style="color:var(--muted)">${t('msg_click_refresh_list')}</div>
      </div>` : `<div style="color:var(--muted);font-size:13px">${t('msg_admin_only')}</div>`}
    </div>

      <div class="section-title">${t('csv_import_title')}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;line-height:1.6">
        ${t('msg_csv_import_hint')}
      </div>
      ${isAdmin ? `
      <input type="file" id="csv-file" accept=".csv" style="margin-bottom:8px;font-size:13px;width:100%"
        data-onchange-action="detectImportType"/>
      <div id="import-type-hint" style="font-size:12px;color:var(--muted);margin-bottom:8px;display:none"></div>
      <div id="import-csv-options" style="display:none;margin-bottom:10px;font-size:12px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px">
          <input type="checkbox" id="import-create-orgs" checked/> ${t('lbl_create_new_orgs')}
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="import-create-employees" checked/> ${t('lbl_create_new_employees')}
        </label>
      </div>
      <button class="btn btn-success" id="import-btn" data-action="importAuto" disabled>${t('btn_import')}</button>
      <div id="import-progress" style="display:none;margin-top:10px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px" id="import-progress-label">${t('msg_preparing')}</div>
        <div style="background:var(--border);border-radius:6px;height:8px;overflow:hidden">
          <div id="import-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#3b82f6,#6366f1);border-radius:6px;transition:width 0.2s ease"></div>
        </div>
      </div>
      <div id="import-result" style="margin-top:8px;font-size:13px"></div>`
      : `<div style="color:var(--muted);font-size:13px">${t('msg_edit_mode_only')}</div>`}
    </div>

    <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">${t('export_data_title')}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv`, "IT_assets.csv"])}'>${t('btn_export_all')}</button>
        <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv?tab=os`, "IT_assets_os.csv"])}'>⬇ ${t('tab_os')}</button>
        <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv?tab=small`, "IT_assets_small.csv"])}'>⬇ ${t('tab_small')}</button>
        <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv?tab=infra`, "IT_assets_infra.csv"])}'>⬇ ${t('tab_infra')}</button>
      </div>
    </div>

    <div class="card" style="max-width:520px;margin-bottom:14px">
      <div class="section-title">${t('diag_title')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" data-action="runDiag">${t('btn_check_state')}</button>
        ${isAdmin ? `<button class="btn btn-secondary btn-sm" data-action="runMigration">${t('btn_recalc_categories')}</button>` : ''}
      </div>
      <div id="diag-result" style="margin-top:10px;font-size:12px;line-height:1.9"></div>
    </div>

    <div class="card" style="max-width:520px">
      <div class="section-title">${t('about_system_title')}</div>
      <div style="font-size:12px;color:var(--muted);line-height:2">
        <div>${t('lbl_version')}: <b id="app-version-detail" style="color:var(--text)">${db_version || '…'}</b></div>
        <div>${t('lbl_db')}: <code>data/db.json</code> + <code>data/config.json</code> + <code>data/it-assets.sqlite</code></div>
        <div>${t('lbl_server')}: Node.js + Express + lowdb + SQLite</div>
        <div>HTTP: <code>:3000</code> (${t('lbl_redirect')}) · HTTPS: <code>:3443</code></div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          ${t('msg_developed_for')}<br>
          ${t('lbl_author')}: <a href="https://github.com/DarkyAndSparky" target="_blank" rel="noopener"
            style="color:var(--accent)">DarkyAndSparky</a>
        </div>
        <div style="margin-top:8px">
          <a href="https://github.com/DarkyAndSparky/it-assets" target="_blank" rel="noopener"
            style="color:var(--accent);display:inline-flex;align-items:center;gap:4px">
            ${t('lbl_github_repo')}
          </a>
        </div>
      </div>
      ${isAdmin ? `
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
        <button class="btn btn-ghost btn-sm" data-action="loadSystemInfo">${t('btn_admin_diag')}</button>
        <div id="system-info-result" style="margin-top:10px;font-size:12px;line-height:1.9"></div>
      </div>` : ''}
    </div>`;
}

// INFRA-5/INFRA-8: подробная админ-диагностика — подгружается по клику, а
// не при каждом открытии настроек. Оформление по образцу procure-it:
// раздельные карточки "О программе" / "Окружение" (авто-обновление раз в
// 10 сек, пока панель открыта) / "Технологии" / "Последние изменения"
// (из CHANGELOG.md) / "Данные".
let _sysInfoEnvTimer = null;

async function loadSystemInfo() {
  const box = document.getElementById('system-info-result');
  if (!box) return;
  box.innerHTML = `<span style="color:var(--muted)">${t('msg_loading')}</span>`;
  clearInterval(_sysInfoEnvTimer);

  try {
    const s = await _fetchSystemInfo();
    box.innerHTML = _renderSystemInfoCards(s);
    // Окружение (uptime/память/размер БД/последний бэкап) меняется
    // постоянно — перерисовываем каждые 10 сек, пока карточка на экране,
    // не перегружая остальные (статичные) блоки повторными запросами.
    _sysInfoEnvTimer = setInterval(async () => {
      const envBox = document.getElementById('about-env-card-body');
      if (!envBox || !document.body.contains(envBox)) { clearInterval(_sysInfoEnvTimer); return; }
      try {
        const fresh = await _fetchSystemInfo();
        envBox.innerHTML = _renderEnvRows(fresh);
      } catch (e) { /* тихо — авто-обновление необязательно */ }
    }, 10000);
  } catch (e) {
    box.innerHTML = `<span style="color:var(--danger, #e94560)">${t('msg_load_error', { msg: e.message })}</span>`;
  }
}

async function _fetchSystemInfo() {
  return fetch(`${API}/api/settings/system-info`, { headers: ah() }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function _fmtBytes(n) {
  if (n == null) return '?';
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024).toFixed(1) + ' KB';
}
function _fmtDate(d) {
  return d ? new Date(d).toLocaleString(_lang === 'en' ? 'en-US' : 'ru-RU') : '—';
}
function _fmtUptime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${h} ${t('lbl_hours_short')} ${m} ${t('lbl_minutes_short')}`;
}

function _renderEnvRows(s) {
  return `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;align-items:baseline">
      <span style="color:var(--muted)">Node.js</span><span style="font-family:monospace">${esc(s.node.version)}</span>
      <span style="color:var(--muted)">${t('lbl_platform')}</span><span style="font-family:monospace">${esc(s.node.platform)} / ${esc(s.node.arch)}</span>
      <span style="color:var(--muted)">${t('lbl_uptime2')}</span><span>${_fmtUptime(s.node.uptime_sec)}</span>
      <span style="color:var(--muted)">${t('lbl_process_memory')}</span><span>${s.node.memory_rss_mb} MB</span>
      <span style="color:var(--muted)">PID</span><span style="font-family:monospace">${s.node.pid}</span>
      <span style="color:var(--muted)">${t('lbl_db_size')}</span><span>${_fmtBytes(s.storage.sqlite_bytes + s.storage.db_json_bytes + s.storage.config_json_bytes)}</span>
      <span style="color:var(--muted)">${t('lbl_last_backup2')}</span><span>${s.storage.backups.last ? _fmtDate(s.storage.backups.last.mtime) : t('lbl_no_backups2')}</span>
    </div>`;
}

function _renderSystemInfoCards(s) {
  const about = s.about || { name: 'it-assets', version: s.version, description: '', license: t('lbl_none'), author: t('lbl_none'), repository: '' };
  const deps = Object.entries(s.dependencies || {})
    .map(([name, v]) => `<div>${esc(name)}: <code>${esc(v.installed)}</code> <span style="opacity:.6">(${esc(v.required)})</span></div>`)
    .join('');
  const techRows = (s.techStack || []).map(t2 => `
      <div>
        <div style="font-weight:600;font-size:13px">${esc(t2.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(t2.role)}</div>
      </div>`).join('');
  const changes = (s.recentChanges || []);

  return `
    <div class="card" style="margin-bottom:14px;padding:12px">
      <div style="font-weight:700;margin-bottom:8px">${t('about_program_title')} ${esc(about.name)}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;align-items:baseline">
        <span style="color:var(--muted)">${t('lbl_version')}</span><span style="font-family:monospace;font-weight:600">${esc(about.version)}</span>
        <span style="color:var(--muted)">${t('lbl_description')}</span><span>${esc(about.description) || t('lbl_none')}</span>
        <span style="color:var(--muted)">${t('lbl_license')}</span><span>${esc(about.license) || t('lbl_none')}</span>
        <span style="color:var(--muted)">${t('lbl_author2')}</span><span>${esc(about.author) || t('lbl_none')}</span>
        <span style="color:var(--muted)">${t('lbl_repository')}</span><span>${about.repository ? `<a href="${esc(about.repository)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(about.repository)}</a>` : t('lbl_none')}</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;padding:12px" id="about-env-card">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
        <div style="font-weight:700">${t('about_env_title')}</div>
        <div style="font-size:10px;color:var(--muted)">${t('about_env_refresh_note')}</div>
      </div>
      <div id="about-env-card-body">${_renderEnvRows(s)}</div>
    </div>

    <div class="card" style="margin-bottom:14px;padding:12px">
      <div style="font-weight:700;margin-bottom:8px">${t('about_tech_title')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px">${techRows}</div>
    </div>

    ${changes.length ? `
    <details class="card" style="margin-bottom:14px;padding:0">
      <summary style="cursor:pointer;padding:12px;font-weight:700;list-style:none;display:flex;align-items:center;gap:8px">
        ${t('about_changes_title')}
        <span style="font-size:10px;color:var(--muted);font-weight:400;margin-left:auto">${t('about_changes_note')}</span>
      </summary>
      <div style="padding:0 12px 12px">
        <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--muted);line-height:1.7">
          ${changes.map(c => `<li>${esc(c)}</li>`).join('')}
        </ul>
      </div>
    </details>` : ''}

    <div class="card" style="padding:12px">
      <div style="font-weight:700;margin-bottom:8px">${t('about_data_title')}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;align-items:baseline">
        <span style="color:var(--muted)">${t('lbl_records')}</span><span>${t('lbl_assets_short')} ${s.counts.assets ?? '?'} · ${t('lbl_history_short')} ${s.counts.history ?? '?'} · ${t('lbl_employees_short')} ${s.counts.employees ?? '?'} · ${t('lbl_users_short')} ${s.counts.users ?? '?'}</span>
        <span style="color:var(--muted)">${t('lbl_backups')}</span><span>${s.storage.backups.count} ${t('lbl_pcs_last')}: ${s.storage.backups.last ? esc(s.storage.backups.last.file) : t('lbl_no_backups2')}</span>
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <div style="font-weight:600;font-size:12px;margin-bottom:6px">${t('lbl_dependencies')}</div>
        <div style="max-height:160px;overflow:auto;font-size:12px">${deps}</div>
      </div>
    </div>`;
}

// ── Вкладка: Организации ──────────────────────────────────────────────────────
let _showLiquidatedOrgs = false;

// Организации/Филиалы/Локации (панели + CRUD + инв-правила) вынесены
// в public/js/views/settings-refdata.js (Фаза 5, шаг 23)

// downloadConfigExport, startConfigImport, _renderImportPreview, _selectResolution,
// _checkAllResolved, applyConfigImport (+ _renderConfigPanel из settings-refdata.js)
// вынесены в public/js/views/settings-config.js (Фаза 5, шаг 24)

async function runMigration() {
  if (!confirm(t('msg_confirm_migration'))) return;
  const r = await fetch(`${API}/api/migrate`, {
    method:'POST', headers:ah(),
    body: JSON.stringify({ from_version: 3 }) // перезапустить с v4
  });
  const d = await r.json();
  if (r.ok) toast(t('msg_migration_done', { v: d.schema_version }), 'success');
  else toast(d.error || t('msg_error'), 'error');
}

async function runDiag() {
  const el = document.getElementById('diag-result');
  el.innerHTML = t('msg_checking');
  try {
    const d = await fetch(`${API}/api/diag`).then(r=>r.json());
    const ok = c => `<span style="color:#059669;font-weight:600">${c}</span>`;
    const err = c => `<span style="color:var(--danger-text);font-weight:600">${c}</span>`;
    const mb = (d.fileSize/1024).toFixed(1);
    const last = d.lastWrite ? new Date(d.lastWrite).toLocaleString(_lang === 'en' ? 'en-US' : 'ru-RU') : '—';
    el.innerHTML = `
      <div>${d.writable ? ok(t('msg_db_writable')) : err(t('msg_db_not_writable'))}</div>
      <div>${d.writeOk  ? ok(t('msg_test_write_ok')) : err(t('msg_test_write_fail'))}</div>
      <div>📁 ${t('lbl_path')}: <code style="font-size:11px">${d.dbPath}</code></div>
      <div>📦 ${t('lbl_size')}: ${mb} KB | ${t('lbl_last_change')}: ${last}</div>
      <div>📋 ${t('lbl_in_db')}: ${t('lbl_devices_count', { n: d.assets })}, ${t('lbl_history_records', { n: d.history })}</div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
        ${d.backup?.last
          ? ok(t('msg_last_backup', {
              name: d.backup.last.file.replace(/^backup_\w+_/,'').replace(/\.zip|\.json/,''),
              size: Math.round(d.backup.last.size/1024),
              full: d.backup.last.full ? t('lbl_backup_full') : t('lbl_backup_db_only')
            }))
          : err(t('msg_no_backups_found'))}
        <span style="color:var(--muted);font-size:12px"> ${t('lbl_total_count', { n: d.backup?.count ?? 0 })}</span>
      </div>
      ${!d.writable||!d.writeOk ? `<div style="margin-top:8px;padding:8px;background:var(--noInv-bg);border-radius:6px;color:var(--danger-text)">
        ${t('msg_move_folder_warning')}
      </div>` : ''}
    `;
  } catch(e) {
    document.getElementById('diag-result').innerHTML = `<span style="color:var(--danger-text)">${t('msg_diag_error', { msg: e.message })}</span>`;
  }
}


function _updateLogoEl(name, logoData) {
  const parts     = (name || 'IT ASSETS').trim().split(/\s+/);
  const logo      = document.getElementById('company-logo');
  const logoSvg   = document.getElementById('company-logo-svg');
  const logoEmoji = document.getElementById('company-logo-emoji');
  if (logo) {
    if (parts.length === 1) {
      const a = esc(parts[0].slice(0, 2));
      const b = esc(parts[0].slice(2));
      logo.innerHTML = a + (b ? `<span>${b}</span>` : '');
    } else {
      logo.innerHTML = esc(parts[0]) + `<span>${esc(parts.slice(1).join(' '))}</span>`;
    }
  }
  document.title = name;
  if (logoSvg && logoEmoji) {
    const isSvg    = logoData && logoData.trim().toLowerCase().startsWith('<svg');
    const isImgUrl = logoData && (logoData.startsWith('data:image') || logoData.startsWith('http'));
    if (isSvg) {
      logoSvg.innerHTML = logoData;
      const el = logoSvg.querySelector('svg');
      if (el) { el.style.height='36px'; el.style.width='auto'; el.removeAttribute('width'); el.removeAttribute('height'); }
      logoSvg.style.display = 'block';
      logoEmoji.style.display = 'none';
    } else if (isImgUrl) {
      logoSvg.innerHTML = `<img src="${logoData}" style="height:36px;width:auto;object-fit:contain" alt="logo"/>`;
      logoSvg.style.display = 'block';
      logoEmoji.style.display = 'none';
    } else {
      logoSvg.innerHTML = '';
      logoSvg.style.display = 'none';
      logoEmoji.style.display = 'block';
    }
  }
}

function _livePreview() {
  const al = document.getElementById('st-accent-light')?.value || '#e94560';
  const ad = document.getElementById('st-accent-dark')?.value  || '#e94560';
  const pl = document.getElementById('preview-light');
  const pd = document.getElementById('preview-dark');
  if (pl) pl.innerHTML = _renderStylePreview(false, al);
  if (pd) pd.innerHTML = _renderStylePreview(true,  ad);
}

function _resetStyles() {
  if (!confirm(t('msg_confirm_reset_style'))) return;
  localStorage.removeItem('itassets_styles');
  // Сбрасываем все кастомные CSS переменные
  const vars = ['--accent','--header-bg','--accent-dark','--header-bg-dark'];
  vars.forEach(v => document.documentElement.style.removeProperty(v));
  // Сбрасываем значения color-picker инпутов
  const defaults = { 'st-accent-light':'#e94560', 'st-accent-dark':'#e94560',
                     'st-header-light':'', 'st-header-dark':'' };
  Object.entries(defaults).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  fetch(`${API}/api/settings/styles`, { method:'PUT', headers:ah(), body:JSON.stringify({styles:{}}) });
  toast(t('msg_style_reset'), 'success');
  setTimeout(() => { _initStyleEditor(); _livePreview(); }, 50);
}

async function _initStyleEditor() {
  let styles = {};
  try {
    const s = await fetch(`${API}/api/settings`).then(r=>r.json());
    styles = s.styles || {};
  } catch(e) {
    styles = JSON.parse(localStorage.getItem('itassets_styles') || '{}');
  }
  const al = styles.accent_light || '#e94560';
  const ad = styles.accent_dark  || '#e94560';
  const inpL = document.getElementById('st-accent-light');
  const inpD = document.getElementById('st-accent-dark');
  if (inpL) inpL.value = al;
  if (inpD) inpD.value = ad;
  _livePreview();
}

function _loadLogoPreview(logoData) {
  const preview = document.getElementById('logo-preview');
  if (!preview) return;
  if (!logoData || !logoData.trim()) {
    preview.innerHTML = `<span style="font-size:12px;color:var(--muted)">${t('msg_logo_not_set')}</span>`;
    return;
  }
  if (logoData.trim().toLowerCase().startsWith('<svg')) {
    // SVG разметка
    preview.innerHTML = logoData;
    const el = preview.querySelector('svg');
    if (el) { el.style.height='36px'; el.style.width='auto'; el.removeAttribute('width'); el.removeAttribute('height'); }
  } else if (logoData.startsWith('data:') || logoData.startsWith('http')) {
    // base64 или URL
    preview.innerHTML = `<img src="${logoData}" style="height:36px;width:auto;object-fit:contain" alt="logo"/>`;
  } else {
    preview.innerHTML = `<span style="font-size:12px;color:var(--muted)">${t('msg_logo_not_set')}</span>`;
  }
}

async function saveLogoSvg() {
  const file = document.getElementById('logo-svg-file')?.files[0];
  if (!file) return toast(t('msg_select_logo_file'), 'error');

  let logoData;
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    // SVG — читаем как текст
    logoData = await file.text();
    if (!logoData.trim().toLowerCase().includes('<svg'))
      return toast(t('msg_not_valid_svg'), 'error');
  } else {
    // PNG/JPG/WebP — конвертируем в base64 data URL
    logoData = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => res(e.target.result);
      reader.onerror = () => rej(new Error(t('msg_file_read_error')));
      reader.readAsDataURL(file);
    });
  }

  // Проверяем размер (макс 512 KB)
  if (logoData.length > 512 * 1024) return toast(t('msg_file_too_large'), 'error');

  const r = await fetch(`${API}/api/settings/logo_svg`, {
    method:'PUT', headers:ah(), body:JSON.stringify({ svg: logoData })
  });
  if (r.ok) {
    toast(t('msg_logo_saved'), 'success');
    _updateLogoEl(_companyName || 'IT ASSETS', logoData);
    _loadLogoPreview(logoData);
  } else { const d = await r.json(); toast(d.error||t('msg_error'),'error'); }
}

async function clearLogoSvg() {
  const r = await fetch(`${API}/api/settings/logo_svg`, {
    method:'PUT', headers:ah(), body:JSON.stringify({ svg:'' })
  });
  if (r.ok) {
    toast(t('msg_logo_removed'), 'success');
    _updateLogoEl(_companyName || 'IT ASSETS', '');
    _loadLogoPreview('');
  } else toast(t('msg_error'),'error');
}

async function saveCompanyName() {
  const name = document.getElementById('company-name-inp')?.value.trim();
  if (!name) return toast(t('msg_enter_name'), 'error');
  const r = await fetch(`${API}/api/settings/company_name`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ company_name: name })
  });
  const d = await r.json();
  if (r.ok) {
    toast(t('msg_company_name_saved'), 'success');
    _companyName = name;
    try {
      const s = await fetch(`${API}/api/settings`).then(r=>r.json());
      _updateLogoEl(name, s.logo_svg || '');
    } catch(e) {
      _updateLogoEl(name, '');
    }
  } else toast(d.error || t('msg_error'), 'error');
}

async function resetCompanyName() {
  if (!confirm(t('msg_confirm_reset_name'))) return;
  const r = await fetch(`${API}/api/settings/company_name`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ company_name: 'IT ASSETS' })
  });
  if (r.ok) {
    toast(t('msg_company_name_reset'), 'success');
    _companyName = 'IT ASSETS';
    const inp = document.getElementById('company-name-inp');
    if (inp) inp.value = 'IT ASSETS';
    try {
      const s = await fetch(`${API}/api/settings`).then(r=>r.json());
      _updateLogoEl('IT ASSETS', s.logo_svg || '');
    } catch(e) {
      _updateLogoEl('IT ASSETS', '');
    }
  } else toast(t('msg_error'), 'error');
}

async function saveStyleSettings() {
  const accentLight  = document.getElementById('st-accent-light')?.value  || '#e94560';
  const accentDark   = document.getElementById('st-accent-dark')?.value   || '#e94560';
  const styles = { accent_light: accentLight, accent_dark: accentDark };
  // Сохраняем локально и на сервере
  localStorage.setItem('itassets_styles', JSON.stringify(styles));
  applyStoredStyles(styles);
  const r = await fetch(`${API}/api/settings/styles`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ styles })
  });
  if (r.ok) toast(t('msg_styles_saved'), 'success');
  else toast(t('msg_save_error'), 'error');
}

function _previewAccent(inputId, previewId) {
  const color = document.getElementById(inputId)?.value;
  const prev  = document.getElementById(previewId);
  if (prev) prev.style.background = color;
}

function _renderStylePreview(isDark, accent) {
  const bg      = isDark ? '#0f1117' : '#f0f2f5';
  const card    = isDark ? '#1a1b23' : '#ffffff';
  const text    = isDark ? '#e8eaf0' : '#1a1a2e';
  const muted   = isDark ? '#6b7280' : '#64748b';
  const border  = isDark ? '#2d2f3e' : '#e2e8f0';
  const navBg   = isDark ? '#1a1b23' : '#ffffff';
  const headerG = isDark
    ? 'linear-gradient(135deg,#0a0b0f,#13141c,#1a1b23)'
    : 'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)';
  const navTabs = [t('nav_dashboard').replace(/^\S+\s/, ''), t('tab_os'), t('tab_small'), t('tab_infra')];
  const contentTabs = [t('nav_os'), t('nav_small'), t('nav_infra')];
  return `
    <div style="width:100%;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.25);font-size:10px;user-select:none">
      <!-- header -->
      <div style="background:${headerG};color:#fff;padding:7px 10px;display:flex;align-items:center;gap:6px">
        <div style="font-weight:800;font-size:11px">IT<span style="color:${accent}">ASSETS</span></div>
        <div style="margin-left:auto;display:flex;gap:4px">
          <div style="background:${accent};border-radius:10px;padding:1px 6px;font-size:9px;font-weight:600">0</div>
          <div style="background:rgba(255,255,255,.2);border-radius:6px;padding:2px 7px;font-size:9px">admin</div>
        </div>
      </div>
      <!-- nav -->
      <div style="background:${navBg};display:flex;gap:0;border-bottom:1px solid ${border};padding:0 8px">
        ${navTabs.map((tb,i) => `
        <div style="padding:5px 7px;font-size:9px;font-weight:${i===0?700:500};color:${i===0?accent:muted};border-bottom:${i===0?`2px solid ${accent}`:'2px solid transparent'}">${tb}</div>`).join('')}
      </div>
      <!-- content -->
      <div style="background:${bg};padding:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px">
        ${contentTabs.map(tb => `
        <div style="background:${card};border-radius:6px;padding:6px 8px;box-shadow:0 1px 4px rgba(0,0,0,.1);border-left:3px solid ${accent}">
          <div style="font-size:10px;font-weight:700;color:${text}">${tb}</div>
          <div style="font-size:14px;font-weight:800;color:${accent};margin-top:2px">—</div>
          <div style="font-size:8px;color:${muted}">${t('lbl_devices_word')}</div>
        </div>`).join('')}
      </div>
    </div>`;
}
