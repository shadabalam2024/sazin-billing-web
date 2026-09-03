const express = require('express');
const supabase = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { logError } = require('../logger');

const router = express.Router();

router.get('/templates', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('templates').select('*').order('created_at', { ascending: false });
    res.json((data || []).map(t => ({ id: t.id, name: t.name, lines: t.lines || [], notes: t.notes || '', createdAt: t.created_at })));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/templates', requireAuth, requirePerm('billing'), async (req, res) => {
  try {
    const { name, lines, notes } = req.body;
    if (!name) return res.json({ success: false, message: 'Template name is required.' });
    const { data, error } = await supabase.from('templates').insert({ name, lines: lines || [], notes: notes || '' }).select('id').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, id: data.id });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/templates/:id', requireAuth, requirePerm('billing'), async (req, res) => {
  try {
    await supabase.from('templates').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
