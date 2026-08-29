/**
 * public/js/theme.js
 *
 * Фаза 5, шаг 3 + шаг 6 (applyStoredStyles добавлена позже, та же тема
 * "внешний вид"): тёмная/светлая тема + применение цветов из настроек,
 * вынесенные из public/index.html. Classic script — та же причина, что и
 * в ui-utils.js/qr.js.
 *
 * initTheme() выполняется сразу же (IIFE) — важно, чтобы это произошло
 * ДО отрисовки body, иначе будет заметная вспышка светлой темы перед
 * переключением на тёмную. Поэтому этот файл должен подключаться в
 * <head>, как и было в исходном index.html.
 */

// ── ТЕМА ─────────────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('itassets_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  // Применяем сохранённые стили сразу из localStorage (без ожидания сервера)
  try {
    const styles = JSON.parse(localStorage.getItem('itassets_styles') || '{}');
    const dark   = saved === 'dark';
    const accent = dark ? (styles.accent_dark||'') : (styles.accent_light||'');
    if (accent) document.documentElement.style.setProperty('--accent', accent);
  } catch(e) {}
})();

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('itassets_theme', next);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

function _initThemeBtn() {
  const btn = document.getElementById('theme-toggle');
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  if (btn) btn.textContent = cur === 'dark' ? '☀️' : '🌙';
}

function applyStoredStyles(s) {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const accent = dark ? (s.accent_dark||'#e94560') : (s.accent_light||'#e94560');
  const headerBg = dark ? (s.header_dark||null) : (s.header_light||null);
  document.documentElement.style.setProperty('--accent', accent);
  if (headerBg) document.documentElement.style.setProperty('--header-bg', headerBg);
}
