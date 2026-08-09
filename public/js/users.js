// ── Change password modal ─────────────────────────────────────────────────────
function showChangePasswordModal(forced = false) {
  let modal = document.getElementById('change-pw-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'change-pw-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:600;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:32px;width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:32px;margin-bottom:8px">🔑</div>
        <h2 style="font-size:17px;font-weight:600">${forced ? 'Смените пароль' : 'Изменение пароля'}</h2>
        ${forced ? '<p style="color:var(--warning);font-size:12px;margin-top:6px">⚠️ Вы используете временный пароль.<br>Смените его перед началом работы.</p>' : ''}
      </div>
      ${!forced ? `<div class="field" style="margin-bottom:12px">
        <label>Текущий пароль</label>
        <input type="password" id="cpw-current" placeholder="••••••••" style="width:100%">
      </div>` : ''}
      <div class="field" style="margin-bottom:12px">
        <label>Новый пароль</label>
        <input type="password" id="cpw-new" placeholder="минимум 6 символов" style="width:100%">
      </div>
      <div class="field" style="margin-bottom:16px">
        <label>Повторите новый пароль</label>
        <input type="password" id="cpw-confirm" placeholder="••••••••" style="width:100%"
          onkeydown="if(event.key==='Enter')doChangePassword(${forced})">
      </div>
      <div id="cpw-error" style="color:var(--danger);font-size:12px;margin-bottom:12px;display:none"></div>
      <button class="btn btn-primary" onclick="doChangePassword(${forced})"
        style="width:100%;background:var(--accent);border-color:var(--accent);color:#fff;justify-content:center">
        Сменить пароль
      </button>
      ${!forced ? `<button class="btn" onclick="document.getElementById('change-pw-modal').style.display='none'"
        style="width:100%;margin-top:8px;justify-content:center">Отмена</button>` : ''}
    </div>`;
  modal.style.display = 'flex';
  if (!modal.dataset.trapBound) {
    modal.dataset.trapBound = '1';
    modal.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll('input, button'))
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  }
  // При принудительной смене поля "Текущий пароль" в форме нет — фокусируем
  // сразу поле нового пароля; иначе фокусируем поле текущего пароля.
  setTimeout(() => (forced ? document.getElementById('cpw-new') : document.getElementById('cpw-current'))?.focus(), 100);
}

async function doChangePassword(forced = false) {
  const current = forced ? undefined : document.getElementById('cpw-current')?.value;
  const nw      = document.getElementById('cpw-new')?.value;
  const confirm = document.getElementById('cpw-confirm')?.value;
  const errEl   = document.getElementById('cpw-error');
  if ((!forced && !current) || !nw || !confirm) {
    errEl.textContent = 'Заполните все поля'; errEl.style.display = 'block'; return;
  }
  if (nw.length < 6) {
    errEl.textContent = 'Минимум 6 символов'; errEl.style.display = 'block'; return;
  }
  if (nw !== confirm) {
    errEl.textContent = 'Пароли не совпадают'; errEl.style.display = 'block'; return;
  }
  try {
    const payload = forced ? { newPassword: nw } : { currentPassword: current, newPassword: nw };
    await api('POST', '/api/auth/change-password', payload);
    document.getElementById('change-pw-modal').style.display = 'none';
    toast('✓ Пароль успешно изменён');
    if (forced) {
      // Now proceed with full init
      await load();
      await loadConfig();
      populateOrgSelect();
      populateTemplateSelect();
      await populateAddressList();
    }
  } catch(e) {
    errEl.textContent = e.message || 'Ошибка'; errEl.style.display = 'block';
  }
}

// ── Users management ─────────────────────────────────────────────────────────
async function loadUsers() {
  if (userRole !== 'admin') return;
  try {
    const users = await api('GET', '/api/users');
    const container = document.getElementById('users-list');
    if (!container) return;
    const ROLE_LABELS = { viewer: '👁 Просмотр', operator: '✏️ Оператор', admin: '⚙️ Админ' };
    if (!users.length) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Пользователей нет — используется PROCURE_PASSWORD из .env</div>';
      return;
    }
    container.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:6px 8px">Логин</th>
        <th style="text-align:left;padding:6px 8px">Роль</th>
        <th style="padding:6px 8px"></th>
      </tr></thead>
      <tbody>
        ${users.map(u => `
          <tr style="border-bottom:1px solid var(--border-light)">
            <td style="padding:6px 8px">${esc(u.username)}</td>
            <td style="padding:6px 8px">
              <select onchange="changeUserRole(${u.id}, this.value)" style="font-size:12px">
                ${['viewer','operator','admin'].map(r =>
                  `<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABELS[r]}</option>`
                ).join('')}
              </select>
            </td>
            <td style="padding:6px 8px;text-align:right">
              <button class="btn btn-sm" onclick="resetUserPassword(${u.id},'${escJsAttr(u.username)}')"
                title="Сменить пароль">🔑</button>
              <button class="btn btn-sm" onclick="deleteUser(${u.id},'${escJsAttr(u.username)}')"
                style="color:var(--danger)" title="Удалить">×</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  } catch(e) { console.error('loadUsers', e); }
}

async function addUser() {
  const username = document.getElementById('new-user-username')?.value.trim();
  const password = document.getElementById('new-user-password')?.value;
  const role     = document.getElementById('new-user-role')?.value;
  if (!username || !password) { toast('Введите логин и пароль'); return; }
  try {
    await api('POST', '/api/users', { username, password, role });
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-password').value = '';
    toast(`Пользователь ${username} создан`);
    await loadUsers();
  } catch(e) { toast('Ошибка: ' + e.message); }
}

async function changeUserRole(id, role) {
  try { await api('PUT', `/api/users/${id}`, { role }); toast('Роль обновлена'); }
  catch(e) { toast('Ошибка: ' + e.message); await loadUsers(); }
}

async function resetUserPassword(id, username) {
  const pw = prompt(`Новый пароль для ${username}:`);
  if (!pw) return;
  try { await api('PUT', `/api/users/${id}`, { password: pw }); toast('Пароль обновлён'); }
  catch(e) { toast('Ошибка: ' + e.message); }
}

async function deleteUser(id, username) {
  if (!confirm(`Удалить пользователя «${username}»?`)) return;
  try { await api('DELETE', `/api/users/${id}`); toast(`${username} удалён`); await loadUsers(); }
  catch(e) { toast('Ошибка: ' + e.message); }
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────
function toggleMobileSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const isOpen   = sidebar.classList.contains('mobile-open');
  sidebar.classList.toggle('mobile-open', !isOpen);
  overlay.classList.toggle('visible', !isOpen);
}

// Hide burger button on wide screens
(function() {
  const btn = document.getElementById('mobile-menu-btn');
  if (!btn) return;
  const mq = window.matchMedia('(max-width: 768px)');
  const update = (e) => { btn.style.display = e.matches ? 'flex' : 'none'; };
  update(mq);
  mq.addEventListener('change', update);
  // Close sidebar when nav item clicked on mobile
  document.getElementById('sidebar')?.addEventListener('click', (e) => {
    if (e.target.closest('.nav-item') && window.innerWidth <= 768) {
      toggleMobileSidebar();
    }
  });
})();

