const express = require('express');
const supabase = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { logError } = require('../logger');
const { readSettings } = require('../settings');
const { toRecord, fromRecord } = require('../records');
const { recordToInvoice, grandTotalOf } = require('../invoiceHelpers');
const { computeInvoice, nextInvoiceNumber } = require('../gst');
const { buildGstInvoiceHTML } = require('../invoice-template');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { console.warn('nodemailer not available'); }

const router = express.Router();

// ════════════════════ NEXT DOCUMENT NUMBER (preview — does NOT consume) ════

router.get('/next-invoice', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const docType = req.query.docType || 'invoice';
    const counterMap = { proforma: 'proforma', 'credit-note': 'credit_note', 'debit-note': 'debit_note', invoice: 'invoice' };
    const prefixMap = { proforma: 'PROFORMA', 'credit-note': 'CN', 'debit-note': 'DN', invoice: s.invoicePrefix || 'SAZIN' };
    const counterName = counterMap[docType] || 'invoice';
    const prefix = prefixMap[docType] || s.invoicePrefix;

    const { data: counter } = await supabase.from('counters').select('fy_label, last_seq').eq('name', counterName).single();
    const state = counter ? { fyLabel: counter.fy_label, lastSeq: counter.last_seq } : {};
    const { number } = nextInvoiceNumber(state, prefix);
    res.json({ nextInvoice: number });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.get('/next-quote', requireAuth, async (req, res) => {
  try {
    const { data: counter } = await supabase.from('counters').select('fy_label, last_seq').eq('name', 'quote').single();
    const state = counter ? { fyLabel: counter.fy_label, lastSeq: counter.last_seq } : {};
    const { number } = nextInvoiceNumber(state, 'QUOTE');
    res.json({ nextQuote: number });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ COMPUTE (live GST preview) ════════════════════

router.post('/compute', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const calc = computeInvoice({
      placeOfSupplyStateCode: req.body.placeOfSupplyStateCode || s.stateCode,
      lines: req.body.lines || []
    }, s);
    res.json({ success: true, calc });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ════════════════════ SAVE (multi-docType) ════════════════════════════════

router.post('/save', requireAuth, async (req, res) => {
  try {
    const { name, mobile, address } = req.body || {};
    if (!name || !mobile || !address)
      return res.status(400).json({ success: false, message: 'Name, mobile and address are required.' });
    if (!/^\d{10}$/.test(mobile))
      return res.status(400).json({ success: false, message: 'Mobile number must be exactly 10 digits.' });

    const docType = req.body.docType || 'invoice';
    const s = await readSettings();

    const counterMap = { proforma: ['proforma', 'PROFORMA'], 'credit-note': ['credit_note', 'CN'], 'debit-note': ['debit_note', 'DN'], invoice: ['invoice', s.invoicePrefix || 'SAZIN'] };
    const [counterName, prefix] = counterMap[docType] || ['invoice', s.invoicePrefix || 'SAZIN'];

    const { data: invoiceNumber, error: ctrErr } = await supabase.rpc('next_doc_number', { counter_name: counterName, prefix });
    if (ctrErr) throw new Error('Failed to generate document number: ' + ctrErr.message);

    const initialPaid = parseFloat(req.body.amountPaid) || 0;
    const initialStatus = req.body.paymentStatus || 'unpaid';
    let initialPayments = Array.isArray(req.body.payments) ? req.body.payments : [];
    if (!initialPayments.length && initialPaid > 0 && initialStatus === 'partial') {
      const payDate = req.body.paymentDate ? new Date(req.body.paymentDate).toISOString() : new Date().toISOString();
      initialPayments = [{ id: invoiceNumber + '_p1', date: payDate, amount: initialPaid, note: req.body.paymentNote || 'Initial payment' }];
    } else if (!initialPayments.length && initialStatus === 'paid') {
      initialPayments = [{ id: invoiceNumber + '_p1', date: new Date().toISOString(), amount: initialPaid, note: 'Full payment' }];
    }

    const row = fromRecord({
      ...req.body,
      invoiceNumber,
      docType,
      date: new Date().toISOString(),
      paymentStatus: initialStatus,
      amountPaid: initialPaid,
      payments: initialPayments
    });

    const { error: insErr } = await supabase.from('documents').insert(row);
    if (insErr) throw new Error(insErr.message);

    // Deduct inventory stock for confirmed invoices
    if (docType === 'invoice') {
      for (const line of (req.body.lines || [])) {
        const desc = (line.description || '').toLowerCase().trim();
        if (!desc) continue;
        const deduct = parseFloat(line.billedQty) || 0;
        if (!deduct) continue;
        const { data: items } = await supabase.from('inventory').select('id, stock_qty').ilike('name', desc).limit(1);
        if (items?.[0]) {
          const newQty = Math.max(0, (parseFloat(items[0].stock_qty) || 0) - deduct);
          await supabase.from('inventory').update({ stock_qty: newQty }).eq('id', items[0].id);
        }
      }
    }

    // Restore inventory stock when a credit note is created
    if (docType === 'credit-note') {
      for (const line of (req.body.lines || [])) {
        const desc = (line.description || '').toLowerCase().trim();
        if (!desc) continue;
        const qty = parseFloat(line.billedQty) || 0;
        if (!qty) continue;
        const { data: items } = await supabase.from('inventory').select('id, stock_qty').ilike('name', desc).limit(1);
        if (items?.[0]) {
          const newQty = Math.round(((parseFloat(items[0].stock_qty) || 0) + qty) * 100) / 100;
          await supabase.from('inventory').update({ stock_qty: newQty }).eq('id', items[0].id);
        }
      }
    }

    res.json({ success: true, invoiceNumber });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ SINGLE RECORD ════════════════════

router.get('/record/:invoiceNumber', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('documents').select('*').eq('invoice_number', req.params.invoiceNumber).single();
    if (error || !data) return res.status(404).json({ success: false, message: 'Record not found.' });
    res.json({ success: true, record: toRecord(data) });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ HISTORY ════════════════════

router.get('/history', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const { data, error } = await supabase.from('documents').select('*').order('date', { ascending: false });
    if (error) throw new Error(error.message);
    const records = (data || []).map(row => {
      const r = toRecord(row);
      return { ...r, grandTotal: grandTotalOf(r, s) };
    });
    res.json(records);
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ EDIT ════════════════════

router.post('/edit/:invoiceNumber', requireAuth, requirePerm('billing', 'clients', 'history'), async (req, res) => {
  try {
    const { name, mobile, address, lines, recipientGstin, placeOfSupplyState, placeOfSupplyStateCode } = req.body || {};
    if (!name || !mobile || !address) return res.json({ success: false, message: 'Name, mobile and address required.' });
    if (!/^\d{10}$/.test(mobile)) return res.json({ success: false, message: 'Mobile must be 10 digits.' });

    const { data: existing } = await supabase.from('documents').select('*').eq('invoice_number', req.params.invoiceNumber).single();
    if (!existing) return res.json({ success: false, message: 'Invoice not found.' });

    await supabase.from('documents').update({
      name, mobile, address,
      lines: Array.isArray(lines) ? lines : existing.lines,
      recipient_gstin: recipientGstin ?? existing.recipient_gstin,
      place_of_supply_state: placeOfSupplyState ?? existing.place_of_supply_state,
      place_of_supply_state_code: placeOfSupplyStateCode ?? existing.place_of_supply_state_code
    }).eq('invoice_number', req.params.invoiceNumber);

    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ DELETE ════════════════════

router.delete('/delete/:invoiceNumber', requireAuth, requirePerm('billing', 'clients', 'history'), async (req, res) => {
  try {
    const { data: existing } = await supabase.from('documents').select('*').eq('invoice_number', req.params.invoiceNumber).single();
    if (!existing) return res.json({ success: false, message: 'Invoice not found.' });

    const record = toRecord(existing);
    let stockRestored = 0;

    if ((!record.docType || record.docType === 'invoice') && Array.isArray(record.lines)) {
      for (const line of record.lines) {
        const desc = (line.description || '').toLowerCase().trim();
        if (!desc) continue;
        const { data: items } = await supabase.from('inventory').select('id, stock_qty').ilike('name', desc).limit(1);
        if (items?.[0]) {
          const newQty = Math.round(((parseFloat(items[0].stock_qty) || 0) + (parseFloat(line.billedQty) || 0)) * 100) / 100;
          await supabase.from('inventory').update({ stock_qty: newQty }).eq('id', items[0].id);
          stockRestored++;
        }
      }
    } else if (record.docType === 'credit-note' && Array.isArray(record.lines)) {
      for (const line of record.lines) {
        const desc = (line.description || '').toLowerCase().trim();
        if (!desc) continue;
        const { data: items } = await supabase.from('inventory').select('id, stock_qty').ilike('name', desc).limit(1);
        if (items?.[0]) {
          const newQty = Math.max(0, Math.round(((parseFloat(items[0].stock_qty) || 0) - (parseFloat(line.billedQty) || 0)) * 100) / 100);
          await supabase.from('inventory').update({ stock_qty: newQty }).eq('id', items[0].id);
          stockRestored++;
        }
      }
    }

    await supabase.from('documents').delete().eq('invoice_number', req.params.invoiceNumber);
    res.json({ success: true, stockRestored });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ PAYMENT STATUS ════════════════════

router.post('/payment-status/:invoiceNumber', requireAuth, requirePerm('billing', 'clients', 'history'), async (req, res) => {
  try {
    await supabase.from('documents').update({
      payment_status: req.body.status,
      amount_paid: parseFloat(req.body.amountPaid) || 0
    }).eq('invoice_number', req.params.invoiceNumber);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ INVOICE PAYMENT LOG ════════════════════

router.post('/invoices/:invoiceNumber/payments', requireAuth, requirePerm('billing', 'clients', 'history'), async (req, res) => {
  try {
    const { data: existing } = await supabase.from('documents').select('*').eq('invoice_number', req.params.invoiceNumber).single();
    if (!existing) return res.json({ success: false, message: 'Invoice not found.' });

    const { amount, note, date } = req.body;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return res.json({ success: false, message: 'Amount must be greater than 0.' });

    let existingPayments = existing.payments || [];
    if (!existingPayments.length) {
      const legacyPaid = parseFloat(existing.amount_paid) || 0;
      if (legacyPaid > 0) {
        existingPayments = [{ id: existing.invoice_number + '_p0', date: existing.date, amount: legacyPaid, note: 'Payment (migrated)' }];
      }
    }

    const payment = { id: Date.now().toString(), date: date ? new Date(date).toISOString() : new Date().toISOString(), amount: amt, note: note || '' };
    const newPayments = [...existingPayments, payment];
    const newAmountPaid = Math.round(newPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;

    const s = await readSettings();
    const record = toRecord(existing);
    const total = grandTotalOf(record, s);
    const newStatus = newAmountPaid >= total ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';

    await supabase.from('documents').update({ payments: newPayments, amount_paid: newAmountPaid, payment_status: newStatus }).eq('invoice_number', req.params.invoiceNumber);
    res.json({ success: true, amountPaid: newAmountPaid, paymentStatus: newStatus });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

router.delete('/invoices/:invoiceNumber/payments/:paymentId', requireAuth, requirePerm('billing', 'clients', 'history'), async (req, res) => {
  try {
    const { data: existing } = await supabase.from('documents').select('*').eq('invoice_number', req.params.invoiceNumber).single();
    if (!existing) return res.json({ success: false, message: 'Invoice not found.' });

    const newPayments = (existing.payments || []).filter(p => p.id !== req.params.paymentId);
    const newAmountPaid = Math.round(newPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;

    const s = await readSettings();
    const record = toRecord(existing);
    const total = grandTotalOf(record, s);
    const newStatus = newAmountPaid >= total ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';

    await supabase.from('documents').update({ payments: newPayments, amount_paid: newAmountPaid, payment_status: newStatus }).eq('invoice_number', req.params.invoiceNumber);
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ RENDER INVOICE ════════════════════

router.post('/render-invoice', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const record = req.body.record;
    const inv = recordToInvoice(record, s);
    const html = buildGstInvoiceHTML({
      invoiceNumber: record.invoiceNumber || 'DRAFT',
      dateStr: new Date(record.date || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      name: record.name, address: record.address, mobile: record.mobile,
      recipientGstin: record.recipientGstin || '', shipTo: record.shipTo || record.address,
      placeOfSupplyState: inv.placeOfSupplyState, placeOfSupplyStateCode: inv.placeOfSupplyStateCode,
      lines: inv.lines, docType: record.docType || 'invoice', originalInvoice: record.originalInvoice || ''
    }, s);
    res.json({ success: true, html });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ════════════════════ OUTSTANDING ════════════════════

router.get('/outstanding', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const { data } = await supabase.from('documents')
      .select('*')
      .in('doc_type', ['invoice', 'proforma'])
      .in('payment_status', ['unpaid', 'partial']);
    const records = (data || []).map(row => {
      const r = toRecord(row);
      const grandTotal = grandTotalOf(r, s);
      const amountPaid = parseFloat(r.amountPaid) || 0;
      return { ...r, grandTotal, amountPaid, remaining: Math.max(0, grandTotal - amountPaid) };
    });
    res.json(records);
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ EMAIL INVOICE ════════════════════

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/email-invoice', requireAuth, async (req, res) => {
  try {
    if (!nodemailer) return res.json({ success: false, message: 'Email not available.' });
    const { invoiceNumber, recipientEmail } = req.body;
    if (!recipientEmail || !EMAIL_RE.test(recipientEmail))
      return res.json({ success: false, message: 'A valid recipient email address is required.' });
    if (!invoiceNumber)
      return res.json({ success: false, message: 'Invoice number is required.' });

    // Fetch the record from DB — never trust client-supplied invoice data
    const { data: row, error: fetchErr } = await supabase.from('documents').select('*').eq('invoice_number', invoiceNumber).single();
    if (fetchErr || !row) return res.json({ success: false, message: 'Invoice not found.' });
    const record = toRecord(row);

    const s = await readSettings();
    if (!s.smtpHost || !s.smtpUser || !s.smtpPass)
      return res.json({ success: false, message: 'SMTP not configured. Add email settings in the Settings tab.' });
    const inv = recordToInvoice(record, s);
    const html = buildGstInvoiceHTML({
      invoiceNumber: record.invoiceNumber,
      dateStr: new Date(record.date || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      name: record.name, address: record.address, mobile: record.mobile,
      recipientGstin: record.recipientGstin || '', shipTo: record.shipTo || record.address,
      placeOfSupplyState: inv.placeOfSupplyState, placeOfSupplyStateCode: inv.placeOfSupplyStateCode,
      lines: inv.lines, docType: record.docType || 'invoice', originalInvoice: record.originalInvoice || ''
    }, s);
    const transporter = nodemailer.createTransport({ host: s.smtpHost, port: parseInt(s.smtpPort) || 587, secure: parseInt(s.smtpPort) === 465, auth: { user: s.smtpUser, pass: s.smtpPass } });
    const docLabel = { proforma: 'Proforma Invoice', 'credit-note': 'Credit Note', 'debit-note': 'Debit Note', quote: 'Quotation' }[record.docType] || 'Invoice';
    await transporter.sendMail({
      from: `"${s.name}" <${s.smtpFrom || s.smtpUser}>`,
      to: recipientEmail,
      subject: `${docLabel} ${record.invoiceNumber} from ${s.name}`,
      html: `<p>Dear ${record.name || 'Customer'},</p><p>Please find your ${docLabel.toLowerCase()} attached below.</p><p>Regards,<br>${s.name}${s.phone ? '<br>' + s.phone : ''}</p>`,
      attachments: [{ filename: `${record.invoiceNumber.replace(/\//g, '-')}.html`, content: html, contentType: 'text/html' }]
    });
    res.json({ success: true });
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'Email send failed.' }); }
});

module.exports = router;
