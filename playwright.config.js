// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Сервер отдаёт только HTTPS (self-signed сертификат), HTTP только редиректит.
// Поднимаем на отдельном порту с ИЗОЛИРОВАННОЙ data-директорией (IT_ASSETS_DATA_DIR),
// чтобы E2E-тесты не трогали реальные данные и не зависели от их состояния.
const HTTPS_PORT = process.env.E2E_HTTPS_PORT || 3543;

module.exports = defineConfig({
  testDir: './tests-e2e',
  fullyParallel: false,     // один сервер, один набор данных — тесты по очереди
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: require.resolve('./tests-e2e/global-setup.js'),
  use: {
    baseURL: `https://localhost:${HTTPS_PORT}`,
    ignoreHTTPSErrors: true, // самоподписанный сертификат
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server/index.js',
    url: `https://localhost:${HTTPS_PORT}`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      HTTPS_PORT: String(HTTPS_PORT),
      PORT: String(Number(HTTPS_PORT) - 1000), // просто чтобы не пересекался с обычным 3000
      IT_ASSETS_DATA_DIR: require('path').join(__dirname, '.e2e-data'), // изолированная БД
    },
  },
});
