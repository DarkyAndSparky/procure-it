/**
 * public/js/views/asset-forms.js
 *
 * Фаза 5, шаг 17: модалки создания/редактирования/перемещения/удаления
 * актива + карточка деталей, вынесенные из public/index.html. Classic
 * script — та же причина, что и в остальных файлах (см. auth.js).
 *
 * НЕ включено (осознанно, отдельный будущий шаг): openInvGenerator и его
 * подсистема (refreshInvPreview, applyInvNumber, createInvRuleFromGenerator),
 * buildQrText/renderQrInto/printAsset, initEmployeeAutocomplete — это
 * отдельный самостоятельный кластер (генератор инв. номеров + QR + автокомплит
 * сотрудников), используется этими формами, но заслуживает отдельного разбора.
 * Остаются как внешние глобалы в index.html, резолвятся в момент вызова.
 */

// Фаза 6: были data-onchange-action="_onFilialSelectChange" data-onchange-args='["m-loc"]' и т.п. — value
// стоит ПЕРВЫМ аргументом, а не последним (конвенция el.value-в-конце тут не
// подходит). Обёртка читает this.value напрямую (this===элемент при
// делегировании через data-onchange-action).
function _onFilialSelectChange(locSelectId) {
  _updateLocSelect(this.value, locSelectId);
}

// Аналогично: data-onchange-action="_onCategorySelectChange" data-onchange-args='${JSON.stringify([tab, "a-meta"])}' —
// value ПОСЕРЕДИНЕ аргументов.
function _onCategorySelectChange(tab, containerId) {
  updateMetaForm(tab, this.value, containerId);
}

// Было data-action="_closeThenShowMove" data-args='${JSON.stringify([id])}' — два оператора подряд.
function _closeThenShowMove(id) { closeModal(); showMoveModal(id); }
function _closeThenShowEdit(id) { closeModal(); showEditModal(id); }

// Было (только для password-поля) самомодифицирующий onclick, показывающий
// реальное значение при клике (маскированное поле).
function _revealMaskedValue(realValue) {
  this.textContent = this.dataset.v ? this.dataset.v : this.textContent;
  this.dataset.v = this.dataset.v || realValue;
}

