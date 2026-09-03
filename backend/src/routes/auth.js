const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const supabase = require('../db');
const { issueToken, requireAuth } = require('../auth');
const { logError } = require('../logger');

const router = express.Router();

// Rate limit login: max 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const { data: users } = await supabase.from('users').select('*').eq('username', username).limit(1);
    const user = users?.[0];
    if (!user || !bcrypt.compareSync(password || '', user.password_hash))
      return res.json({ success: false, message: 'Invalid username or password.' });
    const token = issueToken({ username: user.username, role: user.role, permissions: user.permissions });
    const permissions = user.role === 'admin' ? null : (user.permissions || ['billing', 'quotations', 'clients']);
    supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('username', user.username).then(null, console.error);
    res.json({ success: true, token, role: user.role, username: user.username, mustChangePassword: !!user.must_change_password, permissions });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/logout', requireAuth, (req, res) => {
  // JWT is stateless — client just discards the token.
  res.json({ success: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body || {};
    if (req.user.username !== username)
      return res.status(403).json({ success: false, message: 'You can only change your own password.' });
    const { data: users } = await supabase.from('users').select('*').eq('username', username).limit(1);
    const user = users?.[0];
    if (!user || !bcrypt.compareSync(oldPassword || '', user.password_hash))
      return res.json({ success: false, message: 'Current password is incorrect.' });
    if (!newPassword || newPassword.length < 6)
      return res.json({ success: false, message: 'New password must be at least 6 characters.' });
    await supabase.from('users').update({ password_hash: bcrypt.hashSync(newPassword, 10), must_change_password: false }).eq('username', username);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
