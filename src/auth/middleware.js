const { sessionGetUser } = require('./sessions');

function getRequestRole(req) {
  // viewer: no token needed — read-only access
  const token = req.headers['x-auth-token'] || (req.cookies && req.cookies['auth-token']);
  if (!token) return 'viewer';
  return sessionGetUser(token)?.role || 'viewer';
}

function isAuthenticated(req) { return true; } // viewer always gets in

// Role-based middleware factories
function authMiddleware(req, res, next) {
  // All authenticated roles (operator, admin) + viewer for GET
  const role = getRequestRole(req);
  req.userRole = role;
  req.username = token => sessionGetUser(token)?.username || 'viewer';
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const token = req.headers['x-auth-token'] || (req.cookies && req.cookies['auth-token']);
    const user  = token ? sessionGetUser(token) : null;
    const role  = user?.role || 'viewer';
    req.userRole = role;

    // Block all write operations if password change is required
    if (user?.mustChangePassword && req.method !== 'GET') {
      // Allow only the change-password endpoint itself
      if (!req.path.includes('/auth/change-password')) {
        return res.status(403).json({ error: 'Смените временный пароль перед началом работы', mustChangePassword: true });
      }
    }

    if (roles.includes(role)) return next();
    res.status(403).json({ error: `Доступ запрещён. Требуется роль: ${roles.join(' или ')}` });
  };
}

const operatorOrAdmin = requireRole('operator', 'admin');
const adminOnly       = requireRole('admin');

module.exports = { getRequestRole, isAuthenticated, authMiddleware, requireRole, operatorOrAdmin, adminOnly };
