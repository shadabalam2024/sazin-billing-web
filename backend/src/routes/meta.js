const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { logError } = require('../logger');
const { readSettings, writeSettings } = require('../settings');

const router = express.Router();

// Which build is actually running — Vercel sets VERCEL_GIT_COMMIT_SHA on every
// deploy (Production and Preview alike); it's absent for a local `npm run dev`.
const pkg = require('../../../package.json');
const GIT_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA || null;
router.get('/version', (req, res) => {
  res.json({ version: pkg.version, commit: GIT_COMMIT ? GIT_COMMIT.slice(0, 7) : 'local' });
});

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const { smtpPass, ...pub } = s;
    pub.smtpConfigured = !!(s.smtpHost && s.smtpUser && smtpPass);
    res.json(pub);
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/settings', requireAdmin, async (req, res) => {
  try {
    const current = await readSettings();
    const incoming = req.body || {};
    const merged = { ...current, ...incoming };
    merged.defaultGstRate = Number(merged.defaultGstRate) || 0;
    merged.smtpPort = parseInt(merged.smtpPort) || 587;
    if (!incoming.smtpPass) merged.smtpPass = current.smtpPass || '';
    await writeSettings(merged);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
