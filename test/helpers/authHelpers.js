// Общие хелперы для интеграционных тестов — логин под дефолтным
// администратором (со сменой временного пароля, как того требует сам
// сервер) и создание пользователя с ролью operator.
const assert = require('node:assert/strict');

async function loginAsFreshAdmin(server, newPassword = 'TestAdminPass123!') {
  const login = await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin0000' } });
  assert.equal(login.status, 200, `логин админа не удался: ${login.raw}`);
  assert.equal(login.body.mustChangePassword, true, 'свежий admin должен требовать смены пароля');
  const token = login.body.token;

  const change = await server.request('POST', '/api/auth/change-password', { token, body: { newPassword } });
  assert.equal(change.status, 200, `смена пароля не удалась: ${change.raw}`);

  // Сервер инвалидирует все сессии после смены пароля — логинимся заново.
  const relogin = await server.request('POST', '/api/auth/login', { body: { username: 'admin', password: newPassword } });
  assert.equal(relogin.status, 200, `повторный логин после смены пароля не удался: ${relogin.raw}`);
  return relogin.body.token;
}

async function createOperator(server, adminToken, username = 'operator1', password = 'OperatorPass123!') {
  const res = await server.request('POST', '/api/users', { token: adminToken, body: { username, password, role: 'operator' } });
  assert.equal(res.status, 200, `создание оператора не удалось: ${res.raw}`);
  const login = await server.request('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(login.status, 200, `логин оператора не удался: ${login.raw}`);
  return login.body.token;
}

module.exports = { loginAsFreshAdmin, createOperator };
