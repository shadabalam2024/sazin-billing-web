const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../auth');
const { logError } = require('../logger');
const { readSettings } = require('../settings');
const { toQuote, fromRecord } = require('../records');

const router = express.Router();

router.get('/quotes', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('quotes').select('*').order('date', { ascending: false });
    res.json((data || []).map(toQuote));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/quotes', requireAuth, async (req, res) => {
  try {
    const { name, mobile, address } = req.body || {};
    if (!name || !mobile || !address) return res.status(400).json({ success: false, message: 'Name, mobile and address are required.' });
    if (!/^\d{10}$/.test(mobile)) return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });

    const { data: quoteNumber, error: ctrErr } = await supabase.rpc('next_doc_number', { counter_name: 'quote', prefix: 'QUOTE' });
    if (ctrErr) throw new Error(ctrErr.message);

    const { data: inserted, error } = await supabase.from('quotes').insert({
      quote_number: quoteNumber, name, mobile, address,
      recipient_gstin: req.body.recipientGstin || '',
      place_of_supply_state: req.body.placeOfSupplyState || '',
      place_of_supply_state_code: req.body.placeOfSupplyStateCode || '',
      lines: req.body.lines || [], notes: req.body.notes || ''
    }).select('id').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, quoteNumber, id: inserted.id });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/quotes/:id', requireAuth, async (req, res) => {
  try {
    await supabase.from('quotes').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/quotes/:id/convert', requireAuth, async (req, res) => {
  try {
    const { data: row } = await supabase.from('quotes').select('*').eq('id', req.params.id).single();
    if (!row) return res.json({ success: false, message: 'Quote not found.' });
    if (row.status === 'converted') return res.json({ success: false, message: 'Quote already converted to invoice.' });

    const s = await readSettings();
    const { data: invoiceNumber, error: ctrErr } = await supabase.rpc('next_doc_number', { counter_name: 'invoice', prefix: s.invoicePrefix || 'SAZIN' });
    if (ctrErr) throw new Error(ctrErr.message);

    await supabase.from('documents').insert(fromRecord({
      invoiceNumber, docType: 'invoice',
      date: new Date().toISOString(),
      name: row.name, mobile: row.mobile, address: row.address,
      recipientGstin: row.recipient_gstin || '',
      placeOfSupplyState: row.place_of_supply_state || s.stateName,
      placeOfSupplyStateCode: row.place_of_supply_state_code || s.stateCode,
      lines: row.lines || [], paymentStatus: 'unpaid', amountPaid: 0,
      convertedFromQuote: row.quote_number
    }));

    await supabase.from('quotes').update({ status: 'converted', converted_to_invoice: invoiceNumber }).eq('id', req.params.id);
    res.json({ success: true, invoiceNumber });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
