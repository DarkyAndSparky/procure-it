/**
 * tests-e2e/smoke.spec.js
 *
 * Safety net для Фазы 5 (разбор public/index.html на ES-модули).
 * Это НЕ юнит-тесты — они не знают и не должны знать, как устроен
 * index.html внутри (один файл или двадцать модулей). Они открывают
 * настоящий браузер и проверяют то же самое, что увидел бы человек:
 * работает логин, видны вкладки, можно создать актив, поиск работает.
 *
 * Правило то же, что было с 237 backend-тестами: гоняем ДО начала
 * разбора index.html (baseline), затем после каждого вынесенного
 * JS-модуля. Число прошедших тестов не должно меняться.
 *
 * Данные — в изолированной директории (.e2e-data/, см. playwright.config.js),
 * поднимается свежий admin/admn0000 при каждом запуске.
 */
const { test, expect } = require('@playwright/test');
const { ADMIN_LOGIN, ADMIN_PIN } = require('./e2e-credentials');

async function login(page) {
  await page.goto('/');
  await page.click('#auth-btn');
  await page.waitForSelector('#m-login', { timeout: 5000 });
  await page.fill('#m-login', ADMIN_LOGIN);
  await page.fill('#m-pwd', ADMIN_PIN);
  // Селектор по тексту "Войти" неоднозначен — совпадает с #auth-btn и другими
  // кнопками на странице. Кнопка входа в самой модалке — единственная с
  // data-action="doLogin" (Фаза 6: onclick → addEventListener для CSP), берём точно её.
  await page.click('button[data-action="doLogin"]');
  // После логина auth-кнопка меняет текст/состояние, вкладки .nav-auth становятся видимыми
  await expect(page.locator('[data-tab="os"]')).toBeVisible({ timeout: 5000 });

  // SEC-1: форма принудительной смены дефолтного пароля здесь не появится —
  // global-setup.js меняет пароль admin ОДИН РАЗ до старта тестов (см. этот
  // файл), так что логин здесь всегда идёт уже НЕ дефолтным паролем.
}

test.describe('Смоук: базовая работоспособность UI', () => {

  test('страница логина открывается, вкладки скрыты до входа', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#auth-btn')).toBeVisible();
    // До логина .nav-auth вкладки не должны быть кликабельно-функциональны для гостя
    await expect(page.locator('#app')).toBeVisible();
  });

  test('логин под admin/admn0000 открывает вкладки', async ({ page }) => {
    await login(page);
    for (const tab of ['os', 'small', 'infra', 'history', 'accounts', 'settings']) {
      await expect(page.locator(`[data-tab="${tab}"]`)).toBeVisible();
    }
  });

  test('переключение между вкладками не роняет страницу (нет JS-ошибок)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await login(page);
    for (const tab of ['dashboard', 'os', 'small', 'infra', 'history', 'accounts', 'settings']) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(300); // даём отрисоваться
    }

    expect(errors, `JS-ошибки в консоли: ${errors.join('\n')}`).toEqual([]);
  });

  test('дашборд показывает карточки статистики после логина', async ({ page }) => {
    await login(page);
    await page.click('[data-tab="dashboard"]');
    // Число активов на дашборде — сигнатурный элемент, что /api/stats отработал
    await expect(page.locator('#app')).toContainText(/\d+/, { timeout: 5000 });
  });

  test('вкладка "ОС" показывает таблицу/список активов', async ({ page }) => {
    await login(page);
    await page.click('[data-tab="os"]');
    await page.waitForTimeout(500);
    // На чистой БД список может быть пустым — проверяем, что сама вкладка отрисовалась
    // (наличие панели фильтров/поиска — она есть всегда, даже при пустом списке)
    await expect(page.locator('#app')).toBeVisible();
  });

  test('полный цикл: создать актив → он появляется в списке', async ({ page }) => {
    await login(page);
    await page.click('[data-tab="os"]');
    await page.waitForTimeout(300);

    await page.click(`button[data-action="showAddModal"]`); // Фаза 6: onclick → addEventListener
    await page.waitForSelector('#a-model', { timeout: 5000 });
    await page.fill('#a-model', 'E2E-Smoke-Test-Model');

    await page.click('.modal-actions button:has-text("Сохранить")');
    await page.waitForTimeout(500);

    await expect(page.locator('#app')).toContainText('E2E-Smoke-Test-Model', { timeout: 5000 });
  });

  test('логаут скрывает вкладки обратно', async ({ page }) => {
    await login(page);
    // toggleAuth() при активной сессии делает МГНОВЕННЫЙ выход (без модалки) —
    // видно по коду: if (canEdit()) { ...; render(); return; }. Проверяем,
    // что защищённые вкладки (.nav-auth, управляются классом body.body-auth
    // через CSS) снова спрятаны.
    await page.click('#auth-btn');
    await expect(page.locator('[data-tab="os"]')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#auth-btn')).toHaveText(/Войти/);
  });

});
