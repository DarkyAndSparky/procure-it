/**
 * public/js/views/inv-generator.js
 *
 * Фаза 5, шаг 18: генератор инвентарных номеров (модалка + подмодалка
 * создания правила на лету), вынесенный из public/index.html. Classic
 * script — та же причина, что и в остальных файлах (см. auth.js).
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js).
 */

function openInvGenerator(targetId, orgSelectId, typeSelectId) {
  const orgs  = invCodes.orgs  || {};
  const types = invCodes.types || {};

  // ── Автоподбор из контекстной формы ──────────────────────────────────────
  // Орг: из select по имени орг → ищем short_code
  let preselectedOrg  = '';
  let preselectedType = '';

  if (orgSelectId) {
    const orgEl = document.getElementById(orgSelectId);
    const orgName = orgEl?.value?.trim() || '';
    if (orgName) {
      // orgs = { YRK: 'ЯРКО', LDV: 'Лето ДВЛ', ... }
      const match = Object.entries(orgs).find(([code, name]) =>
        name === orgName || code === orgName.toUpperCase()
      );
      if (match) preselectedOrg = match[0];
    }
  }

  if (typeSelectId) {
    const typeEl = document.getElementById(typeSelectId);
    const typeName = typeEl?.value?.trim() || '';
    if (typeName) {
      // types = { NB: 'Ноутбук', MON: 'Монитор', ... }
      const match = Object.entries(types).find(([code, name]) =>
        name === typeName || code === typeName.toUpperCase()
      );
      if (match) preselectedType = match[0];
      // Если не нашли — покажем подсказку: нет правила для этого типа у орг
    }
  }

  const orgOpts = Object.entries(orgs)
    .map(([k,v])=>`<option value="${k}" ${k===preselectedOrg?'selected':''}>${k} — ${v}</option>`)
    .join('');
  const typeOpts = Object.entries(types)
    .map(([k,v])=>`<option value="${k}" ${k===preselectedType?'selected':''}>${k} — ${v}</option>`)
    .join('');

  const hasPreset = preselectedOrg && preselectedType;

  showModal(`
    <h2>${t('inv_gen_title')}</h2>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">
      ${t('inv_gen_format_hint')}
    </div>
    ${hasPreset ? `<div style="background:var(--success-bg);border:1px solid var(--success-border);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:12px;color:var(--success-text)">
      ${t('msg_picked_from_form')}: <b>${preselectedOrg}</b> · <b>${preselectedType}</b>
    </div>` : (preselectedOrg && !preselectedType) ? `<div style="background:var(--warn-bg);border:1px solid var(--warn-border);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:12px;color:var(--warn-text)">
      ${t('msg_no_rule_for_type', { type: document.getElementById(typeSelectId)?.value||'?' })}
      <button class="btn btn-primary btn-sm" style="margin-top:8px"
        data-action="createInvRuleFromGenerator" data-args='${JSON.stringify([preselectedOrg, document.getElementById(typeSelectId)?.value||''])}'>
        ${t('btn_create_rule_for_type')}
      </button>
    </div>` : ''}
    <div class="two-col">
      <div class="form-row"><label>${t('field_organization')}</label>
        <select id="ig-org" data-onchange-action="refreshInvPreview">${orgOpts}</select>
      </div>
      <div class="form-row"><label>${t('field_device_type')}</label>
        <select id="ig-type" data-onchange-action="refreshInvPreview">${typeOpts}</select>
      </div>
    </div>
    <div class="form-row">
      <label>${t('field_preview')}</label>
      <div style="display:flex;gap:7px;align-items:center">
        <input id="ig-preview" style="flex:1;font-weight:700;font-size:14px;font-family:monospace;background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe" readonly/>
        <button class="btn btn-secondary btn-sm" data-action="refreshInvPreview">${t('btn_refresh')}</button>
      </div>
    </div>
    <div id="ig-note" style="font-size:12px;color:var(--muted);margin-top:4px"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="applyInvNumber" data-args='${JSON.stringify([targetId])}'>${t('btn_apply')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>
  `);
  refreshInvPreview();
}

