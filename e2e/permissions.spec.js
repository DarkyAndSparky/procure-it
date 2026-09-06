// Ролевая модель — viewer/operator/admin (см. src/auth/middleware.js,
// public/js/auth.js:updateRoleUI). Проверяем не только «эта кнопка скрыта»
// (легко сломать вёрсткой и не заметить), но и что попытка обойти скрытый UI
// напрямую (вызов showPage() из консоли) всё равно упирается в клиентский
// role-guard, а write-запрос — в серверный (403), а не в тихий успех.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { CREDS, uniq, waitToast, gotoPage, csrfHeader } = require('./helpers');

test.describe('Роль: viewer', () => {
  test.use({ storageState: path.join(__dirname, '.auth', 'viewer.json') });

  test('видит только реестр на чтение, операторские/админские разделы скрыты', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#nav-new')).toBeHidden();
    await expect(page.locator('#nav-orgs')).toBeHidden();
    await expect(page.locator('#nav-config')).toBeHidden();
    await expect(page.locator('#nav-registry')).toBeVisible();
    await expect(page.locator('#change-pw-btn')).toBeHidden(); // логика UI прячет её для роли viewer, даже если у аккаунта есть пароль
    // Версия публичная, но для гостя это просто текст, а не вход на
    // защищённую страницу «О системе».
    await expect(page.locator('#about-version')).not.toHaveText('…');
    expect(await page.locator('#about-version-link').evaluate(el => el.onclick)).toBeNull();
  });

  test('прямой вызов showPage("new") в обход скрытого меню блокируется клиентским role-guard', async ({ page }) => {
    await page.goto('/');
    // Дожидаемся окончания checkAuth(), иначе userRole ещё имеет стартовое
    // значение до чтения storageState, а страница формы остаётся начальной.
    await expect(page.locator('#nav-new')).toBeHidden();
    await page.evaluate(() => { showPage('registry'); showPage('new'); });
    await expect(page.locator('#toast')).toContainText('Требуется вход как оператор');
    await expect(page.locator('#page-new')).toBeHidden();
  });

  test('прямой POST /api/orgs в обход UI получает 403 от сервера, а не тихий успех', async ({ page, request }) => {
    // Сессия viewer — в HttpOnly cookie этого же browser-контекста, `request`
    // фикстура (та же storageState) шлёт её автоматически. Проверяем именно
    // СЕРВЕРНУЮ, а не только клиентскую защиту: спрятанная кнопка — это UX,
    // а не security-граница.
    await page.goto('/');
    const res = await request.post('/api/orgs', {
      headers: await csrfHeader(page),
      data: { full: 'Не должно создаться', short: uniq('nope') },
    });
    expect(res.status()).toBe(403);
  });

  test('статус заявки нельзя менять из реестра — select задизейблен', async ({ page }) => {
    // Сидируем и организацию, и заявку через API от имени ОПЕРАТОРА — не
    // полагаемся на данные, оставшиеся от других спеков (порядок запуска
    // файлов явно не гарантирован конфигом). Отдельный APIRequestContext с
    // operator.json storageState, а не переиспользование viewer-сессии
    // текущего теста — иначе испортили бы её для этого же теста.
    const { request: pwRequest } = require('@playwright/test');
    const opCtx = await pwRequest.newContext({ storageState: path.join(__dirname, '.auth', 'operator.json') });
    const opState = await opCtx.storageState();
    const opCsrf = opState.cookies.find(c => c.name === 'csrf-token')?.value || '';

    const orgRes = await opCtx.post('/api/orgs', {
      headers: { 'X-CSRF-Token': opCsrf },
      data: { full: `ООО "${uniq('Viewer-RO-Org')}"`, short: uniq('VRO') },
    });
    expect(orgRes.ok()).toBeTruthy();
    const org = await orgRes.json();

    const name = uniq('Viewer-RO-Check');
    await opCtx.post('/api/requests', {
      headers: { 'X-CSRF-Token': opCsrf },
      data: {
        orgId: org.id, name, date: new Date().toISOString().slice(0, 10),
        specNum: uniq('П-RO'), positions: [{ name: 'x', qty: 1, unit: 'шт', purchasePrice: 1, purchaseSum: 1, sellPerUnit: 1, sellSum: 1 }],
      },
    });
    await opCtx.dispose();

    await page.goto('/');
    await gotoPage(page, 'registry');
    await page.locator('#reg-search').fill(name);
    const row = page.locator('#registry-body tr.row-toggle', { hasText: name });
    await expect(row.locator('select.status-select')).toBeDisabled();
  });
});

test.describe('Роль: operator', () => {
  test.use({ storageState: path.join(__dirname, '.auth', 'operator.json') });

  test('доступны заявки и организации, но не конфиг/пользователи', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#nav-new')).toBeVisible();
    await expect(page.locator('#nav-orgs')).toBeVisible();
    await expect(page.locator('#nav-config')).toBeHidden();
    await expect(page.locator('#nav-about')).toBeHidden();
  });

  test('прямой вызов showPage("config") блокируется — оператор не админ', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => showPage('config'));
    await expect(page.locator('#toast')).toContainText('Только для администраторов');
    await expect(page.locator('#page-config')).toBeHidden();
  });

  test('прямой POST /api/users в обход UI получает 403', async ({ page, request }) => {
    await page.goto('/');
    const res = await request.post('/api/users', {
      headers: await csrfHeader(page),
      data: { username: uniq('should-not-exist'), password: 'whatever12345', role: 'admin' },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('Роль: admin', () => {
  test.use({ storageState: path.join(__dirname, '.auth', 'admin.json') });

  test('видит панель пользователей и может завести нового пользователя', async ({ page }) => {
    await page.goto('/');
    await gotoPage(page, 'config');
    await expect(page.locator('#users-list')).toContainText(CREDS.admin.username);

    const newUsername = uniq('e2e-fresh-user');
    await page.locator('#new-user-username').fill(newUsername);
    await page.locator('#new-user-password').fill('FreshUser#2026');
    await page.locator('#new-user-role').selectOption('operator');
    await page.getByRole('button', { name: '+ Добавить' }).click();
    await waitToast(page, `Пользователь ${newUsername} создан`);
    await expect(page.locator('#users-list')).toContainText(newUsername);
  });

  test('может открыть «О системе» кликом по версии в сайдбаре', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#about-version')).not.toHaveText('…');
    await page.locator('#about-version-link').click();
    await expect(page.locator('#page-about')).toBeVisible();
  });

  test('нельзя понизить собственную роль с admin (self-demotion guard)', async ({ page, request }) => {
    await page.goto('/');
    await gotoPage(page, 'config');
    const headers = await csrfHeader(page);
    const usersRes = await request.get('/api/users');
    const users = await usersRes.json();
    const self = users.find(u => u.username === CREDS.admin.username);
    const res = await request.put(`/api/users/${self.id}`, {
      headers,
      data: { role: 'viewer' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Нельзя понизить собственную роль');
  });
});
