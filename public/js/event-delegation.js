/**
 * public/js/event-delegation.js
 *
 * Фаза 6, шаг 1: инфраструктура для перевода inline onclick="..." на
 * addEventListener (нужно для CSP script-src 'self' без unsafe-inline).
 *
 * Проблема: весь UI рендерится через innerHTML (шаблонные строки), а не
 * через виртуальный DOM — обычный addEventListener на конкретный элемент
 * слетает при каждой перерисовке. Решение — ОДИН делегированный обработчик
 * на document, который слушает клики и ищет ближайший [data-action].
 *
 * Разметка вместо:
 *   <button onclick="showDetail('${a.id}')">...
 * теперь:
 *   <button data-action="showDetail" data-args='${JSON.stringify([a.id])}'>...
 *
 * Для случаев с event.stopPropagation() (было: onclick="event.stopPropagation();showX(...)"):
 *   <button data-action="showX" data-args='...' data-stop="1">...
 *
 * Для onchange/oninput: el.value ВСЕГДА добавляется ПОСЛЕДНИМ аргументом
 * (частый паттерн: onchange="foo(a, b, this.value)"). Статичные аргументы —
 * через data-onchange-args/data-oninput-args (только статичная часть, без value).
 *
 * Для случаев "закрыть по клику на фон, не на содержимое" (модалка-оверлей)
 * есть отдельный, более строгий атрибут data-action-self="closeModal" —
 * срабатывает ТОЛЬКО если событие произошло именно на этом элементе,
 * а не всплыло от потомка (обычный [data-action] через closest() сработал
 * бы и от клика внутри модалки, т.к. окно — потомок оверлея).
 *
 * Действие ищется как window[action] — то есть обычная глобальная функция,
 * как и раньше (classic-скрипты, общая область видимости). Никакой отдельный
 * реестр действий не нужен — это НЕ смена архитектуры, только смена способа
 * привязки клика к той же самой функции.
 *
 * Загружать первым, вместе с ui-utils.js — до того, как что-либо начнёт
 * рендериться.
 */

document.addEventListener('click', function(e) {
  // Особый случай: клик именно ПО САМОМУ элементу (не по потомку) — нужен
  // для оверлея модалки, чтобы закрытие срабатывало только по клику на фон,
  // а не по содержимому модалки внутри него. Обычный [data-action] через
  // closest() сработал бы и от клика внутри модалки (окно — потомок оверлея).
  // Аналог исходного onclick="closeModal(event)" на #modal-overlay, где
  // closeModal сама проверяла e.target===overlay.
  const selfEl = e.target.closest('[data-action-self]');
  if (selfEl && e.target === selfEl) {
    const fn = window[selfEl.dataset.actionSelf];
    if (typeof fn === 'function') { fn(e); return; }
    console.error('[event-delegation] Неизвестное действие (data-action-self):', selfEl.dataset.actionSelf, selfEl);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;

  if (el.dataset.stop === '1') e.stopPropagation();

  const action = el.dataset.action;
  const fn = window[action];
  if (typeof fn !== 'function') {
    console.error('[event-delegation] Неизвестное действие:', action, el);
    return;
  }

  let args = [];
  if (el.dataset.args) {
    try { args = JSON.parse(el.dataset.args); }
    catch (err) { console.error('[event-delegation] Битый data-args:', el.dataset.args, err); return; }
  }

  fn.apply(null, args);
});

// То же самое для onchange (используется в некоторых select/input) —
// отдельное событие, т.к. не всплывает как click в некоторых браузерах
// для <select>, но делегирование всё равно работает через bubbling change.
document.addEventListener('change', function(e) {
  const el = e.target.closest('[data-onchange-action]');
  if (!el) return;

  const action = el.dataset.onchangeAction;
  const fn = window[action];
  if (typeof fn !== 'function') {
    console.error('[event-delegation] Неизвестное действие (onchange):', action, el);
    return;
  }

  // el.value ВСЕГДА добавляется последним аргументом (частый паттерн:
  // onchange="foo(a, b, this.value)"). Статичные аргументы — через data-args.
  let args = [];
  if (el.dataset.onchangeArgs) {
    try { args = JSON.parse(el.dataset.onchangeArgs); }
    catch (err) { console.error('[event-delegation] Битый data-onchange-args:', el.dataset.onchangeArgs, err); return; }
  }
  args.push(el.value);

  fn.apply(el, args);
});

// То же для oninput (текстовые поля с живым поиском/фильтрацией).
document.addEventListener('input', function(e) {
  const el = e.target.closest('[data-oninput-action]');
  if (!el) return;

  const action = el.dataset.oninputAction;
  const fn = window[action];
  if (typeof fn !== 'function') {
    console.error('[event-delegation] Неизвестное действие (oninput):', action, el);
    return;
  }

  // Та же конвенция, что и для change: el.value добавляется последним аргументом.
  let args = [];
  if (el.dataset.oninputArgs) {
    try { args = JSON.parse(el.dataset.oninputArgs); }
    catch (err) { console.error('[event-delegation] Битый data-oninput-args:', el.dataset.oninputArgs, err); return; }
  }
  args.push(el.value);

  fn.apply(el, args);
});

// Делегирование для keydown — обычно "если Enter, сделать X" в текстовых
// полях. Передаём event.key последним аргументом (после статичных из
// data-args), сама функция-обработчик решает, что делать с клавишей —
// как и раньше, просто вызов теперь через data-action, а не inline.
document.addEventListener('keydown', function(e) {
  const el = e.target.closest('[data-onkeydown-action]');
  if (!el) return;

  const action = el.dataset.onkeydownAction;
  const fn = window[action];
  if (typeof fn !== 'function') {
    console.error('[event-delegation] Неизвестное действие (keydown):', action, el);
    return;
  }

  let args = [];
  if (el.dataset.onkeydownArgs) {
    try { args = JSON.parse(el.dataset.onkeydownArgs); }
    catch (err) { console.error('[event-delegation] Битый data-onkeydown-args:', el.dataset.onkeydownArgs, err); return; }
  }
  args.push(e.key);

  fn.apply(el, args);
});

// Делегирование для mousedown и dblclick — реже встречаются, но по той же схеме.
document.addEventListener('mousedown', function(e) {
  const el = e.target.closest('[data-onmousedown-action]');
  if (!el) return;
  const fn = window[el.dataset.onmousedownAction];
  if (typeof fn !== 'function') {
    console.error('[event-delegation] Неизвестное действие (mousedown):', el.dataset.onmousedownAction, el);
    return;
  }
  fn.call(el, e);
});

document.addEventListener('dblclick', function(e) {
  const el = e.target.closest('[data-ondblclick-action]');
  if (!el) return;
  const action = el.dataset.ondblclickAction;
  const fn = window[action];
  if (typeof fn !== 'function') {
    console.error('[event-delegation] Неизвестное действие (dblclick):', action, el);
    return;
  }
  let args = [];
  if (el.dataset.ondblclickArgs) {
    try { args = JSON.parse(el.dataset.ondblclickArgs); }
    catch (err) { console.error('[event-delegation] Битый data-ondblclick-args:', el.dataset.ondblclickArgs, err); return; }
  }
  fn.apply(el, args);
});
