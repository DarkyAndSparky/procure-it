// Сквозной сценарий: создать организацию → создать заявку с двумя позициями →
// проверить, что расчёт цены продажи/прибыли в форме совпадает с ручным
// расчётом по формуле из pricing-core.js → сохранить → найти в реестре по
// поиску → сменить статус → отредактировать (меняется сумма) → удалить.
// Один длинный test, а не россыпь мелких: шаги реально последовательно
// зависят друг от друга (id заявки, номер спецификации), рвать их на
// независимые тесты значило бы либо дублировать сетап на каждый шаг, либо
// городить order-dependent тесты, что playwright прямо не поощряет.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { uniq, waitToast, gotoPage, createOrgViaUi, fillNewRequestForm, money } = require('./helpers');

test.use({ storageState: path.join(__dirname, '.auth', 'operator.json') });

test('полный цикл заявки: создание с расчётом цены, реестр, статус, редактирование, удаление', async ({ page }) => {
  await page.goto('/');
  const { short: orgShort } = await createOrgViaUi(page);

  const reqName = uniq('E2E Закуп ноутбуков');
  await fillNewRequestForm(page, {
    orgShort,
    name: reqName,
    positions: [
      { name: 'Ноутбук Lenovo ThinkPad E14', qty: 2, price: 50000 },
      { name: 'Мышь Logitech M100',          qty: 2, price: 500  },
    ],
  });

  // ── Проверка расчёта: markup по умолчанию 5%, доставка выключена ──────────
  // Позиция 1: закуп 2×50000=100000, продажа 2×52500=105000
  // Позиция 2: закуп 2×500=1000,     продажа 2×525=1050
  // Итого: закуп 101000, продажа 106050, прибыль 5050
  await expect(page.locator('#sum-purchase')).toHaveText(money(101000));
  await expect(page.locator('#sum-sell')).toHaveText(money(106050));
  await expect(page.locator('#sum-profit')).toHaveText(money(5050));
  await expect(page.locator('#total-display')).toHaveText(money(106050));

  // ── Сохранение ──────────────────────────────────────────────────────────
  await page.getByRole('button', { name: '💾 Сохранить заявку' }).click();
  await expect(page.locator('#toast')).toContainText('Заявка сохранена');

  // ── Реестр: находим по поиску, проверяем сумму и статус по умолчанию ──────
  await gotoPage(page, 'registry');
  await page.locator('#reg-search').fill(reqName);
  const row = page.locator('#registry-body tr.row-toggle', { hasText: reqName });
  await expect(row).toBeVisible();
  await expect(row).toContainText(money(106050));
  await expect(row).toContainText('🆕 Новая');
  const specNum = (await row.locator('td').nth(1).innerText()).trim();

  // Разворачиваем деталь заявки — проверяем, что обе позиции реально попали
  // в сохранённую запись, а не потерялись между формой и API. Кнопка
  // «Удалить» и список позиций лежат ТОЛЬКО в развёрнутой детали
  // (buildDetailHtml, лениво строится при первом разворачивании — см.
  // toggleDetail в public/js/registry.js), не в самой строке реестра.
  const chevronId = await row.locator('.chevron').getAttribute('id'); // "ch-<id>"
  const reqId = chevronId.replace('ch-', '');
  await row.locator('.chevron').click();
  const detail = page.locator(`#detail-${reqId}`);
  await expect(detail).toContainText('Ноутбук Lenovo ThinkPad E14');
  await expect(detail).toContainText('Мышь Logitech M100');

  // ── Смена статуса ──────────────────────────────────────────────────────
  await row.locator('select.status-select').selectOption('ordered');
  await waitToast(page, 'Статус: 📦 Заказано');
  await expect(row).toContainText('📦 Заказано');

  // ── Редактирование: меняем количество первой позиции, сумма должна пересчитаться ──
  await row.locator('button', { hasText: 'Ред.' }).click();
  await expect(page.locator('#page-new')).toBeVisible();
  await expect(page.locator('#edit-banner')).toBeVisible();
  await expect(page.locator('#edit-banner')).toContainText(specNum);
  await expect(page.locator('#f-name')).toHaveValue(reqName);

  const firstQtyInput = page.locator('#positions-body tr').first().locator('td').nth(5).locator('input');
  await firstQtyInput.fill('3'); // было 2 → закуп позиции 1 = 150000, продажа = 157500
  // Итого: 157500 + 1050 = 158550
  await expect(page.locator('#total-display')).toHaveText(money(158550));

  await page.getByRole('button', { name: '💾 Сохранить изменения' }).click();
  await expect(page.locator('#toast')).toContainText('Заявка обновлена');

  await gotoPage(page, 'registry');
  await page.locator('#reg-search').fill(reqName);
  const updatedRow = page.locator('#registry-body tr.row-toggle', { hasText: reqName });
  await expect(updatedRow).toContainText(money(158550));
  // Номер спецификации должен сохраниться неизменным при редактировании
  // (см. save-export.js: req.specNum = orig.specNum).
  await expect(updatedRow).toContainText(specNum);

  // ── Удаление (кнопка снова только в развёрнутой детали — раскрываем заново,
  // т.к. renderRegistry() после возврата в реестр перерисовал строки с нуля) ──
  await updatedRow.locator('.chevron').click();
  page.once('dialog', d => d.accept());
  await page.locator(`#detail-${reqId}`).locator('button', { hasText: 'Удалить' }).click();
  await waitToast(page, 'Заявка удалена');
  await page.locator('#reg-search').fill(reqName);
  await expect(page.locator('#registry-empty')).toBeVisible();
});
