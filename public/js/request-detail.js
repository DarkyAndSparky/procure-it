async function loadToForm(id, copy=false) {
  let req = await api('GET', '/api/requests/' + id).catch(() => null);
  if (!req) return;
  document.getElementById('f-org').value = req.orgId;
  // Always use current org signatory from card (not stale saved value)
  const orgCard = db.orgs.find(o => o.id === req.orgId);
  if (orgCard) {
    req.orgSignatory = orgCard.signatory || req.orgSignatory || '';
    req.orgStamp = orgCard.stamp === undefined ? true : (orgCard.stamp === '1' || orgCard.stamp === true);
  }
  document.getElementById('f-bitrix').value = req.bitrix;
  document.getElementById('f-name').value = copy ? req.name + ' (копия)' : req.name;
  document.getElementById('f-mol').value = req.mol;
  document.getElementById('f-date').value = req.date;
  document.getElementById('f-address').value = req.address || '';
  document.getElementById('f-supplier').value = req.supplier || '';
  document.getElementById('f-invoice-num').value = req.invoiceNum || '';
  const cpEl = document.getElementById('f-counterparty'); if (cpEl) cpEl.value = req.counterparty || '';
  document.getElementById('f-contract').value = req.contract || '';
  // Migrate legacy status values
  const statusMigration = { inwork: 'ordered', paid: 'delivered' };
  const reqStatus = statusMigration[req.status] || req.status || 'new';
  document.getElementById('f-status').value = reqStatus;
  document.getElementById('f-comment').value = req.comment || '';

  // Delivery & markup
  const delOn = (req.deliveryCost || 0) > 0;
  document.getElementById('f-delivery-on').checked = delOn;
  document.getElementById('f-delivery-cost').value = req.deliveryCost || '';
  document.getElementById('f-delivery-cost').style.opacity = delOn ? '1' : '0.4';
  document.getElementById('f-delivery-cost').style.pointerEvents = delOn ? 'auto' : 'none';
  document.getElementById('f-markup').value = req.markup ?? 5;
  { const noMarkup = (req.markup ?? 5) === 0; document.getElementById('f-no-markup').checked = noMarkup; document.getElementById('f-markup').disabled = noMarkup; }
  document.getElementById('f-doc-type').value = req.docType || 'goods';
  onDocTypeChange();

  // Restore realization mode if needed
  if (req.isRealization) {
    document.getElementById('realization-badge').style.display = 'flex';
    const th = document.querySelector('#page-new table thead th:nth-child(4)');
    if (th) { th.textContent = 'ЮЛ / Получатель'; th.style.color = 'var(--accent)'; }
  } else {
    document.getElementById('realization-badge').style.display = 'none';
    const th = document.querySelector('#page-new table thead th:nth-child(4)');
    if (th) { th.textContent = 'Комментарий / ФИО'; th.style.color = ''; }
  }

  document.getElementById('positions-body').innerHTML = '';
  rowCounter = 0;
  req.positions.forEach(p => addRow(
    p.name, p.qty, p.unit||'шт', 0,
    p.link||'', p.purchasePrice||p.price||0,
    p.comment||'', p.rowOrgName||''
  ));
  updateSpecNum();
  showFolderPath();

  if (copy) {
    // Refresh cache so nextSpecNum is accurate for the copy
    try {
      const resp = await api('GET', '/api/requests');
      allReqs = Array.isArray(resp) ? resp : (resp.items || []);
      db.requests = allReqs;
    } catch(e) {}
    editingId = null;
    setEditingState(false);
    toast('Заявка скопирована — сохраните как новую');
  } else {
    editingId = id;
    setEditingState(true, req.specNum);
  }
  showPage('new');
}

function setEditingState(isEditing, specNum='') {
  const btn = document.getElementById('btn-save');
  const banner = document.getElementById('edit-banner');
  if (!btn) return;
  if (isEditing) {
    btn.textContent = '💾 Сохранить изменения';
    btn.style.background = 'var(--warning)';
    btn.style.borderColor = 'var(--warning)';
    btn.style.color = '#fff';
    if (banner) { banner.style.display = 'flex'; banner.querySelector('span').textContent = 'Редактирование: ' + specNum; }
  } else {
    btn.textContent = '💾 Сохранить заявку';
    btn.style.background = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
    btn.style.color = '#fff';
    if (banner) banner.style.display = 'none';
  }
}

async function exportExcelById(id) {
  // Сначала ищем в кэше, если нет — запрашиваем с сервера
  let req = db.requests.find(r => r.id === id) || allReqs.find(r => r.id === id);
  if (!req) {
    req = await api('GET', '/api/requests/' + id).catch(() => null);
  }
  if (!req) { toast('Заявка не найдена'); return; }
  buildAndDownloadExcel(req);
}


let currentSpecReq = null;

function previewSpec() {
  const req = collectForm();
  if (!req.name || req.positions.length === 0) { toast('Заполните форму и добавьте позиции'); return; }
  currentSpecReq = req;
  document.getElementById('spec-preview-content').innerHTML = buildSpecHtml(req);
  showPage('spec');
}

