// ─── Rows (positions) ────────────────────────────────────────────────────────
let rowCounter = 0;

function addRow(name='', qty=1, unit='шт', price=0, link='', purchasePrice=0, comment='', rowOrgName='') {
  rowCounter++;
  const id = 'row-' + rowCounter;
  const body = document.getElementById('positions-body');
  const tr = document.createElement('tr');
  tr.id = id;
  const pp = purchasePrice || price;
  const isRealization = document.getElementById('realization-badge')?.style.display !== 'none';
  const commentCell = isRealization
    ? `<td><select style="width:120px;border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:11px;background:var(--surface);color:var(--text);font-family:inherit" title="Организация-получатель">${db.orgs.map(o=>`<option value="${o.short}" ${rowOrgName===o.short?'selected':''}>${o.short}</option>`).join('')}<option value="На склад" ${rowOrgName==='На склад'?'selected':''}>На склад</option></select></td>`
    : `<td><input type="text" value="${esc(comment)}" style="width:120px;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:11px;font-family:inherit" placeholder="ФИО / куда"></td>`;
  tr.innerHTML = `
    <td class="drag-handle" title="Перетащить для сортировки" style="cursor:grab;text-align:center;color:var(--text-muted);font-size:16px;user-select:none;padding:0 2px">⠿</td>
    <td style="color:var(--text-muted);font-size:12px;text-align:center">${body.children.length + 1}</td>
    <td><input type="text" value="${esc(name)}" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px;font-family:inherit" placeholder="Наименование товара" oninput="renumber()"></td>
    ${commentCell}
    <td><input type="text" value="${esc(link)}" style="width:80px;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:11px;font-family:inherit" placeholder="URL" title="${esc(link)}"></td>
    <td><input type="number" value="${esc(qty)}" min="1" step="1" style="width:58px;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px" oninput="calcRow('${id}')"></td>
    <td><input type="text" value="${esc(unit)}" style="width:42px;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px"></td>
    <td><input type="text" inputmode="decimal" value="${esc(pp||'')}" style="width:100px;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px" oninput="this.value=this.value.replace(/[\\s\\u00a0\\u202f]/g,'');calcRow('${id}')" onpaste="setTimeout(()=>{this.value=this.value.replace(/[\\s\\u00a0\\u202f]/g,'');calcRow('${id}')},0)" title="Цена закупа за единицу"></td>
    <td id="${id}-sell" style="font-size:12px;font-weight:500;text-align:right;padding-right:8px;color:var(--accent)">—</td>
    <td id="${id}-sum" style="font-size:12px;font-weight:500;text-align:right;padding-right:8px">—</td>
    <td><button class="del-btn" onclick="removeRow('${id}')">×</button></td>`;
  body.appendChild(tr);
  calcTotal();
}

function removeRow(id) {
  document.getElementById(id)?.remove();
  renumber();
  calcTotal();
}

function renumber() {
  const rows = document.getElementById('positions-body').children;
  for (let i = 0; i < rows.length; i++) {
    rows[i].children[1].textContent = i + 1; // [0]=drag handle, [1]=№
  }
}

// ── Drag & drop row reordering ────────────────────────────────────────────────
function initDragDrop() {
  const tbody = document.getElementById('positions-body');
  if (!tbody || tbody._dragInited) return;
  tbody._dragInited = true;

  let dragSrc = null;

  tbody.addEventListener('mousedown', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const tr = handle.closest('tr');
    if (tr) tr.draggable = true;
  });

  tbody.addEventListener('dragstart', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    dragSrc = tr;
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tr.id);
  });

  tbody.addEventListener('dragend', e => {
    const tr = e.target.closest('tr');
    if (tr) { tr.classList.remove('dragging'); tr.draggable = false; }
    tbody.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragSrc = null;
  });

  tbody.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tr = e.target.closest('tr');
    if (!tr || tr === dragSrc) return;
    tbody.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    tr.classList.add('drag-over');
  });

  tbody.addEventListener('dragleave', e => {
    const tr = e.target.closest('tr')
    if (tr) tr.classList.remove('drag-over');
  });

  tbody.addEventListener('drop', e => {
    e.preventDefault();
    const tr = e.target.closest('tr');
    if (!tr || !dragSrc || tr === dragSrc) return;
    tr.classList.remove('drag-over');
    const rect = tr.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      tbody.insertBefore(dragSrc, tr);
    } else {
      tbody.insertBefore(dragSrc, tr.nextSibling);
    }
    renumber();
    calcTotal();
  });

  // ── Keyboard reordering: Alt+Up / Alt+Down ────────────────────────────────
  tbody.addEventListener('keydown', e => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const input = e.target.closest('input,select,textarea');
    if (!input) return;
    const tr = input.closest('tr');
    if (!tr) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && tr.previousElementSibling) {
      tbody.insertBefore(tr, tr.previousElementSibling);
    } else if (e.key === 'ArrowDown' && tr.nextElementSibling) {
      tbody.insertBefore(tr.nextElementSibling, tr);
    }
    renumber();
    calcTotal();
    // Keep focus on the same input after move
    input.focus();
  });
}

