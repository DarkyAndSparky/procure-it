/**
 * public/js/views/settings-refdata.js
 *
 * Фаза 5, шаг 23: справочники "Организации" / "Филиалы" / "Локации" —
 * вкладки настроек целиком (панели + CRUD-модалки + правила инвентарных
 * номеров), вынесенные из public/index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 *
 * _renderConfigPanel() изначально уехала сюда случайно (физически лежала
 * между Locations-панелью и CRUD-модалками — Фаза 5, шаг 24) — теперь
 * в public/js/views/settings-config.js, вместе с остальным доменом "Конфиг".
 *
 * _orgsCache/_filialsCache/_locsCache/ensureRefData() НЕ перенесены —
 * используются ещё и в asset-tab.js, остаются общими глобалами в
 * index.html. _showClosedFilials/_locFilterFilial (состояние конкретно
 * этих панелей) переехали сюда же; _showLiquidatedOrgs — НЕ переехала,
 * осталась в index.html (была объявлена чуть раньше границы выноса),
 * тоже безопасно как внешний глобал.
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js). Самый крупный
 * файл в LOC-5 — 3 полноценных CRUD-домена (орг/филиалы/локации) плюс
 * правила инв. номеров с конфликт-резолвером при удалении.
 */

// ─── Фаза 6: обёртки для составных onclick/onchange этого экрана ───────────────

// Было data-onchange-action="_onToggleShowLiquidatedOrgs"
function _onToggleShowLiquidatedOrgs() {
  _showLiquidatedOrgs = this.checked;
  switchSettingsTab(_settingsTab);
}

// Было data-onchange-action="_onToggleShowClosedFilials"
function _onToggleShowClosedFilials() {
  _showClosedFilials = this.checked;
  switchSettingsTab(_settingsTab);
}

// Было data-action="_goToFilialLocations" data-args='${JSON.stringify([f.id])}'
// — три оператора подряд.
function _goToFilialLocations(filialId) {
  switchSettingsTab('locations');
  _locFilterFilial = filialId;
  _renderLocationsFiltered();
}

// Было data-onchange-action="_onLocFilterFilialChange"
function _onLocFilterFilialChange() {
  _locFilterFilial = this.value;
  _renderLocationsFiltered();
}

