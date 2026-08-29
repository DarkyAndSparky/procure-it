/**
 * public/js/views/qr-print.js
 *
 * Фаза 5, шаг 19: QR-код актива и печать карточки, вынесенные из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 */

function buildQrText(a) {
  // Только латиница/цифры где возможно — меньше байт, плотнее QR
  let lines = [];
  if (a.inv)    lines.push('INV:' + a.inv);
  if (a.serial) lines.push('SN:' + a.serial);
  if (a.model)  lines.push(a.model);
  return lines.join('\n');
}

function renderQrInto(containerId, text) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  // Используем серверный /api/qr напрямую — надёжнее шима
  const url = `${API}/api/qr?text=` + encodeURIComponent(text);
  const img = document.createElement('img');
  img.src    = url;
  img.width  = 200;
  img.height = 200;
  img.style.cssText = 'display:block;image-rendering:pixelated';
  img.alt    = 'QR';
  img.onerror = () => { el.textContent = t('msg_qr_unavailable'); };
  el.appendChild(img);
}

function printAsset(assetData) {
  const a = assetData;
  const qrText = buildQrText(a);

  // Заполняем print-frame
  const frame = document.getElementById('print-frame');
  frame.innerHTML = `
    <div class="pf-title">${esc(a.model || '—')}</div>
    <div class="pf-type">${esc(a.type || '')}${a.category ? ' · ' + esc(a.category) : ''}</div>
    ${a.serial ? `<div class="pf-row"><div class="pf-label">${t('lbl_serial_number')}</div><div class="pf-val">${esc(a.serial)}</div></div>` : ''}
    ${a.inv    ? `<div class="pf-row"><div class="pf-label">${t('lbl_inv_number')}</div><div class="pf-val">${esc(a.inv)}</div></div>` : ''}
    <div class="pf-qr">
      <div id="pf-qr-canvas"></div>
      <div class="pf-hint">${esc(qrText.replace(/\n/g,' · '))}</div>
    </div>`;

  // QR через серверный /api/qr — ждём onload перед печатью
  const qrEl = document.getElementById('pf-qr-canvas');
  if (qrEl) {
    const img = document.createElement('img');
    img.width  = 280;
    img.height = 280;
    img.style.cssText = 'display:block;image-rendering:pixelated';
    img.src = `${API}/api/qr?text=` + encodeURIComponent(qrText);
    img.onload  = () => setTimeout(() => window.print(), 100);
    img.onerror = () => window.print(); // печатаем даже без QR
    qrEl.appendChild(img);
  } else {
    window.print();
  }
}
