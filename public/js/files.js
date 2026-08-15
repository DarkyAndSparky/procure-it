// ─── Signed spec PDF ─────────────────────────────────────────────────────────
async function uploadSignedSpec(id, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf') { toast('Только PDF файлы'); input.value=''; return; }
  if (file.size > 10 * 1024 * 1024) { toast('Файл слишком большой (макс. 10МБ)'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      await api('POST', `/api/requests/${id}/signed-spec`, { pdf: e.target.result });
      toast('✅ Подписанная спецификация прикреплена');
      renderRegistry();
    } catch(err) { toast('Ошибка загрузки: ' + err.message); }
    input.value = '';
  };
  reader.readAsDataURL(file);
}

async function downloadSignedSpec(id, specNum, orgShort) {
  try {
    const res = await fetch(`/api/requests/${id}/signed-spec`, {
      headers: authToken ? { 'X-Auth-Token': authToken } : {}
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeOrg = (orgShort || '').replace(/[\\/:\*?"<>|]/g, '_').slice(0, 20);
    a.href = url; a.download = safeOrg ? `${safeOrg}_Спецификация_${specNum}_подписано.pdf` : `${specNum}_подписано.pdf`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  } catch(e) { toast('Ошибка скачивания: ' + e.message); }
}

// ─── Invoice (счёт) file ─────────────────────────────────────────────────────
async function uploadInvoiceFile(id, input) {
  const file = input.files[0];
  if (!file) return;
  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(file.type)) { toast('Допустимые форматы: PDF, PNG, JPG, WebP'); input.value=''; return; }
  if (file.size > 10 * 1024 * 1024) { toast('Файл слишком большой (макс. 10МБ)'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      await api('POST', `/api/requests/${id}/invoice-file`, { file: e.target.result, name: file.name });
      toast('✅ Счёт прикреплён');
      renderRegistry();
    } catch(err) { toast('Ошибка загрузки: ' + err.message); }
    input.value = '';
  };
  reader.readAsDataURL(file);
}

async function downloadInvoiceFile(id, specNum) {
  try {
    const res = await fetch(`/api/requests/${id}/invoice-file`, {
      headers: authToken ? { 'X-Auth-Token': authToken } : {}
    });
    if (!res.ok) throw new Error(await res.text());
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = m ? m[1] : `${specNum}_счет`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  } catch(e) { toast('Ошибка скачивания: ' + e.message); }
}

// ─── Open / create request folder ───────────────────────────────────────────
async function openRequestFolder(id, rootPathOverride) {
  const body = rootPathOverride ? { rootPath: rootPathOverride, saveAsDefault: userRole === 'admin' } : {};
  try {
    const res = await fetch(`/api/requests/${id}/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { 'X-Auth-Token': authToken } : {}) },
      body: JSON.stringify(body)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (result.code === 'NO_ROOT') {
        const root = prompt('Корневая сетевая папка не указана. Введите путь к ней (например, папка «Платежи»):');
        if (!root) return;
        return openRequestFolder(id, root.trim());
      }
      toast('Ошибка открытия папки: ' + (result.error || res.statusText));
      return;
    }
    if (result.mode === 'webdav' && result.url) {
      window.open(result.url, '_blank');
      return;
    }
    toast(`📁 Открыта папка: ${result.folderPath}`);
    if (rootPathOverride) loadConfig(); // refresh appConfig if we just saved a new default
  } catch(e) {
    toast('Ошибка открытия папки: ' + e.message);
  }
}

// ─── Backup download (auth-aware) ─────────────────────────────────────────────
async function downloadBackup(type) {
  const url = type === 'db' ? '/api/backup/db' : '/api/backup';
  try {
    const res = await fetch(url, {
      headers: authToken ? { 'X-Auth-Token': authToken } : {}
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const cd   = res.headers.get('content-disposition') || '';
    const nameMatch = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename  = nameMatch ? nameMatch[1].replace(/['"]/g,'') : (type === 'db' ? 'backup.db' : 'backup.json');
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url2; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url2); }, 1000);
  } catch(e) { toast('Ошибка скачивания бэкапа: ' + e.message); }
}

// ─── Backup/Restore ──────────────────────────────────────────────────────────
async function restoreBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch(e) { toast('Ошибка: файл повреждён'); input.value = ''; return; }

  // Показываем реальные цифры «сейчас / будет» вместо голого confirm() —
  // легко было щёлкнуть не глядя и потерять данные одним кликом мимо.
  const incoming = {
    requests: (data.requests || []).length,
    orgs: (data.orgs || []).length,
    users: (data.users || []).length,
    addresses: (data.addresses || []).length,
    templates: (data.templates || []).length,
  };

  let current = { requests: '?', orgs: '?', users: '?' };
  try {
    const info = await api('GET', '/api/system-info');
    current = { requests: info.counts?.requests ?? '?', orgs: info.counts?.orgs ?? '?', users: info.counts?.users ?? '?' };
  } catch(e) { /* не критично — покажем «?», не блокируем восстановление из-за этого */ }

  document.getElementById('restore-current-stats').innerHTML =
    `${current.requests} заявок<br>${current.orgs} организаций<br>${current.users} пользователей`;
  document.getElementById('restore-incoming-stats').innerHTML =
    `${incoming.requests} заявок<br>${incoming.orgs} организаций<br>${incoming.users} пользователей`;
  const bd = data.exported || data.exportedAt || data.backupDate || data.date;
  document.getElementById('restore-backup-date').textContent = bd
    ? `Файл сформирован: ${new Date(bd).toLocaleString('ru-RU')}`
    : `Дата формирования файла не найдена в бэкапе — проверь, что это тот файл.`;

  window._pendingRestoreData = data;
  window._pendingRestoreInput = input;
  document.getElementById('restore-confirm-modal').style.display = 'flex';
}

function cancelRestoreConfirm() {
  document.getElementById('restore-confirm-modal').style.display = 'none';
  if (window._pendingRestoreInput) window._pendingRestoreInput.value = '';
  window._pendingRestoreData = null;
  window._pendingRestoreInput = null;
}

async function proceedRestoreConfirm() {
  const data = window._pendingRestoreData;
  const input = window._pendingRestoreInput;
  document.getElementById('restore-confirm-modal').style.display = 'none';
  if (!data) return;

  const btn = document.getElementById('restore-confirm-btn');
  btn.disabled = true; btn.textContent = '⏳ Восстанавливаю…';
  try {
    const result = await api('POST', '/api/restore', data);
    // Server invalidated all sessions after restore — clear local token and reload
    localStorage.removeItem('procure_token');
    const f = result?.files;
    let msg = '✓ Данные восстановлены.';
    if (f && (f.restored || f.missing)) {
      msg += ` Файлов возвращено из зеркала бэкапов: ${f.restored}.`;
      if (f.missing) msg += ` Не найдено: ${f.missing} (проверьте лог сервера).`;
    }
    toast(msg + ' Страница перезагрузится...');
    setTimeout(() => location.reload(), f?.missing ? 3500 : 1200);
  } catch(e) {
    toast('Ошибка восстановления: ' + e.message);
    btn.disabled = false; btn.textContent = 'Заменить всё';
  } finally {
    if (input) input.value = '';
    window._pendingRestoreData = null;
    window._pendingRestoreInput = null;
  }
}

