'use strict';
/**
 * tests-e2e/e2e-credentials.js
 *
 * Единая точка правды для admin-логина/пароля в E2E-прогоне.
 * ADMIN_PIN — это пароль ПОСЛЕ смены дефолтного (см. global-setup.js).
 * Сервер стартует с дефолтным admn0000, но global-setup меняет его на
 * этот пароль ДО того, как начнутся сами тесты — поэтому ни один spec-файл
 * никогда не видит форму принудительной смены пароля (SEC-1) и не должен
 * с ней взаимодействовать.
 */
module.exports = {
  ADMIN_LOGIN: 'admin',
  ADMIN_DEFAULT_PIN: 'admn0000', // только для global-setup, один раз
  ADMIN_PIN: 'e2eTestPass1',     // это тесты используют для логина
};
