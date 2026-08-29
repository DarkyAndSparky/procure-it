/**
 * public/js/error-handler.js
 *
 * Хвост Фазы 5/6: глобальный обработчик ошибок (window.onerror +
 * unhandledrejection), вынесенный из inline-скрипта в <head>. Classic
 * script — та же причина, что и в остальных файлах (см. auth.js).
 *
 * Должен подключаться ПЕРВЫМ (был первым инлайн-скриптом в <head>) —
 * ловит ошибки максимально рано, ещё до того, как остальные скрипты
 * загрузятся (typeof toast === 'function' — защита именно на этот случай).
 */

window.onerror = function(msg, src, line, col, err) {
  const text = `JS Error: ${msg}\n${src}:${line}:${col}`;
  console.error('[IT-ASSETS ERROR]', text, err);
  // Показываем toast если функция уже определена
  if (typeof toast === 'function') toast((typeof t === 'function' ? t('msg_ui_error', { msg: msg.slice(0, 80) }) : 'UI error: ' + msg.slice(0, 80)), 'error');
  return false;
};
window.addEventListener('unhandledrejection', e => {
  console.error('[IT-ASSETS UNHANDLED]', e.reason);
  if (typeof toast === 'function') toast((typeof t === 'function' ? t('msg_request_error', { msg: String(e.reason).slice(0, 80) }) : 'Request error: ' + String(e.reason).slice(0, 80)), 'error');
});