async function refreshInvPreview() {
  const org  = document.getElementById('ig-org')?.value;
  const type = document.getElementById('ig-type')?.value;
  if (!org || !type) return;
  const el   = document.getElementById('ig-preview');
  const note = document.getElementById('ig-note');
  try {
    const r = await fetch(`${API}/api/inv/next?org=${org}&type=${type}`);
    const d = await r.json();
    if (r.ok && d.inv) {
      if (el) { el.value = d.inv; el.style.background='#eff6ff'; el.style.color='#1d4ed8'; }
      if (note) note.innerHTML = t('msg_next_free_number', { org, type });
      // Скрываем кнопку создания если была
      const cb = document.getElementById('ig-create-rule-btn');
      if (cb) cb.style.display = 'none';
    } else {
      // Нет правила для этой пары орг+тип
      if (el) { el.value = ''; el.style.background='var(--warn-bg)'; el.style.color='var(--warn-text)'; }
      if (note) note.innerHTML = `
        <span style="color:var(--warn-text)">${t('msg_no_rule_for_pair', { org, type })}</span>
        <button id="ig-create-rule-btn" class="btn btn-primary btn-sm" style="margin-left:8px"
          data-action="createInvRuleFromGenerator" data-args='${JSON.stringify([org,""])}'>
          ${t('btn_create_rule')}
        </button>`;
    }
  } catch(e) {
    if (note) note.textContent = t('msg_error_prefix') + ': ' + e.message;
  }
}

async function applyInvNumber(targetId) {
  const inv  = document.getElementById('ig-preview')?.value;
  const org  = document.getElementById('ig-org')?.value;
  const type = document.getElementById('ig-type')?.value;
  if (!inv) return;
  // Reserve the number
  await fetch(`${API}/api/inv/reserve`,{method:'POST',headers:ah(),body:JSON.stringify({org,type})}).catch(()=>{});
  closeModal();
  // We need to re-open the parent modal... instead just set value on existing field
  setTimeout(()=>{
    const el = document.getElementById(targetId);
    if (el) { el.value = inv; el.style.background='#eff6ff'; el.style.color='#1d4ed8'; }
  }, 100);
}


async function createInvRuleFromGenerator(orgCode, typeName) {
  // Находим org_id по short_code
  const orgs = await fetch(`${API}/api/orgs`).then(r=>r.json()).catch(()=>[]);
  const org = orgs.find(o => o.short_code === orgCode);
  if (!org) return toast(t('msg_org_not_found', { org: orgCode }), 'error');

  // Автозаполняем type_code из имени если возможно
  const typeCodes = await fetch(`${API}/api/type-codes`).then(r=>r.json()).catch(()=>[]);
  const matchedCode = typeCodes.find(tc => tc.name === typeName);
  const autoCode = matchedCode ? matchedCode.code : '';
  const autoName = typeName || '';

  // Показываем inline-форму поверх текущего модала
  const note = document.getElementById('ig-note');
  if (!note) return;
  note.innerHTML = `
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px;margin-top:8px">
      <div style="font-size:12px;font-weight:600;color:#0369a1;margin-bottom:8px">
        ${t('msg_new_rule_for', { org: orgCode })}
      </div>
      <div class="two-col" style="gap:8px">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">${t('field_type_code_required')}</div>
          <input id="igcr-code" value="${autoCode}" placeholder="NB" maxlength="6"
            style="width:100%;font-size:13px" data-oninput-action="forceUppercase"/>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:3px">${t('field_type_name_required_short')}</div>
          <input id="igcr-name" value="${autoName}" placeholder="${t('msg_type_name_placeholder')}" style="width:100%;font-size:13px"/>
        </div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;margin-bottom:8px">
        ${t('msg_inv_number_will_be')} <code>${orgCode}-[${t('lbl_code_placeholder')}]-00001</code>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" data-action="submitInvRuleFromGenerator" data-args='${JSON.stringify([org.id,orgCode])}'>${t('btn_create_and_apply')}</button>
        <button class="btn btn-secondary btn-sm" data-action="refreshInvPreview">${t('btn_cancel')}</button>
      </div>
    </div>`;
}

async function submitInvRuleFromGenerator(orgId, orgCode) {
  const type_code = document.getElementById('igcr-code')?.value.trim().toUpperCase();
  const type_name = document.getElementById('igcr-name')?.value.trim();
  if (!type_code || !type_name) return toast(t('msg_fill_code_and_name'), 'error');

  const r = await fetch(`${API}/api/orgs/${orgId}/inv-rules`, {
    method: 'POST', headers: ah(),
    body: JSON.stringify({ type_code, type_name })
  });
  const d = await r.json();
  if (!r.ok) return toast(d.error || t('msg_creating_rule_error'), 'error');

  toast(t('msg_rule_created', { org: orgCode, code: type_code }), 'success');

  // Обновляем список типов в селекте генератора
  const typeEl = document.getElementById('ig-type');
  if (typeEl) {
    // Добавляем новый option и выбираем его
    const opt = document.createElement('option');
    opt.value = type_code;
    opt.textContent = `${type_code} — ${type_name}`;
    opt.selected = true;
    typeEl.appendChild(opt);
  }

  // Обновляем глобальный кэш орг
  _orgsCache = await fetch(`${API}/api/orgs`).then(r=>r.json()).catch(()=>_orgsCache);

  // Перезапрашиваем номер
  await refreshInvPreview();
}
