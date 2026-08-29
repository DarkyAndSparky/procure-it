/**
 * public/js/health.js
 *
 * INFRA-6: health-бар — компактный индикатор в шапке (точка рядом с
 * total-badge), опрашивает GET /api/settings/health и красит себя по
 * худшему статусу (ok/warn/error). Клик разворачивает панель с деталями
 * по каждой проверке (БД, бэкап, сертификат, диск).
 *
 * Видим только залогиненным пользователям (как и total-badge рядом) —
 * анонимный посетитель публичного dashboard не должен видеть внутреннюю
 * диагностику сервера. Опрос по таймеру, не при каждом render(), чтобы
 * не долбить эндпоинт на каждое переключение вкладки.
 */

const HEALTH_POLL_MS = 60000; // раз в минуту достаточно — метрики не мгновенные
let _healthTimer = null;
let _healthLast  = null;

const HEALTH_ICON = { ok: '●', warn: '●', error: '●' };

async function refreshHealth() {
  const dot = document.getElementById('health-indicator');
  if (!dot) return;

  if (!currentUser) {
    dot.style.display = 'none';
    stopHealthPolling();
    return;
  }

  try {
    const r = await fetch(`${API}/api/settings/health`, { headers: ah() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    _healthLast = data;

    dot.style.display = 'inline-block';
    dot.className = 'health-dot health-' + data.overall;
    dot.textContent = HEALTH_ICON[data.overall] || '●';
    dot.title = data.overall === 'ok' ? t('health_all_ok') : t('health_issues');

    // Если панель сейчас открыта — обновляем её содержимое на лету.
    const panel = document.getElementById('health-panel');
    if (panel && panel.classList.contains('open')) renderHealthPanel(data);
  } catch (e) {
    dot.style.display = 'inline-block';
    dot.className = 'health-dot health-warn';
    dot.title = t('health_load_error');
  }
}

function renderHealthPanel(data) {
  const panel = document.getElementById('health-panel');
  if (!panel) return;
  const rows = [
    ['db',     t('health_db'),     data.checks.db],
    ['backup', t('health_backup'), data.checks.backup],
    ['cert',   t('health_cert'),   data.checks.cert],
    ['disk',   t('health_disk'),   data.checks.disk],
  ];
  panel.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">${t('health_title')}</div>
    ${rows.map(([key, label, c]) => `
      <div class="hp-row" title="${esc(c.detail)}">
        <span class="hp-dot health-${c.status}">●</span>
        <span class="hp-label">${label}</span>
        <span class="hp-detail">${esc(c.detail)}</span>
      </div>`).join('')}
  `;
}

function toggleHealthDetails() {
  const panel = document.getElementById('health-panel');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    return;
  }
  if (_healthLast) renderHealthPanel(_healthLast);
  panel.classList.add('open');
  // Закрыть по клику вне панели — вешаем одноразовый слушатель на след. тик,
  // чтобы не поймать тот же клик, что открыл панель.
  setTimeout(() => {
    document.addEventListener('click', _onOutsideHealthClick, { once: true });
  }, 0);
}

function _onOutsideHealthClick(e) {
  const panel = document.getElementById('health-panel');
  const dot   = document.getElementById('health-indicator');
  if (!panel) return;
  if (panel.contains(e.target) || dot?.contains(e.target)) {
    // Клик внутри панели/по самой точке — не закрываем, просто пере-навешиваем.
    setTimeout(() => document.addEventListener('click', _onOutsideHealthClick, { once: true }), 0);
    return;
  }
  panel.classList.remove('open');
}

function startHealthPolling() {
  stopHealthPolling();
  refreshHealth();
  _healthTimer = setInterval(refreshHealth, HEALTH_POLL_MS);
}

function stopHealthPolling() {
  if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }
}
