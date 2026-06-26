const jwt = require('jsonwebtoken');
const supabase = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('❌  JWT_SECRET must be set in .env'); process.exit(1); }

const TOKEN_TTL = '12h';

function issueToken(user) {
  return jwt.sign(
    { username: user.username, role: user.role, permissions: user.permissions || null },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function authOf(req) {
  const token = (req.headers['x-auth-token'] || '').trim();
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const session = authOf(req);
  if (!session) return res.status(401).json({ success: false, message: 'Not authorised. Please log in again.' });

  // Check whether this token was issued before the user's sessions were invalidated
  supabase.from('users')
    .select('sessions_invalidated_before')
    .eq('username', session.username)
    .single()
    .then(({ data: user }) => {
      if (user?.sessions_invalidated_before) {
        const invalidatedMs = new Date(user.sessions_invalidated_before).getTime();
        if (session.iat * 1000 < invalidatedMs) {
          return res.status(401).json({ success: false, message: 'You have been logged out. Please sign in again.' });
        }
      }
      req.user = session;
      next();
    })
    .catch(() => { req.user = session; next(); }); // fail open so a DB hiccup doesn't lock everyone out
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required.' });
    next();
  });
}

// Use after requireAuth: requirePerm('perm1','perm2') passes if user is admin OR has any listed permission.
function requirePerm(...perms) {
  return (req, res, next) => {
    if (req.user.role === 'admin') return next();
    if (perms.some(p => (req.user.permissions || []).includes(p))) return next();
    res.status(403).json({ success: false, message: 'Access denied.' });
  };
}

module.exports = { issueToken, authOf, requireAuth, requireAdmin, requirePerm };
