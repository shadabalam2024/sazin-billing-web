const express = require('express');
const supabase = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { logError } = require('../logger');
const { toInventory } = require('../records');

const router = express.Router();

router.get('/inventory', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('inventory').select('*').order('name');
    res.json((data || []).map(toInventory));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/inventory', requireAuth, requirePerm('inventory'), async (req, res) => {
  try {
    const { name, category, unit, costPrice, sellingPrice, stockQty, hsn, lowStockAlert } = req.body;
    if (!name) return res.json({ success: false, message: 'Product name is required.' });
    const { data, error } = await supabase.from('inventory').insert({
      name, category: category || 'General', unit: unit || 'Piece',
      cost_price: parseFloat(costPrice) || 0, selling_price: parseFloat(sellingPrice) || 0,
      stock_qty: parseFloat(stockQty) || 0, hsn: hsn || '', low_stock_alert: parseFloat(lowStockAlert) || 5
    }).select('id').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, id: data.id });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.put('/inventory/:id', requireAuth, requirePerm('inventory'), async (req, res) => {
  try {
    const updates = {};
    if (req.body.name != null) updates.name = req.body.name;
    if (req.body.category != null) updates.category = req.body.category;
    if (req.body.unit != null) updates.unit = req.body.unit;
    if (req.body.costPrice != null) updates.cost_price = parseFloat(req.body.costPrice) || 0;
    if (req.body.sellingPrice != null) updates.selling_price = parseFloat(req.body.sellingPrice) || 0;
    if (req.body.stockQty != null) updates.stock_qty = parseFloat(req.body.stockQty) || 0;
    if (req.body.hsn != null) updates.hsn = req.body.hsn;
    if (req.body.lowStockAlert != null) updates.low_stock_alert = parseFloat(req.body.lowStockAlert) || 5;
    await supabase.from('inventory').update(updates).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/inventory/:id', requireAuth, requirePerm('inventory'), async (req, res) => {
  try {
    await supabase.from('inventory').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
