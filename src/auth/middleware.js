const { sessionGetUser } = require('./sessions');

// Единая точка получения токена сессии: сначала httpOnly-cookie (основной
// способ после миграции с localStorage), затем заголовок X-Auth-Token
// (оставлен для обратной совместимости — например, для внешних скриптов/
// API-клиентов, которые не умеют работать с cookie).
function getToken(req) {
  return (req.cookies && req.cookies['auth-token']) || req.headers['x-auth-token'] || null;
}

function getRequestRole(req) {
  // viewer: no token needed — read-only access
  const token = getToken(req);
  if (!token) return 'viewer';
  return sessionGetUser(token)?.role || 'viewer';
}

// NOTE: удалена isAuthenticated(req) — она безусловно возвращала true и
// нигде в коде не вызывалась, но была ловушкой для будущего кода
// ("кажется, что проверяет аутентификацию, на деле — нет"). Используйте
// getRequestRole(req) !== 'viewer' там, где нужно узнать, аутентифицирован
// ли запрос.

// Role-based middleware factories
function authMiddleware(req, res, next) {
  // All authenticated roles (operator, admin) + viewer for GET
  const token = getToken(req);
  const role = getRequestRole(req);
  req.userRole = role;
  // Было: req.username = token => ...  (функция вместо строки — баг-ловушка).
  req.username = (token ? sessionGetUser(token)?.username : null) || 'viewer';
  next();
}

// CSRF-защита для cookie-based auth (double-submit pattern). Токен сессии
// теперь лежит в httpOnly-cookie и браузер шлёт её автоматически с любым
// запросом на наш домен — значит без доп. проверки сторонний сайт мог бы
// дергать POST/PUT/DELETE от имени залогиненного пользователя (CSRF).
// Защита: при логине выдаём отдельную НЕ-httpOnly cookie csrf-token;
// фронтенд обязан продублировать её значение в заголовке X-CSRF-Token —
// сторонняя страница прочитать чужую cookie и подставить в заголовок
// не может (SOP), поэтому подделать оба совпадающих значения не может.
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = getToken(req);
  if (!token) return next(); // viewer (unauthenticated) — нечего защищать
  const cookieCsrf  = req.cookies && req.cookies['csrf-token'];
  const headerCsrf  = req.headers['x-csrf-token'];
  if (!cookieCsrf || !headerCsrf || cookieCsrf !== headerCsrf) {
    return res.status(403).json({ error: 'Неверный CSRF-токен' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const token = getToken(req);
    const user  = token ? sessionGetUser(token) : null;
    const role  = user?.role || 'viewer';
    req.userRole = role;

    // Block all write operations if password change is required
    if (user?.mustChangePassword && req.method !== 'GET') {
      // Allow only the change-password endpoint itself.
      // Уязвимость (найдена при аудите): было req.path.includes('/auth/change-password')
      // — совпадение по подстроке, а не по точному пути. Роут change-password сам не
      // навешивает requireRole (проверяет всё вручную), так что практической дыры сейчас
      // нет, но проверка семантически неверна: любой БУДУЩИЙ роут, чей путь содержит эту
      // подстроку где угодно (например, гипотетический /auth/change-password-history),
      // тихо получил бы тот же bypass. Точное сравнение — правильный инвариант независимо
      // от того, есть ли сегодня реальный путь атаки.
      if (req.path !== '/auth/change-password') {
        return res.status(403).json({ error: 'Смените временный пароль перед началом работы', mustChangePassword: true });
      }
    }

    if (roles.includes(role)) return next();
    res.status(403).json({ error: `Доступ запрещён. Требуется роль: ${roles.join(' или ')}` });
  };
}

const operatorOrAdmin = requireRole('operator', 'admin');
const adminOnly       = requireRole('admin');

module.exports = { getToken, getRequestRole, authMiddleware, csrfProtection, requireRole, operatorOrAdmin, adminOnly };
