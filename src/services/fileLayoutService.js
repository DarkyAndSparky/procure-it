const fs = require('fs');
const path = require('path');
const { query } = require('../db/connection');
const { SIGNED_DIR, INVOICE_DIR } = require('../config');
const { RU_MONTHS_FOLDER } = require('../utils/docFormat');

// Общие для WebDAV и локального режима: путь org/год/месяц + имя папки заявки.
function resolveFolderNames(r) {
  const date = new Date(r.date || Date.now());
  const year = String(date.getFullYear());
  const monthNum = String(date.getMonth() + 1).padStart(2, '0');
  const monthFolder = `${monthNum}_${RU_MONTHS_FOLDER[date.getMonth()]}`;
  // Папка организации: сначала выделенное поле «Папка для файлов» из
  // карточки организации (org_id → orgs.folder), затем короткое/полное имя.
  const orgRow    = r.orgId ? query('SELECT folder, short, full FROM orgs WHERE id=?', [r.orgId])[0] : null;
  const orgFolder = (orgRow?.folder || orgRow?.short || r.orgShort || r.orgFull || 'Организация').replace(/[\\/:*?"<>|]/g, '_');
  const safeName  = (r.name || 'Заявка').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  // Уязвимость (найдена при аудите): specNum подставляется прямо в имена
  // файлов (`${r.specNum}_спецификация.docx` и т.д.) — значение вида
  // "../../../tmp/pwned" в specNum позволяло записать файл ЗА пределами
  // папки заявки (path traversal), подтверждено на практике для локального/
  // SMB режима. Санитизируем так же, как orgFolder/safeName выше, до любого
  // использования в путях на диске.
  const safeSpecNum  = String(r.specNum || 'spec').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const safeOrgShort = (orgRow?.short || r.orgShort || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 20);
  return { year, monthFolder, orgFolder, safeName, safeSpecNum, safeOrgShort };
}

// ── WebDAV helpers ────────────────────────────────────────────────────────────
function buildDavClient(baseUrl, user, pass) {
  const https = require('https');
  const http  = require('http');
  const authHeader = (user && pass)
    ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
    : null;

  function davReq(method, urlStr, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const lib = parsed.protocol === 'https:' ? https : http;
      const headers = {
        ...(authHeader ? { Authorization: authHeader } : {}),
        ...extraHeaders,
      };
      if (body) {
        headers['Content-Type']   = 'application/octet-stream';
        headers['Content-Length'] = body.length;
      }
      const r2 = lib.request({
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method, headers,
        rejectUnauthorized: false,
      }, resp => {
        const chunks = [];
        resp.on('data', d => chunks.push(d));
        resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks) }));
      });
      r2.on('error', reject);
      if (body) r2.write(body);
      r2.end();
    });
  }

  async function davMkdir(u) {
    const r2 = await davReq('MKCOL', u);
    if (r2.status !== 201 && r2.status !== 405 && r2.status !== 301) {
      throw new Error(`MKCOL ${u} → HTTP ${r2.status}`);
    }
  }

  async function davPut(u, buf) {
    const r2 = await davReq('PUT', u, buf);
    if (r2.status < 200 || r2.status > 299) {
      throw new Error(`PUT ${u} → HTTP ${r2.status}: ${r2.body.toString().slice(0, 200)}`);
    }
  }

  // Читает содержимое файла, если он существует; возвращает null, если нет
  // (404) — используется для чтения маркер-файла с id заявки, см. ниже.
  async function davGetIfExists(u) {
    const r2 = await davReq('GET', u);
    if (r2.status === 404) return null;
    if (r2.status < 200 || r2.status > 299) return null;
    return r2.body.toString('utf8');
  }

  async function davList(u) {
    // PROPFIND Depth:1 → returns XML with hrefs
    const body = Buffer.from('<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>');
    const r2 = await davReq('PROPFIND', u, body, { Depth: '1', 'Content-Type': 'application/xml' });
    if (r2.status === 404) return [];
    const xml = r2.body.toString();
    // Extract last path segment from each <href>
    return [...xml.matchAll(/<[^:>]*:?href[^>]*>([^<]+)<\/[^:>]*:?href>/g)]
      .map(m => decodeURIComponent(m[1].split('/').filter(Boolean).pop() || ''));
  }

  const seg = (...parts) => baseUrl.replace(/\/$/, '') + '/' + parts.map(p => encodeURIComponent(p)).join('/');

  return { davMkdir, davPut, davList, davGetIfExists, seg };
}

