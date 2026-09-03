const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../db');
const { requireAdmin } = require('../auth');
const { logError } = require('../logger');

const router = express.Router();

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('users').select('username, role, must_change_password, permissions, last_login_at, sessions_invalidated_before').order('username');
    res.json((data || []).map(u => ({
      username: u.username, role: u.role, mustChangePassword: !!u.must_change_password,
      permissions: u.permissions || null, lastLoginAt: u.last_login_at || null,
      sessionActive: u.last_login_at
        ? (!u.sessions_invalidated_before || new Date(u.last_login_at) > new Date(u.sessions_invalidated_before))
        : false
    })));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role, permissions } = req.body || {};
    if (!username || !password) return res.json({ success: false, message: 'Username and password are required.' });
    if (!['admin', 'staff'].includes(role)) return res.json({ success: false, message: 'Role must be admin or staff.' });
    if (password.length < 6) return res.json({ success: false, message: 'Password must be at least 6 characters.' });
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).limit(1);
    if (existing?.length) return res.json({ success: false, message: 'Username already exists.' });
    const newUser = { username, password_hash: bcrypt.hashSync(password, 10), role, must_change_password: true };
    if (role === 'staff') newUser.permissions = Array.isArray(permissions) ? permissions : ['billing', 'quotations', 'clients'];
    await supabase.from('users').insert(newUser);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.put('/users/:username', requireAdmin, async (req, res) => {
  try {
    const { data: users } = await supabase.from('users').select('*').eq('username', req.params.username).limit(1);
    const user = users?.[0];
    if (!user) return res.json({ success: false, message: 'User not found.' });
    const { newPassword, role, permissions } = req.body || {};
    const updates = {};
    if (role) {
      if (!['admin', 'staff'].includes(role)) return res.json({ success: false, message: 'Invalid role.' });
      if (user.role === 'admin' && role !== 'admin') {
        const { count } = await supabase.from('users').select('id', { count: 'exact' }).eq('role', 'admin');
        if (count <= 1) return res.json({ success: false, message: 'Cannot demote the last admin.' });
      }
      updates.role = role;
      if (role === 'admin') updates.permissions = null;
    }
    if (Array.isArray(permissions) && (updates.role || user.role) === 'staff') updates.permissions = permissions;
    if (newPassword) {
      if (newPassword.length < 6) return res.json({ success: false, message: 'Password must be at least 6 characters.' });
      updates.password_hash = bcrypt.hashSync(newPassword, 10);
      updates.must_change_password = true;
    }
    await supabase.from('users').update(updates).eq('username', req.params.username);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/users/:username', requireAdmin, async (req, res) => {
  try {
    if (req.params.username === req.user.username) return res.json({ success: false, message: 'You cannot delete your own account.' });
    const { data: target } = await supabase.from('users').select('role').eq('username', req.params.username).single();
    if (!target) return res.json({ success: false, message: 'User not found.' });
    if (target.role === 'admin') {
      const { count } = await supabase.from('users').select('id', { count: 'exact' }).eq('role', 'admin');
      if (count <= 1) return res.json({ success: false, message: 'Cannot delete the last admin account.' });
    }
    await supabase.from('users').delete().eq('username', req.params.username);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ── Force-logout: invalidates all active sessions for the target user ──
router.post('/users/:username/force-logout', requireAdmin, async (req, res) => {
  try {
    if (req.params.username === req.user.username)
      return res.json({ success: false, message: 'You cannot force-logout yourself.' });
    await supabase.from('users')
      .update({ sessions_invalidated_before: new Date().toISOString() })
      .eq('username', req.params.username);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
