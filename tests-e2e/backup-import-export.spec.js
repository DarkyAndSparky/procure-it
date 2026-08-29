/**
 * tests-e2e/backup-import-export.spec.js
 *
 * UI-покрытие для бэкапов, CSV-импорта/экспорта и синхронизации конфига
 * (settings > "Общие" и settings > "Конфиг"). Дополняет API-тесты
 * (tests/csvImportExport.test.js, tests/configExportImport.test.js,
 * tests/backup.test.js) — те проверяют логику, эти — что реальные кнопки
 * в реальном браузере реально до неё достучатся (правильные data-action,
 * правильные id полей, элементы не перекрыты чем-то другим и т.п.).
 *
 * ВАЖНО: этот файл написан по коду public/js/views/settings-general.js,
 * settings-config.js, csv-import.js — но НЕ прогонялся: в среде, где он
 * писался, недоступна загрузка браузера Chromium для Playwright (сетевой
 * egress ограничен). Проверить локально: npm run test:e2e -- backup-import-export
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const { ADMIN_LOGIN, ADMIN_PIN } = require('./e2e-credentials');

async function login(page) {
  await page.goto('/');
  await page.click('#auth-btn');
  await page.waitForSelector('#m-login', { timeout: 5000 });
  await page.fill('#m-login', ADMIN_LOGIN);
  await page.fill('#m-pwd', ADMIN_PIN);
  await page.click('button[data-action="doLogin"]');
  await expect(page.locator('[data-tab="os"]')).toBeVisible({ timeout: 5000 });
  // SEC-1: пароль уже сменён в global-setup.js до старта тестов — форма
  // принудительной смены дефолтного пароля здесь не появляется.
}

// Открывает вкладку Настройки (по умолчанию рендерится подвкладка "Общие",
// где и живут бэкапы/CSV-импорт/экспорт — см. _settingsTab='general' в
// settings-backup.js).
async function openSettingsGeneral(page) {
  await page.click('[data-tab="settings"]');
  await page.waitForSelector('#backup-list', { timeout: 5000 });
}

async function openSettingsConfig(page) {
  await page.click('[data-tab="settings"]');
  await page.click('[data-stab="config"]');
  await page.waitForSelector('[data-action="downloadConfigExport"]', { timeout: 5000 });
}

test.describe('Настройки → Общие: бэкапы', () => {

  test('панель бэкапов отрисовывается, кнопка создания видна', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);
    await expect(page.locator('button[data-action="createBackup"]')).toBeVisible();
    await expect(page.locator('#backup-list')).toBeVisible();
  });

  test('создание бэкапа — появляется тост успеха и запись в списке', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);

    await page.click('button[data-action="createBackup"]');
    // toast() всплывает как временный элемент — ищем текст "Бэкап создан"
    await expect(page.locator('body')).toContainText('Бэкап создан', { timeout: 5000 });

    // Список должен перезагрузиться и показать хотя бы одну строку таблицы
    await expect(page.locator('#backup-list table tbody tr').first()).toBeVisible({ timeout: 5000 });
  });

  test('кнопка восстановления показывает нативный confirm() с предупреждением', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);
    await page.click('button[data-action="createBackup"]');
    await expect(page.locator('#backup-list table tbody tr').first()).toBeVisible({ timeout: 5000 });

    let dialogMessage = '';
    page.once('dialog', async dialog => {
      dialogMessage = dialog.message();
      await dialog.dismiss(); // не восстанавливаем по-настоящему в этом тесте
    });
    await page.click('#backup-list button[data-action="restoreBackup"]');
    await expect.poll(() => dialogMessage).toContain('Восстановить базу из');
  });

  test('кнопки экспорта CSV присутствуют и указывают на корректный URL (Всё/ОС/Мелочи/Инфра)', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);
    // SEC-8: экспорт теперь требует авторизацию, а обычная <a href> не может
    // передать наши заголовки (x-user-id/x-edit-password) — поэтому кнопки,
    // не ссылки; URL зашит в data-args для downloadWithAuth().
    const getArgs = async (text) => {
      const raw = await page.locator(`button:has-text("${text}")`).getAttribute('data-args');
      return JSON.parse(raw);
    };
    expect((await getArgs('Всё'))[0]).toMatch(/\/api\/export\/csv$/);
    expect((await getArgs('ОС'))[0]).toMatch(/tab=os/);
    expect((await getArgs('Мелочи'))[0]).toMatch(/tab=small/);
    expect((await getArgs('Инфра'))[0]).toMatch(/tab=infra/);
  });

  test('клик по кнопке экспорта реально скачивает CSV-файл', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.click('button:has-text("Всё")'),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

});

test.describe('Настройки → Общие: импорт CSV', () => {

  test('без выбранного файла кнопка "Импортировать" недоступна', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);
    await expect(page.locator('#import-btn')).toBeDisabled();
  });

  test('загрузка CSV с оборудованием — определяется тип, кнопка активируется', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);

    const csvPath = path.join(__dirname, 'fixtures', 'sample-assets.csv');
    await page.setInputFiles('#csv-file', csvPath);

    await expect(page.locator('#import-type-hint')).toContainText('Оборудование', { timeout: 3000 });
    await expect(page.locator('#import-btn')).toBeEnabled();
  });

  test('полный цикл: импорт CSV с оборудованием — результат показывает добавленные записи', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);

    const csvPath = path.join(__dirname, 'fixtures', 'sample-assets.csv');
    await page.setInputFiles('#csv-file', csvPath);
    await expect(page.locator('#import-btn')).toBeEnabled({ timeout: 3000 });
    await page.click('#import-btn');

    await expect(page.locator('#import-result')).toContainText(/добавлено/i, { timeout: 10000 });
  });

  test('загрузка CSV с историей перемещений — определяется как история, не оборудование', async ({ page }) => {
    await login(page);
    await openSettingsGeneral(page);

    const csvPath = path.join(__dirname, 'fixtures', 'sample-history.csv');
    await page.setInputFiles('#csv-file', csvPath);

    await expect(page.locator('#import-type-hint')).toContainText('История', { timeout: 3000 });
  });

});

test.describe('Настройки → Конфиг: экспорт/импорт config.json', () => {

  test('панель конфига отрисовывается, кнопка экспорта видна', async ({ page }) => {
    await login(page);
    await openSettingsConfig(page);
    await expect(page.locator('[data-action="downloadConfigExport"]')).toBeVisible();
    await expect(page.locator('#cfg-import-file')).toBeVisible();
    await expect(page.locator('[data-action="startConfigImport"]')).toBeVisible();
  });

  test('клик "Скачать config.json" реально скачивает файл', async ({ page }) => {
    await login(page);
    await openSettingsConfig(page);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.click('[data-action="downloadConfigExport"]'),
    ]);
    expect(download.suggestedFilename()).toBe('config.json');
  });

  test('импорт без выбранного файла — показывает тост с ошибкой, не падает', async ({ page }) => {
    await login(page);
    await openSettingsConfig(page);
    await page.click('[data-action="startConfigImport"]');
    await expect(page.locator('body')).toContainText('Выберите файл', { timeout: 3000 });
  });

  test('импорт невалидного JSON — показывает понятную ошибку, не падает с необработанным исключением', async ({ page }) => {
    await login(page);
    await openSettingsConfig(page);

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const badJsonPath = path.join(__dirname, 'fixtures', 'invalid.json');
    await page.setInputFiles('#cfg-import-file', badJsonPath);
    await page.click('[data-action="startConfigImport"]');

    await expect(page.locator('#cfg-import-result')).toContainText(/Невалидный JSON/i, { timeout: 5000 });
    expect(errors).toEqual([]);
  });

  test('экспорт → повторный импорт того же файла без изменений — не показывает конфликтов', async ({ page }) => {
    await login(page);
    await openSettingsConfig(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.click('[data-action="downloadConfigExport"]'),
    ]);
    const downloadPath = await download.path();

    await page.setInputFiles('#cfg-import-file', downloadPath);
    await page.click('[data-action="startConfigImport"]');

    // Свой же экспорт без изменений — все записи должны совпасть по id,
    // конфликтов быть не должно, ожидаем сообщение об успехе/отсутствии
    // конфликтов, а не список конфликтов на разрешение.
    await expect(page.locator('#cfg-import-result')).not.toContainText('Конфликт', { timeout: 5000 });
  });

});
