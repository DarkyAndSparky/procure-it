const express = require('express');
const router = express.Router();

const { operatorOrAdmin } = require('../auth/middleware');
const { buildSpecDocx } = require('../services/docxService');

router.post('/spec-docx', operatorOrAdmin, async (req, res) => {
  try {
    const r = req.body;
    const buf = await buildSpecDocx(r);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent((r.specNum||'spec')+'_спецификация.docx')}`);
    res.send(buf);
  } catch(e) {
    console.error('[spec-docx]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
