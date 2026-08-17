// ─── Pagination ──────────────────────────────────────────────────────────────
function goPage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderRegistryRows(allReqs);
}

function changePageSize() {
  const sel = document.getElementById('pg-size');
  pageSize = parseInt(sel.value);
  currentPage = 1;
  renderRegistryRows(allReqs);
}

function renderPaginationBar(total) {
  const bar = document.getElementById('pagination-bar');
  if (!bar) return;

  if (total <= pageSize) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  totalPages = Math.ceil(total / pageSize);

  document.getElementById('pagination-info').textContent =
    `Показано ${Math.min((currentPage-1)*pageSize+1, total)}–${Math.min(currentPage*pageSize, total)} из ${total}`;

  // Page buttons (show max 5 around current)
  const pages = document.getElementById('pg-pages');
  pages.innerHTML = '';
  let start = Math.max(1, currentPage - 2);
  let end   = Math.min(totalPages, start + 4);
  start = Math.max(1, end - 4);

  for (let i = start; i <= end; i++) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = i;
    btn.onclick = () => goPage(i);
    if (i === currentPage) {
      btn.style.background = 'var(--accent)';
      btn.style.borderColor = 'var(--accent)';
      btn.style.color = '#fff';
    }
    pages.appendChild(btn);
  }

  // Disable prev/next buttons
  document.getElementById('pg-first').disabled = currentPage === 1;
  document.getElementById('pg-prev').disabled  = currentPage === 1;
  document.getElementById('pg-next').disabled  = currentPage === totalPages;
  document.getElementById('pg-last').disabled  = currentPage === totalPages;
}

// Кэш полных данных заявки по id — нужен для ленивого построения детальной
// строки реестра (см. buildDetailHtml/toggleDetail ниже): при первом
// рендере таблицы строим только видимую свёрнутую строку, а тяжёлую
// детальную разметку (позиции, кнопки, статус раскладки и т.д.) — только
// когда пользователь реально разворачивает конкретную заявку. При росте
// реестра до многих сотен строк это ощутимо экономит время первого рендера
// страницы, которое раньше тратилось на построение HTML для ВСЕХ строк
// текущей страницы разом, даже свёрнутых.
const registryRowData = {};