async function loadSpec(id) {
  // Fetch fresh from the server rather than the (possibly stale) client-side
  // cache — address/supplier can change between when the list was cached and now.
  let req = await api('GET', '/api/requests/' + id).catch(() => null);
  if (!req) req = db.requests.find(r => r.id === id) || allReqs.find(r => r.id === id);
  if (!req) return;
  currentSpecReq = { ...req, supplier: req.supplier || appConfig.supplierName || '', supplierSignatory: appConfig.supplierSignatory || '', supplierStamp: appConfig.supplierStamp === '1' };
  document.getElementById('spec-preview-content').innerHTML = buildSpecHtml(currentSpecReq);
  showPage('spec');
}

async function loadSpecFromRegistry() {
  const id = document.getElementById('spec-select').value;
  if (!id) return;
  let req = await api('GET', '/api/requests/' + id).catch(() => null);
  if (!req) req = db.requests.find(r => r.id === id) || allReqs.find(r => r.id === id);
  if (req) {
    currentSpecReq = { ...req, supplier: req.supplier || appConfig.supplierName || '', supplierSignatory: appConfig.supplierSignatory || '', supplierStamp: appConfig.supplierStamp === '1' };
    document.getElementById('spec-preview-content').innerHTML = buildSpecHtml(currentSpecReq);
  }
}

