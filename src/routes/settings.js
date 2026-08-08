const express = require('express');
const router = express.Router();

const { getDb, saveDb } = require('../db/connection');
const { operatorOrAdmin, adminOnly } = require('../auth/middleware');
const { DEFAULT_SETTINGS } = require('../config');

const PKG_VERSION = (() => {
  try { return require('../../package.json').version; } catch(e) { return '26w31-b01'; }
})();

router.get('/settings', operatorOrAdmin, (req, res) => {
  try {
    const rows = getDb().exec('SELECT key, value FROM settings');
    const result = { ...DEFAULT_SETTINGS };
    if (rows.length && rows[0].values) {
      rows[0].values.forEach(([k, v]) => { if (k in result) result[k] = v; });
    }
    // Never expose the actual password over the wire — return a sentinel so
    // the UI knows a password is set without leaking it
    if (result.networkPass) result.networkPass = '••••••••';
    // Operators need branding + supplier defaults to create requests/specs,
    // but shouldn't see infra credentials/webhooks — only admins get those.
    if (req.userRole !== 'admin') {
      const { networkFolder, networkUser, networkPass, bitrixWebhook, statusWebhook, ...safe } = result;
      return res.json(safe);
    }
    res.json(result);
  } catch(e) { res.json({ ...DEFAULT_SETTINGS }); }
});

router.put('/settings', adminOnly, (req, res) => {
  try {
    const db = getDb();
    const allowed = Object.keys(DEFAULT_SETTINGS);
    // Validate logo size (max 500KB base64)
    if (req.body.logoBase64 && req.body.logoBase64.length > 700000) {
      return res.status(400).json({ error: 'Логотип слишком большой. Максимум 500KB.' });
    }
    // Validate logo format
    if (req.body.logoBase64 && req.body.logoBase64.length > 0) {
      const validFormats = ['data:image/svg', 'data:image/png', 'data:image/jpeg', 'data:image/webp'];
      if (!validFormats.some(f => req.body.logoBase64.startsWith(f))) {
        return res.status(400).json({ error: 'Недопустимый формат логотипа. SVG, PNG, JPG, WebP.' });
      }
    }
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) {
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, String(v)]);
      }
    }
    saveDb();
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/version', operatorOrAdmin, (req, res) => {
  res.json({ version: PKG_VERSION });
});

module.exports = { router, PKG_VERSION };
