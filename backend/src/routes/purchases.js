const express = require('express');
const supabase = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { logError } = require('../logger');
const { toPurchase } = require('../records');

const router = express.Router();

router.get('/purchases', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('purchases').select('*').order('date', { ascending: false });
    res.json((data || []).map(toPurchase));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/purchases', requireAuth, requirePerm('purchases'), async (req, res) => {
  try {
    const { supplier, supplierBillNo, supplierState, isIntraState, items, paymentStatus, notes, amountPaid, paymentNote, paymentDate,
            totalTaxable, totalCgst, totalSgst, totalIgst, totalGst } = req.body;
    if (!supplier || !Array.isArray(items) || !items.length)
      return res.json({ success: false, message: 'Supplier and at least one item are required.' });

    const totalAmount = items.reduce((s, i) => {
      const taxable = (parseFloat(i.qty) || 0) * (parseFloat(i.costPrice) || 0);
      return s + taxable + taxable * (parseFloat(i.gstRate) || 0) / 100;
    }, 0);

    const status = paymentStatus || 'paid';
    const initialPaid = parseFloat(amountPaid) || 0;
    const payments = [];
    if (status === 'paid') {
      payments.push({ id: Date.now().toString() + '_p1', date: new Date().toISOString(), amount: Math.round(totalAmount * 100) / 100, note: paymentNote || 'Full payment' });
    } else if (status === 'partial' && initialPaid > 0) {
      payments.push({ id: Date.now().toString() + '_p1', date: paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString(), amount: initialPaid, note: paymentNote || 'Initial payment' });
    }
    const computedAmountPaid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

    const { data: inserted, error } = await supabase.from('purchases').insert({
      supplier, supplier_bill_no: supplierBillNo || '', supplier_state: supplierState || '',
      is_intra_state: isIntraState !== false, items,
      total_amount: Math.round(totalAmount * 100) / 100,
      total_taxable: totalTaxable || 0, total_cgst: totalCgst || 0, total_sgst: totalSgst || 0,
      total_igst: totalIgst || 0, total_gst: totalGst || 0,
      payment_status: status, amount_paid: computedAmountPaid, payments, notes: notes || ''
    }).select('id').single();
    if (error) throw new Error(error.message);

    // Update inventory stock
    for (const item of items) {
      const shouldUpdate = item.addToInventory || (!('addToInventory' in item) && item.productId);
      if (!shouldUpdate) continue;
      const qty = parseFloat(item.qty) || 0;
      if (item.productId) {
        const { data: inv } = await supabase.from('inventory').select('id, stock_qty').eq('id', item.productId).single();
        if (inv) await supabase.from('inventory').update({ stock_qty: (parseFloat(inv.stock_qty) || 0) + qty }).eq('id', item.productId);
      } else {
        await supabase.from('inventory').insert({
          name: item.name, category: 'General', unit: 'Piece',
          cost_price: parseFloat(item.costPrice) || 0, selling_price: 0,
          stock_qty: qty, hsn: item.hsn || '', low_stock_alert: 5
        });
      }
    }

    res.json({ success: true, id: inserted.id });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.put('/purchases/:id', requireAuth, requirePerm('purchases'), async (req, res) => {
  try {
    const { data: oldRow } = await supabase.from('purchases').select('*').eq('id', req.params.id).single();
    if (!oldRow) return res.json({ success: false, message: 'Purchase not found.' });
    const oldPurchase = toPurchase(oldRow);
    const { supplier, supplierBillNo, items, paymentStatus, notes } = req.body;
    if (!supplier || !Array.isArray(items) || !items.length)
      return res.json({ success: false, message: 'Supplier and at least one item are required.' });

    // Reverse old inventory additions
    for (const item of (oldPurchase.items || []).filter(i => i.addToInventory || (!('addToInventory' in i) && i.productId))) {
      const qty = parseFloat(item.qty) || 0;
      if (item.productId) {
        const { data: inv } = await supabase.from('inventory').select('id, stock_qty').eq('id', item.productId).single();
        if (inv) await supabase.from('inventory').update({ stock_qty: Math.max(0, (parseFloat(inv.stock_qty) || 0) - qty) }).eq('id', item.productId);
      }
    }
    // Apply new inventory additions
    for (const item of items.filter(i => i.addToInventory || (!('addToInventory' in i) && i.productId))) {
      const qty = parseFloat(item.qty) || 0;
      if (item.productId) {
        const { data: inv } = await supabase.from('inventory').select('id, stock_qty').eq('id', item.productId).single();
        if (inv) await supabase.from('inventory').update({ stock_qty: Math.round(((parseFloat(inv.stock_qty) || 0) + qty) * 100) / 100 }).eq('id', item.productId);
      }
    }

    const totalAmount = items.reduce((s, i) => {
      const taxable = (parseFloat(i.qty) || 0) * (parseFloat(i.costPrice) || 0);
      return s + taxable + taxable * (parseFloat(i.gstRate) || 0) / 100;
    }, 0);

    const existingPayments = oldPurchase.payments || [];
    const newAmountPaid = Math.round(existingPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;
    let newStatus = existingPayments.length
      ? (newAmountPaid >= totalAmount ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid')
      : (paymentStatus || oldPurchase.paymentStatus);

    const { totalTaxable, totalCgst, totalSgst, totalIgst, totalGst } = req.body;
    await supabase.from('purchases').update({
      supplier, supplier_bill_no: supplierBillNo || oldRow.supplier_bill_no || '', items,
      total_amount: Math.round(totalAmount * 100) / 100,
      total_taxable: totalTaxable || 0, total_cgst: totalCgst || 0, total_sgst: totalSgst || 0,
      total_igst: totalIgst || 0, total_gst: totalGst || 0,
      amount_paid: newAmountPaid, payment_status: newStatus, notes: notes || ''
    }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/purchases/:id/payments', requireAuth, requirePerm('purchases'), async (req, res) => {
  try {
    const { data: row } = await supabase.from('purchases').select('*').eq('id', req.params.id).single();
    if (!row) return res.json({ success: false, message: 'Purchase not found.' });
    const { amount, note, date } = req.body;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return res.json({ success: false, message: 'Amount must be greater than 0.' });
    const payment = { id: Date.now().toString(), date: date ? new Date(date).toISOString() : new Date().toISOString(), amount: amt, note: note || '' };
    const newPayments = [...(row.payments || []), payment];
    const newAmountPaid = Math.round(newPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;
    const total = parseFloat(row.total_amount) || 0;
    const newStatus = newAmountPaid >= total ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';
    await supabase.from('purchases').update({ payments: newPayments, amount_paid: newAmountPaid, payment_status: newStatus }).eq('id', req.params.id);
    res.json({ success: true, amountPaid: newAmountPaid, paymentStatus: newStatus });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/purchases/:id/payments/:paymentId', requireAuth, requirePerm('purchases'), async (req, res) => {
  try {
    const { data: row } = await supabase.from('purchases').select('*').eq('id', req.params.id).single();
    if (!row) return res.json({ success: false, message: 'Purchase not found.' });
    const newPayments = (row.payments || []).filter(p => p.id !== req.params.paymentId);
    const newAmountPaid = Math.round(newPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;
    const total = parseFloat(row.total_amount) || 0;
    const newStatus = newAmountPaid >= total ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';
    await supabase.from('purchases').update({ payments: newPayments, amount_paid: newAmountPaid, payment_status: newStatus }).eq('id', req.params.id);
    res.json({ success: true, amountPaid: newAmountPaid, paymentStatus: newStatus });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/purchases/:id', requireAuth, requirePerm('purchases'), async (req, res) => {
  try {
    const { data: row } = await supabase.from('purchases').select('*').eq('id', req.params.id).single();
    if (!row) return res.json({ success: false, message: 'Purchase not found.' });
    const purchase = toPurchase(row);
    let stockReversed = 0;
    for (const item of (purchase.items || []).filter(i => i.addToInventory || (!('addToInventory' in i) && i.productId))) {
      const qty = parseFloat(item.qty) || 0;
      if (item.productId) {
        const { data: inv } = await supabase.from('inventory').select('id, stock_qty').eq('id', item.productId).single();
        if (inv) { await supabase.from('inventory').update({ stock_qty: Math.max(0, Math.round(((parseFloat(inv.stock_qty) || 0) - qty) * 100) / 100) }).eq('id', item.productId); stockReversed++; }
      }
    }
    await supabase.from('purchases').delete().eq('id', req.params.id);
    res.json({ success: true, stockReversed });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
