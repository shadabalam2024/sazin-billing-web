const express = require('express');
const supabase = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { logError } = require('../logger');
const { readSettings } = require('../settings');

const router = express.Router();

router.get('/catalog', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('catalog').select('*').order('name');
    res.json((data || []).map(c => ({ id: c.id, name: c.name, cost: parseFloat(c.cost), hsn: c.hsn || '', unit: c.unit || 'Sq.Ft' })));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/catalog', requireAuth, requirePerm('billing'), async (req, res) => {
  try {
    const { name, cost, hsn, unit } = req.body;
    if (!name || !cost) return res.json({ success: false, message: 'Name and cost required.' });
    const s = await readSettings();
    const { data, error } = await supabase.from('catalog').insert({ name, cost: parseFloat(cost), hsn: hsn || s.defaultHsn, unit: unit || 'Sq.Ft' }).select('id').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, id: data.id });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/catalog/:id', requireAuth, requirePerm('billing'), async (req, res) => {
  try {
    await supabase.from('catalog').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
