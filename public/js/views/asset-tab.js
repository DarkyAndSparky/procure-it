/**
 * public/js/views/asset-tab.js
 *
 * Фаза 5, шаг 13: реестр активов (самый используемый экран) + редактор
 * категорий, вынесенные из public/index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 *
 * thSort/setSort — сюда же, используются исключительно этим экраном.
 * _orgsCache/_filialsCache/_locsCache/ensureRefData() НЕ перенесены —
 * они используются ещё и в renderSettings (управление организациями/
 * филиалами/локациями), остаются общими глобалами в index.html.
 */

// ─── Фаза 6: обёртки для составных onclick/onchange реестра активов ────────────
// (были прямые присваивания глобальных фильтров + вызов renderAssetTab в одном
// inline-обработчике — data-action поддерживает только один вызов функции)

function _selectCategory(tab, val) { currentCat = val; renderAssetTab(tab); }

// this.value ПЕРВЫМ аргументом (не последним, как в стандартной конвенции) —
// wrapper читает this.value напрямую.
function _onAssetSearchInput(tab) { onSearchInput(this.value, tab); }

function _onOrgFilterChange(tab) { fOrg = this.value; fFilial = 'Все'; renderAssetTab(tab); }
function _onFilialFilterChange(tab) { fFilial = this.value; renderAssetTab(tab); }
function _onStatusFilterChange(tab) { fStatus = this.value; renderAssetTab(tab); }

function _resetAssetFilters(tab) {
  searchVal=''; fOrg='Все'; fFilial='Все'; fStatus='Все'; sortCol=''; sortDir=1;
  renderAssetTab(tab);
}

// this.checked, не this.value — отдельные обёртки для чекбоксов.
function _onSelectAllChange(tab) { toggleSelectAll(this.checked, tab); }
function _onSelectOneChange(id, tab) { toggleSelectOne(id, this.checked, tab); }

// Было data-action="_removeParentElement" — самоудаление тега категории.
function _removeParentElement() { this.parentElement.remove(); }

// this.value первым, orgsWithRules — статичный массив, вычисленный на момент
// рендера (можно сериализовать целиком в data-args).
function _onBulkInvOrgChange(orgsWithRules) { _updateInvTypeOpts(this.value, orgsWithRules); }

// Было onkeydown="if(event.key==='Enter')addTag('${tab}')"
function _onNewCatKeydown(tab, key) { if (key === 'Enter') addTag(tab); }

