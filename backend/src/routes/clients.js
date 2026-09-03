const express = require('express');
const supabase = require('../db');
const { requireAuth } = require('../auth');
const { logError } = require('../logger');
const { readSettings } = require('../settings');
const { toRecord } = require('../records');
const { grandTotalOf, salesRecords } = require('../invoiceHelpers');

const router = express.Router();

// ════════════════════ SEARCH ════════════════════

router.get('/search/:mobile', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('documents').select('*').eq('mobile', req.params.mobile);
    res.json((data || []).map(toRecord));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.get('/search-invoice/:invoice', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('documents').select('*').ilike('invoice_number', `%${req.params.invoice}%`);
    res.json((data || []).map(toRecord));
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/update-notes', requireAuth, async (req, res) => {
  try {
    const { mobile, notes } = req.body;
    await supabase.from('documents').update({ notes }).eq('mobile', mobile);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.get('/client/:mobile', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const { data } = await supabase.from('documents').select('*').eq('mobile', req.params.mobile).order('date', { ascending: true });
    if (!data || !data.length) return res.json({ found: false });
    const records = data.map(toRecord);
    const invoiceRecords = salesRecords(records);
    const totalBusiness = invoiceRecords.reduce((sum, r) => sum + grandTotalOf(r, s), 0);
    let rawNotes = records[records.length - 1].notes;
    let notesArr = [];
    if (Array.isArray(rawNotes)) notesArr = rawNotes;
    else if (typeof rawNotes === 'string' && rawNotes.trim())
      notesArr = [{ id: Date.now().toString(), text: rawNotes.trim(), done: false, createdAt: new Date().toISOString() }];
    res.json({ found: true, name: records[0].name, mobile: records[0].mobile, address: records[0].address,
      notes: notesArr, totalBusiness, invoiceCount: invoiceRecords.length, invoices: records });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.get('/client-autofill/:mobile', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('documents').select('name, address, recipient_gstin').eq('mobile', req.params.mobile).order('date', { ascending: false }).limit(1);
    if (!data || !data.length) return res.json({ found: false });
    const r = data[0];
    res.json({ found: true, name: r.name, address: r.address, recipientGstin: r.recipient_gstin || '' });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
