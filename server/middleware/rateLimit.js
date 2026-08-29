/**
 * server/middleware/rateLimit.js
 *
 * Фаза 3 рефакторинга: rate limiter для /api/users/auth и /api/users/login,
 * вынесенный из index.js без изменения поведения.
 *
 * Состояние (_loginAttempts) — in-memory Map в замыкании модуля. Это НЕ
 * зависит от database.js, так что мокинг тестов тут ни при чём — модуль
 * можно смело импортировать напрямую.
 */
'use strict';

const _byIp     = new Map(); // ip → { count, resetAt }
const _byTarget = new Map(); // login/user_id (в нижнем регистре) → { count, resetAt }
const RATE_LIMIT_MAX    = 10;
const RATE_LIMIT_WINDOW = 5 * 60 * 1000;  // 5 минут
const RATE_LIMIT_BLOCK  = 15 * 60 * 1000; // блокировка 15 минут после превышения

function _ipOf(req) {
  // X-Forwarded-For — заголовок, который клиент может подделать сам (это не
  // TCP-адрес соединения). Доверяем ему только если сервер явно развёрнут за
  // реверс-прокси (TRUST_PROXY=1), который сам проставляет/перезаписывает этот
  // заголовок. Без этого флага атакующий мог бы обходить rate-limit, посылая
  // случайный X-Forwarded-For на каждый запрос.
  return (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for']?.split(',')[0]?.trim())
    || req.socket.remoteAddress || 'unknown';
}

// SEC-7: до этого лимит был только по IP — из-за этого один офис за NAT мог
// упереться в общий лимит на всех сотрудников сразу (ложная блокировка), а
// подбор пароля к ОДНОМУ конкретному аккаунту с разных IP вообще не ловился
// (обходил лимит "по IP" тривиально). Теперь считаем по обоим ключам сразу —
// блокируем, если превышен любой из двух.
function _targetOf(req) {
  const b = req.body || {};
  const raw = b.user_id || b.login || req.headers['x-user-id'] || '';
  return String(raw).trim().toLowerCase() || null;
}

function _check(map, key, now) {
  const entry = map.get(key);
  if (!entry) return null;
  if (now > entry.resetAt) { map.delete(key); return null; }
  if (entry.count >= RATE_LIMIT_MAX) return Math.ceil((entry.resetAt - now) / 1000);
  return null;
}

function _bump(map, key, now) {
  const cur = map.get(key);
  if (cur && now <= cur.resetAt) {
    cur.count++;
    if (cur.count >= RATE_LIMIT_MAX) cur.resetAt = now + RATE_LIMIT_BLOCK;
  } else {
    map.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
  }
}

function rateLimitLogin(req, res, next) {
  const ip     = _ipOf(req);
  const target = _targetOf(req);
  const now    = Date.now();

  const retryIp     = _check(_byIp, ip, now);
  const retryTarget = target ? _check(_byTarget, target, now) : null;
  const retryAfter  = Math.max(retryIp || 0, retryTarget || 0) || null;

  if (retryAfter) {
    res.set('Retry-After', retryAfter);
    return res.status(429).json({
      error: `Слишком много попыток входа. Повторите через ${Math.ceil(retryAfter/60)} мин.`,
      retry_after: retryAfter
    });
  }

  // Записываем попытку — только после провала (в middleware next, затем перехватим ответ)
  const origJson = res.json.bind(res);
  res.json = function(body) {
    if (res.statusCode === 401) {
      _bump(_byIp, ip, now);
      if (target) _bump(_byTarget, target, now);
    } else if (res.statusCode === 200) {
      // Успешный вход — сбрасываем счётчики по обоим ключам
      _byIp.delete(ip);
      if (target) _byTarget.delete(target);
    }
    return origJson(body);
  };

  next();
}

// Чистим старые записи раз в 10 минут
setInterval(() => {
  const now = Date.now();
  for (const map of [_byIp, _byTarget]) {
    for (const [key, entry] of map.entries()) {
      if (now > entry.resetAt) map.delete(key);
    }
  }
}, 10 * 60 * 1000);

module.exports = { rateLimitLogin };