function buildDetailHtml(r) {
  return `
        <div class="detail-grid">
          <div class="detail-item"><span>Поставщик</span>${esc(r.supplier||'—')}</div>
          <div class="detail-item"><span>Номер счёта</span>${r.invoiceNum ? `<span style="font-family:monospace;color:var(--accent)">${esc(r.invoiceNum)}</span>` : '—'}</div>
          <div class="detail-item"><span>Контрагент</span>${r.counterparty ? esc(r.counterparty) : '—'}</div>
          <div class="detail-item"><span>Договор</span>${esc(r.contract||'—')}</div>
          <div class="detail-item"><span>Битрикс</span>${r.bitrix?'#'+esc(r.bitrix):'—'}</div>
          <div class="detail-item"><span>Адрес</span>${esc(r.address||'—')}</div>
          ${r.comment?`<div class="detail-item" style="grid-column:1/-1"><span>Комментарий</span>${esc(r.comment)}</div>`:''}
          <div class="detail-item" style="grid-column:1/-1"><span>Путь папки</span><span style="font-family:monospace;font-size:11px;color:var(--accent);cursor:pointer" onclick="openRequestFolder('${escJsAttr(r.id)}')" title="Нажать, чтобы открыть папку заявки">📁 ${esc(buildFolderPath(r))}</span></div>
        </div>
        <table style="font-size:12px;width:100%;border-collapse:collapse">
          <tr><th style="padding:4px 8px;background:none;border-bottom:1px solid var(--border);font-size:11px">Наименование</th><th style="padding:4px;background:none;border-bottom:1px solid var(--border);font-size:11px;width:120px">${r.isRealization?'ЮЛ / Кому':'Комментарий'}</th><th style="padding:4px;background:none;border-bottom:1px solid var(--border);font-size:11px;width:60px">Кол-во</th><th style="padding:4px;background:none;border-bottom:1px solid var(--border);font-size:11px;width:90px">Закуп</th><th style="padding:4px;background:none;border-bottom:1px solid var(--border);font-size:11px;width:90px">Продажа</th></tr>
          ${r.positions.map(p=>`<tr><td style="padding:3px 8px;border:none">${esc(p.name)}</td><td style="padding:3px 4px;border:none;font-size:11px;color:var(--text-secondary)">${esc(p.comment||p.rowOrgName||'—')}</td><td style="padding:3px 4px;border:none">${p.qty} ${p.unit||'шт'}</td><td style="padding:3px 4px;border:none;text-align:right">${fmtRub(p.purchasePrice)}</td><td style="padding:3px 4px;border:none;text-align:right;color:var(--accent)">${fmtRub(p.sellPerUnit||0)}</td></tr>`).join('')}
        </table>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-sm btn-success" onclick="exportExcelById('${escJsAttr(r.id)}')">📊 Excel</button>
          ${!r.isRealization?`<button class="btn btn-sm" onclick="loadSpec('${escJsAttr(r.id)}')">${r.docType==='install'?'🔧 Смета на работы':r.docType==='support'?'🛠️ Сопровождение':r.docType==='realization'?'🏪 Спецификация на реализацию':'📄 Спецификация'}</button>`:''}
          ${userRole !== 'viewer' ? `
          <button class="btn btn-sm" onclick="loadToForm('${escJsAttr(r.id)}',true)">📋 Копировать</button>
          <label class="btn btn-sm" style="cursor:pointer;background:${r.signedSpecPdf?'var(--success)':'var(--surface-2)'};border-color:${r.signedSpecPdf?'var(--success)':'var(--border)'};color:${r.signedSpecPdf?'#fff':'var(--text)'}" title="${r.signedSpecPdf?'Подписанная спецификация прикреплена. Нажмите чтобы заменить':'Прикрепить подписанную спецификацию PDF'}">
            ${(r.signedSpecPdf&&r.signedSpecPdf!=='')?'✅ Спецификация подписана':'📎 Прикрепить подпись'}
            <input type="file" accept=".pdf" style="display:none" onchange="uploadSignedSpec('${escJsAttr(r.id)}',this)">
          </label>
          ${r.signedSpecPdf?`<button class="btn btn-sm" onclick="downloadSignedSpec('${escJsAttr(r.id)}','${escJsAttr(r.specNum)}','${escJsAttr(r.orgShort)}')" title="Скачать подписанную спецификацию">⬇️ Скачать подпись</button>`:''}
          <label class="btn btn-sm" style="cursor:pointer;background:${r.invoiceFile?'var(--success)':'var(--surface-2)'};border-color:${r.invoiceFile?'var(--success)':'var(--border)'};color:${r.invoiceFile?'#fff':'var(--text)'}" title="${r.invoiceFile?'Счёт прикреплён. Нажмите чтобы заменить':'Прикрепить счёт (PDF/фото)'}">
            ${(r.invoiceFile&&r.invoiceFile!=='')?'✅ Счёт прикреплён':'🧾 Прикрепить счёт'}
            <input type="file" accept=".pdf,image/*" style="display:none" onchange="uploadInvoiceFile('${escJsAttr(r.id)}',this)">
          </label>
          ${r.invoiceFile?`<button class="btn btn-sm" onclick="downloadInvoiceFile('${escJsAttr(r.id)}','${escJsAttr(r.specNum)}')" title="Скачать счёт">⬇️ Скачать счёт</button>`:''}
          ${appConfig.networkFolder?`<button class="btn btn-sm" id="layout-btn-${esc(r.id)}" onclick="event.stopPropagation();forceLayoutFiles('${escJsAttr(r.id)}',this)" title="Разложить файлы в сетевую папку" style="background:var(--warning-bg);border-color:var(--warning);color:var(--warning)">📁 Разложить файлы</button><span id="layout-status-${esc(r.id)}" style="font-size:11px;color:var(--text-muted)"></span>`:''}
          <button class="btn btn-sm" style="margin-left:auto;color:var(--danger);border-color:var(--danger)" onclick="deleteRequest('${escJsAttr(r.id)}')">Удалить</button>
          ` : `${r.signedSpecPdf?`<button class="btn btn-sm" onclick="downloadSignedSpec('${escJsAttr(r.id)}','${escJsAttr(r.specNum)}','${escJsAttr(r.orgShort)}')" title="Скачать подписанную спецификацию">⬇️ Скачать подпись</button>`:''}${r.invoiceFile?`<button class="btn btn-sm" onclick="downloadInvoiceFile('${escJsAttr(r.id)}','${escJsAttr(r.specNum)}')" title="Скачать счёт">⬇️ Скачать счёт</button>`:''}`}
        </div>
        <div id="audit-${esc(r.id)}" style="display:none;margin-top:10px;border-top:1px solid var(--border);padding-top:10px;font-size:12px"></div>`;
}

