const express = require('express');
const supabase = require('../db');
const { requireAdmin } = require('../auth');
const { logError } = require('../logger');
const { readSettings } = require('../settings');
const { toRecord, fromRecord, toQuote } = require('../records');

const router = express.Router();

router.get('/backup', requireAdmin, async (req, res) => {
  try {
    const { data: docs } = await supabase.from('documents').select('*').order('date');
    const { data: quotes } = await supabase.from('quotes').select('*').order('date');
    const { data: templates } = await supabase.from('templates').select('*');
    const settings = await readSettings();
    const { data: catalog } = await supabase.from('catalog').select('*');
    res.json({
      success: true,
      data: (docs || []).map(toRecord),
      quotes: (quotes || []).map(toQuote),
      templates: templates || [],
      settings, catalog: catalog || [],
      exportDate: new Date().toISOString()
    });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.post('/restore', requireAdmin, async (req, res) => {
  try {
    const { data, quotes, templates } = req.body;
    if (!Array.isArray(data)) return res.json({ success: false, message: 'Invalid backup format.' });
    // Insert documents (skip existing invoice numbers)
    for (const record of data) {
      const row = fromRecord(record);
      await supabase.from('documents').upsert(row, { onConflict: 'invoice_number' });
    }
    if (Array.isArray(quotes)) {
      for (const q of quotes) {
        await supabase.from('quotes').upsert({
          id: q.id, quote_number: q.quoteNumber, date: q.date, status: q.status || 'open',
          name: q.name, mobile: q.mobile, address: q.address,
          recipient_gstin: q.recipientGstin || '', place_of_supply_state: q.placeOfSupplyState || '',
          place_of_supply_state_code: q.placeOfSupplyStateCode || '', lines: q.lines || [],
          converted_to_invoice: q.convertedToInvoice || '', notes: q.notes || ''
        }, { onConflict: 'quote_number' });
      }
    }
    if (Array.isArray(templates)) {
      for (const t of templates) {
        await supabase.from('templates').upsert({ id: t.id, name: t.name, lines: t.lines || [], notes: t.notes || '', created_at: t.createdAt });
      }
    }
    res.json({ success: true, count: data.length });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
