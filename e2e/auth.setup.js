// Сетап-проект (см. playwright.config.js: projects[0]) — гоняется ОДИН раз
// перед всеми остальными тестами. Заводит рабочие учётки через API, минуя UI:
//   admin — засеян миграцией (см. src/db/schema.js) с фиксированным для
//     тестов паролем (PROCURE_INITIAL_ADMIN_PASSWORD в playwright.config.js,
//     без него пароль был бы случайным и неизвестным заранее) и
//     must_change_password=1, поэтому первым делом обязан сменить пароль —
//     это не опция, а требование самого API (см. auth/middleware.js:
//     requireRole блокирует все НЕ-GET запросы, пока флаг не снят).
//   e2e_operator / e2e_viewer — заводятся уже сменившим пароль админом,
//     нужны для permissions.spec.js (разграничение ролей).
//
// Сессия теперь живёт в HttpOnly auth-token cookie (не в localStorage — см.
// src/routes/auth.js/src/auth/middleware.js), а не-GET запросы дополнительно
// защищены CSRF (double-submit: csrf-token cookie, не-httpOnly, должна быть
// продублирована в заголовке X-CSRF-Token). request.storageState() снимает
// ТЕКУЩИЕ cookie из APIRequestContext (включая httpOnly) — этим и
// пользуемся вместо ручной сборки JSON.
//
// Результат — storageState-файлы в e2e/.auth/*.json с cookies, которые
// остальные спеки подключают через test.use({ storageState: ... }) — это
// действует и на `page`, и на `request` фикстуру в том же тесте, так что
// прямые API-вызовы в спеках автоматически идут с валидной cookie-сессией.
const { test: setup, expect, request: pwRequest } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, '.auth');
const INITIAL_ADMIN_PASSWORD = 'E2eBootstrap#Initial1'; // должен совпадать с playwright.config.js

const CREDS = {
  admin:    { username: 'admin',        password: 'AdminE2E#2026' },
  operator: { username: 'e2e_operator', password: 'OperatorE2E#2026' },
  viewer:   { username: 'e2e_viewer',   password: 'ViewerE2E#2026' },
};

/** Достаёт значение cookie по имени из текущего состояния APIRequestContext. */
async function getCookie(request, name) {
  const state = await request.storageState();
  const cookie = state.cookies.find(c => c.name === name);
  return cookie ? cookie.value : null;
}

setup('bootstrap admin/operator/viewer accounts', async ({ request, baseURL }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  async function login(username, password) {
    const res = await request.post('/api/auth/login', { data: { username, password } });
    expect(res.ok(), `login as ${username} failed: ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  // 1. Первый вход дефолтным админом — обязательно приходит mustChangePassword.
  const first = await login('admin', INITIAL_ADMIN_PASSWORD);
  expect(first.mustChangePassword).toBeTruthy();

  // При принудительной смене (mustChangePassword) currentPassword не нужен —
  // см. src/routes/auth.js. CSRF-токен для этого запроса — из cookie,
  // выставленной логином выше (/auth/login в списке CSRF-исключений, но
  // change-password уже под защитой).
  const csrfAfterLogin = await getCookie(request, 'csrf-token');
  const cp = await request.post('/api/auth/change-password', {
    headers: { 'X-CSRF-Token': csrfAfterLogin },
    data: { newPassword: CREDS.admin.password },
  });
  expect(cp.ok(), `change-password failed: ${await cp.text()}`).toBeTruthy();

  // 2. Чистый вход уже с новым паролем — mustChangePassword должен спасть.
  const admin = await login(CREDS.admin.username, CREDS.admin.password);
  expect(admin.mustChangePassword).toBeFalsy();
  expect(admin.role).toBe('admin');
  await request.storageState({ path: path.join(AUTH_DIR, 'admin.json') });
  const adminCsrf = await getCookie(request, 'csrf-token');

  // 3. Операторская и вьюер-учётки — заводит админ через /api/users.
  for (const [role, creds] of [['operator', CREDS.operator], ['viewer', CREDS.viewer]]) {
    const create = await request.post('/api/users', {
      headers: { 'X-CSRF-Token': adminCsrf },
      data: { username: creds.username, password: creds.password, role },
    });
    expect(create.ok(), `creating ${role} user failed: ${await create.text()}`).toBeTruthy();
  }

  // Логинимся каждой ролью в СВОЕЙ APIRequestContext — иначе повторный
  // /auth/login в общем `request` перезаписал бы cookie админа поверх той,
  // что мы уже сохранили в admin.json.
  for (const [role, creds] of [['operator', CREDS.operator], ['viewer', CREDS.viewer]]) {
    const ctx = await pwRequest.newContext({ baseURL, ignoreHTTPSErrors: true });
    const res = await ctx.post('/api/auth/login', { data: { username: creds.username, password: creds.password } });
    expect(res.ok(), `login as ${creds.username} failed: ${await res.text()}`).toBeTruthy();
    const session = await res.json();
    expect(session.mustChangePassword).toBeFalsy(); // созданные админом не требуют смены
    expect(session.role).toBe(role);
    await ctx.storageState({ path: path.join(AUTH_DIR, `${role}.json`) });
    await ctx.dispose();
  }

  // Сами креды — на случай если спек хочет пройти login-форму вручную
  // (auth.spec.js) вместо готового storageState.
  fs.writeFileSync(path.join(AUTH_DIR, 'credentials.json'), JSON.stringify(CREDS, null, 2));
});
