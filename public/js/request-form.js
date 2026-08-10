// ─── Spec number ─────────────────────────────────────────────────────────────
const DOC_TYPE_PREFIX = { goods: 'П', realization: 'Р', install: 'М', support: 'С' };

function updateSpecNum() {
  const orgId = document.getElementById('f-org').value;
  const org = db.orgs.find(o => o.id === orgId);
  const dateVal = document.getElementById('f-date').value;
  const now = dateVal ? new Date(dateVal) : new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  if (!org) {
    document.getElementById('spec-num-display').textContent = '—';
    document.getElementById('spec-num-sub').textContent = 'Выберите организацию';
    return;
  }
  const docType = document.getElementById('f-doc-type')?.value || 'goods';
  const prefix = DOC_TYPE_PREFIX[docType] || 'П';
  const num = nextSpecNum(orgId, y, parseInt(m), docType);
  const specNum = `${prefix}${y}${m}-${String(num).padStart(2, '0')}`;
  document.getElementById('spec-num-display').textContent = specNum;
  document.getElementById('spec-num-sub').textContent = `${org.short} · ${months[parseInt(m)-1]} ${y} · №${num} в месяце`;
}

function nextSpecNum(orgId, year, month, docType) {
  // Use all cached requests (from registry) + fallback to local count
  const pool = allReqs.length ? allReqs : db.requests;
  const existing = pool.filter(r => {
    const d = new Date(r.date);
    const rDocType = r.docType || 'goods';
    return r.orgId === orgId && d.getFullYear() === year && d.getMonth() + 1 === month
      && (!docType || rDocType === docType);
  });
  // If editing existing request, don't count it twice
  const count = editingId
    ? existing.filter(r => r.id !== editingId).length
    : existing.length;
  return count + 1;
}

