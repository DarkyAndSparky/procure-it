/**
 * public/js/views/alerts.js
 *
 * Фаза 5, шаг 11: экран "Требует внимания", вынесенный из public/index.html.
 * Classic script — та же причина, что и в остальных файлах (см. auth.js).
 * Самодостаточна: только глобалы (document, fetch, API, ic, esc, canEdit,
 * showDetail, showMoveModal, openInvGenerator, showEditModal), резолвятся
 * в момент вызова. Само-рекурсивна (кнопки "показать все" зовут renderAlerts()
 * заново) — это нормально, та же функция уже будет определена к тому моменту.
 */

// Фаза 6: было onclick="localStorage.removeItem/setItem(...);renderAlerts()" —
// составной вызов из двух операторов, выношу в именованную функцию.
function _toggleAlertsShowAll(title, show) {
  if (show) localStorage.setItem('alerts-showAll-' + title, '1');
  else localStorage.removeItem('alerts-showAll-' + title);
  renderAlerts();
}

async function renderAlerts() {
  const app=document.getElementById('app');
  app.innerHTML='<div class="spinner"></div>';

  const toArr = r => Array.isArray(r) ? r : (r?.items || []);
  const [noResp, reserved, noInv, noSerial, stale] = await Promise.all([
    fetch(`${API}/api/assets?no_responsible=1&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?status=резерв&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?no_inv=1&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?no_serial=1&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
    fetch(`${API}/api/assets?stale_days=180&limit=500`, { headers: ah() }).then(r=>r.json()).then(toArr),
  ]);

  const alertRow = (a, btn='') => `<div class="alert-card" style="cursor:pointer" data-action="showDetail" data-args='${JSON.stringify([a.id])}'>
    <span style="font-size:20px">${ic(a.type)}</span>
    <div style="flex:1">
      <div style="font-weight:600;font-size:13px">${esc(a.type)} · ${esc(a.model)}</div>
      <div style="font-size:12px;color:var(--muted)">${esc(a.filial||'—')} · ${esc(a.location||'—')} · ${esc(a.responsible||t('lbl_not_assigned'))}</div>
      ${a.inv?`<div style="font-size:11px;color:var(--muted)">${t('field_inv')}: ${esc(a.inv)}</div>`:''}
    </div>
    ${btn}
  </div>`;

  const section = (icon, title, color, items, btn='', emptyMsg='') => {
    const showAll = localStorage.getItem(`alerts-showAll-${title}`) === '1';
    const itemsToShow = showAll ? items : items.slice(0, 50);
    return `
    <div class="card" style="margin-bottom:14px">
      <div class="section-title" style="color:${color};display:flex;justify-content:space-between;align-items:center">
        <span>${icon} ${title} (${items.length})</span>
        ${items.length>50?`<span style="font-size:11px;font-weight:400;color:var(--muted)">${items.length} ${t('lbl_records_short')}</span>`:''}
      </div>
      ${itemsToShow.map(a=>alertRow(a,btn?btn(a):'')).join('')
        || `<div style="color:var(--muted);font-size:13px;padding:6px 0">${emptyMsg}</div>`}
      ${items.length>50?`<div style="padding:10px 0;text-align:center;border-top:1px solid var(--border);margin-top:10px">
        ${showAll ? 
          `<button class="btn btn-ghost btn-sm" data-action="_toggleAlertsShowAll" data-args='${JSON.stringify([title, false])}'>${t('btn_collapse')}</button>` :
          `<button class="btn btn-ghost btn-sm" data-action="_toggleAlertsShowAll" data-args='${JSON.stringify([title, true])}'>▼ ${t('lbl_show_all')} (${items.length})</button>`
        }
      </div>`:''}
    </div>`;
  };

  app.innerHTML=`<div style="max-width:900px">
    <div style="font-size:16px;font-weight:700;margin-bottom:14px">${t('page_title_alerts')}</div>

    ${section('❓',t('lbl_no_responsible'),'var(--red)', noResp,
      a => canEdit()?`<button class="btn btn-primary btn-sm" data-action="showMoveModal" data-args='${JSON.stringify([a.id])}' data-stop="1">${t('btn_assign_arrow')}</button>`:'',
      t('msg_all_have_responsible'))}

    ${section('🏷',t('lbl_no_inv'),'#d97706', noInv,
      a => canEdit()?`<button class="btn btn-secondary btn-sm" data-action="openInvGenerator" data-args='${JSON.stringify([a.id])}' data-stop="1">${t('btn_assign_inv_short')}</button>`:'',
      t('msg_all_have_inv'))}

    ${section('🔢',t('lbl_no_serial'),'#7c3aed', noSerial,
      a => canEdit()?`<button class="btn btn-secondary btn-sm" data-action="showEditModal" data-args='${JSON.stringify([a.id])}' data-stop="1">${t('btn_fill')}</button>`:'',
      t('msg_all_have_serial'))}

    ${section('🕐',t('lbl_stale'),'#64748b', stale, null,
      t('msg_all_up_to_date'))}

    ${section('📦',t('lbl_in_reserve_title'),'var(--amber)', reserved, null,
      t('msg_no_reserve'))}
  </div>`;
}