async function renderAssetTab(tab) {
  if (!_orgsCache.length) await ensureRefData();
  const app=document.getElementById('app');
  const cats=catsCache[tab]||[];
  const params=new URLSearchParams({tab});
  if (currentCat&&currentCat!=='Все') params.set('category',currentCat);
  if (fOrg!=='Все') params.set('org',fOrg);
  if (fFilial!=='Все') params.set('filial',fFilial);
  if (fStatus!=='Все') params.set('status',fStatus);
  if (searchVal) params.set('search',searchVal);
  app.innerHTML='<div class="spinner"></div>';
  const _resp=await fetch(`${API}/api/assets?${params}`, { headers: ah() }).then(r=>r.json());
  const assets = Array.isArray(_resp) ? _resp : (_resp.items || []);
  const totalAssets = _resp.total ?? assets.length;
  const totalPages  = _resp.pages ?? 1;
  assetsCache=assets;
  document.getElementById('total-badge').textContent=totalAssets+' '+t('unit_items');
  // Словарь org_id → name для отображения в таблице
  const _orgMap = Object.fromEntries((_orgsCache||[]).map(o=>[o.id, o.name]));
  // Орг — из справочника (не из отфильтрованных ассетов!) чтобы dropdown не урезался
  const _allOrgs=['Все',...(_orgsCache.length
    ? _orgsCache.filter(o=>o.status==='active'&&!o.system).map(o=>o.name)
    : [...new Set(assets.map(a=>a.org||'').filter(Boolean))]
  )].sort((a,b)=>a==='Все'?-1:b==='Все'?1:a.localeCompare(b,'ru'));
  // Филиалы — из справочника (как орги), чтобы фильтр не урезался по текущей странице
  const filials = ['Все', ...(_filialsCache.length
    ? _filialsCache.filter(f => f.status !== 'closed').map(f => f.name)
    : [...new Set(assets.map(a => a.filial).filter(Boolean))]
  )].sort((a,b) => a==='Все'?-1 : b==='Все'?1 : a.localeCompare(b,'ru'));
  // Сортировка
  if (sortCol) {
    assets.sort((a, b) => {
      const getVal = (obj, col) => {
        if (col === 'filial') return ((obj.filial||'') + ' ' + (obj.location||'')).toLowerCase();
        if (col === 'org') return (_orgMap[obj.org_id] || obj.org || '').toLowerCase();
        return (obj[col]||'').toString().toLowerCase();
      };
      const av = getVal(a, sortCol), bv = getVal(b, sortCol);
      if (sortCol === 'inv') {
        const numA = parseInt((av.match(/\d+$/) || ['0'])[0]);
        const numB = parseInt((bv.match(/\d+$/) || ['0'])[0]);
        if (!isNaN(numA) && !isNaN(numB)) return (numA - numB) * sortDir;
      }
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
  }
  const showMeta = tab==='infra';

  app.innerHTML=`
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div style="font-size:16px;font-weight:700">${tabLabel(tab)}
      <span style="color:var(--muted);font-weight:400;font-size:13px">(${assets.length})</span>
    </div>
    <div style="display:flex;gap:6px">
      ${canEdit()?`<button class="btn btn-secondary btn-sm" data-action="showCatEditor" data-args='${JSON.stringify([tab])}' title="${t('tooltip_categories')}">📂 ${t('btn_categories')}</button>`:''}
      <button class="btn btn-secondary btn-sm" data-action="downloadWithAuth" data-args='${JSON.stringify([`${API}/api/export/csv?tab=${tab}`, `IT_assets_${tab}.csv`])}'>⬇ CSV</button>
      ${canEdit()?`<button class="btn btn-primary btn-sm" data-action="showAddModal" data-args='${JSON.stringify([tab])}'>${t('btn_add')}</button>`:''}
    </div>
  </div>
  <div class="cat-tabs">
    ${['Все',...cats].map(c=>{const val=c==='Все'?'':c;return `<div class="cat-tab ${(currentCat||'Все')===c?'active':''}" data-action="_selectCategory" data-args='${JSON.stringify([tab, val])}'>${c==='Все'?t('lbl_all'):c}</div>`;}).join('')}
  </div>
  ${canEdit() && selectedIds.size > 0 ? `
  <div style="display:flex;align-items:center;gap:8px;padding:9px 14px;
    background:var(--accent-dim,var(--surface2));border:1px solid var(--accent);
    border-radius:10px;margin-bottom:10px;flex-wrap:wrap">
    <span style="font-size:13px;font-weight:700;color:var(--accent)">☑ ${t('lbl_selected')}: ${selectedIds.size}</span>
    <button class="btn btn-primary btn-sm" data-action="showBulkMoveModal" data-args='${JSON.stringify([tab])}'>→ ${t('btn_move')}</button>
    <button class="btn btn-secondary btn-sm" data-action="showBulkInvModal" data-args='${JSON.stringify([tab])}'>🏷 ${t('field_inv')}</button>
    <button class="btn btn-danger btn-sm" data-action="showBulkRetireModal" data-args='${JSON.stringify([tab])}'>🗑 ${t('btn_retire')}</button>
    <button class="btn btn-ghost btn-sm" data-action="clearSelection" data-args='${JSON.stringify([tab])}'>✕ ${t('btn_clear_selection')}</button>
  </div>` : ''}
  <div class="card" style="margin-bottom:0">
    <div class="filters">
      <input class="search-inp" type="text" placeholder="🔍 ${t('msg_search')}" value="${esc(searchVal)}"
        data-oninput-action="_onAssetSearchInput" data-oninput-args='${JSON.stringify([tab])}'/>
      <select data-onchange-action="_onOrgFilterChange" data-onchange-args='${JSON.stringify([tab])}'>
        ${_allOrgs.map(o=>`<option ${fOrg===o?'selected':''}>${o==='Все'?t('lbl_all'):esc(o)}</option>`).join('')}
      </select>
      <select data-onchange-action="_onFilialFilterChange" data-onchange-args='${JSON.stringify([tab])}'>
        ${filials.map(f=>`<option ${fFilial===f?'selected':''}>${f==='Все'?t('lbl_all'):esc(f)}</option>`).join('')}
      </select>
      <select data-onchange-action="_onStatusFilterChange" data-onchange-args='${JSON.stringify([tab])}'>
        ${['Все','используется','резерв'].map(s=>`<option ${fStatus===s?'selected':''}>${s==='Все'?t('lbl_all'):s}</option>`).join('')}
      </select>
      ${(searchVal||fOrg!=='Все'||fFilial!=='Все'||fStatus!=='Все')?
        `<button class="btn btn-ghost btn-sm" data-action="_resetAssetFilters" data-args='${JSON.stringify([tab])}'>✕ ${t('btn_reset')}</button>`:''}
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        ${canEdit()?`<th style="width:32px"><input type="checkbox" id="sel-all" title="${t('tooltip_select_all')}"
          data-onchange-action="_onSelectAllChange" data-onchange-args='${JSON.stringify([tab])}'/></th>`:''}
        ${thSort('inv',t('field_inv'))}${thSort('type',t('field_type'))}${thSort('model',t('field_model'))}${thSort('serial',t('field_serial'))}
        ${showMeta?'<th>IP</th><th>MAC</th>':''}
        ${thSort('responsible',t('field_responsible'))}${thSort('filial',t('lbl_filial_place'))}${thSort('org',t('lbl_org_short'))}
        <th>${t('field_collection')}</th>${thSort('status',t('field_status'))}
        ${canEdit()?'<th></th>':''}
      </tr></thead>
      <tbody>${assets.map(a=>`
        <tr class="clickable" data-action="showDetail" data-args='${JSON.stringify([a.id])}' id="row-${a.id}">
          ${canEdit()?`<td data-action="_noop" style="width:32px;text-align:center"><input type="checkbox" class="row-cb" data-id="${a.id}" ${selectedIds.has(a.id)?'checked':''} data-onchange-action="_onSelectOneChange" data-onchange-args='${JSON.stringify([a.id, tab])}'/></td>`:''}
          <td class="mono" style="font-size:11px">${a.inv?`<span style="background:#eff6ff;color:#1d4ed8;border-radius:5px;padding:2px 6px;font-weight:600">${esc(a.inv)}</span>`:'<span style="color:#cbd5e1">—</span>'}</td>
          <td>${ic(a.type)} <span style="font-weight:500">${esc(a.type)}</span></td>
          <td><b>${esc(a.model)}</b></td>
          <td class="mono">${esc(a.serial)||'—'}</td>
          ${showMeta?`<td><span class="badge-meta">${esc(a.meta?.ip)||'—'}</span></td>
            <td class="mono" style="font-size:11px">${esc(a.meta?.mac)||'—'}</td>`:''}
          <td>${(!a.responsible||a.responsible==='?'||a.responsible==='—')
            ?`<span class="no-resp">${t('lbl_not_assigned')}</span>`:esc(a.responsible)}</td>
          <td><b>${esc(a.filial)}</b>${a.location?` <span style="color:var(--muted)">· ${esc(a.location)}</span>`:''}</td>
          <td style="font-size:11px;color:var(--muted);white-space:nowrap">${esc(_orgMap[a.org_id]||a.org||'—')}</td>
          <td><span class="badge-cat">${esc(a.category)}</span></td>
          <td><span class="badge-s ${sc(a.status)}">${a.status}</span></td>
          ${canEdit()?`<td data-action="_noop" style="white-space:nowrap">
            <button class="btn btn-secondary btn-sm" data-action="showMoveModal" data-args='${JSON.stringify([a.id])}'>→</button>
            <button class="btn-icon" data-action="showEditModal" data-args='${JSON.stringify([a.id])}' title="${t('btn_edit')}">✏️</button>
          </td>`:''}
        </tr>`).join('')}
      </tbody></table></div>

  ${renderPaginator(totalPages, totalAssets)}
  </div>`;

  // Синхронизируем состояние sel-all чекбокса
  setTimeout(() => {
    const selAll = document.getElementById('sel-all');
    if (!selAll) return;
    const cbs = document.querySelectorAll('.row-cb');
    if (cbs.length === 0) { selAll.checked = false; selAll.indeterminate = false; return; }
    const checkedCount = [...cbs].filter(cb => cb.checked).length;
    selAll.checked       = checkedCount === cbs.length;
    selAll.indeterminate = checkedCount > 0 && checkedCount < cbs.length;
  }, 0);
}

// ─── CATEGORY EDITOR ─────────────────────────────────────────────────────────
function showCatEditor(tab) {
  const cats = catsCache[tab]||[];
  showModal(`<h2>📂 ${t('modal_categories_title', { tab: tabLabel(tab) })}</h2>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px">
      ${t('msg_categories_used_for_grouping')}<br>
      ${t('msg_category_delete_note')}
    </div>
    <div id="tag-container" class="tag-list">${cats.map(c=>`
      <div class="tag" id="tag-${btoa(c)}">
        ${esc(c)}
        <span class="del" data-action="removeTag" data-args='${JSON.stringify([tab, esc(c)])}'>×</span>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:7px;margin-top:14px">
      <input id="new-cat-inp" style="flex:1" placeholder="${t('msg_new_collection_placeholder')}" 
        data-onkeydown-action="_onNewCatKeydown" data-onkeydown-args='${JSON.stringify([tab])}'/>
      <button class="btn btn-success" data-action="addTag" data-args='${JSON.stringify([tab])}'>${t('btn_add')}</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="saveCats" data-args='${JSON.stringify([tab])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
let editingCats = [];
function removeTag(tab, name) {
  const id = 'tag-'+btoa(name);
  document.getElementById(id)?.remove();
}
function addTag(tab) {
  const inp = document.getElementById('new-cat-inp');
  const val = inp.value.trim();
  if (!val) return;
  const id = 'tag-'+btoa(val);
  if (document.getElementById(id)) { inp.value=''; return; }
  const div = document.createElement('div');
  div.className='tag'; div.id=id;
  div.innerHTML=`${esc(val)} <span class="del" data-action="_removeParentElement">×</span>`;
  document.getElementById('tag-container').appendChild(div);
  inp.value='';
}
async function saveCats(tab) {
  const tags = [...document.querySelectorAll('#tag-container .tag')]
    .map(t=>t.childNodes[0].textContent.trim()).filter(Boolean);
  const r = await fetch(`${API}/api/categories/${tab}`,{method:'PUT',headers:ah(),body:JSON.stringify({categories:tags})});
  if (r.ok) {
    catsCache[tab] = tags;
    closeModal(); toast(t('msg_collections_saved'),'success'); render();
  } else toast(t('msg_error'),'error');
}

function thSort(col, label) {
  const active = sortCol === col;
  const arrow  = active ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
  const style  = active
    ? 'cursor:pointer;user-select:none;color:var(--indigo);white-space:nowrap'
    : 'cursor:pointer;user-select:none;white-space:nowrap';
  return `<th style="${style}" data-action="setSort" data-args='${JSON.stringify([col])}'>${label}${arrow}</th>`;
}

function setSort(col) {
  if (sortCol === col) sortDir *= -1;
  else { sortCol = col; sortDir = 1; }
  currentPage = 1;
  renderAssetTab(currentTab);
}

// ─── Массовые операции + пагинация реестра (шаг 15) ─────────────────────────
function toggleSelectOne(id, checked, tab) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  const selAll = document.getElementById('sel-all');
  if (selAll) {
    const cbs = document.querySelectorAll('.row-cb');
    selAll.checked = cbs.length > 0 && [...cbs].every(cb => cb.checked);
  }
  renderAssetTab(tab);
}

function toggleSelectAll(checked, tab) {
  document.querySelectorAll('.row-cb').forEach(cb => {
    if (checked) selectedIds.add(cb.dataset.id);
    else selectedIds.delete(cb.dataset.id);
  });
  renderAssetTab(tab).then(() => {
    const selAll = document.getElementById('sel-all');
    if (selAll) selAll.checked = checked && selectedIds.size > 0;
  });
}

function clearSelection(tab) {
  selectedIds.clear();
  renderAssetTab(tab);
}


function renderPaginator(totalPages, totalAssets) {
  if (totalPages <= 1) return '';
  const from = (currentPage - 1) * PAGE_SIZE + 1;
  const to   = Math.min(currentPage * PAGE_SIZE, totalAssets);
  let btns = '';
  const prevDis = currentPage <= 1 ? ' disabled' : '';
  const nextDis = currentPage >= totalPages ? ' disabled' : '';
  btns += `<button class="btn btn-ghost btn-sm"${prevDis} data-action="gotoPage" data-args='${JSON.stringify([currentPage-1])}'>← ${t('btn_prev')}</button>`;
  let lastWasDots = false;
  for (let p = 1; p <= totalPages; p++) {
    const near = Math.abs(p - currentPage) <= 2 || p === 1 || p === totalPages;
    if (near) {
      const cls = p === currentPage ? 'btn-primary' : 'btn-ghost';
      btns += `<button class="btn btn-sm ${cls}" data-action="gotoPage" data-args='${JSON.stringify([p])}'>${p}</button>`;
      lastWasDots = false;
    } else if (Math.abs(p - currentPage) === 3 && !lastWasDots) {
      btns += '<span style="color:var(--muted);padding:0 4px">…</span>';
      lastWasDots = true;
    }
  }
  btns += `<button class="btn btn-ghost btn-sm"${nextDis} data-action="gotoPage" data-args='${JSON.stringify([currentPage+1])}'>${t('btn_next')} →</button>`;
  btns += `<span style="font-size:12px;color:var(--muted);margin-left:8px">${from}–${to} ${t('lbl_of')} ${totalAssets}</span>`;
  return `<div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:14px;flex-wrap:wrap">${btns}</div>`;
}

function gotoPage(page) {
  currentPage = Math.max(1, page);
  renderAssetTab(currentTab);
}

// ─── Bulk-модалки (присвоить инв.№, списать, переместить) — шаг 16 ─────────
async function showBulkInvModal(tab) {
  if (!selectedIds.size) return toast(t('msg_nothing_selected'), 'error');

  // Загружаем организации с правилами инв. номеров
  let orgsWithRules = [];
  try {
    const orgs = await fetch(`${API}/api/orgs`, { headers: ah() }).then(r=>r.json());
    orgsWithRules = orgs.filter(o => o.inv_rules && o.inv_rules.filter(r=>r.active!==false).length > 0);
  } catch(e) {}

  if (!orgsWithRules.length) {
    return toast(t('msg_no_orgs_with_inv_rules'), 'error');
  }

  // Собираем список выбранных ассетов (из DOM)
  const selectedArr = [...selectedIds];

  const orgOpts = orgsWithRules.map(o =>
    `<option value="${o.id}">${esc(o.name)} (${o.short_code})</option>`
  ).join('');

  showModal(`<h2>${t('modal_bulk_inv_title')}</h2>
    <div style="background:var(--surface2);border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px;border:1px solid var(--border)">
      ${t('lbl_selected_devices')}: <b>${selectedArr.length}</b><br>
      <span style="font-size:11px;color:var(--muted)">${t('msg_devices_without_inv_note')}</span>
    </div>
    <div class="form-row"><label>${t('field_org')}</label>
      <select id="bi-org" data-onchange-action="_onBulkInvOrgChange" data-onchange-args='${JSON.stringify([orgsWithRules])}'>
        ${orgOpts}
      </select>
    </div>
    <div class="form-row"><label>${t('field_device_type_rule')}</label>
      <select id="bi-type"></select>
    </div>
    <div id="bi-preview" style="font-size:12px;color:var(--muted);margin-bottom:8px"></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">
      ${t('msg_inv_only_without_number_note')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doBulkAssignInv" data-args='${JSON.stringify([tab])}'>${t('btn_assign')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);

  // Инициализируем типы для первой организации
  if (orgsWithRules[0]) _updateInvTypeOpts(orgsWithRules[0].id, orgsWithRules);
}

function _updateInvTypeOpts(orgId, orgs) {
  const org = orgs.find(o => o.id === orgId);
  const sel = document.getElementById('bi-type');
  if (!sel || !org) return;
  const rules = (org.inv_rules||[]).filter(r => r.active !== false);
  sel.innerHTML = rules.map(r =>
    `<option value="${r.type_code}">${r.type_name || r.type_code} → ${org.short_code}-${r.type_code}-XXXXX</option>`
  ).join('');
  _updateInvPreview(org);
}

function _updateInvPreview(org) {
  const preview = document.getElementById('bi-preview');
  if (!preview) return;
  const tc = document.getElementById('bi-type')?.value;
  if (!tc || !org) return;
  const rule = (org.inv_rules||[]).find(r=>r.type_code===tc);
  const next = (rule?.counter||0) + 1;
  preview.textContent = `${t('msg_next_number')}: ${org.short_code}-${tc}-${String(next).padStart(5,'0')}`;
}

async function doBulkAssignInv(tab) {
  const orgId   = document.getElementById('bi-org')?.value;
  const typeCode = document.getElementById('bi-type')?.value;
  if (!orgId || !typeCode) return toast(t('msg_select_org_and_type'), 'error');

  const ids = [...selectedIds];
  const r = await fetch(`${API}/api/assets/bulk-assign-inv`, {
    method: 'POST', headers: ah(),
    body: JSON.stringify({ ids, org_id: orgId, type_code: typeCode })
  });
  const d = await r.json();
  if (r.ok) {
    closeModal();
    // BUG-2: теперь сервер отдаёт причину пропуска по каждому ID —
    // показываем не просто число, а за что конкретно (если пропуски есть).
    let msg = `${t('msg_bulk_assigned_prefix')}: ${d.assigned}`;
    if (d.skipped > 0) {
      const reasons = {};
      (d.ids_failed || []).forEach(f => { reasons[f.reason] = (reasons[f.reason]||0) + 1; });
      const detail = Object.entries(reasons).map(([r,n]) => `${r}: ${n}`).join(', ');
      msg += `, ${t('msg_bulk_skipped_prefix')}: ${d.skipped}${detail ? ` (${detail})` : ''}`;
    }
    toast(msg, 'success');
    selectedIds.clear();
    renderAssetTab(tab);
  } else toast(d.error || t('msg_error'), 'error');
}

function showBulkRetireModal(tab) {
  if (!selectedIds.size) return toast(t('msg_nothing_selected'), 'error');
  showModal(`<h2>${t('modal_bulk_retire_title')}</h2>
    <div style="background:var(--danger-bg);border:1px solid var(--danger-border);border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px;color:var(--danger-text)">
      ${t('msg_will_be_retired_count')}: <b>${selectedIds.size}</b> ${t('msg_units_of_equipment')}.<br>
      ${t('msg_retire_irreversible')}
    </div>
    <div class="form-row"><label>${t('field_retire_reason')}</label>
      <input id="br-reason" placeholder="${t('msg_retire_reason_placeholder')}" autofocus/></div>
    <div class="modal-actions">
      <button class="btn btn-danger" data-action="doBulkRetire" data-args='${JSON.stringify([tab])}'>${t('btn_retire_count', { n: selectedIds.size })}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}

async function doBulkRetire(tab) {
  const reason = document.getElementById('br-reason')?.value.trim() || t('msg_bulk_retire_default_reason');
  const ids = [...selectedIds];
  closeModal();
  let ok = 0, fail = 0;
  for (const id of ids) {
    const r = await fetch(`${API}/api/assets/${id}`, {
      method: 'DELETE',
      headers: { ...ah(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (r.ok) ok++; else fail++;
  }
  selectedIds.clear();
  if (ok)   toast(`${t('msg_retired_count_prefix')}: ${ok} ${t('msg_units_short')}`, 'success');
  if (fail) toast(`${t('msg_errors_count_prefix')}: ${fail}`, 'error');
  renderAssetTab(tab);
}

function showBulkMoveModal(tab) {
  if (!selectedIds.size) return toast(t('msg_nothing_selected'), 'error');
  const filOpts = _filialsCache.map(f=>`<option value="${f.name}">${esc(f.name)}</option>`).join('');
  const locOpts = _locsCache.map(l=>`<option value="${l.name}">${esc(l.name)}</option>`).join('');
  showModal(`<h2>${t('modal_bulk_move_title')}</h2>
    <div style="background:#eff6ff;border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px">
      ${t('lbl_assets_count')}: <b>${selectedIds.size}</b> &nbsp;·&nbsp;
      <span style="font-size:12px;color:var(--muted)">${t('msg_empty_field_note')}</span>
    </div>
    <div class="form-row"><label>${t('field_responsible')}</label>
      <input id="bm-resp" placeholder="${t('msg_full_name_example')}"/></div>
    <div class="form-row"><label>${t('field_filial')}</label>
      <select id="bm-filial"><option value="">${t('opt_no_change')}</option>${filOpts}</select></div>
    <div class="form-row"><label>${t('field_location')}</label>
      <select id="bm-loc"><option value="">${t('opt_no_change')}</option>${locOpts}</select></div>
    <div class="form-row"><label>${t('field_reason')}</label>
      <input id="bm-reason" placeholder="${t('msg_move_reason_placeholder')}"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doBulkMove" data-args='${JSON.stringify([tab])}'>${t('btn_move')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}

async function doBulkMove(tab) {
  const newResponsible = document.getElementById('bm-resp')?.value.trim();
  const newFilial      = document.getElementById('bm-filial')?.value;
  const newLocation    = document.getElementById('bm-loc')?.value;
  const reason         = document.getElementById('bm-reason')?.value.trim();
  if (!newResponsible && !newFilial && !newLocation)
    return toast(t('msg_fill_at_least_one_field'), 'error');
  const r = await fetch(`${API}/api/assets/bulk-move`, {
    method:'POST', headers:ah(),
    body:JSON.stringify({ ids:[...selectedIds], newResponsible, newFilial, newLocation, reason })
  });
  const d = await r.json();
  if (r.ok) {
    closeModal();
    toast(`${t('msg_moved_count_prefix')}: ${d.ok}${d.failed?.length?' | '+t('msg_errors_count_prefix')+': '+d.failed.length:''}`, 'success');
    selectedIds.clear();
    renderAssetTab(tab);
  } else toast(d.error||t('msg_error'), 'error');
}
