const express = require('express');
const supabase = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { logError } = require('../logger');

const router = express.Router();

router.get('/expenses', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('expenses').select('*').order('date', { ascending: false });
    res.json((data || []).map(e => ({ id: e.id, category: e.category, description: e.description, amount: parseFloat(e.amount), notes: e.notes || '', date: e.date })));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/expenses', requireAuth, requirePerm('expenses'), async (req, res) => {
  try {
    const { category, description, amount, notes } = req.body;
    if (!description || !amount) return res.json({ success: false, message: 'Description and amount are required.' });
    const { data, error } = await supabase.from('expenses').insert({ category: category || 'Other', description, amount: parseFloat(amount) || 0, notes: notes || '' }).select('id').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, id: data.id });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/expenses/:id', requireAuth, requirePerm('expenses'), async (req, res) => {
  try {
    await supabase.from('expenses').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
