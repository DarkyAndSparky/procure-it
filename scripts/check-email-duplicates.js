#!/usr/bin/env node
// Диагностика перед миграцией idx_users_email_unique (см. src/db/schema.js,
// строки ~215-231). Индекс — частичный (WHERE email != ''), поэтому пустая
// строка дублей не считается — это нормально для пользователей без email.
//
// Ничего не меняет в БД сам по себе — только показывает, что мешает
// индексу создаться, и что нужно решить руками (см. вывод ниже) прежде
// чем перезапускать сервер. Возвращает код 1, если дубли найдены, 0 —
// если чисто (можно спокойно рестартовать сервер, индекс встанет сам).
'use strict';

const { initDb, query } = require('../src/db/connection');

async function main() {
  await initDb();

  const dupes = query(`
    SELECT email, COUNT(*) as cnt
    FROM users
    WHERE email != ''
    GROUP BY email
    HAVING cnt > 1
  `);

  if (!dupes.length) {
    console.log('Дублей нет — уникальный индекс на users.email должен создаться при следующем старте сервера без проблем.');
    process.exit(0);
  }

  console.log(`Найдено email-адресов с дублями: ${dupes.length}\n`);

  for (const { email } of dupes) {
    const rows = query(
      `SELECT id, username, role, created_at, must_change_password FROM users WHERE email = ? ORDER BY id`,
      [email]
    );
    console.log(`email: ${email}`);
    for (const r of rows) {
      console.log(`  id=${r.id}  username=${r.username}  role=${r.role}  created_at=${r.created_at}`);
    }
    console.log('');
  }

  console.log(
    'Индекс НЕ будет создан, пока эти дубли не разведены руками. Варианты на\n' +
    'выбор для каждой группы: (а) у части строк email — ошибка ввода, поправить\n' +
    'на верный; (б) один из аккаунтов не должен использовать этот email вообще —\n' +
    'обнулить (email=\'\'), это не задето уникальным индексом; (в) аккаунты\n' +
    'реально дублируют друг друга — решать, какой оставить, отдельная история,\n' +
    'этот скрипт таких решений не принимает автоматически.\n' +
    '\n' +
    'После правки — перезапустить сервер: миграция в schema.js попробует\n' +
    'создать индекс заново при каждом старте (CREATE UNIQUE INDEX IF NOT EXISTS).'
  );
  process.exit(1);
}

main().catch(e => {
  console.error('Ошибка при проверке:', e);
  process.exit(2);
});
