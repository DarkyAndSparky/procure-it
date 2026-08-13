const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { BACKUP_DIR, SIGNED_DIR, INVOICE_DIR } = require('../config');

// Пользователь может настроить свою папку для бэкапов (Настройки → Резервная
// копия) — например, на другой диск или сетевой ресурс, чтобы бэкап не лежал
// в том же месте, что и рабочие данные (иначе смысл бэкапа теряется — при
// поломке диска теряется и он тоже). Если не настроено — используем прежнее
// поведение (data/backups). Если настроенный путь недоступен для записи —
// не молчим и не роняем бэкап целиком, а откатываемся на дефолт и логируем.
function resolveBackupDir() {
  try {
    const db = getDb();
    const rows = db.exec(`SELECT value FROM settings WHERE key='backupFolder'`);
    const custom = rows.length && rows[0].values.length ? String(rows[0].values[0][0] || '').trim() : '';
    if (!custom) return BACKUP_DIR;
    fs.mkdirSync(custom, { recursive: true });
    fs.accessSync(custom, fs.constants.W_OK);
    return custom;
  } catch(e) {
    console.error('[BACKUP] Настроенная папка бэкапа недоступна, использую data/backups по умолчанию:', e.message);
    return BACKUP_DIR;
  }
}

function doBackup() {
  try {
    const backupDir = resolveBackupDir();
    const db = getDb();
    const data = db.export();
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toTimeString().slice(0, 5).replace(':', '-');
    const fname = `zakupki_${date}_${time}.db`;
    const fpath = path.join(backupDir, fname);
    fs.writeFileSync(fpath, Buffer.from(data));

    // Прикреплённые файлы (подписанные PDF-спецификации, счета) хранятся на
    // диске отдельно от SQLite (см. комментарий у /signed-spec — «avoids
    // bloating SQLite with binary data»), поэтому сами по себе .db-снапшоты
    // их не содержат и раньше эти файлы вообще не бэкапились. Держим
    // единое зеркало (не версионируем на каждый запуск, чтобы не раздувать
    // диск копиями одних и тех же PDF каждые 6 часов) — просто обновляем
    // его текущим содержимым signed_specs/ и invoices/ при каждом бэкапе.
    const filesMirrorDir = path.join(backupDir, 'files_mirror');
    let filesCopied = 0;
    try {
      for (const [srcDir, label] of [[SIGNED_DIR, 'signed_specs'], [INVOICE_DIR, 'invoices']]) {
        const destDir = path.join(filesMirrorDir, label);
        fs.mkdirSync(destDir, { recursive: true });
        if (!fs.existsSync(srcDir)) continue;
        const srcEntries = new Set(fs.readdirSync(srcDir));
        // Копируем новые/изменившиеся файлы
        for (const entry of srcEntries) {
          const srcPath = path.join(srcDir, entry);
          const destPath = path.join(destDir, entry);
          const srcStat = fs.statSync(srcPath);
          const destStat = fs.existsSync(destPath) ? fs.statSync(destPath) : null;
          if (!destStat || destStat.mtimeMs < srcStat.mtimeMs || destStat.size !== srcStat.size) {
            fs.copyFileSync(srcPath, destPath);
            filesCopied++;
          }
        }
        // Убираем из зеркала файлы, удалённые из исходной папки
        for (const entry of fs.readdirSync(destDir)) {
          if (!srcEntries.has(entry)) fs.rmSync(path.join(destDir, entry), { force: true });
        }
      }
    } catch(e) {
      console.error('[BACKUP] Ошибка синхронизации вложенных файлов:', e.message);
    }

    // Удаляем .db-снапшоты старше 30 дней (файловое зеркало не версионируется —
    // оно всегда актуально и не растёт со временем)
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime }));

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    files.forEach(f => {
      if (f.time < cutoff) {
        fs.unlinkSync(path.join(backupDir, f.name));
        console.log('[BACKUP] Удалён старый бэкап:', f.name);
      }
    });

    console.log(`[BACKUP] ✓ ${fname} → ${backupDir} (${(data.byteLength / 1024).toFixed(1)} KB)${filesCopied ? `, файлов синхронизировано: ${filesCopied}` : ''}`);
  } catch(e) {
    console.error('[BACKUP] Ошибка:', e.message);
  }
}

module.exports = { doBackup, resolveBackupDir };
