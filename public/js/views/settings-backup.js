/**
 * public/js/views/settings-backup.js
 *
 * Хвост Фазы 5/6: бэкапы (createBackup/loadBackupList/restoreBackup) +
 * состояние справочников настроек (_settingsTab/_orgsCache/.../ensureRefData),
 * вынесенные из inline-скрипта в index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 *
 * LOC-6: найден и локализован во время финального прохода — не попал
 * в исходный список LOC-5 (0 вызовов t()), t()/I18N см. public/js/i18n.js.
 */

// ─── Состояние справочников (используется settings-refdata.js и asset-tab.js) ──
let _settingsTab = 'general'; // 'general' | 'orgs' | 'filials' | 'locations' | 'config'
let _orgsCache = [], _filialsCache = [], _locsCache = [];
let _refDataLoaded = false;

async function ensureRefData() {
  if (_refDataLoaded) return;
  try {
    [_orgsCache, _filialsCache, _locsCache] = await Promise.all([
      fetch(`${API}/api/orgs`).then(r=>r.json()).catch(()=>[]),
      fetch(`${API}/api/filials`).then(r=>r.json()).catch(()=>[]),
      fetch(`${API}/api/locations`).then(r=>r.json()).catch(()=>[]),
    ]);
    _refDataLoaded = true;
  } catch(e) { console.warn('ensureRefData failed', e); }
}

// ─── Бэкапы ──────────────────────────────────────────────────────────────────

async function createBackup() {
  const r = await fetch(`${API}/api/backup/create`, { method:'POST', headers:ah() });
  const d = await r.json();
  if (r.ok) { toast(t('msg_backup_created', { file: d.file, size: (d.size/1024).toFixed(1) }), 'success'); loadBackupList(); }
  else toast(d.error || t('msg_error'), 'error');
}

async function loadBackupList() {
  const el = document.getElementById('backup-list');
  if (!el) return;
  el.innerHTML = `<div style="color:var(--muted)">${t('msg_loading')}</div>`;
  const r = await fetch(`${API}/api/backup/list`, { headers:ah() });
  const list = await r.json();
  if (!list.length) { el.innerHTML = `<div style="color:var(--muted)">${t('msg_no_backups')}</div>`; return; }
  el.innerHTML = `
    <table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead><tr style="color:var(--muted)">
        <th style="text-align:left;padding:3px 6px">${t('th_file')}</th>
        <th style="padding:3px 6px">${t('th_type')}</th>
        <th style="text-align:right;padding:3px 6px">${t('th_size')}</th>
        <th style="text-align:right;padding:3px 6px">${t('th_date_col')}</th>
        <th style="padding:3px 6px"></th>
      </tr></thead>
      <tbody>${list.map(b => `
        <tr style="border-top:1px solid var(--border)">
          <td style="padding:4px 6px;font-family:monospace;font-size:11px">${esc(b.name)}</td>
          <td style="padding:4px 6px;text-align:center">
            <span title="${b.full ? t('tooltip_full_backup') : t('tooltip_db_only')}"
              style="font-size:13px">${b.full ? '🔒' : '⚠️'}</span>
          </td>
          <td style="padding:4px 6px;text-align:right;color:var(--muted)">${(b.size/1024).toFixed(1)} ${t('lbl_kb')}</td>
          <td style="padding:4px 6px;text-align:right;color:var(--muted)">${fd(b.mtime)}</td>
          <td style="padding:4px 6px;white-space:nowrap">
            <a href="${API}/api/backup/download/${esc(b.name)}" class="btn-icon" title="${t('tooltip_download')}" style="text-decoration:none">⬇</a>
            <button class="btn-icon" title="${t('tooltip_restore')}" data-action="restoreBackup" data-args='${JSON.stringify([b.name, b.full])}'>↩</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:8px;font-size:11px;color:var(--muted)">
      ${t('lbl_full_legend')} &nbsp;·&nbsp; ${t('lbl_db_only_legend')}
    </div>`;
}

async function restoreBackup(name, isFull) {
  const warn = isFull
    ? t('msg_restore_full_warn', { name })
    : t('msg_restore_partial_warn', { name });
  if (!confirm(warn)) return;
  const r = await fetch(`${API}/api/backup/restore/${encodeURIComponent(name)}`, { method:'POST', headers:ah() });
  const d = await r.json();
  if (r.ok) {
    if (d.warn) toast(t('msg_restored_with_warning', { warn: d.warn }), 'error');
    else toast(t('msg_restored_reloading'), 'success');
    setTimeout(() => location.reload(), 1500);
  } else toast(d.error || t('msg_error'), 'error');
}
