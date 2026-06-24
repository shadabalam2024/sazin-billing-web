const jwt = require('jsonwebtoken');

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

// Reads x-auth-token header and verifies the JWT.
function authOf(req) {
  const token = (req.headers['x-auth-token'] || '').trim();
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const session = authOf(req);
  if (!session) return res.status(401).json({ success: false, message: 'Not authorised. Please log in again.' });
  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  const session = authOf(req);
  if (!session) return res.status(401).json({ success: false, message: 'Not authorised. Please log in again.' });
  if (session.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required.' });
  req.user = session;
  next();
}

module.exports = { issueToken, authOf, requireAuth, requireAdmin };
