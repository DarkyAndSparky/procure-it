/**
 * public/js/qr.js
 *
 * Фаза 5, шаг 3: QR-генератор, вынесенный из public/index.html.
 * Classic script (не type="module") — см. объяснение в ui-utils.js о том,
 * почему модули пока не используем (синхронный render() до DOMContentLoaded).
 *
 * Совместимый API: new QRCode(el, {text, width, height}).
 * Запрашивает SVG с сервера (/api/qr, библиотека qrcode npm) и вставляет
 * как <img> через тот же URL (браузер сам делает GET и рендерит).
 */

function QRCode(el, opts) {
  const text = (opts && opts.text) ? opts.text : String(opts || '');
  const w    = (opts && opts.width)  || 200;
  const h    = (opts && opts.height) || 200;
  el.innerHTML = '';
  const url = '/api/qr?text=' + encodeURIComponent(text);
  const img = document.createElement('img');
  img.src    = url;
  img.width  = w;
  img.height = h;
  img.style.display = 'block';
  img.onerror = () => { el.textContent = 'QR: ' + text; };
  el.appendChild(img);
}
QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
