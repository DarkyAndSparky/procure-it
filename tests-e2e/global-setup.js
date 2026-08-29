'use strict';
/**
 * tests-e2e/global-setup.js
 *
 * SEC-1 сделал форму смены дефолтного пароля НЕЗАКРЫВАЕМОЙ без реальной
 * смены пароля (раньше была кнопка "Напомнить позже" — её больше нет).
 * E2E-тесты стартуют с ДЕЙСТВИТЕЛЬНО дефолтным admin/admn0000 (см.
 * playwright.config.js — изолированная свежая .e2e-data/ каждый прогон),
 * значит при первом же логине в браузере вылезала бы блокирующая
 * модалка, которую UI-тесты не должны и не умеют проходить сами.
 *
 * Решение: меняем пароль ОДИН РАЗ здесь, через прямой вызов API, ДО того
 * как запустится хоть один тест — тесты логинятся уже новым паролем и
 * никогда не видят эту форму вообще.
 */
const { ADMIN_LOGIN, ADMIN_DEFAULT_PIN, ADMIN_PIN } = require('./e2e-credentials');

module.exports = async () => {
  // Самоподписанный сертификат — это тестовый одноразовый скрипт, не
  // production-код, отключаем проверку TLS только для него.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  // Та же логика порта, что в playwright.config.js — пересчитываем
  // напрямую, чтобы не зависеть от точной формы объекта FullConfig.
  const HTTPS_PORT = process.env.E2E_HTTPS_PORT || 3543;
  const baseURL = `https://localhost:${HTTPS_PORT}`;

  // webServer уже должен быть готов к этому моменту (Playwright ждёт его
  // сам), но на всякий случай — несколько попыток с паузой, вдруг сервер
  // отвечает на TCP, но ещё не успел смигрировать/поднять SQLite.
  let lastErr;
  for (let i = 0; i < 10; i++) {
    try {
      const loginRes = await fetch(`${baseURL}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: ADMIN_LOGIN, password: ADMIN_DEFAULT_PIN }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok || !loginData?.user?.id) {
        throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginData)}`);
      }

      const pwRes = await fetch(`${baseURL}/api/settings/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': loginData.user.id,
          'x-edit-password': ADMIN_DEFAULT_PIN,
        },
        body: JSON.stringify({ newPassword: ADMIN_PIN }),
      });
      if (!pwRes.ok) {
        const body = await pwRes.json().catch(() => ({}));
        throw new Error(`password change failed: ${pwRes.status} ${JSON.stringify(body)}`);
      }

      return; // успех
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`E2E global-setup: не удалось сменить дефолтный пароль admin — ${lastErr}`);
};
