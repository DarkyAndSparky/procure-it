// Общие UI-хелперы. Селекторы взяты напрямую из public/zakupki.html и
// public/js/*.js — id у элементов стабильные и явные (см. f-org, f-name,
// positions-body и т.д.), поэтому строим локаторы по ним, а не по тексту,
// который куда легче случайно сломать правкой копирайта на кнопке.
const { expect } = require('@playwright/test');

const path = require('path');
const fs = require('fs');

// ВАЖНО: читаем credentials.json ЛЕНИВО, а не на верхнем уровне модуля.
// Playwright на этапе сборки списка тестов делает require() всех spec-файлов
// (включая зависящие от проекта 'setup') ДО того, как сам проект 'setup'
// (auth.setup.js) реально выполнится и создаст этот файл. Синхронное чтение
// на верхнем уровне модуля роняло require() с ENOENT ещё до старта тестов.
let _creds;
function getCreds() {
  if (!_creds) {
    _creds = JSON.parse(
      fs.readFileSync(path.join(__dirname, '.auth', 'credentials.json'), 'utf8')
    );
  }
  return _creds;
}

// Сохраняем совместимость с текущим API (`const { CREDS } = require('./helpers')`)
// через геттер — обращение к CREDS.admin и т.д. останется ленивым.
const CREDS = new Proxy({}, {
  get(_target, prop) {
    return getCreds()[prop];
  },
});

// Уникальный суффикс на тест — тесты выполняются последовательно (workers:1)
// на ОДНОЙ живой БД (см. playwright.config.js), без сброса между тестами.
// Чтобы не зависеть друг от друга и не собирать «мусор» с прошлых прогонов
// под одним и тем же именем (UNIQUE-конфликт на short/username), у каждой
// сущности — свой случайный хвост.
function uniq(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function waitToast(page, text) {
  const toast = page.locator('#toast');
  await expect(toast).toContainText(text, { timeout: 5000 });
}

async function gotoPage(page, pageName) {
  // showPage(id) переключает .page по id вида #page-new/#page-registry/...
  await page.locator(`#nav-${pageName}`).click();
  await expect(page.locator(`#page-${pageName}`)).toBeVisible();
}

/** Создаёт организацию через UI-страницу "Организации" и возвращает её short-название. */
async function createOrgViaUi(page, { full, short } = {}) {
  full = full || `ООО "${uniq('Тест-Орг')}"`;
  short = short || uniq('ТО');
  await gotoPage(page, 'orgs');
  await page.locator('#new-org-full').fill(full);
  await page.locator('#new-org-short').fill(short);
  await page.getByRole('button', { name: 'Добавить организацию' }).click();
  await waitToast(page, 'Организация добавлена');
  await expect(page.locator('#page-orgs')).toContainText(short);
  return { full, short };
}

/** Заполняет форму новой заявки минимально необходимыми полями и позициями. */
async function fillNewRequestForm(page, { orgShort, name, positions } = {}) {
  positions = positions && positions.length ? positions : [{ name: 'Ноутбук Lenovo ThinkPad', qty: 2, price: 55000 }];
  name = name || uniq('Заявка');

  await gotoPage(page, 'new');
  if (orgShort) {
    await page.locator('#f-org').selectOption({ label: orgShort });
  }
  await page.locator('#f-name').fill(name);
  await page.locator('#f-date').fill(new Date().toISOString().slice(0, 10));

  // showPage('new') НЕ чистит форму (clearForm вызывается отдельно, только
  // по Ctrl+N/после сохранения) — а main.js при самой первой загрузке
  // страницы уже добавляет одну пустую строку (см. addRow('', 1, 'шт', 0)).
  // Так что на входе в этот хелпер строк может быть 0, 1 или сколько
  // угодно осталось от прошлого шага теста. Приводим к чистому состоянию
  // сами, а не полагаемся на то, сколько их там уже есть.
  const rows = page.locator('#positions-body tr');
  while (await rows.count() > 0) {
    await rows.first().locator('button.del-btn').click();
  }
  for (let i = 0; i < positions.length; i++) {
    await page.getByRole('button', { name: '+ Строка' }).click();
  }
  for (let i = 0; i < positions.length; i++) {
    const row = rows.nth(i);
    await row.locator('td').nth(2).locator('input').fill(positions[i].name);
    await row.locator('td').nth(5).locator('input').fill(String(positions[i].qty));
    await row.locator('td').nth(7).locator('input').fill(String(positions[i].price));
  }

  return { name, positions };
}

/** Regex, устойчивый к точному виду разделителя тысяч (U+00A0 vs обычный
 * пробел — зависит от сборки ICU в Node), но требующий совпадения по цифрам.
 * fmtRub() в public/js/helpers.js форматирует через Intl.NumberFormat('ru-RU'). */
function money(amount) {
  const [intPart, fracPart] = amount.toFixed(2).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0?\\s?');
  return new RegExp(`${grouped},${fracPart}`);
}

module.exports = { CREDS, uniq, waitToast, gotoPage, createOrgViaUi, fillNewRequestForm, money };
