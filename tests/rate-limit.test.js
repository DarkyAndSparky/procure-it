'use strict';
/**
 * Тесты: SEC-7 — rate-limit на вход считается по паре (IP, аккаунт),
 * а не только по IP, чтобы:
 *  - подбор пароля к ОДНОМУ аккаунту с разных IP всё равно ловился;
 *  - один шумный IP (например, офис за NAT) не блокировал ВСЕХ
 *    сотрудников сразу, если целятся в разные аккаунты.
 */
process.env.TRUST_PROXY = '1'; // чтобы можно было симулировать разные IP через X-Forwarded-For

const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

function fail(login, ip) {
  return request(app).post('/api/users/login')
    .set('x-forwarded-for', ip)
    .send({ login, password: 'wrong-password-' + Math.random() });
}

describe('SEC-7 — rate-limit по паре user+IP', () => {
  test('подбор пароля к ОДНОМУ аккаунту с разных IP всё равно блокируется', async () => {
    let last;
    for (let i = 0; i < 10; i++) {
      last = await fail('admin', `10.0.1.${i}`); // каждый раз новый IP
    }
    expect(last.status).toBe(401); // 10-я попытка ещё не заблокирована, просто неверный пароль

    const next = await fail('admin', '10.0.1.99'); // 11-я, снова новый IP
    expect(next.status).toBe(429); // но по аккаунту 'admin' лимит уже исчерпан
  });

  test('один IP, разные аккаунты — блокируется по IP (не даёт перебирать много аккаунтов с одной точки)', async () => {
    const ip = '10.0.2.1';
    let last;
    for (let i = 0; i < 10; i++) {
      last = await fail(`user-${i}`, ip); // каждый раз новый (несуществующий) логин
    }
    expect(last.status).toBe(401);

    const next = await fail('yet-another-user', ip);
    expect(next.status).toBe(429); // лимит по IP исчерпан, хотя аккаунт другой
  });

  test('разные IP и разные аккаунты друг другу не мешают', async () => {
    const res = await fail('someone-else', '10.0.3.1');
    expect(res.status).toBe(401); // не 429 — свежая пара IP+аккаунт
  });
});
