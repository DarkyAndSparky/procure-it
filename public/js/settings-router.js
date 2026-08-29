/**
 * public/js/settings-router.js
 *
 * Фаза 5, шаг 22: диспетчер экрана настроек (renderSettings,
 * switchSettingsTab, _renderSettingsPanel), вынесенный из
 * public/index.html. Тот же паттерн, что и в router.js: сами реализации
 * под-панелей (_renderGeneralPanel, _renderOrgsPanel, _renderFilialsPanel,
 * _renderLocationsPanel, _renderConfigPanel) пока ОСТАЮТСЯ в index.html —
 * вызываются по имени, безопасно для classic-скриптов.
 *
 * _settingsTab/_refDataLoaded — состояние экрана настроек, остаются
 * глобальными в index.html (нужны ещё не вынесенным панелям).
 */

async function renderSettings() {
  const isAdmin = canAdmin();
  const app = document.getElementById('app');
  try {
    const s = await fetch(`${API}/api/settings`).then(r=>r.json());
    _companyName = s.company_name||'';
    if (s.version) {
      _appVersion = s.version
        .replace(/^alpha-(\d+)-/, 'α$1 · ')
        .replace(/^beta-(\d+)-/,  'β$1 · ')
        .replace(/-/g,'·');
    }
    // Применяем стили с сервера и синхронизируем localStorage
    if (s.styles && (s.styles.accent_light || s.styles.accent_dark)) {
      localStorage.setItem('itassets_styles', JSON.stringify(s.styles));
      applyStoredStyles(s.styles);
    }
  } catch(e) {}

  // Загрузка справочников (всегда свежие при открытии настроек)
  _refDataLoaded = false;
  await ensureRefData();

  app.innerHTML = `
    <div style="max-width:900px">
      ${!isAdmin ? `<div class="card" style="margin-bottom:14px;background:var(--warn-bg);border:1px solid var(--warn-border)">
        <div style="font-size:13px;color:var(--warn-text);display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">🔒</span>
          <div>${t('msg_edit_mode_admin_note')}</div>
        </div>
      </div>` : ''}

      <!-- Вкладки настроек -->
      <div class="cat-tabs settings-tabs" style="margin-bottom:18px">
        <button class="cat-tab ${_settingsTab==='general'?'active':''}" data-stab="general" data-action="switchSettingsTab" data-args='["general"]'>${t('tab_settings_general')}</button>
        ${isAdmin ? `
        <button class="cat-tab ${_settingsTab==='users'?'active':''}" data-stab="users" data-action="switchSettingsTab" data-args='["users"]'>${t('tab_settings_users')}</button>
        <button class="cat-tab ${_settingsTab==='employees'?'active':''}" data-stab="employees" data-action="switchSettingsTab" data-args='["employees"]'>${t('tab_settings_employees')}</button>
        <button class="cat-tab ${_settingsTab==='orgs'?'active':''}" data-stab="orgs" data-action="switchSettingsTab" data-args='["orgs"]'>${t('tab_settings_orgs')}</button>
        <button class="cat-tab ${_settingsTab==='filials'?'active':''}" data-stab="filials" data-action="switchSettingsTab" data-args='["filials"]'>${t('tab_settings_filials')}</button>
        <button class="cat-tab ${_settingsTab==='locations'?'active':''}" data-stab="locations" data-action="switchSettingsTab" data-args='["locations"]'>${t('tab_settings_locations')}</button>
        <button class="cat-tab ${_settingsTab==='types'?'active':''}" data-stab="types" data-action="switchSettingsTab" data-args='["types"]'>${t('tab_settings_types')}</button>
        <button class="cat-tab ${_settingsTab==='config'?'active':''}" data-stab="config" data-action="switchSettingsTab" data-args='["config"]'>${t('tab_settings_config')}</button>
        ` : ''}
      </div>

      <div id="settings-panel">
        ${await _renderSettingsPanel(isAdmin)}
      </div>
    </div>`;
  if (_settingsTab === 'employees') _empRefreshTables();
}

async function switchSettingsTab(tab) {
  _settingsTab = tab;
  const isAdmin = canAdmin();
  document.querySelectorAll('.settings-tabs .cat-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.stab === tab);
  });
  const panel = document.getElementById('settings-panel');
  if (panel) panel.innerHTML = `<div style="color:var(--muted);padding:16px">${t('msg_loading')}</div>`;
  const html = await _renderSettingsPanel(isAdmin);
  if (panel) {
    panel.innerHTML = html;
    if (_settingsTab === 'employees') _empRefreshTables();
  }
}

async function _renderSettingsPanel(isAdmin) {
  if (_settingsTab === 'types')     return await _renderTypesPanel();
  if (_settingsTab === 'users')     return await _renderUsersPanel();
  if (_settingsTab === 'employees') return await _renderEmployeesPanel();
  if (_settingsTab === 'orgs')      return _renderOrgsPanel();
  if (_settingsTab === 'filials')   return _renderFilialsPanel();
  if (_settingsTab === 'locations') return _renderLocationsPanel();
  if (_settingsTab === 'config')    return _renderConfigPanel(isAdmin);
  const _gs = await fetch(`${API}/api/settings`).then(r=>r.json()).catch(()=>({}));
  const html = _renderGeneralPanel(isAdmin, _gs.company_name || _companyName, _gs.logo_svg || '', _appVersion);
  setTimeout(() => {
    _loadLogoPreview(_gs.logo_svg || '');
    if (isAdmin) _initStyleEditor();
  }, 50);
  return html;
}
