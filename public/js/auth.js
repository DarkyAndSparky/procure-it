// ─── State ───────────────────────────────────────────────────────────────────
const API = '';

// ── Auth token & role ────────────────────────────────────────────────────────
let authToken = localStorage.getItem('procure_token') || '';
let userRole  = 'viewer';
let userName  = null;

async function checkAuth() {
  try {
    const r = await fetch('/api/auth/status', {
      headers: authToken ? { 'X-Auth-Token': authToken } : {}
    });
    const data = await r.json();
    userRole = data.role || 'viewer';
    userName = data.username || null;
    updateRoleUI();
    if (data.authenticated) {
      if (data.mustChangePassword) {
        showChangePasswordModal(true);
        return false;
      }
      return true;
    }
    if (!data.hasUsers) return true; // no users configured — viewer access
    showLoginModal();
    return false;
  } catch(e) { return true; }
}

function updateRoleUI() {
  const isOperatorPlus = userRole === 'operator' || userRole === 'admin';
  const isAdmin = userRole === 'admin';
  document.querySelectorAll('[data-role-min="operator"]').forEach(el => {
    el.style.display = isOperatorPlus ? '' : 'none';
  });
  document.querySelectorAll('[data-role-min="admin"]').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
  document.querySelectorAll('[data-role-action]').forEach(el => {
    el.disabled = !isOperatorPlus;
    if (!isOperatorPlus) el.title = 'Только для операторов и администраторов';
  });
  const badge = document.getElementById('role-badge');
  if (badge) {
    const labels = { viewer: '👁 Просмотр', operator: '✏️ Оператор', admin: '⚙️ Админ' };
    badge.textContent = (userName ? userName + ' · ' : '') + (labels[userRole] || userRole);
    badge.style.display = '';
  }
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.style.display = userRole !== 'viewer' ? 'inline-flex' : 'none';
  const changePwBtn = document.getElementById('change-pw-btn');
  if (changePwBtn) changePwBtn.style.display = userRole !== 'viewer' ? 'inline-flex' : 'none';
}

function continueAsGuest() {
  // Force-close both auth modals, even if one is stuck on top of the other.
  const loginModal = document.getElementById('login-modal');
  if (loginModal) loginModal.style.display = 'none';
  const cpwModal = document.getElementById('change-pw-modal');
  if (cpwModal) cpwModal.remove(); // fully removed so its z-index can never block clicks again
  userRole = 'viewer';
  userName = null;
  updateRoleUI();
}

function showLoginModal() {
  // Belt-and-braces: remove any stray change-password modal first so it can never
  // sit on top of (and block clicks/input on) the login modal.
  document.getElementById('change-pw-modal')?.remove();
  let modal = document.getElementById('login-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'login-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9000;display:flex;align-items:center;justify-content:center;pointer-events:auto';
    modal.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:32px;width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:32px;margin-bottom:8px">🔒</div>
          <h2 style="font-size:18px;font-weight:600">procure-it</h2>
          <p style="color:var(--text-secondary);font-size:13px;margin-top:4px">Войдите для редактирования</p>
        </div>
        <div class="field" style="margin-bottom:12px">
          <label>Логин</label>
          <input type="text" id="login-username" placeholder="username" style="width:100%"
            onkeydown="if(event.key==='Enter')document.getElementById('login-password').focus()">
        </div>
        <div class="field" style="margin-bottom:16px">
          <label>Пароль</label>
          <input type="password" id="login-password" placeholder="••••••••"
            style="width:100%" onkeydown="if(event.key==='Enter')doLogin()">
        </div>
        <div id="login-error" style="color:var(--danger);font-size:12px;margin-bottom:12px;display:none"></div>
        <button class="btn btn-primary" onclick="doLogin()"
          style="width:100%;background:var(--accent);border-color:var(--accent);color:#fff;justify-content:center">Войти</button>
        <button class="btn" onclick="continueAsGuest()"
          style="width:100%;margin-top:8px;justify-content:center;color:var(--text-secondary);position:relative;z-index:1"
          type="button">
          Продолжить как гость (только просмотр)
        </button>
      </div>`;
    document.body.appendChild(modal);
    // Ловушка фокуса: без неё Tab уводит фокус на элементы фоновой (затемнённой)
    // страницы, которые остаются в DOM и доступны с клавиатуры несмотря на
    // визуальное затемнение. Циклим Tab/Shift+Tab между полями внутри модалки.
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
  modal.style.display = 'flex';
  document.body.appendChild(modal); // move to end of <body> so it always paints on top of everything else
  setTimeout(() => document.getElementById('login-username')?.focus(), 100);
}

async function doLogin() {
  const username = document.getElementById('login-username')?.value.trim();
  const pwd      = document.getElementById('login-password')?.value;
  const errEl    = document.getElementById('login-error');
  if (!username || !pwd) {
    if (errEl) { errEl.textContent = 'Введите логин и пароль'; errEl.style.display = 'block'; }
    return;
  }
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pwd })
    });
    const data = await r.json();
    if (data.ok) {
      authToken = data.token || '';
      userRole  = data.role || 'operator';
      userName  = data.username || username;
      if (authToken) localStorage.setItem('procure_token', authToken);
      document.getElementById('login-modal').style.display = 'none';
      updateRoleUI();
      if (data.mustChangePassword) {
        showChangePasswordModal(true); // forced
        return;
      }
      await load();
      await loadConfig();
      populateOrgSelect();
      populateTemplateSelect();
      await populateAddressList();
    } else {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = data.error || 'Ошибка'; }
    }
  } catch(e) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Ошибка соединения'; }
  }
}


let db = { orgs: [], requests: [], templates: [] };

// ─── Months (declared early — used in updateSpecNum, buildSpecHtml, registry filters) ──
const months    = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const RU_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

let editingId = null;
let currentPage = 1;
let pageSize = 25;
let totalPages = 1;
let allReqs = []; // cached for pagination

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'X-Auth-Token': authToken } : {}),
    }
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(API + path, opts);
    if (r.status === 401) {
      // Token expired or invalid
      authToken = '';
      localStorage.removeItem('procure_token');
      showLoginModal();
      throw new Error('Сессия истекла, войдите снова');
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || r.statusText);
    }
    return await r.json();
  } catch(e) {
    toast('Ошибка: ' + e.message);
    throw e;
  }
}

// Совместимость — save() теперь ничего не делает (данные сохраняются через API)
function save() {}

async function load() {
  try {
    showLoading(true);
    const [orgs, templates] = await Promise.all([
      api('GET', '/api/orgs'),
      api('GET', '/api/templates'),
    ]);
    db.orgs = orgs;
    db.templates = templates;
    // requests грузятся лениво в renderRegistry
  } catch(e) {
    console.error('Load error:', e);
  } finally {
    showLoading(false);
  }
}

function showLoading(on) {
  let el = document.getElementById('global-loading');
  if (!el) return;
  el.style.display = on ? 'flex' : 'none';
}


