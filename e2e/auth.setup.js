// Сетап-проект (см. playwright.config.js: projects[0]) — гоняется ОДИН раз
// перед всеми остальными тестами. Заводит рабочие учётки через API, минуя UI:
//   admin/admin0000 — засеян миграцией (см. src/db/schema.js) с
//     must_change_password=1, поэтому первым делом обязан сменить пароль —
//     это не опция, а требование самого API (см. auth/middleware.js:
//     requireRole блокирует все НЕ-GET запросы, пока флаг не снят).
//   e2e_operator / e2e_viewer — заводятся уже сменившим пароль админом,
//     нужны для permissions.spec.js (разграничение ролей).
//
// Результат — storageState-файлы в e2e/.auth/*.json с localStorage-токеном
// (приложение хранит сессию в localStorage под 'procure_token', см.
// public/js/auth.js — НЕ в куках), которые остальные спеки подключают через
// test.use({ storageState: ... }), не проходя логин-форму на каждый тест.
const { test: setup, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, '.auth');

const CREDS = {
  admin:    { username: 'admin',        password: 'AdminE2E#2026' },
  operator: { username: 'e2e_operator', password: 'OperatorE2E#2026' },
  viewer:   { username: 'e2e_viewer',   password: 'ViewerE2E#2026' },
};

setup('bootstrap admin/operator/viewer accounts', async ({ request, baseURL }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  async function writeStorageState(filename, token) {
    fs.writeFileSync(path.join(AUTH_DIR, filename), JSON.stringify({
      cookies: [],
      origins: [{ origin: baseURL, localStorage: [{ name: 'procure_token', value: token }] }],
    }, null, 2));
  }

  async function login(username, password) {
    const res = await request.post('/api/auth/login', { data: { username, password } });
    expect(res.ok(), `login as ${username} failed: ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  // 1. Первый вход дефолтным админом — обязательно приходит mustChangePassword.
  const first = await login('admin', 'admin0000');
  expect(first.mustChangePassword).toBeTruthy();

  const cp = await request.post('/api/auth/change-password', {
    headers: { 'X-Auth-Token': first.token },
    data: { newPassword: CREDS.admin.password },
  });
  expect(cp.ok(), `change-password failed: ${await cp.text()}`).toBeTruthy();

  // 2. Чистый вход уже с новым паролем — mustChangePassword должен спасть.
  const admin = await login(CREDS.admin.username, CREDS.admin.password);
  expect(admin.mustChangePassword).toBeFalsy();
  expect(admin.role).toBe('admin');
  await writeStorageState('admin.json', admin.token);

  // 3. Операторская и вьюер-учётки — заводит админ через /api/users.
  for (const [role, creds] of [['operator', CREDS.operator], ['viewer', CREDS.viewer]]) {
    const create = await request.post('/api/users', {
      headers: { 'X-Auth-Token': admin.token },
      data: { username: creds.username, password: creds.password, role },
    });
    expect(create.ok(), `creating ${role} user failed: ${await create.text()}`).toBeTruthy();

    const session = await login(creds.username, creds.password);
    expect(session.mustChangePassword).toBeFalsy(); // созданные админом не требуют смены
    expect(session.role).toBe(role);
    await writeStorageState(`${role}.json`, session.token);
  }

  // Сами креды — на случай если спек хочет пройти login-форму вручную
  // (auth.spec.js) вместо готового storageState.
  fs.writeFileSync(path.join(AUTH_DIR, 'credentials.json'), JSON.stringify(CREDS, null, 2));
});