function calcRow(id) {
  calcTotal(); // full recalc since delivery % depends on total
}

function updateDelivery() {
  const on = document.getElementById('f-delivery-on').checked;
  const inp = document.getElementById('f-delivery-cost');
  inp.style.opacity = on ? '1' : '0.4';
  inp.style.pointerEvents = on ? 'auto' : 'none';
  if (!on) inp.value = '';
  calcTotal();
}

function onDocTypeChange() {
  const dt = document.getElementById('f-doc-type').value;
  const th = document.getElementById('th-item-name');
  if (th) th.textContent = dt === 'install' ? 'Наименование работ / услуг' : 'Наименование товара';
  const warrantyWrap = document.getElementById('f-warranty-wrap');
  if (warrantyWrap) warrantyWrap.style.display = dt === 'support' ? '' : 'none';
  if (dt === 'realization') {
    // Реализация — товар для себя: без наценки, поставщик и организация — по умолчанию
    const noMarkupCb = document.getElementById('f-no-markup');
    if (noMarkupCb && !noMarkupCb.checked) { noMarkupCb.checked = true; toggleNoMarkup(); }
    const supplierName = (appConfig.supplierName || '').toLowerCase().trim();
    const selfOrg = supplierName
      ? db.orgs.find(o => (o.full||'').toLowerCase().includes(supplierName) || (o.short||'').toLowerCase().includes(supplierName) || supplierName.includes((o.short||'').toLowerCase()))
      : null;
    const orgSel = document.getElementById('f-org');
    if (orgSel && !orgSel.value) {
      const ipOrg = selfOrg || db.orgs.find(o => (o.short||'').toUpperCase().startsWith('ИП') || (o.full||'').toUpperCase().startsWith('ИП')) || db.orgs[0];
      if (ipOrg) { orgSel.value = ipOrg.id; syncOrgSearchDisplay(); updateSpecNum(); fillOrgDefaults(); }
    }
    toast('🏪 Реализация: цена без наценки, организация по умолчанию');
  }
}

function toggleNoMarkup() {
  const cb = document.getElementById('f-no-markup');
  const markupInput = document.getElementById('f-markup');
  if (cb.checked) {
    markupInput.value = '0';
    markupInput.disabled = true;
  } else {
    markupInput.disabled = false;
    if (parseNum(markupInput.value) === 0) markupInput.value = '5';
  }
  calcTotal();
}

function calcTotal() {
  const rows = document.getElementById('positions-body').children;
  const markupEl = document.getElementById('f-markup');
  const markup = (markupEl && markupEl.value !== '' ? parseNum(markupEl.value) : 5) / 100;
  const deliveryOn = document.getElementById('f-delivery-on')?.checked;
  const deliveryCost = deliveryOn ? (parseNum(document.getElementById('f-delivery-cost')?.value) || 0) : 0;

  // Step 1: total purchase (без доставки)
  let totalPurchase = 0;
  const rowData = [];
  for (const tr of rows) {
    // cols: [0]drag [1]№ [2]name [3]comment [4]link [5]qty [6]unit [7]purchasePrice
    const qty = parseNum(tr.children[5].querySelector('input').value);
    const pp  = parseNum(tr.children[7].querySelector('input').value);
    const purchaseSum = qty * pp;
    totalPurchase += purchaseSum;
    rowData.push({ tr, qty, pp, purchaseSum });
  }

  // Step 2: per-row delivery share + sell price (общая формула — см.
  // pricing-core.js, единственный источник истины для этого расчёта)
  let totalSell = 0;
  for (const { tr, qty, pp, purchaseSum } of rowData) {
    const id = tr.id;
    const { deliveryShare, ppWithDelivery, sellPerUnit, sellSum } = calcRowPricing({
      purchasePrice: pp, qty, totalPurchase, deliveryCost, markup,
    });
    totalSell += sellSum;
    const sellEl = tr.querySelector(`#${id}-sell`);
    const sumEl  = tr.querySelector(`#${id}-sum`);
    if (sellEl) sellEl.textContent = fmtRub(sellPerUnit);
    if (sumEl)  sumEl.textContent  = fmtRub(sellSum);
  }

  // Доставка без позиций в закупе не должна уходить в убыток —
  // делить её долю пока не на что, поэтому просто не учитываем её,
  // пока не появится хотя бы одна позиция.
  const profit = calcProfit({ totalPurchase, totalSell, deliveryCost });

  // Update summary
  document.getElementById('total-display').textContent = fmtRub(totalSell);
  const sp = document.getElementById('sum-purchase'); if(sp) sp.textContent = fmtRub(totalPurchase);
  const sd = document.getElementById('sum-delivery'); if(sd) sd.textContent = fmtRub(deliveryCost);
  const ss = document.getElementById('sum-sell');     if(ss) ss.textContent = fmtRub(totalSell);
  const spr= document.getElementById('sum-profit');   if(spr) spr.textContent = fmtRub(profit);

  return { totalPurchase, totalSell, deliveryCost, profit };
}

