const express = require('express');
const router = express.Router();

const { getDb } = require('../db/connection');
const { operatorOrAdmin } = require('../auth/middleware');
const { sendDealToBitrix } = require('../services/bitrixService');

router.post('/send-bitrix', operatorOrAdmin, async (req, res) => {
  try {
    // Get webhook URL from settings
    const rows = getDb().exec("SELECT value FROM settings WHERE key='bitrixWebhook'");
    const webhookUrl = rows[0]?.values?.[0]?.[0] || '';
    if (!webhookUrl) return res.status(400).json({ error: 'Webhook URL не настроен. Укажите его в Конфиге.' });

    const r = req.body; // full request object sent from frontend
    if (!r || !r.specNum) return res.status(400).json({ error: 'Некорректные данные заявки' });

    const result = await sendDealToBitrix(webhookUrl, r);
    if (result.error) return res.status(502).json({ error: `Bitrix ответил ошибкой: ${result.error_description || result.error}` });
    res.json({ ok: true, bitrixResult: result });
  } catch(e) {
    console.error('[bitrix]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