// Раскладывает файлы заявки на WebDAV-сервере (Nextcloud/ownCloud/любой WebDAV).
async function layoutFilesWebDav(reqId, r, cfg, body) {
  const { year, monthFolder, orgFolder, safeName, safeSpecNum, safeOrgShort } = resolveFolderNames(r);
  const { davMkdir, davPut, davList, davGetIfExists, seg } = buildDavClient(cfg.networkFolder, cfg.networkUser, cfg.networkPass);
  const results = [];

  // Create folder hierarchy
  await davMkdir(seg(year));
  await davMkdir(seg(year, monthFolder));
  await davMkdir(seg(year, monthFolder, orgFolder));

  // Найти СУЩЕСТВУЮЩУЮ папку этой заявки. Раньше сопоставление шло по
  // вхождению specNum в имя папки — но имя папки строится из НАЗВАНИЯ
  // заявки (safeName), а не из specNum, поэтому проверка никогда не
  // срабатывала: каждый повторный вызов (например, сначала выгрузили
  // спецификацию, потом отдельно прикрепили счёт) создавал НОВУЮ папку
  // "02_...", "03_..." вместо переиспользования уже существующей —
  // подтверждённый баг. Теперь ищем по скрытому маркер-файлу с id заявки
  // внутри каждой папки-кандидата — это надёжно и не зависит от того, что
  // видимое имя папки построено из названия заявки, которое к тому же может
  // повторяться у разных заявок.
  const MARKER = '.procure-spec-id';
  const children = await davList(seg(year, monthFolder, orgFolder));
  let maxNum = 0, requestFolderName = null;
  for (const name of children) {
    const m = name.match(/^(\d+)_/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }
  for (const name of children) {
    if (!/^\d+_/.test(name)) continue;
    const marker = await davGetIfExists(seg(year, monthFolder, orgFolder, name, MARKER));
    if (marker && marker.trim() === String(reqId)) { requestFolderName = name; break; }
  }
  const isNewFolder = !requestFolderName;
  if (!requestFolderName) {
    requestFolderName = `${String(maxNum + 1).padStart(2, '0')}_${safeName}`;
  }

  await davMkdir(seg(year, monthFolder, orgFolder, requestFolderName));
  await davMkdir(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты'));
  if (isNewFolder) {
    await davPut(seg(year, monthFolder, orgFolder, requestFolderName, MARKER), Buffer.from(String(reqId), 'utf8'));
  }

  if (body.docxBase64) {
    const name = `${safeOrgShort}_Спецификация_${safeSpecNum}.docx`;
    await davPut(seg(year, monthFolder, orgFolder, requestFolderName, name), Buffer.from(body.docxBase64, 'base64'));
    results.push({ type: 'docx', name });
  }
  if (r.signedSpecPdf === '__has_pdf__') {
    const pdfPath = path.join(SIGNED_DIR, path.basename(query('SELECT signed_spec_pdf FROM requests WHERE id=?', [reqId])[0]?.signed_spec_pdf || ''));
    if (fs.existsSync(pdfPath)) {
      const name = `${safeOrgShort}_Спецификация_${safeSpecNum}_подписано.pdf`;
      await davPut(seg(year, monthFolder, orgFolder, requestFolderName, name), fs.readFileSync(pdfPath));
      results.push({ type: 'signed_spec', name });
    }
  }
  if (r.invoiceFile === '__has_file__') {
    const invMeta = query('SELECT invoice_file, invoice_file_original_name FROM requests WHERE id=?', [reqId])[0];
    const invRow = invMeta?.invoice_file || '';
    const invPath = path.join(INVOICE_DIR, path.basename(invRow));
    if (invRow && fs.existsSync(invPath)) {
      const ext = invRow.split('.').pop();
      // Сохраняем оригинальное имя файла счёта (например, полученного от
      // поставщика письмом), а не переименовываем его в свою схему — это
      // чужой документ со своим номером, важным для сверки с поставщиком.
      // Если оригинальное имя почему-то не сохранилось (старые записи до
      // этого фикса) — используем прежнюю схему именования как запасной вариант.
      const name = invMeta?.invoice_file_original_name
        ? path.basename(invMeta.invoice_file_original_name).replace(/[^\w.\-\u0400-\u04ff ]/g, '_').slice(0, 120)
        : `${safeOrgShort}_Счет_${safeSpecNum}.${ext}`;
      await davPut(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты', name), fs.readFileSync(invPath));
      results.push({ type: 'invoice_attached', name });
    }
  }
  if (body.excelBase64) {
    const name = `${safeOrgShort}_Расчеты_${safeSpecNum}.xlsx`;
    await davPut(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты', name), Buffer.from(body.excelBase64, 'base64'));
    results.push({ type: 'excel', name });
  }
  if (Array.isArray(body.invoiceFiles)) {
    for (const inv of body.invoiceFiles) {
      if (!inv.name || !inv.data) continue;
      // Sanitize filename — strip path separators to prevent traversal
      const safeInvName = path.basename(inv.name).replace(/[^\w.\-\u0400-\u04ff ]/g, '_').slice(0, 120);
      await davPut(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты', safeInvName),
        Buffer.from(inv.data.replace(/^data:[^;]+;base64,/, ''), 'base64'));
      results.push({ type: 'invoice', name: safeInvName });
    }
  }

  const folderUrl = seg(year, monthFolder, orgFolder, requestFolderName);
  return { ok: true, mode: 'webdav', folderPath: folderUrl, files: results };
}

// Монтирует SMB-шару на Windows, если заданы логин/пароль и путь \\server\share.
function mountSmbIfNeeded(cfg, rootPath) {
  if (cfg.networkUser && cfg.networkPass && process.platform === 'win32' && rootPath.startsWith('\\\\')) {
    const safeUser = (cfg.networkUser || '').replace(/["&|<>]/g, '');
    const safePass = (cfg.networkPass || '').replace(/["&|<>]/g, '');
    const safePath = rootPath.replace(/["&|<>]/g, '');
    try {
      require('child_process').execSync(
        `net use "${safePath}" /user:"${safeUser}" "${safePass}" /persistent:no`,
        { stdio: 'pipe' }
      );
    } catch(e) { /* already mounted */ }
  }
}

// Ищет уже существующую папку заявки внутри orgPath по скрытому
// маркер-файлу с id заявки (см. подробный комментарий в layoutFilesWebDav
// про то, почему сопоставление по имени папки было ошибочным). Если не
// нашли — создаёт новую, следующую по порядку, и сразу пишет в неё маркер.
// Общая для layoutFilesLocal и openFolder, чтобы не дублировать одну и ту
// же логику (и один и тот же потенциальный баг) в двух местах.
const REQUEST_MARKER_FILE = '.procure-spec-id';
function findOrCreateRequestFolderLocal(orgPath, reqId, safeName) {
  let maxNum = 0, requestFolderName = null;
  try {
    for (const e of fs.readdirSync(orgPath, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const m = e.name.match(/^(\d+)_/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
    }
    for (const e of fs.readdirSync(orgPath, { withFileTypes: true })) {
      if (!e.isDirectory() || !/^\d+_/.test(e.name)) continue;
      const markerPath = path.join(orgPath, e.name, REQUEST_MARKER_FILE);
      if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf8').trim() === String(reqId)) {
        requestFolderName = e.name;
        break;
      }
    }
  } catch(e) {}

  const isNewFolder = !requestFolderName;
  if (!requestFolderName) requestFolderName = `${String(maxNum + 1).padStart(2, '0')}_${safeName}`;

  const requestPath = path.join(orgPath, requestFolderName);
  fs.mkdirSync(requestPath, { recursive: true });
  if (isNewFolder) {
    try { fs.writeFileSync(path.join(requestPath, REQUEST_MARKER_FILE), String(reqId), 'utf8'); } catch(e) {}
  }
  return requestPath;
}

// Раскладывает файлы заявки в локальную (или примонтированную SMB) папку.
async function layoutFilesLocal(reqId, r, cfg, body) {
  const rootPath = cfg.networkFolder.trim();
  const { year, monthFolder, orgFolder, safeName, safeSpecNum, safeOrgShort } = resolveFolderNames(r);
  const results = [];

  mountSmbIfNeeded(cfg, rootPath);

  const orgPath = path.join(rootPath, year, monthFolder, orgFolder);
  fs.mkdirSync(orgPath, { recursive: true });

  const requestPath = findOrCreateRequestFolderLocal(orgPath, reqId, safeName);
  const calcPath    = path.join(requestPath, 'Расчеты');
  fs.mkdirSync(calcPath, { recursive: true });

  const wb64 = b64 => Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');

  if (body.docxBase64) {
    const name = `${safeOrgShort}_Спецификация_${safeSpecNum}.docx`;
    fs.writeFileSync(path.join(requestPath, name), Buffer.from(body.docxBase64, 'base64'));
    results.push({ type: 'docx', name });
  }
  if (r.signedSpecPdf === '__has_pdf__') {
    const pdfRow = query('SELECT signed_spec_pdf FROM requests WHERE id=?', [reqId])[0];
    const pdfPath = path.join(SIGNED_DIR, path.basename(pdfRow?.signed_spec_pdf || ''));
    if (fs.existsSync(pdfPath)) {
      const name = `${safeOrgShort}_Спецификация_${safeSpecNum}_подписано.pdf`;
      fs.writeFileSync(path.join(requestPath, name), fs.readFileSync(pdfPath));
      results.push({ type: 'signed_spec', name });
    }
  }
  if (r.invoiceFile === '__has_file__') {
    const invMeta = query('SELECT invoice_file, invoice_file_original_name FROM requests WHERE id=?', [reqId])[0];
    const invRow = invMeta?.invoice_file || '';
    const invPath = path.join(INVOICE_DIR, path.basename(invRow));
    if (invRow && fs.existsSync(invPath)) {
      const ext = invRow.split('.').pop();
      // См. комментарий в layoutFilesWebDav выше — сохраняем оригинальное
      // имя файла счёта вместо переименования в свою схему.
      const name = invMeta?.invoice_file_original_name
        ? path.basename(invMeta.invoice_file_original_name).replace(/[^\w.\-\u0400-\u04ff ]/g, '_').slice(0, 120)
        : `${safeOrgShort}_Счет_${safeSpecNum}.${ext}`;
      fs.writeFileSync(path.join(calcPath, name), fs.readFileSync(invPath));
      results.push({ type: 'invoice_attached', name });
    }
  }
  if (body.excelBase64) {
    const name = `${safeOrgShort}_Расчеты_${safeSpecNum}.xlsx`;
    fs.writeFileSync(path.join(calcPath, name), Buffer.from(body.excelBase64, 'base64'));
    results.push({ type: 'excel', name });
  }
  if (Array.isArray(body.invoiceFiles)) {
    for (const inv of body.invoiceFiles) {
      if (!inv.name || !inv.data) continue;
      const safeInvName = path.basename(inv.name).replace(/[^\w.\-\u0400-\u04ff ]/g, '_').slice(0, 120);
      fs.writeFileSync(path.join(calcPath, safeInvName), wb64(inv.data));
      results.push({ type: 'invoice', name: safeInvName });
    }
  }

  return { ok: true, mode: 'local', folderPath: requestPath, files: results };
}

// Точка входа: выбирает WebDAV или локальный режим по виду networkFolder.
async function layoutFiles(reqId, r, cfg, body) {
  const rootPath = (cfg.networkFolder || '').trim();
  if (!rootPath) throw Object.assign(new Error('Не указана папка назначения в Конфиге'), { status: 400 });
  const isWebDav = /^https?:\/\//i.test(rootPath);
  return isWebDav ? layoutFilesWebDav(reqId, r, cfg, body) : layoutFilesLocal(reqId, r, { ...cfg, networkFolder: rootPath }, body);
}

// ── Проверка статуса раскладки (read-only, ничего не создаёт) ──────────────
// После перезапуска сервера реестр не «помнит», что файлы уже разложены —
// это никогда нигде не сохранялось как флаг, факт раскладки виден только
// по факту наличия файлов в сетевой папке. Проверяем это по требованию:
// ищем папку заявки по тому же маркер-файлу, что использует раскладка, и
// смотрим, что внутри уже лежит — НЕ создавая ничего (в отличие от
// findOrCreateRequestFolderLocal/layoutFilesWebDav).
function findRequestFolderLocalReadOnly(orgPath, reqId) {
  try {
    for (const e of fs.readdirSync(orgPath, { withFileTypes: true })) {
      if (!e.isDirectory() || !/^\d+_/.test(e.name)) continue;
      const markerPath = path.join(orgPath, e.name, REQUEST_MARKER_FILE);
      if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf8').trim() === String(reqId)) {
        return path.join(orgPath, e.name);
      }
    }
  } catch(e) { /* orgPath doesn't exist yet — not laid out */ }
  return null;
}

async function checkLayoutStatus(reqId, r, cfg) {
  const rootPath = (cfg.networkFolder || '').trim();
  if (!rootPath) return { laidOut: false, reason: 'no_network_folder' };
  const { year, monthFolder, orgFolder, safeOrgShort, safeSpecNum } = resolveFolderNames(r);
  const isWebDav = /^https?:\/\//i.test(rootPath);

  let requestFolderPath = null; // локальный путь ИЛИ WebDAV-сегмент (для отображения)
  let entries = [];

  if (isWebDav) {
    const { davList, davGetIfExists, seg } = buildDavClient(rootPath, cfg.networkUser, cfg.networkPass);
    try {
      const children = await davList(seg(year, monthFolder, orgFolder));
      for (const name of children) {
        if (!/^\d+_/.test(name)) continue;
        const marker = await davGetIfExists(seg(year, monthFolder, orgFolder, name, REQUEST_MARKER_FILE));
        if (marker && marker.trim() === String(reqId)) {
          requestFolderPath = seg(year, monthFolder, orgFolder, name);
          entries = await davList(requestFolderPath);
          break;
        }
      }
    } catch(e) {
      return { laidOut: false, error: e.message };
    }
  } else {
    const orgPath = path.join(rootPath, year, monthFolder, orgFolder);
    const found = findRequestFolderLocalReadOnly(orgPath, reqId);
    if (found) {
      requestFolderPath = found;
      try { entries = fs.readdirSync(found); } catch(e) { entries = []; }
      // Расчёты (xlsx/счета) лежат в подпапке — заглядываем и туда тоже,
      // чтобы «Расчёты» тоже засчитывались как разложенные.
      try { entries = entries.concat(fs.readdirSync(path.join(found, 'Расчеты')).map(f => `Расчеты/${f}`)); } catch(e) {}
    }
  }

  if (!requestFolderPath) return { laidOut: false, folderPath: null };

  const hasSpec  = entries.some(f => f.includes('Спецификация') && f.endsWith('.docx'));
  const hasCalc  = entries.some(f => f.includes('Расчеты') && f.endsWith('.xlsx'));
  const hasFiles = entries.filter(f => f !== REQUEST_MARKER_FILE).length > 0;
  return { laidOut: hasFiles, hasSpec, hasCalc, folderPath: requestFolderPath, fileCount: entries.filter(f => f !== REQUEST_MARKER_FILE).length };
}

// Создаёт (если нужно) и открывает папку заявки в файловом менеджере ОС —
// best-effort, работает когда сервер и браузер на одной машине.
function openFolder(r, cfg, opts = {}) {
  const rootPath = (opts.rootPath || cfg.networkFolder || '').trim();
  if (!rootPath) {
    throw Object.assign(new Error('Не указана корневая папка'), { status: 400, code: 'NO_ROOT' });
  }
  if (/^https?:\/\//i.test(rootPath)) {
    // WebDAV — nothing to "open" locally, hand the URL back so the client can open a tab
    return { ok: true, mode: 'webdav', url: rootPath };
  }

  const { year, monthFolder, orgFolder, safeName, safeSpecNum, safeOrgShort } = resolveFolderNames(r);
  mountSmbIfNeeded(cfg, rootPath);

  const orgPath = path.join(rootPath, year, monthFolder, orgFolder);
  fs.mkdirSync(orgPath, { recursive: true });

  const requestPath = findOrCreateRequestFolderLocal(orgPath, r.id, safeName);

  // Best-effort: open in the OS file manager. Silently ignored if the
  // server has no GUI session (headless/Docker) — the client still gets
  // the resolved path back to show/copy.
  try {
    const { exec } = require('child_process');
    if (process.platform === 'win32') exec(`start "" "${requestPath.replace(/"/g, '')}"`);
    else if (process.platform === 'darwin') exec(`open "${requestPath.replace(/"/g, '')}"`);
    else exec(`xdg-open "${requestPath.replace(/"/g, '')}"`);
  } catch(e) { /* non-fatal */ }

  return { ok: true, mode: 'local', folderPath: requestPath };
}

// Проверка доступности папки/WebDAV — используется в Конфиге ("Проверить подключение").
async function testFolder(folderPath, user, pass) {
  const isWebDav = /^https?:\/\//i.test(folderPath);
  if (isWebDav) {
    const https = require('https');
    const http  = require('http');
    const parsed = new URL(folderPath.replace(/\/$/, ''));
    const lib = parsed.protocol === 'https:' ? https : http;
    const authHeader = (user && pass) ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : null;
    const status = await new Promise((resolve, reject) => {
      const r = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname,
        method: 'PROPFIND',
        headers: { ...(authHeader ? { Authorization: authHeader } : {}), Depth: '0', 'Content-Type': 'application/xml' },
        rejectUnauthorized: false,
      }, resp => resolve(resp.statusCode));
      r.on('error', reject);
      r.end();
    });
    if (status === 207 || status === 200) return { ok: true, mode: 'webdav', status };
    if (status === 401) return { ok: false, error: 'Ошибка авторизации (401). Проверьте логин и пароль.' };
    if (status === 404) return { ok: false, error: 'Папка не найдена (404). Проверьте URL и путь.' };
    return { ok: false, error: `Сервер ответил: HTTP ${status}` };
  } else {
    if (!fs.existsSync(folderPath)) return { ok: false, error: 'Папка не найдена или недоступна' };
    fs.accessSync(folderPath, fs.constants.W_OK);
    return { ok: true, mode: 'local' };
  }
}

module.exports = { layoutFiles, openFolder, testFolder, checkLayoutStatus };
