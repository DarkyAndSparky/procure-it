/**
 * public/js/views/dashboard.js
 *
 * Фаза 5, шаг 10: первый экран view-слоя, вынесенный из public/index.html.
 * Classic script — та же причина, что и в остальных файлах (см. auth.js).
 * Самодостаточна: без параметров, только глобалы (document, currentUser,
 * esc, switchTab, API), резолвятся в момент вызова.
 */

async function renderDashboard() {
  const app=document.getElementById('app');
  app.innerHTML='<div class="spinner"></div>';
  let stats, hist;
  try {
    [stats,hist]=await Promise.all([
      fetch(`${API}/api/stats`).then(r=>r.json()),
      fetch(`${API}/api/history?limit=10`).then(r=>r.json())
    ]);
  } catch(e) {
    app.innerHTML=`<div class="card" style="color:var(--danger-text);padding:20px">
      ${t('msg_dashboard_connection_error', { msg: e.message })}<br>
      <small style="color:var(--muted)">${t('msg_ensure_server_running')}</small></div>`;
    return;
  }
  if (!stats || !hist) { app.innerHTML=`<div class="card">${t('msg_no_server_data')}</div>`; return; }
  const histItems = Array.isArray(hist) ? hist : (hist.items||[]);
  document.getElementById('total-badge').textContent=stats.total+' '+t('unit_items');
  const COLORS=['#e94560','#6366f1','#10b981','#f59e0b','#8b5cf6','#06b6d4','#f97316','#64748b','#0ea5e9','#84cc16'];
  const maxType=Math.max(...(stats.byType||[]).map(ty=>ty.n),1);
  const maxFil =Math.max(...(stats.byFilial||[]).map(f=>f.n),1);
  app.innerHTML=`
  <!-- Глобальный поиск — только для залогиненных -->
  ${currentUser ? `<div class="card" style="margin-bottom:18px;padding:14px 18px">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:20px">🔍</span>
      <input id="global-search-inp" type="text" placeholder="${t('msg_global_search_placeholder')}"
        class="focus-border-accent"
        style="flex:1;font-size:14px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;outline:none;background:var(--surface);color:var(--text)"
        data-oninput-action="globalSearchDebounce"/>
      <button class="btn btn-ghost btn-sm" id="global-search-clear" style="display:none" data-action="clearGlobalSearch">✕</button>
    </div>
    <div id="global-search-results" style="margin-top:0;overflow:hidden;max-height:0;transition:max-height 0.25s ease,margin-top 0.25s ease"></div>
  </div>` : `<div class="card" style="margin-bottom:18px;padding:18px 20px;text-align:center">
    <div style="font-size:32px;margin-bottom:10px">🔐</div>
    <div style="font-size:15px;font-weight:600;margin-bottom:6px">${t('msg_login_for_full_access')}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:14px">${t('msg_login_required_note')}</div>
    <button class="btn btn-primary" data-action="toggleAuth">${t('btn_login_to_system')}</button>
  </div>`}

  <div class="stat-grid">
    ${[{n:stats.total,l:t('lbl_total_units'),c:'#6366f1'},{n:stats.active,l:t('lbl_in_use'),c:'#10b981'},
       {n:stats.reserve,l:t('lbl_in_reserve'),c:'#f59e0b'},{n:stats.noResp,l:t('lbl_no_responsible'),c:'#e94560'},
       ...(stats.byTab||[]).map(tb=>({n:tb.n,l:tabLabel(tb.tab),c:'#8b5cf6'}))
    ].map(s=>`<div class="stat-card" style="border-left-color:${s.c}">
      <div class="stat-num" style="color:${s.c}">${s.n}</div><div class="stat-lbl">${s.l}</div></div>`).join('')}
  </div>
  <div class="two-col">
    <div class="card"><div class="section-title">${t('section_by_branch')}</div>
      ${(stats.byFilial||[]).map(f=>`<div class="bar-row"><div class="bar-lbl">${f.filial}</div>
        <div class="bar" style="width:${Math.max(f.n/maxFil*150,6)}px;background:#6366f1"></div>
        <div class="bar-num">${f.n}</div></div>`).join('')}
    </div>
    <div class="card"><div class="section-title">${t('section_by_type')}</div>
      ${(stats.byType||[]).map((ty,i)=>`<div class="bar-row"><div class="bar-lbl">${ty.type}</div>
        <div class="bar" style="width:${Math.max(ty.n/maxType*150,6)}px;background:${COLORS[i%COLORS.length]}"></div>
        <div class="bar-num">${ty.n}</div></div>`).join('')}
    </div>
  </div>
  ${currentUser ? `
  <div class="card"><div class="section-title">${t('section_recent_moves')}</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>${t('th_date')}</th><th>${t('th_event')}</th><th>${t('th_from_who')}</th><th>${t('th_to')}</th><th>${t('th_equipment')}</th><th>${t('th_reason')}</th></tr></thead>
      <tbody>${(histItems||[]).map(h=>{
        const atype=h.action_type||'move';
        const acolor={'add':'#059669','move':'#6366f1','retire':'#dc2626','import':'#0ea5e9','reassign':'#8b5cf6'}[atype]||'#6366f1';
        const aicon={'add':'+','move':'->','retire':'x','import':'v','reassign':'>'}[atype]||'->';
        const alabel={'add':t('action_add'),'move':t('action_move'),'retire':t('action_retire'),'import':t('action_import'),'reassign':t('action_move')}[atype]||esc(h.reason);
        const dt=h.date?new Date(h.date):null;
        const dateStr=dt?dt.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}):'—';
        const timeStr=dt&&h.date.length>10?dt.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
        return `<tr>
        <td style="white-space:nowrap"><div style="font-weight:600">${dateStr}</div>${timeStr?`<div style="font-size:10px;color:var(--muted)">${timeStr}</div>`:''}</td>
        <td><span style="padding:2px 7px;border-radius:20px;font-size:11px;font-weight:600;background:${acolor}18;color:${acolor}">${alabel}</span></td>
        <td style="color:var(--muted);font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.from_who)||'—'}</td>
        <td style="font-weight:500;font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.to_who)||'—'}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(h.equipment||'')}</td>
        <td><span class="badge-cat" style="font-size:10px">${esc(h.reason||'')}</span></td></tr>`;
      }).join('')}
      </tbody></table></div>
  </div>

  <div class="card" style="margin-top:18px">
    <div class="section-title">${t('section_by_org')}</div>
    ${stats.byOrg && stats.byOrg.length ? `
    <div style="display:flex;flex-direction:column;gap:6px">
      ${stats.byOrg.slice(0,10).map(o => {
        const pct = stats.total > 0 ? Math.round(o.n / stats.total * 100) : 0;
        return `<div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span>${esc(o.org)}</span>
            <span style="color:var(--muted)">${o.n} ${t('msg_units_short')} · ${pct}%</span>
          </div>
          <div style="background:var(--border);border-radius:4px;height:7px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:4px"></div>
          </div>
        </div>`;
      }).join('')}
    </div>` : `<div style="color:var(--muted);font-size:13px">${t('msg_no_data_short')}</div>`}
  </div>
  ` : ''}

  ${currentUser && (stats.noInv > 0 || stats.noSerial > 0 || stats.noResp > 0) ? `
  <div class="card" style="margin-top:18px;border-left:3px solid var(--amber)">
    <div class="section-title">${t('section_needs_attention')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
      ${stats.noResp > 0 ? `<div style="background:var(--warn-bg);border-radius:8px;padding:12px;cursor:pointer"
          data-action="switchTab" data-args='["alerts"]'>
        <div style="font-size:22px;font-weight:700;color:var(--warn-text)">${stats.noResp}</div>
        <div style="font-size:12px;color:var(--warn-text);opacity:.8">${t('lbl_no_responsible')}</div>
      </div>` : ''}
      ${stats.noInv > 0 ? `<div style="background:var(--noInv-bg);border-radius:8px;padding:12px;cursor:pointer"
          data-action="switchTab" data-args='["alerts"]'>
        <div style="font-size:22px;font-weight:700;color:var(--noInv-text)">${stats.noInv}</div>
        <div style="font-size:12px;color:var(--noInv-text);opacity:.8">${t('lbl_no_inv')}</div>
      </div>` : ''}
      ${stats.noSerial > 0 ? `<div style="background:var(--noSerial-bg);border-radius:8px;padding:12px;cursor:pointer"
          data-action="switchTab" data-args='["alerts"]'>
        <div style="font-size:22px;font-weight:700;color:var(--noSerial-text)">${stats.noSerial}</div>
        <div style="font-size:12px;color:#5b21b6">${t('lbl_no_serial')}</div>
      </div>` : ''}
    </div>
  </div>` : ''}
`;
}
