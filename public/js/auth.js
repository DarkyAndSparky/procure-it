/**
 * public/js/auth.js
 *
 * Фаза 5, шаг 5: логин/логаут/сессия, вынесенные из public/index.html.
 * Classic script — та же причина, что и в остальных вынесенных файлах.
 *
 * ВАЖНО: этот файл ЧИТАЕТ И ПИШЕТ глобальные переменные currentUser,
 * authPassword, currentTab — они остаются объявлены в самом index.html
 * (let currentUser = null; и т.д., в начале второго <script>-блока).
 * Это безопасно для classic-скриптов: обращение к ним происходит только
 * ВНУТРИ тел функций — то есть в момент вызова (клик, fetch-колбэк),
 * а не в момент объявления функции. К этому моменту все синхронные
 * скрипты уже отработали, и currentUser/authPassword/currentTab уже
 * объявлены и проинициализированы. Порядок <script>-тегов поэтому
 * не критичен — как и с i18n.js.
 *
 * Единственный синхронный top-level вызов в этой группе — _updateAuthUI()
 * в конце основного скрипта index.html; он тоже безопасен по той же причине.
 */

function toggleAuth() {
  if (canEdit()) {
    authPassword = null;
    currentUser  = null;
    _updateAuthUI();
    toast(t('msg_logged_out'));
    stopHealthPolling();
    if (typeof refreshHealth === 'function') refreshHealth(); // прячет точку
    render(); return;
  }
  _showLoginModal();
}

async function _showLoginModal() {
  showModal(`<h2>${t('modal_login_title')}</h2>
    <div class="form-row">
      <label>${t('field_login')}</label>
      <input type="text" id="m-login" autofocus placeholder="${t('msg_enter_login')}" autocomplete="username"/>
    </div>
    <div class="form-row">
      <label>${t('field_password')}</label>
      <input type="password" id="m-pwd" placeholder="${t('msg_enter_password')}" autocomplete="current-password"/>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doLogin">${t('btn_login_submit')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
  setTimeout(()=>document.getElementById('m-login')?.focus(), 80);
}

async function doLogin() {
  try {
    const login = document.getElementById('m-login')?.value.trim() || '';
    const pwd   = document.getElementById('m-pwd')?.value || '';
    if (!login) return toast(t('msg_enter_login'), 'error');

    const r = await fetch(`${API}/api/users/login`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ login, password: pwd })
    });
    const d = await r.json();
    if (r.ok) {
      currentUser  = d.user;
      authPassword = pwd;
      _updateAuthUI();
      toast(t('msg_welcome', { name: currentUser.name }), 'success');
      startHealthPolling();
      render();
      // Обязательная смена дефолтного пароля — блокирует остальной интерфейс,
      // сервер всё равно откажет во всех действиях, кроме смены своего пароля
      // (см. server/middleware/auth.js, SEC-1), поэтому форма не закрывается.
      if (d.must_change_pin) {
        setTimeout(() => _showForcedPinChange(), 400);
      } else {
        closeModal();
      }
    } else toast(d.error || t('msg_invalid_credentials'), 'error');
  } catch(e) { toast(t('msg_connection_error'), 'error'); }
}

function _showForcedPinChange() {
  window._forcePinChangeMode = true;
  const html = `
    <div style="padding:24px;max-width:420px">
      <div style="font-size:22px;margin-bottom:12px">${t('loc_forced_pin_title')}</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.7;margin-bottom:18px">
        ${t('loc_forced_pin_body')}
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">${t('lbl_new_password')}</label>
        <input id="new-pin-inp" type="password" placeholder="${t('msg_min_4_chars')}" autofocus
          style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface1);color:var(--text);font-size:14px;box-sizing:border-box"/>
      </div>
      <div style="margin-bottom:18px">
        <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">${t('lbl_repeat_password')}</label>
        <input id="new-pin-inp2" type="password" placeholder="${t('lbl_repeat_password')}"
          style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface1);color:var(--text);font-size:14px;box-sizing:border-box"/>
      </div>
      <div id="forced-pin-error" style="display:none;color:var(--danger,#e5484d);font-size:12px;margin-bottom:12px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" style="flex:1" data-action="doChangeDefaultPin">${t('btn_change_pin_continue')}</button>
      </div>
    </div>`;
  showModal(html);
  setTimeout(() => document.getElementById('new-pin-inp')?.focus(), 100);
}

async function doChangeDefaultPin() {
  const p1 = document.getElementById('new-pin-inp')?.value || '';
  const p2 = document.getElementById('new-pin-inp2')?.value || '';
  const errEl = document.getElementById('forced-pin-error');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } else toast(msg, 'error'); };
  if (p1.length < 4) return showErr(t('msg_pw_too_short'));
  if (p1 !== p2)     return showErr(t('msg_pw_mismatch'));
  if (p1 === 'admn0000') return showErr(t('msg_pw_cannot_be_default'));
  try {
    const r = await fetch(`${API}/api/settings/password`, {
      method:'PUT', headers:{'Content-Type':'application/json','x-user-id':currentUser?.id,'x-edit-password':authPassword},
      body: JSON.stringify({ newPassword: p1 })
    });
    const d = await r.json();
    if (r.ok) {
      authPassword = p1;
      window._forcePinChangeMode = false;
      closeModal();
      toast(t('msg_pw_changed'), 'success');
    } else showErr(d.error || t('msg_pw_change_error'));
  } catch(e) { showErr(t('msg_connection_error_short')); }
}

// Подстраховка: если 428 (must_change_pin) прилетит с любого другого запроса
// (например, сервер перезапустили и PIN снова дефолтный, а форма уже была
// закрыта раньше) — снова показываем блокирующую форму, а не просто toast.
(function _installForcedPinChangeGuard() {
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _fetch.apply(this, args);
    if (res.status === 428 && !window._forcePinChangeMode) {
      res.clone().json().then(d => {
        if (d && d.must_change_pin) _showForcedPinChange();
      }).catch(() => {});
    }
    return res;
  };
})();

function _updateAuthUI() {
  const btn    = document.getElementById('auth-btn');
  const status = document.getElementById('auth-status');
  const authed = !!currentUser;

  // Показываем/скрываем защищённые вкладки навигации
  document.body.classList.toggle('body-auth', authed);

  if (!authed) {
    if (btn)    btn.textContent     = t('btn_login');
    if (status) status.textContent  = t('lbl_viewer');
    // Если были на закрытой вкладке — возвращаем на дашборд
    const protectedTabs = ['os','small','infra','history','accounts','alerts','settings'];
    if (protectedTabs.includes(currentTab)) {
      currentTab = 'dashboard';
      document.querySelectorAll('.nav-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === 'dashboard'));
    }
    return;
  }

  const roleLabel = currentUser?.role === 'admin' ? t('lbl_admin')
                  : currentUser?.role === 'viewer' ? t('lbl_viewer') : t('lbl_operator');
  if (btn)    btn.textContent  = t('btn_logout');
  if (status) status.textContent = `${currentUser.name} · ${roleLabel}`;
}

function ah() {
  const h = {'Content-Type':'application/json'};
  if (canEdit()) h['x-edit-password'] = authPassword;
  if (currentUser?.id) h['x-user-id'] = currentUser.id;
  return h;
}

// Проверка прав
function canEdit()  { return !!currentUser && currentUser?.role !== 'viewer'; }
function canAdmin() { return !!currentUser && currentUser?.role === 'admin'; }