function _renderOrgsPanel() {
  const active     = _orgsCache.filter(o => o.status !== 'liquidated' && !o.system);
  const liquidated = _orgsCache.filter(o => o.status === 'liquidated');
  const visible    = _showLiquidatedOrgs ? [...active, ...liquidated] : active;

  const rows = visible.map(o => {
    const isLiq = o.status === 'liquidated';
    return `<tr style="${isLiq ? 'opacity:0.55' : ''}">
      <td><b>${esc(o.name)}</b>${isLiq ? ` <span style="font-size:11px;color:var(--muted)">${t('lbl_liquidated_suffix')}</span>` : ''}</td>
      <td><code style="font-size:12px;color:var(--indigo)">${esc(o.short_code)}</code></td>
      <td>${isLiq ? '—' : t('lbl_rules_count', { n: o.inv_rules?.length || 0 })}</td>
      <td><span class="badge-s ${o.status==='active'?'s-used':'s-off'}">${o.status==='active'?t('lbl_status_active'):t('lbl_status_liquidated')}</span></td>
      <td style="white-space:nowrap">
        ${!isLiq ? `
        <button class="btn-icon" title="${t('tooltip_inv_rules')}" data-action="showInvRulesModal" data-args='${JSON.stringify([o.id])}'>🏷</button>
        <button class="btn-icon" title="${t('tooltip_rename')}" data-action="showRenameOrgModal" data-args='${JSON.stringify([o.id, esc(o.name)])}'>✏️</button>
        <button class="btn-icon" title="${t('tooltip_liquidate')}" data-action="showLiquidateOrgModal" data-args='${JSON.stringify([o.id, esc(o.name)])}'>🗑</button>
        ` : ''}
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="section-title" style="margin:0">${t('orgs_title')}</div>
        <div style="display:flex;gap:8px;align-items:center">
          <label style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer">
            <input type="checkbox" ${_showLiquidatedOrgs?'checked':''} data-onchange-action="_onToggleShowLiquidatedOrgs">
            ${t('lbl_show_archive')}
          </label>
          <button class="btn btn-primary btn-sm" data-action="showCreateOrgModal">${t('btn_add')}</button>
        </div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>${t('th_name')}</th><th>${t('th_code')}</th><th>${t('th_inv_rules')}</th><th>${t('th_status')}</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" style="color:var(--muted);text-align:center">${t('msg_no_data')}</td></tr>`}</tbody>
        </table>
      </div>
      ${liquidated.length && !_showLiquidatedOrgs ? `<div style="padding:8px 0 0;font-size:12px;color:var(--muted)">${t('msg_n_liquidated_hidden', { n: liquidated.length })}</div>` : ''}
    </div>`;
}

// ── Вкладка: Филиалы ──────────────────────────────────────────────────────────
let _showClosedFilials = false;

function _renderFilialsPanel() {
  const active = _filialsCache.filter(f => f.status !== 'closed');
  const closed = _filialsCache.filter(f => f.status === 'closed');
  const visible = _showClosedFilials ? [...active, ...closed] : active;

  const rows = visible.map(f => {
    const isClosed = f.status === 'closed';
    return `<tr style="${isClosed ? 'opacity:0.5' : ''}">
      <td><b>${esc(f.name)}</b>${isClosed ? ` <span style="font-size:11px;color:var(--muted)">${t('lbl_closed_suffix')}</span>` : ''}</td>
      <td style="color:var(--muted);font-size:12px">${esc(f.address||'—')}</td>
      <td><span class="badge-s ${f.status==='active'?'s-used':'s-off'}">${f.status}</span></td>
      <td style="white-space:nowrap">
        ${!isClosed ? `<button class="btn-icon" title="${t('tooltip_edit')}" data-action="showEditFilialModal" data-args='${JSON.stringify([f.id, esc(f.name), esc(f.address||"")])}'>✏️</button>` : ''}
        ${f.status==='active' ? `<button class="btn-icon" title="${t('tooltip_close')}" data-action="closeFilial" data-args='${JSON.stringify([f.id, esc(f.name)])}'>🔒</button>` : ''}
        <button class="btn-icon" title="${t('tooltip_locations')}" data-action="_goToFilialLocations" data-args='${JSON.stringify([f.id])}'>📍</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="section-title" style="margin:0">${t('filials_title')}</div>
        <div style="display:flex;gap:8px;align-items:center">
          <label style="font-size:13px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer">
            <input type="checkbox" ${_showClosedFilials?'checked':''} data-onchange-action="_onToggleShowClosedFilials">
            ${t('lbl_show_closed')}
          </label>
          <button class="btn btn-primary btn-sm" data-action="showCreateFilialModal">${t('btn_add')}</button>
        </div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>${t('th_name')}</th><th>${t('th_address')}</th><th>${t('th_status')}</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" style="color:var(--muted);text-align:center">${t('msg_no_data')}</td></tr>`}</tbody>
        </table>
      </div>
      ${closed.length && !_showClosedFilials ? `<div style="padding:8px 0 0;font-size:12px;color:var(--muted)">${t('msg_n_closed_hidden', { n: closed.length })}</div>` : ''}
    </div>`;
}

// ── Вкладка: Локации ──────────────────────────────────────────────────────────
let _locFilterFilial = '';
function _renderLocationsPanel() { return _renderLocationsFiltered(); }
function _renderLocationsFiltered() {
  const panel = document.getElementById('settings-panel');
  const filtered = _locFilterFilial
    ? _locsCache.filter(l => l.filial_id === _locFilterFilial)
    : _locsCache;

  const filialOptions = [{ id:'', name:t('lbl_all_filials') }, ..._filialsCache]
    .map(f => `<option value="${f.id}" ${f.id===_locFilterFilial?'selected':''}>${esc(f.name)}</option>`).join('');

  const rows = filtered.map(l => {
    const fil = _filialsCache.find(f => f.id === l.filial_id);
    return `<tr>
      <td><b>${esc(l.name)}</b></td>
      <td style="color:var(--muted);font-size:12px">${esc(fil?.name||'—')}</td>
      <td><span class="badge-cat">${esc(l.type||'office')}</span></td>
      <td><span class="badge-s ${l.status==='active'?'s-used':'s-off'}">${l.status}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-icon" title="${t('tooltip_edit')}" data-action="showEditLocationModal" data-args='${JSON.stringify([l.id, esc(l.name), l.filial_id, l.type||"office"])}'>✏️</button>
        ${l.status==='active'?`<button class="btn-icon" title="${t('tooltip_close')}" data-action="closeLocation" data-args='${JSON.stringify([l.id, esc(l.name)])}'>🔒</button>`:''}
      </td>
    </tr>`;
  }).join('');

  const html = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div class="section-title" style="margin:0">${t('locations_title')}</div>
        <div style="display:flex;gap:7px;align-items:center">
          <select style="font-size:13px" data-onchange-action="_onLocFilterFilialChange">${filialOptions}</select>
          <button class="btn btn-primary btn-sm" data-action="showCreateLocationModal">${t('btn_add')}</button>
        </div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>${t('th_name')}</th><th>${t('th_filial')}</th><th>${t('th_type')}</th><th>${t('th_status')}</th><th></th></tr></thead>
          <tbody>${rows||`<tr><td colspan="5" style="color:var(--muted);text-align:center">${t('msg_no_data')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  if (panel) panel.innerHTML = html;
  return html;
}


// ── CRUD: Организации ─────────────────────────────────────────────────────────
function showCreateOrgModal() {
  showModal(`<h2>${t('modal_new_org_title')}</h2>
    <div class="form-row"><label>${t('field_name_required')}</label><input id="co-name" placeholder="${t('msg_new_org_name_placeholder2')}"/></div>
    <div class="form-row"><label>${t('field_code_short')}</label>
      <input id="co-code" placeholder="${t('msg_code_placeholder')}" maxlength="8" style="text-transform:uppercase"
        data-oninput-action="forceUppercase"/>
      <div style="font-size:11px;color:var(--muted);margin-top:3px">
        ${t('msg_code_hint')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doCreateOrg">${t('btn_create')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doCreateOrg() {
  const name = document.getElementById('co-name').value.trim();
  const short_code = document.getElementById('co-code').value.trim().toUpperCase();
  if (!name || !short_code) return toast(t('msg_fill_all_fields'),'error');
  const r = await fetch(`${API}/api/orgs`, { method:'POST', headers:ah(), body:JSON.stringify({ name, short_code }) });
  const d = await r.json();
  if (r.ok) { closeModal(); toast(t('msg_org_created'),'success'); await renderSettings(); }
  else toast(d.error||t('msg_error'),'error');
}

function showRenameOrgModal(id, currentName) {
  showModal(`<h2>${t('modal_rename_org_title')}</h2>
    <div style="font-size:13px;color:var(--muted);margin-bottom:14px">
      ${t('lbl_current_name')}: <b>${esc(currentName)}</b><br>
      <span style="font-size:12px">${t('msg_history_snapshot_note')}</span>
    </div>
    <div class="form-row"><label>${t('field_new_name_required')}</label>
      <input id="rn-name" value="${esc(currentName)}"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doRenameOrg" data-args='${JSON.stringify([id])}'>${t('btn_rename')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doRenameOrg(id) {
  const newName = document.getElementById('rn-name').value.trim();
  if (!newName) return toast(t('msg_enter_name'),'error');
  const r = await fetch(`${API}/api/orgs/${id}/rename`, { method:'POST', headers:ah(), body:JSON.stringify({ newName }) });
  const d = await r.json();
  if (r.ok) { closeModal(); toast(t('msg_renamed_history'),'success'); await renderSettings(); }
  else toast(d.error||t('msg_error'),'error');
}

function showLiquidateOrgModal(id, name) {
  const liqOrg = _orgsCache.find(o => o.id === id);
  const opts = _orgsCache.filter(o => o.id !== id && o.status === 'active')
    .map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  showModal(`<h2>${t('modal_liquidate_org_title')}</h2>
    <div style="background:var(--noInv-bg);border:1px solid var(--danger-border);border-radius:8px;padding:11px;margin-bottom:14px;font-size:13px;color:var(--danger-text)">
      ${t('msg_liquidate_warning', { name: esc(name) })}
    </div>
    <div class="form-row"><label>${t('field_transfer_assets_to')}</label>
      <select id="lq-target" data-onchange-action="_lqTargetChange" data-onchange-args='${JSON.stringify([id])}'>
        <option value="">${t('msg_choose_existing')}</option>
        ${opts}
        <option value="__new__">${t('msg_create_new_org')}</option>
      </select>
    </div>
    <div id="lq-new-fields" style="display:none">
      <div class="form-row"><label>${t('field_new_org_name_required')}</label>
        <input id="lq-new-name" placeholder="${t('msg_new_org_name_placeholder')}"/></div>
      <div class="form-row"><label>${t('field_short_code_required')}</label>
        <input id="lq-new-code" placeholder="${t('msg_short_code_placeholder')}" style="text-transform:uppercase"
          data-oninput-action="forceUppercase"/>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">
          ${t('msg_rules_copied_note')}
        </div></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" data-action="doLiquidateOrg" data-args='${JSON.stringify([id])}'>${t('btn_liquidate')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
function _lqTargetChange(liqId) {
  const val = document.getElementById('lq-target').value;
  document.getElementById('lq-new-fields').style.display = val === '__new__' ? '' : 'none';
}
async function doLiquidateOrg(id) {
  const targetVal = document.getElementById('lq-target').value;
  if (!targetVal) return toast(t('msg_select_org'),'error');

  let targetOrgId = targetVal;

  if (targetVal === '__new__') {
    // Создаём новую орг на сервере, потом переносим
    const newName = document.getElementById('lq-new-name').value.trim();
    const newCode = document.getElementById('lq-new-code').value.trim().toUpperCase();
    if (!newName) return toast(t('msg_enter_new_org_name'),'error');
    if (!newCode || newCode.length < 2) return toast(t('msg_enter_code_min2'),'error');

    // Create org with inherited rules
    const liqOrg = _orgsCache.find(o => o.id === id);
    const inheritedRules = (liqOrg?.inv_rules || []).map(r => ({...r, counter: 0}));
    const cr = await fetch(`${API}/api/orgs`, { method:'POST', headers:ah(),
      body:JSON.stringify({ name:newName, short_code:newCode, inv_rules:inheritedRules }) });
    const cd = await cr.json();
    if (!cr.ok) return toast(cd.error||t('msg_org_create_error'),'error');
    targetOrgId = cd.id;
    // Refresh cache so liquidate can find new org
    _orgsCache = await fetch(`${API}/api/orgs`).then(r=>r.json()).catch(()=>_orgsCache);
  }

  const r = await fetch(`${API}/api/orgs/${id}/liquidate`, {
    method:'POST', headers:ah(),
    body:JSON.stringify({ targetOrgId, renumberInv: targetVal === '__new__' })
  });
  const d = await r.json();
  if (r.ok) {
    closeModal();
    toast(t('msg_transferred_stats', {
      n: d.transferred,
      renumbered: d.renumbered ? t('msg_renumbered_suffix', { n: d.renumbered }) : ''
    }),'success');
    _refDataLoaded = false;
    await renderSettings();
  } else toast(d.error||t('msg_error'),'error');
}

function showInvRulesModal(orgId) {
  const org = _orgsCache.find(o => o.id === orgId);
  if (!org) return;
  const rules = org.inv_rules || [];
  const rulesHtml = rules.length
    ? `<table style="width:100%;font-size:13px;margin-bottom:14px">
        <thead><tr><th>${t('th_code')}</th><th>${t('th_name')}</th><th>${t('th_counter')}</th><th>${t('th_format')}</th><th style="text-align:center">${t('th_status')}</th><th></th></tr></thead>
        <tbody>${rules.map(r => `<tr id="ir-row-${r.type_code}">
          <td><code>${esc(r.type_code)}</code></td>
          <td id="ir-name-${r.type_code}" data-ondblclick-action="startRenameInvRule" data-ondblclick-args='${JSON.stringify([orgId, r.type_code, esc(r.type_name)])}' style="cursor:text" title="${t('tooltip_rename_dblclick')}">${esc(r.type_name)}</td>
          <td style="color:var(--muted);text-align:center">${r.counter}</td>
          <td style="font-size:11px;color:var(--muted)">${esc(r.format)}</td>
          <td style="text-align:center"><span class="badge-s ${r.active!==false?'s-used':'s-off'}" style="cursor:pointer"
            data-action="toggleInvRule" data-args='${JSON.stringify([orgId, r.type_code, r.active===false])}'>${r.active!==false?t('lbl_rule_active'):t('lbl_rule_off')}</span></td>
          <td style="text-align:right"><button class="btn-icon" title="${t('tooltip_delete_rule')}" data-action="deleteInvRule" data-args='${JSON.stringify([orgId, r.type_code])}'>🗑</button></td>
        </tr>`).join('')}</tbody>
      </table>`
    : `<div style="color:var(--muted);font-size:13px;margin-bottom:14px">${t('msg_no_rules')}</div>`;

  showModal(`<h2>${t('modal_inv_rules_title', { org: esc(org.name) })}</h2>
    ${rulesHtml}
    <hr class="sep"/>
    <div class="section-title" style="font-size:13px">${t('lbl_add_rule')}</div>
    <div class="two-col">
      <div class="form-row"><label>${t('field_type_code_required')}</label>
        <input id="ir-code" placeholder="NB" maxlength="5" data-oninput-action="forceUppercase"/></div>
      <div class="form-row"><label>${t('field_type_name_required')}</label>
        <input id="ir-name" placeholder="${t('msg_type_name_placeholder')}"/></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doAddInvRule" data-args='${JSON.stringify([orgId])}'>${t('btn_add')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_close')}</button>
    </div>`);
}
async function doAddInvRule(orgId) {
  const type_code = document.getElementById('ir-code').value.trim().toUpperCase();
  const type_name = document.getElementById('ir-name').value.trim();
  if (!type_code || !type_name) return toast(t('msg_fill_code_and_name'),'error');
  const r = await fetch(`${API}/api/orgs/${orgId}/inv-rules`, { method:'POST', headers:ah(), body:JSON.stringify({ type_code, type_name }) });
  const d = await r.json();
  if (r.ok) { toast(t('msg_rule_added'),'success'); _orgsCache = await fetch(`${API}/api/orgs`).then(r=>r.json()); showInvRulesModal(orgId); }
  else toast(d.error||t('msg_error'),'error');
}
async function toggleInvRule(orgId, typeCode, newActive) {
  await fetch(`${API}/api/orgs/${orgId}/inv-rules/${typeCode}`, { method:'PATCH', headers:ah(), body:JSON.stringify({ active: newActive }) });
  _orgsCache = await fetch(`${API}/api/orgs`).then(r=>r.json());
  showInvRulesModal(orgId);
}
// Было onkeydown="if(event.key==='Enter')doRenameInvRule(...);if(event.key==='Escape')showInvRulesModal(...)"
function _onInvRuleRenameKeydown(orgId, typeCode, key) {
  if (key === 'Enter') doRenameInvRule(orgId, typeCode);
  if (key === 'Escape') showInvRulesModal(orgId);
}

function startRenameInvRule(orgId, typeCode, currentName) {
  const cell = document.getElementById(`ir-name-${typeCode}`);
  if (!cell) return;
  cell.innerHTML = `<input id="ir-rename-${typeCode}" value="${esc(currentName)}" style="width:100%;font-size:13px;padding:2px 4px"
    data-onkeydown-action="_onInvRuleRenameKeydown" data-onkeydown-args='${JSON.stringify([orgId, typeCode])}'/>`;
  const inp = document.getElementById(`ir-rename-${typeCode}`);
  inp.focus(); inp.select();
}
async function doRenameInvRule(orgId, typeCode) {
  const inp = document.getElementById(`ir-rename-${typeCode}`);
  if (!inp) return;
  const type_name = inp.value.trim();
  if (!type_name) return toast(t('msg_name_cant_be_empty'),'error');
  const r = await fetch(`${API}/api/orgs/${orgId}/inv-rules/${typeCode}`, { method:'PUT', headers:ah(), body:JSON.stringify({ type_name }) });
  const d = await r.json();
  if (r.ok) { toast(t('msg_renamed'),'success'); _orgsCache = await fetch(`${API}/api/orgs`).then(r=>r.json()); showInvRulesModal(orgId); }
  else toast(d.error||t('msg_error'),'error');
}
async function deleteInvRule(orgId, typeCode, counter) {
  const r = await fetch(`${API}/api/orgs/${orgId}/inv-rules/${typeCode}`, { method:'DELETE', headers:ah() });
  const d = await r.json();
  if (!r.ok) return toast(d.error||t('msg_error'),'error');
  if (d.ok) {
    toast(t('msg_rule_deleted'),'success');
    _orgsCache = await fetch(`${API}/api/orgs`).then(r=>r.json());
    showInvRulesModal(orgId);
    return;
  }
  if (d.conflict) {
    showDeleteInvRuleConflict(orgId, typeCode, d);
  }
}
function showDeleteInvRuleConflict(orgId, typeCode, info) {
  const org = _orgsCache.find(o => o.id === orgId);
  const otherRules = (org.inv_rules||[]).filter(r => r.type_code !== typeCode && r.active !== false);
  const transferOptions = otherRules.map(r =>
    `<option value="${esc(r.type_code)}">${esc(r.type_code)} — ${esc(r.type_name)}</option>`
  ).join('');
  showModal(`<h2>${t('modal_delete_rule_title', { code: esc(typeCode) })}</h2>
    <p style="font-size:14px;margin-bottom:16px">
      ${t('msg_assets_have_prefix', { count: info.count, prefix: esc(info.prefix) })}<br>
      ${t('msg_choose_what_to_do')}
    </p>
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
        <input type="radio" name="del-action" value="reset" checked/>
        <span>${t('lbl_reset_inv_numbers')}</span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;${transferOptions ? '' : 'opacity:.4;pointer-events:none'}">
        <input type="radio" name="del-action" value="transfer" ${transferOptions ? '' : 'disabled'}/>
        <span>
          ${t('lbl_transfer_to_other_rule')}<br>
          ${transferOptions
            ? `<select id="del-target" style="margin-top:6px;font-size:13px">${transferOptions}</select>`
            : `<span style="font-size:12px;color:var(--muted)">${t('msg_no_other_active_rules')}</span>`}
        </span>
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" data-action="doDeleteInvRuleForce" data-args='${JSON.stringify([orgId, typeCode])}'>${t('btn_delete_and_apply')}</button>
      <button class="btn btn-secondary" data-action="showInvRulesModal" data-args='${JSON.stringify([orgId])}'>${t('btn_cancel')}</button>
    </div>`);
}
async function doDeleteInvRuleForce(orgId, typeCode) {
  const action = document.querySelector('input[name="del-action"]:checked')?.value;
  if (!action) return toast(t('msg_choose_action'),'error');
  const targetEl = document.getElementById('del-target');
  const targetTypeCode = (action === 'transfer' && targetEl) ? targetEl.value : undefined;
  if (action === 'transfer' && !targetTypeCode) return toast(t('msg_choose_target_rule'),'error');
  const r = await fetch(`${API}/api/orgs/${orgId}/inv-rules/${typeCode}/delete-force`,
    { method:'POST', headers:ah(), body:JSON.stringify({ action, targetTypeCode }) });
  const d = await r.json();
  if (r.ok) {
    toast(t('msg_rule_deleted'),'success');
    _orgsCache = await fetch(`${API}/api/orgs`).then(r=>r.json());
    showInvRulesModal(orgId);
  } else toast(d.error||t('msg_error'),'error');
}

// ── CRUD: Филиалы ─────────────────────────────────────────────────────────────
function showCreateFilialModal() {
  showModal(`<h2>${t('modal_new_filial_title')}</h2>
    <div class="form-row"><label>${t('field_name_required')}</label><input id="cf-name" placeholder="${t('msg_filial_name_placeholder')}"/></div>
    <div class="form-row"><label>${t('field_address')}</label><input id="cf-addr" placeholder="${t('msg_filial_address_placeholder')}"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doCreateFilial">${t('btn_create')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doCreateFilial() {
  const name = document.getElementById('cf-name').value.trim();
  const address = document.getElementById('cf-addr').value.trim();
  if (!name) return toast(t('msg_enter_name'),'error');
  const r = await fetch(`${API}/api/filials`, { method:'POST', headers:ah(), body:JSON.stringify({ name, address }) });
  const d = await r.json();
  if (r.ok) { closeModal(); toast(t('msg_filial_created'),'success'); await renderSettings(); }
  else toast(d.error||t('msg_error'),'error');
}
function showEditFilialModal(id, name, address) {
  showModal(`<h2>${t('modal_edit_filial_title')}</h2>
    <div class="form-row"><label>${t('field_name')}</label><input id="ef-name" value="${esc(name)}"/></div>
    <div class="form-row"><label>${t('field_address')}</label><input id="ef-addr" value="${esc(address)}"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doUpdateFilial" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doUpdateFilial(id) {
  const name = document.getElementById('ef-name').value.trim();
  const address = document.getElementById('ef-addr').value.trim();
  const r = await fetch(`${API}/api/filials/${id}`, { method:'PUT', headers:ah(), body:JSON.stringify({ name, address }) });
  if (r.ok) { closeModal(); toast(t('msg_saved'),'success'); await renderSettings(); }
  else toast(t('msg_error'),'error');
}
async function closeFilial(id, name) {
  if (!confirm(t('msg_confirm_close_filial', { name }))) return;
  const r = await fetch(`${API}/api/filials/${id}/close`, { method:'POST', headers:ah(), body:'{}' });
  const d = await r.json();
  if (r.ok) { toast(t('msg_closed_affected', { n: d.affected_assets }),'success'); await renderSettings(); }
  else toast(d.error||t('msg_error'),'error');
}

// ── CRUD: Локации ─────────────────────────────────────────────────────────────
function showCreateLocationModal() {
  const opts = _filialsCache.filter(f=>f.status==='active')
    .map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('');
  showModal(`<h2>${t('modal_new_location_title')}</h2>
    <div class="form-row"><label>${t('field_name_required')}</label><input id="cl-name" placeholder="${t('msg_location_name_placeholder')}"/></div>
    <div class="form-row"><label>${t('field_filial_required')}</label><select id="cl-filial">${opts}</select></div>
    <div class="form-row"><label>${t('field_type')}</label>
      <select id="cl-type">
        <option value="office">${t('loc_type_office')}</option>
        <option value="warehouse">${t('loc_type_warehouse')}</option>
        <option value="server_room">${t('loc_type_server_room')}</option>
        <option value="other">${t('loc_type_other')}</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doCreateLocation">${t('btn_create')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doCreateLocation() {
  const name = document.getElementById('cl-name').value.trim();
  const filial_id = document.getElementById('cl-filial').value;
  const type = document.getElementById('cl-type').value;
  if (!name || !filial_id) return toast(t('msg_fill_all_fields'),'error');
  const r = await fetch(`${API}/api/locations`, { method:'POST', headers:ah(), body:JSON.stringify({ name, filial_id, type }) });
  const d = await r.json();
  if (r.ok) { closeModal(); toast(t('msg_location_created'),'success'); await renderSettings(); }
  else toast(d.error||t('msg_error'),'error');
}
function showEditLocationModal(id, name, filialId, type) {
  const opts = _filialsCache.map(f=>`<option value="${f.id}" ${f.id===filialId?'selected':''}>${esc(f.name)}</option>`).join('');
  const typeLabels = { office:t('loc_type_office'), warehouse:t('loc_type_warehouse'), server_room:t('loc_type_server_room'), other:t('loc_type_other') };
  showModal(`<h2>${t('modal_edit_location_title')}</h2>
    <div class="form-row"><label>${t('field_name')}</label><input id="el-name" value="${esc(name)}"/></div>
    <div class="form-row"><label>${t('field_filial')}</label><select id="el-filial">${opts}</select></div>
    <div class="form-row"><label>${t('field_type')}</label>
      <select id="el-type">
        ${['office','warehouse','server_room','other'].map(ty=>`<option value="${ty}" ${ty===type?'selected':''}>${typeLabels[ty]}</option>`).join('')}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doUpdateLocation" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doUpdateLocation(id) {
  const name = document.getElementById('el-name').value.trim();
  const filial_id = document.getElementById('el-filial').value;
  const type = document.getElementById('el-type').value;
  const r = await fetch(`${API}/api/locations/${id}`, { method:'PUT', headers:ah(), body:JSON.stringify({ name, filial_id, type }) });
  if (r.ok) { closeModal(); toast(t('msg_saved'),'success'); await renderSettings(); }
  else toast(t('msg_error'),'error');
}
async function closeLocation(id, name) {
  if (!confirm(t('msg_confirm_close_location', { name }))) return;
  const r = await fetch(`${API}/api/locations/${id}/close`, { method:'POST', headers:ah(), body:'{}' });
  if (r.ok) { toast(t('msg_closed'),'success'); await renderSettings(); }
  else toast(t('msg_error'),'error');
}
