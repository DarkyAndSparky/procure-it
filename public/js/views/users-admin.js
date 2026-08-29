/**
 * public/js/views/users-admin.js
 *
 * Фаза 5, шаг 20: управление пользователями системы (вкладка в
 * настройках — логины, роли, PIN), вынесенное из public/index.html.
 * Classic script — та же причина, что и в остальных файлах (см. auth.js).
 *
 * Отдельно от employees.js: пользователи системы (логин/роль/PIN) —
 * это другой домен, нежели справочник сотрудников (для автокомплита).
 * _renderUsersPanel() вызывается из renderSettings() (пока в index.html)
 * как внешний глобал.
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js), тот же паттерн,
 * что в employees.js/asset-tab.js (LOC-1..4).
 */


// ─── УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (вкладка в настройках) ────────────────────────

async function _renderUsersPanel() {
  let users = [];
  try { users = await fetch(`${API}/api/users`, {headers:ah()}).then(r=>r.json()); } catch(e){}

  const ROLE_LABEL = { admin:t('role_admin'), operator:t('role_operator'), viewer:t('role_viewer') };
  const ROLE_BADGE = { admin:'s-used', operator:'s-reserve', viewer:'s-off' };

  const rows = users.map(u => `
    <tr>
      <td><b>${esc(u.name)}</b></td>
      <td><span class="badge-s ${ROLE_BADGE[u.role]||'s-off'}">${ROLE_LABEL[u.role]||u.role}</span></td>
      <td><span class="badge-s ${u.active!==false?'s-used':'s-off'}">${u.active!==false?t('lbl_active'):t('lbl_disabled')}</span></td>
      <td>${u.role!=='admin' ? (u.can_view_accounts?`<span class="badge-s s-used" title="${t('tooltip_sees_acct_pw')}">${t('lbl_cva_yes')}</span>`:`<span class="badge-s s-off">${t('lbl_cva_no')}</span>`) : `<span style="color:var(--muted);font-size:11px">${t('lbl_always')}</span>`}</td>
      <td style="white-space:nowrap">
        <button class="btn-icon" title="${t('tooltip_edit')}" data-action="showEditUserModal" data-args='${JSON.stringify([u.id, esc(u.name), u.role, esc(u.login||u.name), !!u.can_view_accounts])}'>✏️</button>
        ${u.id!=='sys-user-admin'?`
        <button class="btn-icon" title="${u.active!==false?t('tooltip_deactivate'):t('tooltip_activate')}"
          data-action="toggleUserActive" data-args='${JSON.stringify([u.id, u.active===false])}'>${u.active!==false?'🔒':'🔓'}</button>
        <button class="btn-icon" title="${t('tooltip_delete')}" data-action="deleteUser" data-args='${JSON.stringify([u.id, esc(u.name)])}'>🗑</button>
        `:''}
      </td>
    </tr>`).join('');

  return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="section-title" style="margin:0">${t('users_title')}</div>
        <button class="btn btn-primary btn-sm" data-action="showCreateUserModal">${t('btn_add')}</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6">
        ${t('users_hint')}
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>${t('th_name')}</th><th>${t('th_role')}</th><th>${t('th_status')}</th><th>${t('th_acct_passwords')}</th><th></th></tr></thead>
          <tbody>${rows||`<tr><td colspan="5" style="color:var(--muted);text-align:center">${t('msg_no_users')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

function showCreateUserModal() {
  showModal(`<h2>${t('modal_new_user_title')}</h2>
    <div class="form-row"><label>${t('field_name_required')}</label>
      <input id="cu-name" placeholder="${t('msg_name_placeholder')}"/></div>
    <div class="form-row"><label>${t('field_login_required')}</label>
      <input id="cu-login" placeholder="${t('msg_login_placeholder')}"/></div>
    <div class="form-row"><label>${t('field_role')}</label>
      <select id="cu-role">
        <option value="operator">${t('role_operator_full')}</option>
        <option value="viewer">${t('role_viewer_full')}</option>
        <option value="admin">${t('role_admin')}</option>
      </select>
    </div>
    <div class="form-row"><label>${t('field_password')}</label>
      <input type="password" id="cu-pin" placeholder="${t('msg_password_min4')}"/>
    </div>
    <div class="form-row">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="cu-cva"/> ${t('lbl_sees_acct_passwords')}
      </label>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${t('msg_cva_admin_note')}</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doCreateUser">${t('btn_create')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}

async function doCreateUser() {
  const name  = document.getElementById('cu-name')?.value.trim();
  const login = document.getElementById('cu-login')?.value.trim();
  const role  = document.getElementById('cu-role')?.value;
  const pin   = document.getElementById('cu-pin')?.value.trim();
  const can_view_accounts = !!document.getElementById('cu-cva')?.checked;
  if (!name)  return toast(t('msg_enter_name'), 'error');
  if (!login) return toast(t('msg_enter_login'), 'error');
  if (!pin || pin.length < 4) return toast(t('msg_password_min4_error'), 'error');
  const r = await fetch(`${API}/api/users`, {
    method:'POST', headers:ah(), body:JSON.stringify({name, login, role, pin, can_view_accounts})
  });
  const d = await r.json();
  if (r.ok) {
    closeModal(); toast(t('msg_user_created'), 'success');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.innerHTML = await _renderUsersPanel();
  } else toast(d.error||t('msg_error'), 'error');
}

function showEditUserModal(id, name, role, login, canViewAccounts) {
  showModal(`<h2>${t('modal_edit_user_title')}</h2>
    <div class="form-row"><label>${t('th_name')}</label>
      <input id="eu-name" value="${esc(name)}"/></div>
    <div class="form-row"><label>${t('field_login')}</label>
      <input id="eu-login" value="${esc(login||'')}"/></div>
    <div class="form-row"><label>${t('field_role')}</label>
      <select id="eu-role">
        <option value="operator" ${role==='operator'?'selected':''}>${t('role_operator')}</option>
        <option value="viewer"   ${role==='viewer'?'selected':''}>${t('role_viewer')}</option>
        <option value="admin"    ${role==='admin'?'selected':''}>${t('role_admin')}</option>
      </select>
    </div>
    <div class="form-row"><label>${t('field_new_password')}</label>
      <input type="password" id="eu-pin" placeholder="${t('msg_keep_password_placeholder')}"/></div>
    <div class="form-row">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="eu-cva" ${canViewAccounts?'checked':''}/> ${t('lbl_sees_acct_passwords')}
      </label>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${t('msg_cva_admin_note')}</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doUpdateUser" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}

async function doUpdateUser(id) {
  const name  = document.getElementById('eu-name')?.value.trim();
  const login = document.getElementById('eu-login')?.value.trim();
  const role  = document.getElementById('eu-role')?.value;
  const pin   = document.getElementById('eu-pin')?.value.trim();
  const can_view_accounts = !!document.getElementById('eu-cva')?.checked;
  if (!login) return toast(t('msg_login_empty_error'), 'error');
  const body = {name, login, role, can_view_accounts};
  if (pin) { if (pin.length < 4) return toast(t('msg_password_min4_error'), 'error'); body.pin = pin; }
  const r = await fetch(`${API}/api/users/${id}`, {
    method:'PUT', headers:ah(), body:JSON.stringify(body)
  });
  const d = await r.json();
  if (r.ok) {
    closeModal(); toast(t('msg_saved'), 'success');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.innerHTML = await _renderUsersPanel();
  } else toast(d.error||t('msg_error'), 'error');
}

async function toggleUserActive(id, makeActive) {
  const r = await fetch(`${API}/api/users/${id}`, {
    method:'PUT', headers:ah(), body:JSON.stringify({active: makeActive})
  });
  if (r.ok) {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.innerHTML = await _renderUsersPanel();
  } else toast(t('msg_error'), 'error');
}

async function deleteUser(id, name) {
  if (!confirm(t('confirm_delete_user', { name }))) return;
  const r = await fetch(`${API}/api/users/${id}`, {method:'DELETE', headers:ah()});
  const d = await r.json();
  if (r.ok) {
    toast(t('msg_deleted'), 'success');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.innerHTML = await _renderUsersPanel();
  } else toast(d.error||t('msg_error'), 'error');
}
