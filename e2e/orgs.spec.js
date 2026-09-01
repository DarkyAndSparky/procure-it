const path = require('path');
const { test, expect } = require('@playwright/test');
const { uniq, waitToast, gotoPage, createOrgViaUi } = require('./helpers');

test.use({ storageState: path.join(__dirname, '.auth', 'operator.json') });

test.describe('Организации', () => {
  test('создание организации появляется в списке и в селекте на форме заявки', async ({ page }) => {
    await page.goto('/');
    const { short } = await createOrgViaUi(page);

    // Тот же список используется для наполнения #f-org на странице заявки —
    // ошибка синхронизации (populateOrgSelect() не вызван после addOrg())
    // была бы незаметна на странице orgs, но сломала бы создание заявок.
    await gotoPage(page, 'new');
    const options = await page.locator('#f-org option').allTextContents();
    expect(options).toContain(short);
  });

  test('пустые обязательные поля не дают создать организацию', async ({ page }) => {
    await page.goto('/');
    await gotoPage(page, 'orgs');
    await page.locator('#new-org-full').fill('');
    await page.locator('#new-org-short').fill('');
    await page.getByRole('button', { name: 'Добавить организацию' }).click();
    await waitToast(page, 'Заполните все поля');
  });

  test('дублирующееся короткое название отклоняется сервером с понятной ошибкой', async ({ page }) => {
    await page.goto('/');
    const { short } = await createOrgViaUi(page);

    // Вторая организация с ТЕМ ЖЕ коротким названием — конфликт (см.
    // findDuplicateOrg в src/routes/orgs.js), должен показаться как toast
    // с текстом ошибки от api(), а не тихо провалиться.
    await gotoPage(page, 'orgs');
    await page.locator('#new-org-full').fill(`ООО "${uniq('Дубликат')}"`);
    await page.locator('#new-org-short').fill(short);
    await page.getByRole('button', { name: 'Добавить организацию' }).click();
    await expect(page.locator('#toast')).toContainText('Конфликт с существующей организацией');
  });

  test('редактирование организации через модалку сохраняется', async ({ page }) => {
    await page.goto('/');
    const { short } = await createOrgViaUi(page);
    await gotoPage(page, 'orgs');

    const newSignatory = uniq('Иванов И.И.');
    const orgItem = page.locator('.org-item', { hasText: short });
    await orgItem.getByRole('button', { name: /Ред\./ }).click();
    await expect(page.locator('#org-modal')).toBeVisible();
    await page.locator('#modal-org-signatory').fill(newSignatory);
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await waitToast(page, 'Организация обновлена');
    await expect(page.locator('#org-modal')).toBeHidden();
    await expect(orgItem).toContainText(newSignatory);
  });

  test('удаление организации убирает её из списка и из формы заявки', async ({ page }) => {
    await page.goto('/');
    const { short } = await createOrgViaUi(page);
    await gotoPage(page, 'orgs');

    page.once('dialog', d => d.accept());
    await page.locator('.org-item', { hasText: short }).getByRole('button', { name: '×' }).click();
    await waitToast(page, 'Организация удалена');
    await expect(page.locator('#org-list')).not.toContainText(short);

    await gotoPage(page, 'new');
    const options = await page.locator('#f-org option').allTextContents();
    expect(options).not.toContain(short);
  });
});
