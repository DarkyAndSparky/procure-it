/**
 * public/js/views/types-admin.js
 *
 * Фаза 5, шаг 21: редактор справочника "Типы устройств" (вкладка
 * настроек), вынесенный из public/index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 *
 * _renderTypesPanel() вызывается из renderSettings() (пока в index.html)
 * как внешний глобал.
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js). TAB_OPTIONS
 * генерируется функцией _tabOptions(), а не константой на верхнем уровне —
 * нужно чтобы t() успел резолвиться в актуальном языке при каждом вызове
 * (переключение языка меняет _lang в рантайме, статичная константа бы
 * "заморозила" подписи на языке при первой загрузке скрипта).
 */

// ─── ТИПЫ УСТРОЙСТВ ──────────────────────────────────────────────────────────
function _tabOptions() {
  return [
    {v:'os',    l:t('nav_os')},
    {v:'small', l:t('nav_small')},
    {v:'infra', l:t('nav_infra')},
  ];
}
const TAB_COLORS = {os:'#3b82f6',small:'#8b5cf6',infra:'#10b981'};
function _tabLabelsShort() {
  return {os:t('tab_os'), small:t('tab_small'), infra:t('tab_infra')};
}

async function _renderTypesPanel() {
  let types = [];
  try { types = await fetch(`${API}/api/type-codes`).then(r=>r.json()); } catch(e){}
  _typesBuffer = types;

  const tabOptions = _tabOptions();
  const rows = types.map((ty,i) => {
    const tabSel = tabOptions.map(o =>
      `<option value="${o.v}" ${(ty.tab||'os')===o.v?'selected':''}>${o.l}</option>`
    ).join('');
    return `
    <tr>
      <td><code style="font-size:12px;color:var(--indigo)">${esc(ty.code)}</code></td>
      <td><input value="${esc(ty.name)}"
        style="width:100%;font-size:13px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface)"
        data-onchange-action="updateTypeCode" data-onchange-args='${JSON.stringify([i, 'name'])}'/></td>
      <td>
        <select style="font-size:13px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:${TAB_COLORS[ty.tab||'os']}"
          data-onchange-action="updateTypeCode" data-onchange-args='${JSON.stringify([i, 'tab'])}'>
          ${tabSel}
        </select>
      </td>
      <td style="text-align:center">
        <button class="btn-icon" title="${t('tooltip_delete')}" data-action="deleteTypeCode" data-args='${JSON.stringify([i])}'>🗑</button>
      </td>
    </tr>`;
  }).join('');

  const tabLabelsShort = _tabLabelsShort();
  const summary = ['os','small','infra'].map(tab => {
    const n = types.filter(ty=>(ty.tab||'os')===tab).length;
    return `<span style="color:${TAB_COLORS[tab]};font-weight:600">${tabLabelsShort[tab]}: ${n}</span>`;
  }).join(' &nbsp;·&nbsp; ');

  return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="section-title" style="margin:0">${t('types_title')}</div>
        <button class="btn btn-primary btn-sm" data-action="showAddTypeModal">${t('btn_add')}</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;line-height:1.6">
        ${t('types_hint')}
      </div>
      <div style="font-size:12px;margin-bottom:12px;padding:8px 10px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">
        ${t('lbl_distribution')}: ${summary}
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>${t('th_code')}</th><th>${t('th_type_name')}</th><th>${t('th_collection')}</th><th></th></tr></thead>
          <tbody>${rows||`<tr><td colspan="4" style="color:var(--muted);text-align:center">${t('msg_no_types')}</td></tr>`}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary btn-sm" data-action="saveTypeCodes">${t('btn_save_icon')}</button>
        <span style="font-size:11px;color:var(--muted)">${t('msg_changes_next_import')}</span>
      </div>
    </div>`;
}

let _typesBuffer = null;

async function _loadTypesBuffer() {
  if (!_typesBuffer) {
    _typesBuffer = await fetch(`${API}/api/type-codes`).then(r=>r.json()).catch(()=>[]);
  }
  return _typesBuffer;
}

function updateTypeCode(idx, field, value) {
  if (!_typesBuffer) return;
  _typesBuffer[idx][field] = value;
  // При делегировании через data-onchange-action this === элемент (fn.apply(el, args)).
  // Раньше это был отдельный inline-обработчик onchange рядом с onclick, теперь —
  // побочный эффект прямо здесь: подсвечиваем select цветом выбранной вкладки.
  if (field === 'tab' && this && this.style) this.style.color = TAB_COLORS[value] || 'inherit';
}

async function deleteTypeCode(idx) {
  const types = await _loadTypesBuffer();
  const ty = types[idx];
  if (!confirm(t('confirm_delete_type', { name: ty.name, code: ty.code }))) return;
  _typesBuffer.splice(idx, 1);
  const panel = document.getElementById('settings-panel');
  if (panel) panel.innerHTML = await _renderTypesPanel();
}

function showAddTypeModal() {
  const opts = _tabOptions().map(o=>`<option value="${o.v}">${o.l}</option>`).join('');
  showModal(`<h2>${t('modal_new_type_title')}</h2>
    <div class="form-row"><label>${t('field_code_hint')}</label>
      <input id="at-code" placeholder="NB" maxlength="5"
        style="text-transform:uppercase" data-oninput-action="forceUppercase"/></div>
    <div class="form-row"><label>${t('field_type_name_required')}</label>
      <input id="at-name" placeholder="${t('msg_type_name_placeholder')}"/></div>
    <div class="form-row"><label>${t('field_collection_required')}</label>
      <select id="at-tab">${opts}</select></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doAddTypeCode">${t('btn_add')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}

async function doAddTypeCode() {
  const code = document.getElementById('at-code')?.value.trim().toUpperCase();
  const name = document.getElementById('at-name')?.value.trim();
  const tab  = document.getElementById('at-tab')?.value || 'os';
  if (!code || !name) return toast(t('msg_fill_all_fields'), 'error');
  const types = await _loadTypesBuffer();
  if (types.find(ty => ty.code === code)) return toast(t('msg_code_exists', { code }), 'error');
  _typesBuffer.push({ code, name, tab });
  closeModal();
  const panel = document.getElementById('settings-panel');
  if (panel) panel.innerHTML = await _renderTypesPanel();
}

async function saveTypeCodes() {
  if (!_typesBuffer) return toast(t('msg_no_data'), 'error');
  const r = await fetch(`${API}/api/type-codes`, {
    method: 'PUT', headers: ah(),
    body: JSON.stringify({ codes: _typesBuffer })
  });
  const d = await r.json();
  if (r.ok) {
    toast(t('msg_types_saved'), 'success');
    _typesBuffer = null; // сбрасываем кэш
  } else toast(d.error || t('msg_error'), 'error');
}
