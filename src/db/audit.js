const { run } = require('./connection');

function auditLog(action, requestId, field, oldValue, newValue, meta) {
  try {
    run(
      `INSERT INTO audit_log (action, request_id, field, old_value, new_value, meta)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [action, requestId || null, field || null,
       oldValue !== undefined ? String(oldValue) : null,
       newValue !== undefined ? String(newValue) : null,
       meta ? JSON.stringify(meta) : null]
    );
  } catch(e) { console.error('[AUDIT]', e.message); }
}

module.exports = { auditLog };