function renderRegistryRows(reqs) {
  const body = document.getElementById('registry-body');
  const empty = document.getElementById('registry-empty');
  body.innerHTML = '';

  if (reqs.length === 0) {
    empty.style.display = 'block';
    document.getElementById('pagination-bar').style.display = 'none';
    return;
  }

  empty.style.display = 'none';

  // Paginate
  const start = (currentPage - 1) * pageSize;
  const page  = reqs.slice(start, start + pageSize);

  page.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'row-toggle';
    tr.onclick = () => toggleDetail(r.id);
    const realizBadge = r.isRealization ? ' <span style="font-size:10px;background:var(--accent-bg);color:var(--accent);padding:1px 5px;border-radius:4px;margin-left:4px">реализация</span>' : '';
    const docTypeBadge = r.docType === 'install' ? ' <span style="font-size:10px;background:var(--warning-bg);color:var(--warning);padding:1px 5px;border-radius:4px;margin-left:4px">монтаж</span>'
      : r.docType === 'support' ? ' <span style="font-size:10px;background:var(--surface-2);color:var(--text-secondary);padding:1px 5px;border-radius:4px;margin-left:4px">сопровождение</span>'
      : r.docType === 'realization' ? ' <span style="font-size:10px;background:var(--accent-bg);color:var(--accent);padding:1px 5px;border-radius:4px;margin-left:4px">реализация</span>' : '';
    tr.innerHTML = `
      <td><span class="chevron" id="ch-${esc(r.id)}">▶</span></td>
      <td><span style="font-family:monospace;font-size:12px;color:var(--accent)">${esc(r.specNum)}</span>${realizBadge}${docTypeBadge}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${fmtDate(r.date)}</td>
      <td>${esc(r.orgShort||'')}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.name)}">${esc(r.name)}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${esc(r.mol||'')}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="text-align:center"><span class="num-badge">${r.positions.length}</span></td>
      <td style="font-weight:600;font-size:12px">${fmtRub(r.total)}</td>
      <td>
        <button class="btn btn-sm" onclick="event.stopPropagation();loadToForm('${escJsAttr(r.id)}')">Ред.</button>
        <select class="btn btn-sm status-select" onchange="event.stopPropagation();changeStatus('${escJsAttr(r.id)}',this.value)" onclick="event.stopPropagation()" style="margin-left:4px;padding:2px 4px;font-size:11px;cursor:pointer" ${userRole==='viewer'?'disabled title="Только для операторов"':''}>
          ${Object.entries(STATUS_MAP).map(([k,v])=>`<option value="${k}" ${r.status===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </td>`;
    body.appendChild(tr);
    registryRowData[r.id] = r;

    const detail = document.createElement('tr');
    // Ленивая деталь: сам контейнер есть сразу (нужен для CSS-переходов и
    // toggleDetail), а содержимое строится по требованию — см.
    // buildDetailHtml() и toggleDetail() ниже.
    detail.innerHTML = `<td colspan="10" style="padding:0"><div id="detail-${esc(r.id)}" class="registry-detail"></div></td>`;
    body.appendChild(detail);
  });

  renderPaginationBar(reqs.length);
}

async function renderRegistry() {
  const search    = (document.getElementById('reg-search')?.value || '').toLowerCase();
  const filterOrg = document.getElementById('reg-filter-org')?.value || '';
  const filterMonth = document.getElementById('reg-filter-month')?.value || '';
  const filterStatus = document.getElementById('reg-filter-status')?.value || '';

  // Build query
  const params = new URLSearchParams();
  if (search)      params.set('q', search);
  if (filterOrg)      params.set('org', filterOrg);
  if (filterMonth)    params.set('month', filterMonth);
  if (filterStatus)   params.set('status', filterStatus);
  const filterSupplier = document.getElementById('reg-filter-supplier')?.value || '';
  if (filterSupplier) params.set('supplier', filterSupplier);
  const filterCounterparty = document.getElementById('reg-filter-counterparty')?.value || '';
  if (filterCounterparty) params.set('counterparty', filterCounterparty);

  let reqs = [];
  let totalCount = 0;
  try {
    const resp = await api('GET', '/api/requests?' + params.toString());
    // Support both paginated {items, total} and legacy array response
    if (Array.isArray(resp)) {
      reqs = resp; totalCount = resp.length;
    } else {
      reqs = resp.items || []; totalCount = resp.total || reqs.length;
    }
    db.requests = reqs; // cache for stats
  } catch(e) { return; }

  // Cache all results and paginate
  allReqs = reqs;
  currentPage = 1;
  renderRegistryRows(reqs);
  startLayoutStatusPolling();

    // Stats from API
  try {
    const stats = await api('GET', '/api/stats');
    const isFiltered = !!(search || filterOrg || filterMonth || filterStatus || filterSupplier || filterCounterparty);
    const filteredTotal = reqs.reduce((s,r)=>s+r.total,0);
    document.getElementById('stats-row').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Всего заявок</div>
        <div class="stat-value">${stats.totalRequests}</div>
        ${isFiltered ? `<div class="stat-sub" style="color:var(--accent)">Найдено: ${reqs.length}</div>` : `<div class="stat-sub">В этом месяце: ${stats.thisMonth}</div>`}
      </div>
      <div class="stat-card">
        <div class="stat-label">${isFiltered ? 'Сумма выборки' : 'Продажи всего'}</div>
        <div class="stat-value" style="font-size:16px">${fmtRub(isFiltered ? filteredTotal : stats.totalSell)}</div>
        ${isFiltered ? `<div class="stat-sub">Всего: ${fmtRub(stats.totalSell)}</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-label">Закуп всего</div>
        <div class="stat-value" style="font-size:16px">${fmtRub(stats.totalPurchase)}</div>
        <div class="stat-sub">Прибыль: ${fmtRub(stats.totalSell - stats.totalPurchase)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Действия</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
          <button class="btn btn-sm" onclick="exportRegistryExcel()" style="background:var(--accent);border-color:var(--accent);color:#fff">📊 Экспорт реестра</button>
          <button class="btn btn-sm" onclick="exportRegistryCsv()" title="Экспорт в CSV — для внешних систем/BI">📄 CSV</button>
          <button class="btn btn-sm" onclick="toggleBreakdown()" id="breakdown-btn">📈 Разбивка по орг.</button>
        </div>
      </div>`;
    renderBreakdown(reqs);

    // Update org filter options
    const orgSel = document.getElementById('reg-filter-org');
    const curOrg = orgSel.value;
    orgSel.innerHTML = '<option value="">Все организации</option>';
    db.orgs.forEach(o => {
      if (reqs.some(r=>r.orgId===o.id) || db.requests.some(r=>r.orgId===o.id))
        orgSel.innerHTML += `<option value="${esc(o.id)}" ${curOrg===o.id?'selected':''}>${o.short}</option>`;
    });

    // Supplier filter
    const supplierSel = document.getElementById('reg-filter-supplier');
    if (supplierSel) {
      const curSupplier = supplierSel.value;
      const suppliers = [...new Set(db.requests.map(r=>r.supplier).filter(Boolean))].sort();
      supplierSel.innerHTML = '<option value="">Все поставщики</option>';
      suppliers.forEach(s => {
        supplierSel.innerHTML += `<option value="${esc(s)}" ${curSupplier===s?'selected':''}>${esc(s)}</option>`;
      });
    }

    // Counterparty filter (магазин/поставщик закупки — отдельное поле от
    // «Поставщика» в шапке документа, см. request-form.js)
    const counterpartySel = document.getElementById('reg-filter-counterparty');
    if (counterpartySel) {
      const curCounterparty = counterpartySel.value;
      const counterparties = [...new Set(db.requests.map(r=>r.counterparty).filter(Boolean))].sort();
      counterpartySel.innerHTML = '<option value="">Все контрагенты</option>';
      counterparties.forEach(c => {
        counterpartySel.innerHTML += `<option value="${esc(c)}" ${curCounterparty===c?'selected':''}>${esc(c)}</option>`;
      });
    }

    // Month filter
    const monthSel = document.getElementById('reg-filter-month');
    const curM = monthSel.value;
    const allMonths = [...new Set(db.requests.map(r=>r.date?.slice(0,7)).filter(Boolean))].sort().reverse();
    monthSel.innerHTML = '<option value="">Все месяцы</option>';
    allMonths.forEach(m => {
      const [y,mo] = m.split('-');
      monthSel.innerHTML += `<option value="${m}" ${curM===m?'selected':''}>${months[parseInt(mo)-1]} ${y}</option>`;
    });
  } catch(e) { console.error('Stats error', e); }
}

function toggleDetail(id) {
  const el = document.getElementById('detail-' + id);
  const ch = document.getElementById('ch-' + id);
  const isOpen = el.classList.contains('open');
  document.querySelectorAll('.registry-detail').forEach(e => e.classList.remove('open'));
  document.querySelectorAll('.chevron').forEach(c => c.classList.remove('open'));
  if (!isOpen) {
    // Ленивая генерация содержимого — строим HTML детали только при первом
    // реальном разворачивании этой строки, не заранее для всех строк
    // страницы (см. registryRowData/buildDetailHtml выше).
    if (!el.dataset.rendered) {
      const r = registryRowData[id];
      if (r) {
        el.innerHTML = buildDetailHtml(r);
        el.dataset.rendered = '1';
      }
    }
    el.classList.add('open');
    ch.classList.add('open');
    // Форс-проверка статуса раскладки при открытии строки — раньше это
    // нигде не проверялось после перезапуска сервера, кнопка всегда
    // выглядела одинаково независимо от того, лежат файлы в сетевой папке
    // или нет.
    checkLayoutStatus(id);
  }
}

// ─── Статус раскладки файлов в сетевую папку ────────────────────────────────
// Не хранится как флаг в БД (раскладка идёт напрямую в сетевую папку/WebDAV,
// это единственный источник истины) — проверяем по требованию: при открытии
// строки реестра и периодически, пока строка остаётся раскрытой.
const LAYOUT_STATUS_CACHE = {};
let layoutStatusPollTimer = null;

async function checkLayoutStatus(id) {
  const btn = document.getElementById('layout-btn-' + id);
  const badge = document.getElementById('layout-status-' + id);
  if (!btn || !appConfig.networkFolder) return;
  try {
    const status = await api('GET', `/api/requests/${id}/layout-status`);
    LAYOUT_STATUS_CACHE[id] = status;
    applyLayoutStatusUI(id, status);
  } catch(e) {
    if (badge) { badge.textContent = ''; }
  }
}

function applyLayoutStatusUI(id, status) {
  const btn = document.getElementById('layout-btn-' + id);
  const badge = document.getElementById('layout-status-' + id);
  if (!btn) return;
  if (status.laidOut) {
    btn.textContent = '✅ Разложено';
    btn.title = 'Файлы уже в сетевой папке. Нажать, чтобы разложить заново';
    btn.style.background = 'var(--success-bg)';
    btn.style.borderColor = 'var(--success)';
    btn.style.color = 'var(--success)';
    if (badge) badge.textContent = status.fileCount ? `(${status.fileCount})` : '';
  } else {
    btn.textContent = '📁 Разложить файлы';
    btn.title = 'Разложить файлы в сетевую папку';
    btn.style.background = 'var(--warning-bg)';
    btn.style.borderColor = 'var(--warning)';
    btn.style.color = 'var(--warning)';
    if (badge) badge.textContent = '';
  }
}

// Периодическая перепроверка — только для реально раскрытых строк (не
// долбим сетевую папку/WebDAV статусами по всем заявкам сразу).
function startLayoutStatusPolling() {
  if (layoutStatusPollTimer) clearInterval(layoutStatusPollTimer);
  layoutStatusPollTimer = setInterval(() => {
    document.querySelectorAll('.registry-detail.open').forEach(el => {
      const id = el.id.replace('detail-', '');
      checkLayoutStatus(id);
    });
  }, 5 * 60 * 1000); // раз в 5 минут
}

async function deleteRequest(id) {
  if (!confirm('Удалить заявку?')) return;
  await api('DELETE', '/api/requests/' + id);
  renderRegistry();
  toast('Заявка удалена');
}

async function addOrg() {
  const full = document.getElementById('new-org-full').value.trim();
  const short = document.getElementById('new-org-short').value.trim();
  const signatory = document.getElementById('new-org-signatory').value.trim();
  const contract  = document.getElementById('new-org-contract').value.trim();
  const address   = document.getElementById('new-org-address').value.trim();
  const folder    = document.getElementById('new-org-folder').value.trim();
  if (!full || !short) { toast('Заполните все поля'); return; }
  const org = await api('POST', '/api/orgs', { full, short, signatory, contract, address, folder });
  db.orgs.push(org);
  ['full','short','signatory','contract','address','folder'].forEach(f => {
    const el = document.getElementById('new-org-' + f); if (el) el.value = '';
  });
  renderOrgs();
  populateOrgSelect();
  toast('Организация добавлена');
}

async function deleteOrg(id) {
  try {
    await api('DELETE', '/api/orgs/' + id);
    db.orgs = db.orgs.filter(o => o.id !== id);
    renderOrgs();
    populateOrgSelect();
    toast('Организация удалена');
  } catch(e) { /* error shown by api() */ }
}

function renderOrgs() {
  const list = document.getElementById('org-list');
  if (db.orgs.length === 0) {
    list.innerHTML = '<div class="empty"><p>Нет организаций</p></div>';
    return;
  }
  list.innerHTML = db.orgs.map(o => `
    <div class="org-item" style="cursor:pointer" onclick="openOrgModal('${escJsAttr(o.id)}')">
      <div style="flex:1">
        <div class="org-name">${esc(o.full)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(o.short)} · ${esc(o.signatory||'—')}</div>
        ${o.contract ? `<div style="font-size:11px;color:var(--accent);margin-top:2px">📄 ${esc(o.contract)}</div>` : '<div style="font-size:11px;color:var(--danger);margin-top:2px">📄 договор не задан</div>'}
        ${o.address  ? `<div style="font-size:11px;color:var(--text-muted);margin-top:1px">📍 ${esc(o.address)}</div>`  : ''}
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="btn btn-sm" onclick="event.stopPropagation();openOrgModal('${escJsAttr(o.id)}')" style="font-size:11px">✏️ Ред.</button>
        <button class="del-btn" onclick="event.stopPropagation();deleteOrg('${escJsAttr(o.id)}')">×</button>
      </div>
    </div>`).join('');
}

function populateOrgSelect() {
  const sel = document.getElementById('f-org');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— выбрать —</option>';
  db.orgs.forEach(o => {
    sel.innerHTML += `<option value="${esc(o.id)}" ${cur===o.id?'selected':''}>${o.short}</option>`;
  });

  // Datalist для автокомплита #f-org-search — метка «Короткое (Полное)»,
  // чтобы можно было найти организацию и по краткому названию, и по части
  // полного, не листая длинный select руками.
  const datalist = document.getElementById('f-org-datalist');
  if (datalist) {
    datalist.innerHTML = db.orgs.map(o => `<option value="${esc(orgSearchLabel(o))}">`).join('');
  }
  syncOrgSearchDisplay();

  const specSel = document.getElementById('spec-select');
  const pool = allReqs.length ? allReqs : db.requests;
  specSel.innerHTML = '<option value="">— Выбрать сохранённую заявку —</option>';
  pool.forEach(r => {
    specSel.innerHTML += `<option value="${esc(r.id)}">${esc(r.specNum)} — ${esc(r.name)}</option>`;
  });
}

// ─── Автокомплит выбора организации (#f-org-search + #f-org-datalist) ──────
// select #f-org остаётся единственным источником истины для org id — этот
// слой только переводит удобный текстовый поиск в его value и обратно.
function orgSearchLabel(o) {
  return `${o.short} (${o.full})`;
}

function syncOrgSearchDisplay() {
  const search = document.getElementById('f-org-search');
  const sel = document.getElementById('f-org');
  if (!search || !sel) return;
  const org = db.orgs.find(o => o.id === sel.value);
  search.value = org ? orgSearchLabel(org) : '';
}

function onOrgSearchInput() {
  const search = document.getElementById('f-org-search');
  const sel = document.getElementById('f-org');
  if (!search || !sel) return;
  const typed = search.value.trim();
  // Ищем точное совпадение с меткой даталиста, а как фолбэк — точное
  // совпадение с коротким или полным названием (на случай если пользователь
  // допечатал вручную, не выбирая из подсказки мышью/стрелками).
  const org = db.orgs.find(o => orgSearchLabel(o) === typed)
    || db.orgs.find(o => o.short === typed)
    || db.orgs.find(o => o.full === typed);
  if (org) {
    if (sel.value !== org.id) {
      sel.value = org.id;
      updateSpecNum();
      fillOrgDefaults();
    }
  } else if (!typed) {
    sel.value = '';
    updateSpecNum();
  }
  // Если введённый текст не совпадает ни с одной организацией — оставляем
  // предыдущее выбранное значение в #f-org (не сбрасываем на полпути ввода),
  // пока пользователь не допечатает точное совпадение или не выберет явно.
}

// ─── Pages ───────────────────────────────────────────────────────────────────
const pageTitles = {
  new: 'Новая заявка',
  registry: 'Реестр заявок',
  spec: 'Спецификация',
  orgs: 'Организации',
  config: 'Настройки',
  about: 'О системе'
};

function showPage(name) {
  // Role guard — enforce server-side roles client-side too
  const pageRoles = { new: 'operator', orgs: 'operator', config: 'admin', about: 'admin' };
  const required  = pageRoles[name];
  if (required) {
    const isOp    = userRole === 'operator' || userRole === 'admin';
    const isAdmin = userRole === 'admin';
    if (required === 'admin'    && !isAdmin) { toast('⛔ Только для администраторов'); return; }
    if (required === 'operator' && !isOp)    { toast('⛔ Требуется вход как оператор'); return; }
  }

  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById('page-' + name).style.display = 'block';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  document.getElementById('page-title').textContent = pageTitles[name] || name;

  if (name === 'registry') renderRegistry();
  if (name === 'orgs') renderOrgs();
  if (name === 'spec') populateOrgSelect();
  if (name === 'config') {
    populateConfigPage();
    if (userRole === 'admin') loadUsers();
  }
  if (name === 'about') loadSystemInfoPage();
  if (name === 'new') {
    initDragDrop();
    const supplierField = document.getElementById('f-supplier');
    if (supplierField && !supplierField.value && appConfig.supplierName) {
      supplierField.value = appConfig.supplierName;
    }
  }
}

function clearForm() {
  editingId = null;
  setEditingState(false);
  // Reset realization mode
  document.getElementById('realization-badge').style.display = 'none';
  const th = document.querySelector('#page-new table thead th:nth-child(4)');
  if (th) { th.textContent = 'Комментарий / ФИО'; th.style.color = ''; }
  document.getElementById('f-org').value = '';
  syncOrgSearchDisplay();
  document.getElementById('f-bitrix').value = '';
  document.getElementById('f-name').value = '';
  document.getElementById('f-mol').value = '';
  document.getElementById('f-date').value = '';
  document.getElementById('f-address').value = '';
  document.getElementById('f-supplier').value = appConfig.supplierName || '';
  document.getElementById('f-contract').value = '';
  document.getElementById('f-invoice-num').value = '';
  const cpEl0 = document.getElementById('f-counterparty'); if (cpEl0) cpEl0.value = '';
  const wpEl0 = document.getElementById('f-warranty-period'); if (wpEl0) wpEl0.value = '';
  document.getElementById('f-status').value = 'new';
  document.getElementById('f-comment').value = '';
  document.getElementById('f-markup').value = '5';
  document.getElementById('f-markup').disabled = false;
  document.getElementById('f-no-markup').checked = false;
  document.getElementById('f-doc-type').value = 'goods';
  onDocTypeChange();
  document.getElementById('folder-card').style.display = 'none';
  document.getElementById('positions-body').innerHTML = '';
  rowCounter = 0;
  document.getElementById('invoice-name').textContent = '';
  updateSpecNum();
  calcTotal();
}

// ─── Audit log ───────────────────────────────────────────────────────────────
const ACTION_LABELS = {
  CREATE: { label: 'Создана',  color: 'var(--success)' },
  UPDATE: { label: 'Изменена', color: 'var(--accent)'  },
  STATUS: { label: 'Статус',   color: 'var(--warning)' },
  DELETE: { label: 'Удалена',  color: 'var(--danger)'  },
};

async function toggleAuditLog(id) {
  const panel = document.getElementById('audit-' + id);
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div style="color:var(--text-muted);padding:8px">Загрузка истории...</div>';

  try {
    const logs = await api('GET', `/api/audit?request_id=${id}&limit=50`);
    if (!logs.length) {
      panel.innerHTML = '<div style="color:var(--text-muted);padding:8px">История изменений пуста</div>';
      return;
    }

    panel.innerHTML = `
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px">
        📋 История изменений (${logs.length})
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${logs.map(log => {
          const action = ACTION_LABELS[log.action] || { label: log.action, color: 'var(--text-muted)' };
          const meta = log.meta ? (() => { try { return JSON.parse(log.meta); } catch(e) { return {}; } })() : {};
          const ts = log.ts ? new Date(log.ts).toLocaleString('ru-RU') : '—';
          let detail = '';
          if (log.action === 'STATUS') {
            detail = `${statusBadge(log.old_value)} → ${statusBadge(log.new_value)}`;
          } else if (log.action === 'CREATE') {
            detail = `<span style="color:var(--text-secondary)">${esc(log.new_value || '')}</span>`;
          } else if (log.action === 'UPDATE') {
            const diff = meta.diff;
            if (diff && diff.length) {
              const FIELD_LABELS = {
                name: 'Название', mol: 'МОЛ', date: 'Дата', address: 'Адрес',
                supplier: 'Поставщик', contract: 'Договор',
                delivery_cost: 'Доставка', markup: 'Наценка %',
                comment: 'Комментарий', positions_count: 'Позиций (кол-во)',
                positions_added: '➕ Добавлены',
                positions_removed: '➖ Удалены',
                positions_changed: '✏️ Изменены',
                total: 'Сумма'
              };
              detail = `<div style="display:flex;flex-direction:column;gap:3px;margin-top:2px">` +
                diff.map(d => {
                  const label = FIELD_LABELS[d.field] || d.field;
                  const oldV = d.old.length > 40 ? d.old.slice(0, 40) + '…' : d.old;
                  const newV = d.new.length > 40 ? d.new.slice(0, 40) + '…' : d.new;
                  return `<div style="font-size:11px">
                    <span style="color:var(--text-muted)">${esc(label)}:</span>
                    <span style="color:var(--danger);text-decoration:line-through;margin:0 4px">${esc(oldV||'—')}</span>
                    <span style="color:var(--success)">${esc(newV||'—')}</span>
                  </div>`;
                }).join('') + `</div>`;
            } else {
              detail = `<span style="color:var(--text-secondary)">обновлена</span>`;
            }
          } else if (log.action === 'DELETE') {
            detail = `<span style="color:var(--danger)">удалена</span>`;
          }
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface-alt);border-radius:4px">
            <span style="font-size:10px;font-weight:600;color:${action.color};min-width:56px">${action.label}</span>
            <span style="color:var(--text-muted);min-width:120px">${ts}</span>
            <span>${detail}</span>
          </div>`;
        }).join('')}
      </div>`;
  } catch(e) {
    panel.innerHTML = `<div style="color:var(--danger);padding:8px">Ошибка загрузки истории: ${esc(e.message)}</div>`;
  }
}

// ─── Breakdown ───────────────────────────────────────────────────────────────
let breakdownOpen = false;

function toggleBreakdown() {
  breakdownOpen = !breakdownOpen;
  const panel = document.getElementById('breakdown-panel');
  if (panel) panel.style.display = breakdownOpen ? 'block' : 'none';
  const btn = document.getElementById('breakdown-btn');
  if (btn) btn.textContent = breakdownOpen ? '📈 Скрыть разбивку' : '📈 Разбивка по орг.';
}

function renderBreakdown(reqs) {
  const panel = document.getElementById('breakdown-panel');
  if (!panel) return;
  if (!breakdownOpen) { panel.style.display = 'none'; return; }
  if (reqs.length === 0) { panel.innerHTML = ''; panel.style.display = 'none'; return; }

  // Group by org
  const byOrg = {};
  reqs.forEach(r => {
    const key = r.orgShort || r.orgId || '—';
    if (!byOrg[key]) byOrg[key] = { name: key, count: 0, purchase: 0, sell: 0, profit: 0, delivery: 0 };
    byOrg[key].count++;
    byOrg[key].purchase += r.totalPurchase || 0;
    byOrg[key].sell     += r.total || 0;
    byOrg[key].delivery += r.deliveryCost || 0;
    byOrg[key].profit   += (r.total || 0) - (r.totalPurchase || 0) - (r.deliveryCost || 0);
  });

  const rows = Object.values(byOrg).sort((a,b) => b.sell - a.sell);
  const totalSell = rows.reduce((s,r) => s + r.sell, 0);

  let html = `<div class="card" style="padding:0;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:13px;font-weight:600">Разбивка по организациям</span>
      <span style="font-size:12px;color:var(--text-muted)">${reqs.length} заявок</span>
    </div>
    <div class="table-wrap"><table style="font-size:12px">
      <thead><tr>
        <th>Организация</th>
        <th style="text-align:center">Заявок</th>
        <th style="text-align:right">Закуп</th>
        <th style="text-align:right">Доставка</th>
        <th style="text-align:right">Продажа</th>
        <th style="text-align:right">Прибыль</th>
        <th style="text-align:right;width:80px">Доля</th>
      </tr></thead>
      <tbody>`;

  rows.forEach(r => {
    const pct = totalSell > 0 ? (r.sell / totalSell * 100).toFixed(1) : '0.0';
    const barW = totalSell > 0 ? Math.round(r.sell / totalSell * 60) : 0;
    html += `<tr>
      <td style="font-weight:500">${esc(r.name)}</td>
      <td style="text-align:center"><span class="num-badge">${r.count}</span></td>
      <td style="text-align:right;color:var(--text-secondary)">${fmtRub(r.purchase)}</td>
      <td style="text-align:right;color:var(--text-secondary)">${fmtRub(r.delivery)}</td>
      <td style="text-align:right;font-weight:600;color:var(--accent)">${fmtRub(r.sell)}</td>
      <td style="text-align:right;color:var(--success)">${fmtRub(r.profit)}</td>
      <td style="text-align:right">
        <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
          <div style="width:${barW}px;height:6px;background:var(--accent);border-radius:3px;opacity:0.6"></div>
          <span style="color:var(--text-muted);min-width:32px">${pct}%</span>
        </div>
      </td>
    </tr>`;
  });

  // Totals row
  const totSell = rows.reduce((s,r)=>s+r.sell,0);
  const totPur  = rows.reduce((s,r)=>s+r.purchase,0);
  const totDel  = rows.reduce((s,r)=>s+r.delivery,0);
  const totPro  = rows.reduce((s,r)=>s+r.profit,0);
  html += `<tr style="background:var(--surface-alt);font-weight:600;border-top:2px solid var(--border)">
    <td>Итого</td>
    <td style="text-align:center">${reqs.length}</td>
    <td style="text-align:right;color:var(--text-secondary)">${fmtRub(totPur)}</td>
    <td style="text-align:right;color:var(--text-secondary)">${fmtRub(totDel)}</td>
    <td style="text-align:right;color:var(--accent)">${fmtRub(totSell)}</td>
    <td style="text-align:right;color:var(--success)">${fmtRub(totPro)}</td>
    <td></td>
  </tr>`;

  html += `</tbody></table></div></div>`;
  panel.innerHTML = html;
  panel.style.display = 'block';
}

