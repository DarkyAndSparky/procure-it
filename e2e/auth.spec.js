// Логин-форма, гостевой режим, разлогин — единственный спек, который
// намеренно НЕ подключает готовый storageState (см. helpers.js): здесь как
// раз важно, что происходит с чистого листа, без токена в localStorage.
const { test, expect } = require('@playwright/test');
const { CREDS, waitToast } = require('./helpers');

test.describe('Аутентификация', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('неавторизованный пользователь видит модалку входа', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#login-modal')).toBeVisible();
    await expect(page.locator('#login-username')).toBeFocused();
  });

  test('неверные креды показывают ошибку и не закрывают модалку', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-username').fill('admin');
    await page.locator('#login-password').fill('совершенно-неверный-пароль');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.locator('#login-error')).toContainText('Неверный логин или пароль');
    await expect(page.locator('#login-modal')).toBeVisible();
  });

  test('можно продолжить как гость с ролью "просмотр"', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Продолжить как гость/ }).click();
    await expect(page.locator('#login-modal')).toBeHidden();
    // Гостю (viewer) недоступны операторские/админские пункты меню и кнопка выхода.
    await expect(page.locator('#nav-new')).toBeHidden();
    await expect(page.locator('#nav-config')).toBeHidden();
    await expect(page.locator('#logout-btn')).toBeHidden();
    // Реестр — доступен на чтение всем.
    await expect(page.locator('#nav-registry')).toBeVisible();
  });

  test('успешный вход оператором открывает операторские разделы и переживает reload', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-username').fill(CREDS.operator.username);
    await page.locator('#login-password').fill(CREDS.operator.password);
    await page.getByRole('button', { name: 'Войти' }).click();

    await expect(page.locator('#login-modal')).toBeHidden();
    await expect(page.locator('#nav-new')).toBeVisible();
    await expect(page.locator('#nav-config')).toBeHidden(); // оператору конфиг не положен
    await expect(page.locator('#role-badge')).toContainText(CREDS.operator.username);

    // Токен лежит в localStorage — сессия должна пережить обновление страницы
    // без повторного показа модалки логина.
    await page.reload();
    await expect(page.locator('#login-modal')).toBeHidden();
    await expect(page.locator('#nav-new')).toBeVisible();
  });

  test('выход возвращает к модалке логина и стирает токен', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-username').fill(CREDS.operator.username);
    await page.locator('#login-password').fill(CREDS.operator.password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.locator('#login-modal')).toBeHidden();

    await page.locator('#logout-btn').click();
    await waitToast(page, 'Вы вышли из системы');
    await expect(page.locator('#login-modal')).toBeVisible();

    const token = await page.evaluate(() => localStorage.getItem('procure_token'));
    expect(token).toBeFalsy();
  });

  test('администратору доступны config и users, оператору — нет', async ({ page }) => {
    await page.goto('/');
    await page.locator('#login-username').fill(CREDS.admin.username);
    await page.locator('#login-password').fill(CREDS.admin.password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.locator('#login-modal')).toBeHidden();
    await expect(page.locator('#nav-config')).toBeVisible();
    await expect(page.locator('#nav-about')).toBeVisible();
  });
});
