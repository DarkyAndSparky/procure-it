// @ts-check
const path = require('path');
const os = require('os');
const { defineConfig, devices } = require('@playwright/test');

// Изолированная директория данных ПОД КАЖДЫЙ прогон — см. src/config.js
// (PROCURE_DATA_DIR). Без этого e2e бил бы по data/zakupki.db репозитория:
// на CI это разово, а локально — реальная порча рабочей БД разработчика.
const E2E_DATA_DIR = process.env.PROCURE_DATA_DIR
  || path.join(os.tmpdir(), `procure-it-e2e-${Date.now()}-${process.pid}`);
const PORT = process.env.PROCURE_E2E_PORT || '9137';
// Приложение всегда поднимается по HTTPS с самоподписанным сертификатом,
// если в системе есть openssl (см. server.js/src/certs.js) — рабочего
// «plain HTTP»-режима в проде НЕТ и env-флага на его отключение тоже нет.
// Значит и e2e ходит по https с ignoreHTTPSErrors, а не притворяется, что
// сервер слушает http.
const BASE_URL = `https://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // все тесты бьют по одному серверу/БД — гоняем последовательно, файл за файлом
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true, // самоподписанный сертификат — см. комментарий у BASE_URL выше
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // "setup" сеет тестовые аккаунты (admin/operator/viewer) через API один
    // раз за весь прогон — см. e2e/auth.setup.js. Остальные проекты просто
    // подключают готовый storageState (localStorage-токен, см. auth.js —
    // приложение хранит токен там, а не в куках) и не трогают логин-форму,
    // кроме auth.spec.js, который явно сбрасывает storageState.
    { name: 'setup', testMatch: /.*\.setup\.js/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /.*\.setup\.js/,
    },
  ],

  webServer: {
    command: 'node server.js',
    url: BASE_URL + '/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 20_000,
    // ВАЖНО: Playwright не подмешивает process.env автоматически, если задан
    // свой env — задашь только PORT/PROCURE_DATA_DIR, потеряешь PATH и
    // процесс не запустится вовсе. Мёржим явно.
    env: {
      ...process.env,
      PORT,
      PROCURE_DATA_DIR: E2E_DATA_DIR,
      NODE_ENV: 'test',
      // Без PROCURE_PASSWORD — миграция засеет дефолтного admin/admin0000
      // (см. src/db/schema.js), это и используют фикстуры логина.
      PROCURE_PASSWORD: '',
      PROCURE_AUTO_OPEN: '0',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