// ─── Collect form ────────────────────────────────────────────────────────────
function collectForm() {
  const orgId = document.getElementById('f-org').value;
  const org = db.orgs.find(o => o.id === orgId);
  const date = document.getElementById('f-date').value || new Date().toISOString().slice(0,10);
  const d = new Date(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const docType = document.getElementById('f-doc-type')?.value || 'goods';
  const prefix = DOC_TYPE_PREFIX[docType] || 'П';

  // Use displayed specNum if editing (preserves original number)
  // Otherwise compute fresh — same algorithm as updateSpecNum
  let specNum;
  if (editingId) {
    specNum = document.getElementById('spec-num-display')?.textContent || '';
  }
  if (!specNum || specNum === '—') {
    const num = nextSpecNum(orgId, y, m, docType);
    specNum = `${prefix}${y}${String(m).padStart(2,'0')}-${String(num).padStart(2,'0')}`;
  }

  const rows = document.getElementById('positions-body').children;
  const markupEl = document.getElementById('f-markup');
  const markup = (markupEl && markupEl.value !== '' ? parseNum(markupEl.value) : 5) / 100;
  const deliveryOn = document.getElementById('f-delivery-on')?.checked;
  const deliveryCost = deliveryOn ? (parseNum(document.getElementById('f-delivery-cost')?.value) || 0) : 0;

  let totalPurchase = 0;
  const positionsRaw = [];
  const isRealization = document.getElementById('realization-badge')?.style.display !== 'none';
  for (const tr of rows) {
    // cols: [0]drag [1]№ [2]name [3]comment/ЮЛ [4]link [5]qty [6]unit [7]purchasePrice [8]sell [9]sum [10]×
    const qty = parseNum(tr.children[5].querySelector('input,select')?.value || tr.children[5].querySelector('input')?.value);
    const pp  = parseNum(tr.children[7].querySelector('input').value);
    const commentEl = tr.children[3].querySelector('input,select');
    positionsRaw.push({
      name: tr.children[2].querySelector('input').value,
      comment: commentEl ? commentEl.value : '',
      rowOrgName: isRealization && commentEl ? commentEl.value : '',
      link: tr.children[4].querySelector('input').value,
      qty,
      unit: tr.children[6].querySelector('input').value || 'шт',
      purchasePrice: pp,
      purchaseSum: qty * pp
    });
    totalPurchase += qty * pp;
  }

  const positions = positionsRaw.map(p => {
    const deliveryShare = totalPurchase > 0 ? (p.purchaseSum / totalPurchase) * deliveryCost : 0;
    const ppWithDel = p.qty > 0 ? p.purchasePrice + deliveryShare / p.qty : p.purchasePrice;
    const sellPerUnit = ppWithDel * (1 + markup);
    const sellSum = sellPerUnit * p.qty;
    return { ...p, deliveryShare, ppWithDel, sellPerUnit, sellSum };
  });

  const total = positions.reduce((s,p) => s + p.sellSum, 0);

  return {
    id: Date.now().toString(),
    specNum,
    orgId,
    orgFull: org?.full || '',
    orgShort: org?.short || '',
    orgFolder: org?.folder || '',
    orgSignatory: db.orgs.find(o => o.id === orgId)?.signatory || org?.signatory || '',
    orgStamp: (() => { const oc = db.orgs.find(o => o.id === orgId) || org; return oc?.stamp === undefined ? true : oc.stamp === '1' || oc.stamp === true; })(),
    bitrix: document.getElementById('f-bitrix').value,
    name: document.getElementById('f-name').value,
    mol: document.getElementById('f-mol').value,
    date,
    address: document.getElementById('f-address').value,
    supplier: document.getElementById('f-supplier').value || appConfig.supplierName || '',
    supplierSignatory: appConfig.supplierSignatory || '',
    supplierStamp: appConfig.supplierStamp === '1',
    invoiceNum: document.getElementById('f-invoice-num').value,
    contract: document.getElementById('f-contract').value,
    status: document.getElementById('f-status').value,
    comment: document.getElementById('f-comment').value,
    isRealization: document.getElementById('realization-badge').style.display !== 'none',
    docType: document.getElementById('f-doc-type')?.value || 'goods',
    deliveryCost,
    markup: markup * 100,
    totalPurchase,
    positions,
    total
  };
}

async function testFolderConnection() {
  const path = document.getElementById('cfg-network-folder')?.value.trim();
  const user = document.getElementById('cfg-network-user')?.value.trim();
  const pass = document.getElementById('cfg-network-pass')?.value;
  const el   = document.getElementById('folder-test-result');
  if (!path) { if (el) el.innerHTML = '<span style="color:var(--danger)">Укажите путь</span>'; return; }
  if (el) el.innerHTML = '<span style="color:var(--text-muted)">⏳ Проверка...</span>';
  try {
    const r = await api('POST', '/api/test-folder', { path, user, pass });
    if (el) el.innerHTML = r.ok
      ? `<span style="color:var(--success)">✅ Подключено (${r.mode})</span>`
      : `<span style="color:var(--danger)">❌ ${r.error}</span>`;
  } catch(e) {
    if (el) el.innerHTML = `<span style="color:var(--danger)">❌ ${e.message}</span>`;
  }
}

// ─── Force layout files from registry ────────────────────────────────────────
async function forceLayoutFiles(id, btn) {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳ Раскладка...'; btn.disabled = true; }
  try {
    // Load full request data
    const req = await api('GET', '/api/requests/' + id);
    if (!req) throw new Error('Заявка не найдена');
    const result = await layoutFilesToFolder(id, req);
    if (result?.ok) {
      toast(`📁 Готово: ${result.files?.length || 0} файлов разложено`);
    }
  } catch(e) {
    toast('Ошибка раскладки: ' + e.message);
  } finally {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}

// ─── Layout files to network folder ──────────────────────────────────────────
async function layoutFilesToFolder(reqId, req) {
  const payload = {};
  // Same fallback as loadSpec/collectForm: supplier defaults live in
  // appConfig and may not be baked into the stored request yet.
  const specReq = {
    ...req,
    supplier: req.supplier || appConfig.supplierName || '',
    supplierSignatory: appConfig.supplierSignatory || '',
    supplierStamp: appConfig.supplierStamp === '1',
  };

  // 1. Generate DOCX spec and convert to base64
  try {
    const res = await fetch('/api/spec-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken },
      body: JSON.stringify(specReq)
    });
    if (res.ok) {
      const blob = await res.blob();
      const b64 = await new Promise(resolve => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result.split(',')[1]);
        fr.readAsDataURL(blob);
      });
      payload.docxBase64 = b64;
    }
  } catch(e) { console.warn('[layout] docx error:', e); }

  // 2. Generate Excel and convert to base64
  try {
    const b64 = buildWorkbookBase64(req);
    if (b64) payload.excelBase64 = b64;
  } catch(e) { console.warn('[layout] xlsx error:', e); }

  // 3. Attach invoice file if selected
  const invoiceInput = document.getElementById('f-invoice');
  if (invoiceInput?.files?.length) {
    const file = invoiceInput.files[0];
    const data = await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(file);
    });
    payload.invoiceFiles = [{ name: file.name, data }];
  }

  const result = await api('POST', `/api/requests/${reqId}/layout-files`, payload);
  if (result.ok) {
    toast(`📁 Файлы разложены: ${result.files?.length || 0} файлов`);
  }
  return result;
}

// Builds XLSX workbook and returns base64 string
function buildWorkbookBase64(req) {
  if (typeof XLSX === 'undefined') {
    toast('⚠️ Excel библиотека не загружена — файл расчётов не будет приложен');
    return null;
  }
  const wb = XLSX.utils.book_new();
  buildAndDownloadExcel(req, wb); // fills wb, skips download
  try {
    return XLSX.write(wb, { bookType: 'xlsx', type: 'base64', cellStyles: true });
  } catch(e) {
    console.warn('[buildWorkbookBase64]', e);
    toast('⚠️ Не удалось сформировать Excel: ' + e.message);
    return null;
  }
}
