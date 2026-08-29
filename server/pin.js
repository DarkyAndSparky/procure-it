'use strict';
/**
 * pin.js — хеширование и проверка PIN-кодов пользователей.
 *
 * Раньше PIN хранился в config.json открытым текстом (users[].pin) и
 * сравнивался напрямую строкой. Теперь он хранится как bcrypt-хеш.
 *
 * Особый случай: пустой PIN ('' или null) — это осознанная фича
 * «вход без пароля» (например, для viewer-пользователя). Пустой PIN
 * никогда не хешируется и хранится как есть — иначе не отличить
 * «пароль пуст» от «пароль — это хеш пустой строки».
 */

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$/;

function isEmpty(pin) {
  return pin === '' || pin == null;
}

function isHashed(pin) {
  return typeof pin === 'string' && BCRYPT_RE.test(pin);
}

/** Хеширует PIN. Пустой PIN оставляет пустым (см. комментарий выше). */
function hashPin(pin) {
  if (isEmpty(pin)) return '';
  const raw = String(pin);
  if (isHashed(raw)) return raw; // уже хеш — не хешируем повторно
  return bcrypt.hashSync(raw, SALT_ROUNDS);
}

/**
 * Сверяет введённый PIN с сохранённым значением.
 * Понимает как новые bcrypt-хеши, так и старые открытые PIN (на случай,
 * если миграция ещё не прошла или значение было отредактировано вручную) —
 * во втором случае сравнение идёт строкой, как раньше.
 */
function verifyPin(inputPin, storedPin) {
  if (isEmpty(storedPin)) return true; // вход без пароля
  const input = String(inputPin || '').trim();
  if (isHashed(storedPin)) return bcrypt.compareSync(input, storedPin);
  return input === String(storedPin); // легаси открытый текст
}

module.exports = { hashPin, verifyPin, isHashed, isEmpty };
