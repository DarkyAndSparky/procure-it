// Отправляет заявку как сделку/задачу в Bitrix24 по вебхуку. Возвращает
// распарсенный JSON-ответ Bitrix (или { raw } если ответ не JSON).
async function sendDealToBitrix(webhookUrl, r) {
  const lines = [
    `📦 Заявка ${r.specNum}`,
    `Организация: ${r.orgFull || r.orgShort || '—'}`,
    `МОЛ: ${r.mol || '—'}`,
    `Дата: ${r.date || '—'}`,
    `Поставщик: ${r.supplier || '—'}`,
    `Адрес доставки: ${r.address || '—'}`,
    `Сумма (продажа): ${Number(r.total || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`,
    '',
    'Позиции:',
    ...(r.positions || []).map((p, i) =>
      `  ${i + 1}. ${p.name} — ${p.qty} ${p.unit || 'шт'} × ${Number(p.purchasePrice || 0).toLocaleString('ru-RU')} ₽`
    ),
  ];
  if (r.comment) lines.push('', `Комментарий: ${r.comment}`);

  const payload = {
    fields: {
      TITLE:       `Закупка ${r.specNum}`,
      DESCRIPTION: lines.join('\n'),
      RESPONSIBLE_ID: 1,   // default — user can override in Bitrix
      // Optional: link to deal/task via r.bitrix if it's a deal ID
      ...(r.bitrix ? { OPPORTUNITY: r.bitrix } : {}),
    }
  };

  // Determine method: if webhook ends with crm.deal.add / tasks.task.add — use as-is,
  // otherwise default to crm.deal.add
  const base = webhookUrl.replace(/\/$/, '');
  const method = base.endsWith('tasks.task.add') ? '' : '/crm.deal.add.json';
  const url = base.endsWith('.json') ? base : `${base}${method}`;

  return postJson(url, payload);
}

// POST JSON-пейлоада о смене статуса заявки на произвольный вебхук
// (настройка "Webhook при смене статуса" в Конфиге).
async function sendStatusWebhook(webhookUrl, payload) {
  return postJson(webhookUrl, payload);
}

function postJson(url, payload) {
  const https = require('https');
  const http  = require('http');
  const body  = JSON.stringify(payload);
  const parsed = new URL(url);
  const lib = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req2 = lib.request(options, resp => {
      let data = '';
      resp.on('data', d => data += d);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data }); }
      });
    });
    req2.on('error', reject);
    req2.write(body);
    req2.end();
  });
}

module.exports = { sendDealToBitrix, sendStatusWebhook };
