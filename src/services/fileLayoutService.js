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
  return { year, monthFolder, orgFolder, safeName };
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

  return { davMkdir, davPut, davList, seg };
}

// Раскладывает файлы заявки на WebDAV-сервере (Nextcloud/ownCloud/любой WebDAV).
async function layoutFilesWebDav(reqId, r, cfg, body) {
  const { year, monthFolder, orgFolder, safeName } = resolveFolderNames(r);
  const { davMkdir, davPut, davList, seg } = buildDavClient(cfg.networkFolder, cfg.networkUser, cfg.networkPass);
  const results = [];

  // Create folder hierarchy
  await davMkdir(seg(year));
  await davMkdir(seg(year, monthFolder));
  await davMkdir(seg(year, monthFolder, orgFolder));

  // Find existing or next folder for this request
  const children = await davList(seg(year, monthFolder, orgFolder));
  let maxNum = 0, requestFolderName = null;
  for (const name of children) {
    const m = name.match(/^(\d+)_/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
    if (r.specNum && name.includes(r.specNum)) requestFolderName = name;
  }
  if (!requestFolderName) {
    requestFolderName = `${String(maxNum + 1).padStart(2, '0')}_${safeName}`;
  }

  await davMkdir(seg(year, monthFolder, orgFolder, requestFolderName));
  await davMkdir(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты'));

  if (body.docxBase64) {
    const name = `${r.specNum}_спецификация.docx`;
    await davPut(seg(year, monthFolder, orgFolder, requestFolderName, name), Buffer.from(body.docxBase64, 'base64'));
    results.push({ type: 'docx', name });
  }
  if (r.signedSpecPdf === '__has_pdf__') {
    const pdfPath = path.join(SIGNED_DIR, path.basename(query('SELECT signed_spec_pdf FROM requests WHERE id=?', [reqId])[0]?.signed_spec_pdf || ''));
    if (fs.existsSync(pdfPath)) {
      const name = `${r.specNum}_спецификация_подписано.pdf`;
      await davPut(seg(year, monthFolder, orgFolder, requestFolderName, name), fs.readFileSync(pdfPath));
      results.push({ type: 'signed_spec', name });
    }
  }
  if (r.invoiceFile === '__has_file__') {
    const invRow = query('SELECT invoice_file FROM requests WHERE id=?', [reqId])[0]?.invoice_file || '';
    const invPath = path.join(INVOICE_DIR, path.basename(invRow));
    if (invRow && fs.existsSync(invPath)) {
      const ext = invRow.split('.').pop();
      const name = `${r.specNum}_счет.${ext}`;
      await davPut(seg(year, monthFolder, orgFolder, requestFolderName, 'Расчеты', name), fs.readFileSync(invPath));
      results.push({ type: 'invoice_attached', name });
    }
  }
  if (body.excelBase64) {
    const name = `${r.specNum}_расчеты.xlsx`;
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

// Раскладывает файлы заявки в локальную (или примонтированную SMB) папку.
async function layoutFilesLocal(reqId, r, cfg, body) {
  const rootPath = cfg.networkFolder.trim();
  const { year, monthFolder, orgFolder, safeName } = resolveFolderNames(r);
  const results = [];

  mountSmbIfNeeded(cfg, rootPath);

  const orgPath = path.join(rootPath, year, monthFolder, orgFolder);
  fs.mkdirSync(orgPath, { recursive: true });

  let maxNum = 0, requestFolderName = null;
  try {
    for (const e of fs.readdirSync(orgPath, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const m = e.name.match(/^(\d+)_/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
      if (r.specNum && e.name.includes(r.specNum)) requestFolderName = e.name;
    }
  } catch(e) {}

  if (!requestFolderName) requestFolderName = `${String(maxNum + 1).padStart(2, '0')}_${safeName}`;

  const requestPath = path.join(orgPath, requestFolderName);
  const calcPath    = path.join(requestPath, 'Расчеты');
  fs.mkdirSync(requestPath, { recursive: true });
  fs.mkdirSync(calcPath,    { recursive: true });

  const wb64 = b64 => Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');

  if (body.docxBase64) {
    const name = `${r.specNum}_спецификация.docx`;
    fs.writeFileSync(path.join(requestPath, name), Buffer.from(body.docxBase64, 'base64'));
    results.push({ type: 'docx', name });
  }
  if (r.signedSpecPdf === '__has_pdf__') {
    const pdfRow = query('SELECT signed_spec_pdf FROM requests WHERE id=?', [reqId])[0];
    const pdfPath = path.join(SIGNED_DIR, path.basename(pdfRow?.signed_spec_pdf || ''));
    if (fs.existsSync(pdfPath)) {
      const name = `${r.specNum}_спецификация_подписано.pdf`;
      fs.writeFileSync(path.join(requestPath, name), fs.readFileSync(pdfPath));
      results.push({ type: 'signed_spec', name });
    }
  }
  if (r.invoiceFile === '__has_file__') {
    const invRow = query('SELECT invoice_file FROM requests WHERE id=?', [reqId])[0]?.invoice_file || '';
    const invPath = path.join(INVOICE_DIR, path.basename(invRow));
    if (invRow && fs.existsSync(invPath)) {
      const ext = invRow.split('.').pop();
      const name = `${r.specNum}_счет.${ext}`;
      fs.writeFileSync(path.join(calcPath, name), fs.readFileSync(invPath));
      results.push({ type: 'invoice_attached', name });
    }
  }
  if (body.excelBase64) {
    const name = `${r.specNum}_расчеты.xlsx`;
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

  const { year, monthFolder, orgFolder, safeName } = resolveFolderNames(r);
  mountSmbIfNeeded(cfg, rootPath);

  const orgPath = path.join(rootPath, year, monthFolder, orgFolder);
  fs.mkdirSync(orgPath, { recursive: true });

  let maxNum = 0, requestFolderName = null;
  try {
    for (const e of fs.readdirSync(orgPath, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const m = e.name.match(/^(\d+)_/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
      if (r.specNum && e.name.includes(r.specNum)) requestFolderName = e.name;
    }
  } catch(e) {}
  if (!requestFolderName) requestFolderName = `${String(maxNum + 1).padStart(2, '0')}_${safeName}`;

  const requestPath = path.join(orgPath, requestFolderName);
  fs.mkdirSync(requestPath, { recursive: true });

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

module.exports = { layoutFiles, openFolder, testFolder };
