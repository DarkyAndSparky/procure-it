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

    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
    const stamp = `${date}_${time}`;

    // Прикреплённые файлы (подписанные PDF-спецификации, счета) хранятся на
    // диске отдельно от SQLite. Раньше бэкап DB и синхронизация файлов были
    // независимыми операциями: DB-снапшот записывался первым, потом файлы
    // синхронизировались в единое зеркало (files_mirror). Проблема: при
    // восстановлении «старой» DB с «новым» зеркалом файлы не совпадали с
    // заявками в базе — то, что ссылается на только что загруженный счёт,
    // видело файл, появившийся ПО ФАКТУ в зеркале уже ПОСЛЕ этого снапшота.
    //
    // Решение: файлы и DB копируются в одну именованную папку снапшота
    // (files_<stamp>/), а не в общее зеркало. Снапшот либо есть целиком,
    // либо его нет. При восстановлении из этого снапшота DB и файлы
    // гарантированно на одну версию. Старое зеркало files_mirror остаётся
    // поддерживаться для совместимости — restore.js умеет искать там.
    const snapshotFilesDir = path.join(backupDir, `files_${stamp}`);
    let filesCopied = 0;
    try {
      for (const [srcDir, label] of [[SIGNED_DIR, 'signed_specs'], [INVOICE_DIR, 'invoices']]) {
        const destDir = path.join(snapshotFilesDir, label);
        fs.mkdirSync(destDir, { recursive: true });
        if (!fs.existsSync(srcDir)) continue;
        for (const entry of fs.readdirSync(srcDir)) {
          fs.copyFileSync(path.join(srcDir, entry), path.join(destDir, entry));
          filesCopied++;
        }
      }
    } catch(e) {
      console.error('[BACKUP] Ошибка копирования вложенных файлов в снапшот:', e.message);
    }

    // DB пишется ПОСЛЕ того как файлы снапшота уже скопированы — так
    // наличие .db-файла служит сигналом «снапшот завершён»: если процесс
    // упадёт на середине копирования файлов, .db не появится и такой
    // неполный снапшот не будет использован при восстановлении.
    const data = db.export();
    const fname = `zakupki_${stamp}.db`;
    const fpath = path.join(backupDir, fname);
    fs.writeFileSync(fpath, Buffer.from(data));

    // Обновляем также общее зеркало files_mirror (без версионирования)
    // для обратной совместимости со старым restore-кодом.
    const filesMirrorDir = path.join(backupDir, 'files_mirror');
    try {
      for (const [srcDir, label] of [[SIGNED_DIR, 'signed_specs'], [INVOICE_DIR, 'invoices']]) {
        const destDir = path.join(filesMirrorDir, label);
        fs.mkdirSync(destDir, { recursive: true });
        if (!fs.existsSync(srcDir)) continue;
        const srcEntries = new Set(fs.readdirSync(srcDir));
        for (const entry of srcEntries) {
          const srcPath = path.join(srcDir, entry);
          const destPath = path.join(destDir, entry);
          const srcStat = fs.statSync(srcPath);
          const destStat = fs.existsSync(destPath) ? fs.statSync(destPath) : null;
          if (!destStat || destStat.mtimeMs < srcStat.mtimeMs || destStat.size !== srcStat.size) {
            fs.copyFileSync(srcPath, destPath);
          }
        }
        for (const entry of fs.readdirSync(destDir)) {
          if (!srcEntries.has(entry)) fs.rmSync(path.join(destDir, entry), { force: true });
        }
      }
    } catch(e) {
      console.error('[BACKUP] Ошибка синхронизации files_mirror:', e.message);
    }

    // Удаляем снапшоты (DB-файл + папку files_<stamp>) старше 30 дней.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(backupDir);
    for (const entry of entries) {
      const entryPath = path.join(backupDir, entry);
      const stat = fs.statSync(entryPath);
      if (entry.endsWith('.db') && stat.mtimeMs < cutoff) {
        fs.unlinkSync(entryPath);
        console.log('[BACKUP] Удалён старый DB-снапшот:', entry);
        // Удаляем и папку файлов этого же снапшота, если есть
        const snapshotStamp = entry.replace(/^zakupki_/, '').replace(/\.db$/, '');
        const snapshotDir = path.join(backupDir, `files_${snapshotStamp}`);
        if (fs.existsSync(snapshotDir)) {
          fs.rmSync(snapshotDir, { recursive: true, force: true });
          console.log('[BACKUP] Удалена папка файлов снапшота:', `files_${snapshotStamp}`);
        }
      }
    }

    console.log(`[BACKUP] ✓ ${fname} → ${backupDir} (${(data.byteLength / 1024).toFixed(1)} KB)${filesCopied ? `, файлов в снапшоте: ${filesCopied}` : ''}`);
  } catch(e) {
    console.error('[BACKUP] Ошибка:', e.message);
  }
}

module.exports = { doBackup, resolveBackupDir };