async function saveSpecWord() {
  const req = currentSpecReq;
  if (!req) { toast('Сначала откройте спецификацию'); return; }
  const btn = document.getElementById('btn-save-word');
  const origText = btn.textContent;
  btn.textContent = '⏳ Генерация...';
  btn.disabled = true;
  try {
    const res = await fetch('/api/spec-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken },
      body: JSON.stringify(req)
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dlOrgShort = (req.orgShort || '').replace(/[\\/:\*?"<>|]/g, '_').slice(0, 20);
    const dlSpecNum  = (req.specNum  || 'spec').replace(/[\\/:\*?"<>|]/g, '_');
    a.download = dlOrgShort ? `${dlOrgShort}_Спецификация_${dlSpecNum}.docx` : `${dlSpecNum}_спецификация.docx`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    toast('Word сохранён');
  } catch(e) {
    toast('Ошибка: ' + e.message);
    console.error(e);
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}


function buildSpecHtml(req) {
  const total = req.total || 0;
  const totalStr = fmtRub(total);
  const totalWords = numToWords(total);
  const dateObj = new Date(req.date);
  const dateStr = `«${String(dateObj.getDate()).padStart(2,'0')}» ${months[dateObj.getMonth()]} ${dateObj.getFullYear()} г.`;

  const docType = req.docType || 'goods';
  const DOC_LABELS = {
    install: {
      title: 'СПЕЦИФИКАЦИЯ НА ВЫПОЛНЕНИЕ РАБОТ',
      colHeader: 'Наименование работ / услуг',
      contractWord: 'к договору подряда',
      termLine: 'Срок выполнения работ: 14 дней.',
      paymentLine: '— Аванс (предварительная оплата) в размере 100 % от стоимости работ, подлежащих выполнению по настоящей Спецификации.',
      qualityLine: 'Работы должны быть выполнены в соответствии с действующими нормами и правилами, а также требованиями технической документации, и приняты Покупателем по акту выполненных работ.',
      finalLine: 'Настоящая Спецификация составлена в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон и является неотъемлемой частью Договора подряда.',
      addressLabel: 'Адрес выполнения работ',
    },
    support: {
      title: 'ДОКУМЕНТ ПО СОПРОВОЖДЕНИЮ (ЗАГЛУШКА)',
      colHeader: 'Наименование услуги',
      contractWord: 'к договору',
      termLine: '⚠ Формат документа «Сопровождение» ещё не согласован и будет уточнён отдельно.',
      paymentLine: '— Порядок оплаты будет определён после согласования формата документа.',
      qualityLine: 'Данный раздел является заглушкой и будет заменён после уточнения формата документа «Сопровождение».',
      finalLine: 'Настоящий документ — временная заглушка и не является итоговой формой.',
      addressLabel: 'Адрес',
    },
    goods: {
      title: 'СПЕЦИФИКАЦИЯ',
      colHeader: 'Наименование Товара',
      contractWord: 'к договору поставки',
      termLine: 'Срок поставки Товара: 14 дней.',
      paymentLine: '— Аванс (предварительная оплата) в размере 100 % от стоимости Товара, подлежащего поставке по настоящей Спецификации. Цена указана с доставкой до Покупателя.',
      qualityLine: 'Качество Товара должно соответствовать установленным требованиям государственных стандартов качества в соответствии с действующим законодательством Российской Федерации. При поставке необходимо наличие всех необходимых сертификатов, удостоверений качества, протоколов лабораторных испытаний и т.д. на поставляемый Товар.',
      finalLine: 'Настоящая Спецификация составлена в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон и является неотъемлемой частью Договора.',
      addressLabel: 'Адрес доставки/выборки',
    },
    realization: {
      title: 'СПЕЦИФИКАЦИЯ НА РЕАЛИЗАЦИЮ',
      colHeader: 'Наименование Товара',
      contractWord: 'к договору поставки',
      termLine: 'Срок поставки Товара: 14 дней.',
      qualityLine: 'Качество Товара должно соответствовать установленным требованиям государственных стандартов качества в соответствии с действующим законодательством Российской Федерации. При поставке необходимо наличие всех необходимых сертификатов, удостоверений качества, протоколов лабораторных испытаний и т.д. на поставляемый Товар.',
      finalLine: 'Настоящая Спецификация составлена в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон и является неотъемлемой частью Договора.',
      addressLabel: 'Адрес доставки/выборки',
    },
  };
  const L = DOC_LABELS[docType] || DOC_LABELS.goods;

  let rows = '';
  req.positions.forEach((p,i) => {
    const sellUnit = p.sellPerUnit || (p.purchasePrice || p.price || 0) * (1 + (req.markup ?? 5)/100);
    const sellSum  = p.sellSum    || sellUnit * p.qty;
    rows += `<tr>
      <td style="text-align:center">${i+1}</td>
      <td>${esc(p.name)}</td>
      <td style="text-align:center">${p.qty}</td>
      <td style="text-align:right">${fmtRub(sellUnit)}</td>
      <td style="text-align:right">${fmtRub(sellSum)}</td>
    </tr>`;
  });

  const isRealizationDoc = docType === 'realization';

  return `
    ${isRealizationDoc ? '' : `<div class="app-ref">${(() => {
      const contract = req.contract || '—';
      const fromIdx = contract.indexOf(' от ');
      const contractNum  = fromIdx > -1 ? contract.slice(0, fromIdx) : contract;
      const contractDate = fromIdx > -1 ? 'от ' + contract.slice(fromIdx + 4) : '';
      const lines = [`Приложение №1`, `${L.contractWord} № ${esc(contractNum)}`];
      if (contractDate) lines.push(esc(contractDate));
      return lines.join('<br>');
    })()}</div>`}
    <div class="spec-title">${L.title} № ${esc(req.specNum)}</div>
    <div class="spec-city-date">
      <span>г. Екатеринбург</span>
      <span>${dateStr}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #333">
      <thead>
        <tr>
          <th style="width:36px;text-align:center">№ п/п</th>
          <th>${L.colHeader}</th>
          <th style="width:60px;text-align:center">Кол-во (шт.)</th>
          <th style="width:130px;text-align:right">Цена за ед., руб. (без НДС)</th>
          <th style="width:130px;text-align:right">Стоимость, руб. (без НДС)</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td colspan="4" style="text-align:right;font-weight:bold;border:1px solid #333">Итого:</td>
          <td style="text-align:right;font-weight:bold;border:1px solid #333">${totalStr}</td>
        </tr>
        <tr><td colspan="5" style="border:1px solid #333;padding:4px 8px">НДС: не облагается</td></tr>
      </tbody>
    </table>
    <p style="margin-top:16px">Всего наименований ${req.positions.length}, на сумму ${totalStr} рублей, без НДС</p>
    <p style="margin-top:4px;font-style:italic">${totalWords}, НДС не облагается.</p>
    <p style="margin-top:12px">${L.termLine}</p>
    ${isRealizationDoc ? '' : `<p style="margin-top:8px"><strong>Порядок оплаты:</strong><br>
    ${L.paymentLine}</p>`}
    ${req.address ? `<p style="margin-top:8px">${L.addressLabel}: ${esc(req.address)}</p>` : ''}
    <p style="margin-top:8px">${L.qualityLine}</p>
    <p style="margin-top:8px">${L.finalLine}</p>
    ${isRealizationDoc ? `
    <div class="sign-block">
      <div>
        <div class="sign-title" style="margin-top:6px">${esc(req.orgFull || '___________')}</div>
        <div style="margin-top:32px">______________________/${esc(req.orgSignatory || '___________')}/</div>
        <div style="margin-top:8px">${req.orgStamp === false ? 'Б.П.' : 'М.П.'}</div>
      </div>
    </div>` : `
    <div class="sign-block">
      <div>
        <div class="sign-title">Поставщик:</div>
        <div class="sign-title" style="margin-top:6px">${esc(req.supplier || '___________')}</div>
        <div style="margin-top:32px">______________________/${esc(req.supplierSignatory || '___________')}/</div>
        <div style="margin-top:8px">${req.supplierStamp ? 'М.П.' : 'Б.П.'}</div>
      </div>
      <div>
        <div class="sign-title">Покупатель:</div>
        <div class="sign-title" style="margin-top:6px">${esc(req.orgFull || '___________')}</div>
        <div style="margin-top:32px">______________________/${esc(req.orgSignatory || '___________')}/</div>
        <div style="margin-top:8px">${req.orgStamp === false ? 'Б.П.' : 'М.П.'}</div>
      </div>
    </div>`}`;
}

