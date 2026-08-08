const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { BACKUP_DIR, SIGNED_DIR, INVOICE_DIR } = require('../config');

function doBackup() {
  try {
    const db = getDb();
    const data = db.export();
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toTimeString().slice(0, 5).replace(':', '-');
    const fname = `zakupki_${date}_${time}.db`;
    const fpath = path.join(BACKUP_DIR, fname);
    fs.writeFileSync(fpath, Buffer.from(data));

    // Прикреплённые файлы (подписанные PDF-спецификации, счета) хранятся на
    // диске отдельно от SQLite (см. комментарий у /signed-spec — «avoids
    // bloating SQLite with binary data»), поэтому сами по себе .db-снапшоты
    // их не содержат и раньше эти файлы вообще не бэкапились. Держим
    // единое зеркало (не версионируем на каждый запуск, чтобы не раздувать
    // диск копиями одних и тех же PDF каждые 6 часов) — просто обновляем
    // его текущим содержимым signed_specs/ и invoices/ при каждом бэкапе.
    const filesMirrorDir = path.join(BACKUP_DIR, 'files_mirror');
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
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime }));

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    files.forEach(f => {
      if (f.time < cutoff) {
        fs.unlinkSync(path.join(BACKUP_DIR, f.name));
        console.log('[BACKUP] Удалён старый бэкап:', f.name);
      }
    });

    console.log(`[BACKUP] ✓ ${fname} (${(data.byteLength / 1024).toFixed(1)} KB)${filesCopied ? `, файлов синхронизировано: ${filesCopied}` : ''}`);
  } catch(e) {
    console.error('[BACKUP] Ошибка:', e.message);
  }
}

module.exports = { doBackup };