async function showDetail(id) {
  const a=await fetch(`${API}/api/assets/${id}`, { headers: ah() }).then(r=>r.json());
  const histResp=await fetch(`${API}/api/history?asset_id=${id}&limit=20`, { headers: ah() }).then(r=>r.json());
  const hist = Array.isArray(histResp) ? histResp : (histResp.items || []);
  // Org lookup через справочник
  if (!a.org && a.org_id && _orgsCache.length) {
    const org = _orgsCache.find(o => o.id === a.org_id);
    if (org) a.org = org.name;
  }
  const mf=getMetaFields(a.category);
  const metaRows=mf.filter(k=>a.meta?.[k]).map(k=>`
    <div><div class="detail-lbl">${metaLabel(k)}</div>
    <div class="detail-val ${k==='password'?'pw-mask mono':'mono'}" ${k==='password'?`data-action="_revealMaskedValue" data-args='${JSON.stringify([esc(a.meta[k] || '')])}'`:''}>
      ${k==='password'?(a.meta[k]?'••••••':'—'):esc(a.meta[k])}</div></div>`).join('');

  showModal(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div>
        <div style="font-size:26px">${ic(a.type)}</div>
        <div style="font-weight:800;font-size:17px">${esc(a.model)}</div>
        <div style="color:var(--muted);font-size:12px">${esc(a.type)} · <span class="badge-cat">${esc(a.category)}</span></div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="badge-s ${sc(a.status)}">${a.status}</span>
        <button class="btn btn-ghost btn-sm" data-action="closeModal">✕</button>
      </div>
    </div>
    <div class="two-col">
      ${[[t('field_inv'),a.inv,'mono'],[t('field_serial'),a.serial,'mono'],[t('field_responsible'),a.responsible,''],
         [t('field_filial'),a.filial,''],[t('field_location'),a.location,''],
         [t('field_org'),a.org,''],[t('field_note'),a.note,'']
        ].filter(([,v])=>v&&v!=='—').map(([l,v,cls])=>`
        <div><div class="detail-lbl">${l}</div><div class="detail-val ${cls}">${esc(v)}</div></div>`).join('')}
    </div>
    ${metaRows?`<hr class="sep"/><div class="section-title">${t('section_meta')}</div>
      <div class="meta-grid">${metaRows}</div>`:''}
    ${hist.length?`<hr class="sep"/>
    <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:10px;letter-spacing:.5px">
      ${t('section_history_count', { n: hist.length })}
    </div>
    <div style="position:relative;padding-left:20px">
      <div style="position:absolute;left:7px;top:0;bottom:0;width:2px;background:var(--border);border-radius:2px"></div>
      ${hist.map((h,i)=>{
        const isMove    = h.action_type==='move'   || h.from_who || h.to_who;
        const isCreate  = h.action_type==='create' || h.action_type==='import';
        const isRetire  = h.action_type==='retire' || h.action_type==='delete';
        const icon  = isRetire?'🗑':isCreate?'✨':isMove?'→':'📝';
        const color = isRetire?'#dc2626':isCreate?'#059669':isMove?'#6366f1':'var(--warn-text)';
        return `<div style="position:relative;margin-bottom:${i<hist.length-1?'12':'4'}px">
          <div style="position:absolute;left:-16px;top:2px;width:10px;height:10px;border-radius:50%;
            background:${color};border:2px solid #fff;box-shadow:0 0 0 1px ${color}"></div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:2px">${fd(h.date)}
            ${h.changed_by?`<span style="color:var(--muted)"> · ${esc(h.changed_by)}</span>`:''}
          </div>
          ${(h.from_who||h.to_who)?`<div style="font-size:12px;margin-bottom:2px">
            ${h.from_who?`<span style="color:var(--muted)">${esc(h.from_who)}</span> `:''}
            ${h.from_who&&h.to_who?'<span style="color:var(--muted)">→</span> ':''}
            ${h.to_who?`<b>${esc(h.to_who)}</b>`:''}
          </div>`:''}
          ${h.filial||h.location?`<div style="font-size:11px;color:var(--muted)">
            📍 ${esc(h.filial||'')}${h.location?' · '+esc(h.location):''}
          </div>`:''}
          ${h.reason?`<div style="font-size:11px;margin-top:2px">
            <span class="badge-cat" style="font-size:10px">${esc(h.reason)}</span>
          </div>`:''}
        </div>`;
      }).join('')}
    </div>`:''}
    <hr class="sep"/>
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0">
      <div id="detail-qr-${id}" style="line-height:0;border-radius:8px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.12)"></div>
      <div style="font-size:11px;color:var(--muted);text-align:center;max-width:200px;line-height:1.4">${buildQrText(a).replace(/\n/g, ' · ')}</div>
      <button class="btn btn-secondary btn-sm" data-action="printAsset" data-args='${JSON.stringify([a])}'>${t('btn_print_card')}</button>
    </div>
    <div class="modal-actions">
      ${canEdit()?`
        <button class="btn btn-primary" data-action="_closeThenShowMove" data-args='${JSON.stringify([id])}'>→ ${t('btn_move')}</button>
        <button class="btn btn-secondary" data-action="_closeThenShowEdit" data-args='${JSON.stringify([id])}'>✏️ ${t('btn_edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="confirmDelete" data-args='${JSON.stringify([id])}'>${t('btn_retire')}</button>`:''}
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_close')}</button>
    </div>`);
  currentDetailAsset = a;
  requestAnimationFrame(() => renderQrInto('detail-qr-' + id, buildQrText(a)));

}

// ─── MOVE MODAL ───────────────────────────────────────────────────────────────
async function showMoveModal(id) {
  await ensureRefData();
  const a=assetsCache.find(x=>x.id===id)||{};
  const filialObj = _filialsCache.find(f=>f.name===a.filial);
  const locOpts = _buildLocOpts(filialObj?.id||'', a.location||'');
  const orgOpts = _buildOrgOpts(a.org||'');
  const filialOpts = _filialsCache.filter(f=>f.status==='active')
    .map(f=>`<option value="${esc(f.name)}" ${a.filial===f.name?'selected':''}>${esc(f.name)}</option>`).join('');
  showModal(`<h2>${t('modal_move_title')}</h2>
    <div style="background:#f8fafc;border-radius:8px;padding:11px;margin-bottom:14px;font-size:13px">
      ${ic(a.type||'')} <b>${esc(a.type||'')} · ${esc(a.model||'')}</b><br>
      <span style="color:var(--muted)">SN: ${esc(a.serial)||'—'}</span>
    </div>
    <div class="form-row"><label>${t('lbl_current_responsible')}</label>
      <div style="font-size:13px;color:var(--muted);padding:5px 0">${esc(a.responsible)||'—'}</div></div>
    <div class="form-row"><label>${t('lbl_new_responsible')}</label>
      <input id="m-resp" value="${esc((!a.responsible||a.responsible==='?')?'':a.responsible)}" placeholder="${t('msg_full_name_placeholder')}"/></div>
    <div class="two-col">
      <div class="form-row"><label>${t('field_org')} *</label>
        <select id="m-org">${orgOpts}</select></div>
      <div class="form-row"><label>${t('field_filial')} *</label>
        <select id="m-filial" data-onchange-action="_onFilialSelectChange" data-onchange-args='["m-loc"]'>${filialOpts}</select></div>
    </div>
    <div class="form-row"><label>${t('field_location')}</label>
      <select id="m-loc">${locOpts}</select></div>
    <div class="form-row"><label>${t('field_reason')}</label>
      <select id="m-reason">${['Перемещение','Увольнение сотрудника','Трудоустройство сотрудника','Замена оборудования','Заявка на оборудование','Ремонт','Другое'].map(r=>`<option>${r}</option>`).join('')}</select></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doMove" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
  setTimeout(() => initEmployeeAutocomplete('m-resp'), 80);
}
async function doMove(id) {
  try {

  const newResponsible = document.getElementById('m-resp').value.trim();
  const newOrg      = document.getElementById('m-org').value.trim();
  const newFilial   = document.getElementById('m-filial').value.trim();
  const newLocation = document.getElementById('m-loc').value.trim();
  const reason      = document.getElementById('m-reason').value.trim();
  if (!newResponsible) return toast(t('msg_specify_responsible'),'error');
  if (!newOrg)    return toast(t('msg_select_org'),'error');
  if (!newFilial) return toast(t('msg_select_filial'),'error');
  const filialObj = _filialsCache.find(f=>f.name===newFilial);
  const r=await fetch(`${API}/api/assets/${id}/move`,{method:'POST',headers:ah(),
    body:JSON.stringify({newResponsible, newOrg, newFilial,
      newAddress: filialObj?.address||'', newLocation, reason})});
  if (r.ok){closeModal();toast(t('msg_moved'),'success');render();}
  else {const e=await r.json();toast(e.error||t('msg_error'),'error');}

  } catch(e) { toast(t('msg_connection_error'),'error'); }
}

// ─── ADD/EDIT MODAL ───────────────────────────────────────────────────────────
function metaFormRows(category, existing={}) {
  const fields=getMetaFields(category);
  return fields.map(k=>`<div class="form-row"><label>${metaLabel(k)}</label>
    <input id="meta-${k}" value="${esc(existing[k]||'')}" placeholder="${metaLabel(k)}"
      type="${k==='password'?'text':'text'}"/></div>`).join('');
}
function collectMeta(category) {
  const fields=getMetaFields(category);
  const meta={};
  fields.forEach(k=>{const el=document.getElementById('meta-'+k);if(el)meta[k]=el.value;});
  return meta;
}

// ── Справочники в формах ─────────────────────────────────────────────────────

function _buildOrgOpts(selected) {
  const opts = _orgsCache.map(o =>
    `<option value="${esc(o.name)}" ${o.name===selected?'selected':''}>${esc(o.name)}</option>`
  );
  if (!_orgsCache.some(o=>o.name===selected) && selected)
    opts.unshift(`<option value="${esc(selected)}" selected>${esc(selected)}</option>`);
  return opts.join('');
}

function _buildLocOpts(filialId, selected='') {
  const locs = filialId
    ? _locsCache.filter(l => l.filial_id === filialId && l.status === 'active')
    : _locsCache.filter(l => l.status === 'active');
  // Always include current value even if not in filtered list
  const hasSelected = locs.some(l=>l.name===selected);
  let opts = locs.map(l =>
    `<option value="${esc(l.name)}" ${l.name===selected?'selected':''}>${esc(l.name)}</option>`
  ).join('');
  if (!hasSelected && selected)
    opts = `<option value="${esc(selected)}" selected>${esc(selected)}</option>` + opts;
  if (!opts) opts = `<option value="">${t('msg_no_locations')}</option>`;
  return opts;
}

function _updateLocSelect(filialName, selectId) {
  const filialObj = _filialsCache.find(f=>f.name===filialName);
  const sel = document.getElementById(selectId);
  if (sel) sel.innerHTML = _buildLocOpts(filialObj?.id||'');
}

async function showAddModal(tab) {
  await ensureRefData();
  const cats=(catsCache[tab]||[]).filter(c=>c!=='Все');
  const types=['Ноутбук','Системный Блок','Монитор','МФУ','Планшет','Телевизор','ИБП',
    'Точка доступа','Мини ПК','Мышь','Клавиатура','Гарнитура','Колонки','Камера',
    'Коммутатор','Маршрутизатор','Радиомод','Радиомост','Сервер','POE HUB','Другое'];
  const firstCat=cats[0]||'';
  const filialOpts = _filialsCache.filter(f=>f.status==='active')
    .map(f=>`<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
  const firstFilial = _filialsCache.find(f=>f.status==='active');
  const locOpts = _buildLocOpts(firstFilial?.id||'');
  const orgOpts = _buildOrgOpts('');
  showModal(`<h2>${t('modal_add_asset_title')}</h2>
    <div class="two-col">
      <div class="form-row"><label>${t('field_org')}</label>
        <select id="a-org">${orgOpts}</select></div>
      <div class="form-row"><label>${t('field_collection')}</label>
        <select id="a-cat" data-onchange-action="_onCategorySelectChange" data-onchange-args='${JSON.stringify([tab, "a-meta"])}'>${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_type')}</label>
        <select id="a-type">${types.map(typ=>`<option>${typ}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_model')} *</label><input id="a-model" placeholder="${t('field_model')}"/></div>
      <div class="form-row"><label>${t('field_serial')}</label><input id="a-serial" placeholder="SN"/></div>
      <div class="form-row"><label>${t('field_inv')}</label>
        <div style="display:flex;gap:5px">
          <input id="a-inv" placeholder="${t('msg_inv_example')}" style="flex:1"/>
          <button type="button" class="btn btn-secondary btn-sm" data-action="openInvGenerator" data-args='["a-inv","a-org","a-type"]' title="${t('tooltip_generator')}">🏷</button>
        </div>
      </div>
      <div class="form-row"><label>${t('field_responsible')}</label><input id="a-resp" placeholder="${t('msg_full_name_placeholder')}"/></div>
      <div class="form-row"><label>${t('field_filial')}</label>
        <select id="a-filial" data-onchange-action="_onFilialSelectChange" data-onchange-args='["a-loc"]'>${filialOpts}</select></div>
      <div class="form-row"><label>${t('field_location')}</label>
        <select id="a-loc">${locOpts}</select></div>
      <div class="form-row"><label>${t('field_status')}</label>
        <select id="a-status"><option>используется</option><option>резерв</option></select></div>
    </div>
    <div class="form-row"><label>${t('field_note')}</label><textarea id="a-note"></textarea></div>
    <hr class="sep"/>
    <div class="section-title" style="margin-bottom:8px">${t('section_meta')}</div>
    <div id="a-meta" class="two-col">${metaFormRows(firstCat)}</div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doAdd" data-args='${JSON.stringify([tab])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
function updateMetaForm(tab, category, containerId) {
  document.getElementById(containerId).innerHTML = metaFormRows(category);
}
async function doAdd(tab) {
  try {

  const filial=document.getElementById('a-filial').value.trim();
  const category=document.getElementById('a-cat').value.trim();
  const filialObj = _filialsCache.find(f=>f.name===filial);
  const data={tab,category,filial,address:filialObj?.address||'',
    location:document.getElementById('a-loc').value.trim(),
    responsible:document.getElementById('a-resp').value.trim(),
    type:document.getElementById('a-type').value.trim(),
    model:document.getElementById('a-model').value.trim(),
    serial:document.getElementById('a-serial').value.trim(),
    inv:   (document.getElementById('a-inv')||{}).value||'',
    status:document.getElementById('a-status').value.trim(),
    org:document.getElementById('a-org').value.trim(),
    note:document.getElementById('a-note').value.trim(),
    meta:collectMeta(category)};
  if (!data.model) return toast(t('msg_fill_model'),'error');
  const r=await fetch(`${API}/api/assets`,{method:'POST',headers:ah(),body:JSON.stringify(data)});
  if (r.ok){closeModal();toast(t('msg_added'),'success');render();}
  else{const e=await r.json();toast(e.error||t('msg_error'),'error');}

  } catch(e) { toast(t('msg_connection_error'),'error'); }
}

async function showEditModal(id) {
  await ensureRefData();
  const a=await fetch(`${API}/api/assets/${id}`, { headers: ah() }).then(r=>r.json());
  const allCats=[...new Set([...Object.values(catsCache).flat(),a.category])].filter(Boolean);
  const types=['Ноутбук','Системный Блок','Монитор','МФУ','Планшет','Телевизор','ИБП',
    'Точка доступа','Мини ПК','Мышь','Клавиатура','Гарнитура','Колонки','Камера',
    'Коммутатор','Маршрутизатор','Радиомост','Сервер','POE HUB','Другое'];
  showModal(`<h2>${t('modal_edit_title')}</h2>
    <div class="two-col">
      <div class="form-row"><label>${t('field_type')}</label>
        <select id="e-type">${types.map(typ=>`<option ${a.type===typ?'selected':''}>${typ}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_model')}</label><input id="e-model" value="${esc(a.model)}"/></div>
      <div class="form-row"><label>${t('field_serial')}</label><input id="e-serial" value="${esc(a.serial)}"/></div>
      <div class="form-row"><label>${t('field_inv')}</label>
        <div style="display:flex;gap:5px">
          <input id="e-inv" value="${esc(a.inv||'')}" placeholder="LDV-NB-00001" style="flex:1"/>
          <button type="button" class="btn btn-secondary btn-sm" data-action="openInvGenerator" data-args='["e-inv","e-org","e-type"]' title="${t('tooltip_generator')}">🏷</button>
        </div>
      </div>
      <div class="form-row"><label>${t('field_responsible')}</label><input id="e-resp" value="${esc(a.responsible)}"/></div>
      <div class="form-row"><label>${t('field_filial')}</label>
        <select id="e-filial" data-onchange-action="_onFilialSelectChange" data-onchange-args='["e-loc"]'>${_filialsCache.filter(f=>f.status==='active').map(f=>`<option value="${esc(f.name)}" ${a.filial===f.name?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_location')}</label>
        <select id="e-loc">${_buildLocOpts(_filialsCache.find(f=>f.name===a.filial)?.id||'', a.location)}</select></div>
      <div class="form-row"><label>${t('field_collection')}</label>
        <select id="e-cat" data-onchange-action="_onCategorySelectChange" data-onchange-args='[null,"e-meta"]'>${allCats.map(c=>`<option ${a.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_tab')}</label>
        <select id="e-tab">${['os','small','infra'].map(tb=>`<option ${a.tab===tb?'selected':''}>${tb}</option>`).join('')}</select></div>
      <div class="form-row"><label>${t('field_org')}</label>
        <select id="e-org">${_buildOrgOpts(a.org)}</select></div>
      <div class="form-row"><label>${t('field_status')}</label>
        <select id="e-status">${['используется','резерв'].map(s=>`<option ${a.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="form-row"><label>${t('field_note')}</label><textarea id="e-note">${esc(a.note)}</textarea></div>
    <hr class="sep"/>
    <div class="section-title" style="margin-bottom:8px">${t('section_meta')}</div>
    <div id="e-meta" class="two-col">${metaFormRows(a.category, a.meta||{})}</div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doEdit" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
  setTimeout(() => initEmployeeAutocomplete('e-resp'), 80);
}
async function doEdit(id) {
  try {

  const filial=document.getElementById('e-filial').value.trim();
  const category=document.getElementById('e-cat').value.trim();
  const filialObj = _filialsCache.find(f=>f.name===filial);
  const data={
    type:document.getElementById('e-type').value.trim(),
    model:document.getElementById('e-model').value.trim(),
    serial:document.getElementById('e-serial').value.trim(),
    inv:   (document.getElementById('e-inv')||{}).value||'',
    responsible:document.getElementById('e-resp').value.trim(),
    filial,address:filialObj?.address||'',
    location:document.getElementById('e-loc').value.trim(),
    category,
    tab:document.getElementById('e-tab').value.trim(),
    org:document.getElementById('e-org').value.trim(),
    status:document.getElementById('e-status').value.trim(),
    note:document.getElementById('e-note').value.trim(),
    meta:collectMeta(category)};
  const r=await fetch(`${API}/api/assets/${id}`,{method:'PUT',headers:ah(),body:JSON.stringify(data)});
  if (r.ok){closeModal();toast(t('msg_saved'),'success');render();}
  else toast(t('msg_error'),'error');

  } catch(e) { toast(t('msg_connection_error'),'error'); }
}

function confirmDelete(id) {
  const a=assetsCache.find(x=>x.id===id)||{};
  showModal(`<h2>${t('modal_retire_confirm_title')}</h2>
    <p style="color:var(--muted);margin-bottom:18px;font-size:13px">
      ${ic(a.type)} <b>${esc(a.model)}</b> ${t('msg_retire_confirm_suffix')}</p>
    <div class="modal-actions">
      <button class="btn btn-danger" data-action="doDelete" data-args='${JSON.stringify([id])}'>${t('btn_confirm_retire')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doDelete(id) {
  const r=await fetch(`${API}/api/assets/${id}`,{method:'DELETE',headers:ah()});
  if (r.ok){closeModal();toast(t('msg_retired'));render();}else toast(t('msg_error'),'error');
}
