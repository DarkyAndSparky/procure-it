/**
 * public/js/views/history.js
 *
 * Фаза 5, шаг 14: экран истории целиком (state + render + связанные
 * действия), вынесенный из public/index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 *
 * histFilters/histPage/histShowAll — состояние экрана истории, читается
 * ещё и в onHistSearchInput() (остаётся в index.html, в паре с
 * onSearchInput) — безопасно, резолвится в момент вызова.
 *
 * goToAsset() тоже сюда — используется только из строк истории
 * (переход на актив по клику на запись).
 */

// Фаза 6: были составные onchange="histFilters.X=this.value;histPage=1;renderHistory()" —
// выношу в именованную функцию (el.value приходит автоматически последним
// аргументом при делегировании через data-onchange-action).
function _setHistFilter(field, value) {
  histFilters[field] = value;
  histPage = 1;
  renderHistory();
}

// Было data-onchange-action="_setHistShowAll" — читает this.checked,
// не this.value, поэтому отдельная функция (this === элемент при делегировании).
function _setHistShowAll() {
  histShowAll = this.checked;
  renderHistory();
}

// Были составные onclick="histPage=N;renderHistory()" на кнопках пагинации.
function _gotoHistPage(page) {
  histPage = page;
  renderHistory();
}

let histFilters={search:'',action_type:'',filial:'',from_date:'',to_date:''};
let histPage = 1;
let histShowAll = false;
async function renderHistory(reset) {
  const app=document.getElementById('app');
  if (reset) {
    histFilters={search:'',action_type:'',filial:'',org:'',changed_by:'',from_date:'',to_date:''};
    histPage = 1;
    histShowAll = false;
  }
  app.innerHTML='<div class="spinner"></div>';
  const ITEMS_PER_PAGE = 50;
  const itemsPerPage = histShowAll ? 10000 : ITEMS_PER_PAGE;
  const offset = (histPage - 1) * itemsPerPage;
  const p=new URLSearchParams({
    limit:itemsPerPage,
    offset:offset,
    ...Object.fromEntries(Object.entries(histFilters).filter(([,v])=>v&&v!=='Все'))
  });
  const data=await fetch(`${API}/api/history?${p}`).then(r=>r.json()).catch(()=>({items:[],total:0,stats:{},filterOptions:{}}));
  const {items=[],total=0,stats={},filterOptions={}}=data;
  const totalPages = Math.ceil(total / itemsPerPage);
  const actionIcon={'add':'➕','move':'🔄','retire':'🗑️','import':'📥','reassign':'👤','status_change':'📋'};
  const actionLabel={'add':t('action_add'),'move':t('action_move'),'retire':t('action_retire'),'import':t('action_import'),'org_transfer':t('action_org_transfer'),'reassign':t('action_move'),'status_change':t('action_status_change')};
  const actionColor={'add':'#059669','move':'#6366f1','retire':'#dc2626','import':'#0ea5e9','reassign':'#8b5cf6','status_change':'#f59e0b'};
  // Берём из filterOptions (все записи) а не из items (только страница)
  const filials    = filterOptions.filials    || [...new Set(items.map(h=>h.filial).filter(Boolean))].sort();
  const orgsInHist = filterOptions.orgs       || [...new Set(items.map(h=>h.org_name||h.org||'').filter(Boolean))].sort();
  const authors    = filterOptions.authors    || [...new Set(items.map(h=>h.changed_by).filter(Boolean))].sort();
  app.innerHTML=`
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
    <div class="card" style="flex:1;min-width:130px;padding:14px 18px;display:flex;align-items:center;gap:10px">
      <div style="font-size:26px">📋</div>
      <div><div style="font-size:22px;font-weight:800;color:#6366f1">${stats.total||0}</div><div style="font-size:11px;color:var(--muted)">${t('lbl_total_records')}</div></div>
    </div>
    <div class="card" style="flex:1;min-width:130px;padding:14px 18px;display:flex;align-items:center;gap:10px">
      <div style="font-size:26px">📅</div>
      <div><div style="font-size:22px;font-weight:800;color:#0ea5e9">${stats.today||0}</div><div style="font-size:11px;color:var(--muted)">${t('lbl_today')}</div></div>
    </div>
    <div class="card" style="flex:1;min-width:130px;padding:14px 18px;display:flex;align-items:center;gap:10px">
      <div style="font-size:26px">➕</div>
      <div><div style="font-size:22px;font-weight:800;color:#059669">${stats.adds||0}</div><div style="font-size:11px;color:var(--muted)">${t('lbl_additions')}</div></div>
    </div>
    <div class="card" style="flex:1;min-width:130px;padding:14px 18px;display:flex;align-items:center;gap:10px">
      <div style="font-size:26px">🔄</div>
      <div><div style="font-size:22px;font-weight:800;color:#6366f1">${stats.moves||0}</div><div style="font-size:11px;color:var(--muted)">${t('lbl_moves')}</div></div>
    </div>
    <div class="card" style="flex:1;min-width:130px;padding:14px 18px;display:flex;align-items:center;gap:10px">
      <div style="font-size:26px">🗑️</div>
      <div><div style="font-size:22px;font-weight:800;color:var(--noInv-text)">${stats.retires||0}</div><div style="font-size:11px;color:var(--muted)">${t('lbl_retirements')}</div></div>
    </div>
    <div class="card" style="flex:1;min-width:130px;padding:14px 18px;display:flex;align-items:center;gap:10px">
      <div style="font-size:26px">📥</div>
      <div><div style="font-size:22px;font-weight:800;color:#0ea5e9">${stats.imports||0}</div><div style="font-size:11px;color:var(--muted)">${t('lbl_imports')}</div></div>
    </div>
  </div>
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div class="section-title" style="margin:0">${t('section_history_events')} <span style="font-size:12px;color:var(--muted);font-weight:400">${t('msg_showing_of', { shown: items.length, total })}</span></div>
      <button class="btn btn-ghost btn-sm" data-action="renderHistory" data-args='[true]'>✕ ${t('btn_reset')}</button>
    </div>
    <div class="filters">
      <input class="search-inp" style="flex:2;min-width:160px" placeholder="🔍 ${t('msg_search_history_placeholder')}" value="${esc(histFilters.search)}"
        data-oninput-action="onHistSearchInput"/>
      <select class="filter-sel" data-onchange-action="_setHistFilter" data-onchange-args='["action_type"]'>
        <option value="">${t('opt_all_events')}</option>
        <option value="add" ${histFilters.action_type==='add'?'selected':''}>${t('action_add')}</option>
        <option value="move" ${histFilters.action_type==='move'?'selected':''}>${t('action_move')}</option>
        <option value="retire" ${histFilters.action_type==='retire'?'selected':''}>${t('action_retire')}</option>
        <option value="import" ${histFilters.action_type==='import'?'selected':''}>${t('action_import')}</option>
        <option value="status_change" ${histFilters.action_type==='status_change'?'selected':''}>${t('action_status_change')}</option>
        <option value="org_transfer" ${histFilters.action_type==='org_transfer'?'selected':''}>${t('action_org_transfer')}</option>
        <option value="reassign" ${histFilters.action_type==='reassign'?'selected':''}>${t('action_move')}</option>
      </select>
      <select class="filter-sel" data-onchange-action="_setHistFilter" data-onchange-args='["filial"]'>
        <option value="">${t('opt_all_branches')}</option>
        ${filials.map(f=>`<option value="${esc(f)}" ${histFilters.filial===f?'selected':''}>${esc(f)}</option>`).join('')}
      </select>
      <select class="filter-sel" data-onchange-action="_setHistFilter" data-onchange-args='["org"]'>
        <option value="">${t('opt_all_orgs')}</option>
        ${orgsInHist.map(o=>`<option value="${esc(o)}" ${histFilters.org===o?'selected':''}>${esc(o)}</option>`).join('')}
      </select>
      <select class="filter-sel" style="min-width:140px" data-onchange-action="_setHistFilter" data-onchange-args='["changed_by"]'>
        <option value="">${t('opt_all_authors')}</option>
        ${authors.map(a=>`<option value="${esc(a)}" ${histFilters.changed_by===a?'selected':''}>${esc(a)}</option>`).join('')}
      </select>
      <input type="date" class="filter-date" value="${histFilters.from_date}" title="${t('tooltip_date_from')}"
        data-onchange-action="_setHistFilter" data-onchange-args='["from_date"]'/>
      <input type="date" class="filter-date" value="${histFilters.to_date}" title="${t('tooltip_date_to')}"
        data-onchange-action="_setHistFilter" data-onchange-args='["to_date"]'/>
      ${Object.values(histFilters).some(v=>v) ? `<button class="btn btn-ghost btn-sm" data-action="renderHistory" data-args='[true]'>✕ ${t('btn_reset')}</button>` : ''}
    </div>
    ${items.length===0?`<div style="text-align:center;padding:40px;color:var(--muted)">${t('msg_no_records_for_filters')}</div>`:`
    <div class="tbl-wrap"><table>
      <thead><tr><th>${t('th_datetime')}</th><th>${t('th_event')}</th><th>${t('th_equipment')}</th><th>${t('field_serial')}</th><th>${t('th_from')}</th><th>${t('th_to')} / ${t('th_where')}</th><th>${t('field_filial')}</th><th>${t('th_author')}</th><th>${t('th_reason')}</th></tr></thead>
      <tbody>${items.map(h=>{
        const dt=h.date?new Date(h.date):null;
        const dateStr=dt?dt.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}):'—';
        const timeStr=dt&&h.date.length>10?dt.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
        const atype=h.action_type||'move';
        const color=actionColor[atype]||'#6366f1';
        const icon=actionIcon[atype]||'🔄';
        const label=actionLabel[atype]||esc(h.reason);
        return `<tr style="cursor:${h.asset_id?'pointer':'default'}" ${h.asset_id?`data-action="goToAsset" data-args='${JSON.stringify([h.asset_id])}'`:''}>
          <td style="white-space:nowrap">
            <div style="font-weight:600;color:var(--text)">${dateStr}</div>
            ${timeStr?`<div style="font-size:11px;color:var(--muted)">${timeStr}</div>`:''}
          </td>
          <td><span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600;background:${color}18;color:${color}">${icon} ${label}</span></td>
          <td style="max-width:200px">
            <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(h.equipment)}">${esc(h.equipment)||'—'}</div>
            ${h.type?`<div style="font-size:11px;color:var(--muted)">${esc(h.type)}</div>`:''}
          </td>
          <td class="mono" style="font-size:11px;color:var(--muted)">${esc(h.serial)||'—'}</td>
          <td style="color:var(--muted);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(h.from_who)}">${esc(h.from_who)||'—'}</td>
          <td style="max-width:160px">
            <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(h.to_who)}">${esc(h.to_who)||'—'}</div>
            ${h.location?`<div style="font-size:11px;color:var(--muted)">${esc(h.location)}</div>`:''}
          </td>
          <td style="font-size:12px">${esc(h.filial)||'—'}</td>
          <td style="font-size:12px;color:var(--muted);white-space:nowrap">${esc(h.changed_by)||'—'}</td>
          <td><span class="badge-cat">${esc(h.reason)||'—'}</span></td>
        </tr>`;}).join('')}
      </tbody></table></div>
    ${totalPages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" data-action="_gotoHistPage" data-args='[1]' ${histPage===1?'disabled':''}>⏮</button>
        <button class="btn btn-ghost btn-sm" data-action="_gotoHistPage" data-args='${JSON.stringify([Math.max(1,histPage-1)])}' ${histPage===1?'disabled':''}>◀</button>
        <span style="font-size:12px;color:var(--muted);min-width:100px;text-align:center">${t('lbl_page_of', { page: histPage, count: totalPages })}</span>
        <button class="btn btn-ghost btn-sm" data-action="_gotoHistPage" data-args='${JSON.stringify([Math.min(totalPages,histPage+1)])}' ${histPage===totalPages?'disabled':''}>▶</button>
        <button class="btn btn-ghost btn-sm" data-action="_gotoHistPage" data-args='${JSON.stringify([totalPages])}' ${histPage===totalPages?'disabled':''}>⏭</button>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin-left:8px">
          <input type="checkbox" id="hist-show-all" data-onchange-action="_setHistShowAll">
          ${t('lbl_show_all')} (${total})
        </label>
      </div>
    ` : ''}
    `}
  </div>`;
}


function goToAsset(assetId) {
  // Переходим на вкладку ОС и открываем карточку ассета
  const asset = assetsCache.find(a => a.id === assetId);
  const tab = asset?.tab || 'os';
  switchTab(tab);
  setTimeout(() => showDetail(assetId), 450);
}

async function importHistory() {
  const file=document.getElementById('csv-file').files[0];
  if (!file) return toast(t('msg_import_history_file'),'error');
  const setP=(pct,label)=>{
    document.getElementById('import-progress').style.display='block';
    document.getElementById('import-progress-bar').style.width=pct+'%';
    document.getElementById('import-progress-label').textContent=label;
  };
  const btn=document.getElementById('import-btn');
  btn.disabled=true;
  document.getElementById('import-result').innerHTML='';
  setP(5,t('msg_reading_file'));
  const text=await file.text();
  const lines=text.replace(/^\uFEFF/,'').split('\n').filter(l=>l.trim());
  if (lines.length<2){btn.disabled=false;return toast(t('msg_empty_file'),'error');}
  setP(20,t('msg_parsing_rows'));
  const sep=lines[0].includes(';')?';':',';
  function parseRow(line){const res=[];let cur='',inQ=false;
    for(let i=0;i<line.length;i++){const c=line[i];
      if(c==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
      else if(c===sep&&!inQ){res.push(cur);cur='';}else cur+=c;}
    res.push(cur);return res;}
  const headers=parseRow(lines[0]).map(h=>h.trim().toLowerCase());
  const MAP={'дата':'date','от кого':'from_who','кому':'to_who','оборудование':'equipment',
    'причина':'reason','тип события':'action_type','кто изменил':'changed_by'};
  const rows=lines.slice(1).map(l=>{
    const vals=parseRow(l);const row={};
    headers.forEach((h,i)=>{const k=MAP[h];if(k)row[k]=vals[i]||'';});
    return row;}).filter(r=>r.date||r.equipment);
  if (!rows.length){btn.disabled=false;return toast(t('msg_no_data'),'error');}
  setP(40,t('msg_found_records_sending', { n: rows.length }));
  let animPct=40;
  const anim=setInterval(()=>{if(animPct<85){animPct+=0.5;document.getElementById('import-progress-bar').style.width=animPct+'%';}},80);
  const r=await fetch(`${API}/api/import/history`,{method:'POST',headers:ah(),body:JSON.stringify({rows})});
  clearInterval(anim);
  const d=await r.json();
  btn.disabled=false;
  if (r.ok){
    setP(100,t('msg_history_done_added', { n: d.added }));
    document.getElementById('import-progress-bar').style.background='linear-gradient(90deg,#10b981,#059669)';
    document.getElementById('import-result').innerHTML=`<span style="color:#065f46">✅ ${t('msg_history_added_count', { n: d.added })}</span>`;
    toast(t('msg_history_imported_count', { n: d.added }),'success');
    setTimeout(()=>renderHistory(true), 800);
  } else {
    setP(100,t('msg_error'));
    document.getElementById('import-progress-bar').style.background='#ef4444';
    toast(d.error||t('msg_error'),'error');
  }
}
