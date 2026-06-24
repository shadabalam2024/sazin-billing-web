require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const supabase = require('./db');
const { issueToken, requireAuth, requireAdmin } = require('./auth');
const { computeInvoice, nextInvoiceNumber } = require('./gst');
const { buildGstInvoiceHTML } = require('./invoice-template');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { console.warn('nodemailer not available'); }

const app = express();

// Security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
app.use(helmet());

// CORS — strict: only allow the configured origin; deny all others if not set
const allowedOrigin = process.env.CORS_ORIGIN || false;
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-auth-token']
}));
app.use(express.json({ limit: '5mb' }));

// Rate limit login: max 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' }
});

// ── Default company settings ──
const DEFAULT_SETTINGS = {
  name: 'SAZIN TECH Pvt Ltd',
  address: 'D-10, Industrial Area, New Siwan, Phase 1, Hardiya More, Opposite Paani Tanki, Siwan, Bihar — 841226',
  gstin: '', stateName: 'Bihar', stateCode: '10',
  phone: '', email: '', logoText: 'SAZIN',
  bankName: '', bankAccount: '', bankIfsc: '', upi: '',
  declaration: 'Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  invoicePrefix: 'SAZIN', defaultHsn: '3925', defaultGstRate: 18,
  smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', smtpFrom: ''
};

// ════════════════════ DB HELPERS ════════════════════

async function readSettings() {
  const { data, error } = await supabase.from('settings').select('data').eq('id', 1).single();
  if (error) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(data?.data || {}) };
}

async function writeSettings(s) {
  await supabase.from('settings').upsert({ id: 1, data: s });
}

// Documents: convert DB row (snake_case) → API record (camelCase)
function toRecord(row) {
  if (!row) return null;
  return {
    invoiceNumber: row.invoice_number,
    docType: row.doc_type || 'invoice',
    date: row.date,
    dateStr: row.date_str || (row.date ? new Date(row.date).toLocaleDateString('en-IN') : ''),
    name: row.name,
    mobile: row.mobile,
    address: row.address,
    shipTo: row.ship_to || row.address,
    recipientGstin: row.recipient_gstin || '',
    placeOfSupplyState: row.place_of_supply_state || '',
    placeOfSupplyStateCode: row.place_of_supply_state_code || '',
    originalInvoice: row.original_invoice || '',
    lines: row.lines || [],
    paymentStatus: row.payment_status || 'unpaid',
    amountPaid: parseFloat(row.amount_paid) || 0,
    payments: row.payments || [],
    notes: row.notes || [],
    convertedFromQuote: row.converted_from_quote || '',
    createdBy: row.created_by || ''
  };
}

// Documents: convert API record (camelCase) → DB row (snake_case)
function fromRecord(record) {
  return {
    invoice_number: record.invoiceNumber,
    doc_type: record.docType || 'invoice',
    date: record.date || new Date().toISOString(),
    date_str: record.dateStr || '',
    name: record.name,
    mobile: record.mobile,
    address: record.address,
    ship_to: record.shipTo || record.address || '',
    recipient_gstin: record.recipientGstin || '',
    place_of_supply_state: record.placeOfSupplyState || '',
    place_of_supply_state_code: record.placeOfSupplyStateCode || '',
    original_invoice: record.originalInvoice || '',
    lines: record.lines || [],
    payment_status: record.paymentStatus || 'unpaid',
    amount_paid: parseFloat(record.amountPaid) || 0,
    payments: record.payments || [],
    notes: record.notes || [],
    converted_from_quote: record.convertedFromQuote || '',
    created_by: record.createdBy || ''
  };
}

// Purchases: DB row → API object
function toPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplier: row.supplier,
    supplierBillNo: row.supplier_bill_no || '',
    supplierState: row.supplier_state || '',
    isIntraState: row.is_intra_state !== false,
    items: row.items || [],
    totalAmount: parseFloat(row.total_amount) || 0,
    totalTaxable: parseFloat(row.total_taxable) || 0,
    totalCgst: parseFloat(row.total_cgst) || 0,
    totalSgst: parseFloat(row.total_sgst) || 0,
    totalIgst: parseFloat(row.total_igst) || 0,
    totalGst: parseFloat(row.total_gst) || 0,
    paymentStatus: row.payment_status || 'paid',
    amountPaid: parseFloat(row.amount_paid) || 0,
    payments: row.payments || [],
    notes: row.notes || '',
    date: row.date
  };
}

// Inventory: DB row → API object
function toInventory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category || 'General',
    unit: row.unit || 'Piece',
    costPrice: parseFloat(row.cost_price) || 0,
    sellingPrice: parseFloat(row.selling_price) || 0,
    stockQty: parseFloat(row.stock_qty) || 0,
    hsn: row.hsn || '',
    lowStockAlert: parseFloat(row.low_stock_alert) || 5,
    createdAt: row.created_at
  };
}

// Quotes: DB row → API object
function toQuote(row) {
  if (!row) return null;
  return {
    id: row.id,
    docType: 'quote',
    quoteNumber: row.quote_number,
    date: row.date,
    status: row.status || 'open',
    name: row.name,
    mobile: row.mobile,
    address: row.address,
    recipientGstin: row.recipient_gstin || '',
    placeOfSupplyState: row.place_of_supply_state || '',
    placeOfSupplyStateCode: row.place_of_supply_state_code || '',
    lines: row.lines || [],
    convertedToInvoice: row.converted_to_invoice || '',
    notes: row.notes || ''
  };
}

// ── GST calculation helpers (mirrors original logic) ──
function recordToInvoice(record, settings) {
  let lines;
  if (Array.isArray(record.lines)) {
    lines = record.lines.map(l => ({
      description: l.description || 'Item',
      hsn: l.hsn || settings.defaultHsn,
      qty: Number(l.billedQty != null ? l.billedQty : l.qty) || 0,
      unit: l.unit || 'Sq.Ft',
      rate: Number(l.rate) || 0,
      discountPct: Number(l.discountPct) || 0,
      gstRate: Number(l.gstRate != null ? l.gstRate : settings.defaultGstRate)
    }));
  } else {
    const gstRate = Number(record.gstRate) || 0;
    lines = (record.measurements || []).map(m => ({
      description: 'Item', hsn: settings.defaultHsn,
      qty: (Number(m.area) || 0) * (Number(m.quantity) || 1),
      unit: 'Sq.Ft', rate: Number(m.cost) || 0, discountPct: 0, gstRate
    }));
  }
  return {
    placeOfSupplyStateCode: record.placeOfSupplyStateCode || settings.stateCode,
    placeOfSupplyState: record.placeOfSupplyState || settings.stateName,
    lines
  };
}

function grandTotalOf(record, settings) {
  return computeInvoice(recordToInvoice(record, settings), settings).grandTotal;
}

function salesRecords(records) {
  return records.filter(r => !r.docType || r.docType === 'invoice');
}

// ════════════════════ AUTH ════════════════════

app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const { data: users } = await supabase.from('users').select('*').eq('username', username).limit(1);
    const user = users?.[0];
    if (!user || !bcrypt.compareSync(password || '', user.password_hash))
      return res.json({ success: false, message: 'Invalid username or password.' });
    const token = issueToken({ username: user.username, role: user.role, permissions: user.permissions });
    const permissions = user.role === 'admin' ? null : (user.permissions || ['billing', 'quotations', 'clients']);
    res.json({ success: true, token, role: user.role, username: user.username, mustChangePassword: !!user.must_change_password, permissions });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/logout', requireAuth, (req, res) => {
  // JWT is stateless — client just discards the token.
  res.json({ success: true });
});

app.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body || {};
    if (req.user.username !== username)
      return res.status(403).json({ success: false, message: 'You can only change your own password.' });
    const { data: users } = await supabase.from('users').select('*').eq('username', username).limit(1);
    const user = users?.[0];
    if (!user || !bcrypt.compareSync(oldPassword || '', user.password_hash))
      return res.json({ success: false, message: 'Current password is incorrect.' });
    if (!newPassword || newPassword.length < 6)
      return res.json({ success: false, message: 'New password must be at least 6 characters.' });
    await supabase.from('users').update({ password_hash: bcrypt.hashSync(newPassword, 10), must_change_password: false }).eq('username', username);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ SETTINGS ════════════════════

app.get('/settings', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const { smtpPass, ...pub } = s;
    pub.smtpConfigured = !!(s.smtpHost && s.smtpUser && smtpPass);
    res.json(pub);
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/settings', requireAdmin, async (req, res) => {
  try {
    const current = await readSettings();
    const incoming = req.body || {};
    const merged = { ...current, ...incoming };
    merged.defaultGstRate = Number(merged.defaultGstRate) || 0;
    merged.smtpPort = parseInt(merged.smtpPort) || 587;
    if (!incoming.smtpPass) merged.smtpPass = current.smtpPass || '';
    await writeSettings(merged);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ NEXT DOCUMENT NUMBER (preview — does NOT consume) ════

app.get('/next-invoice', requireAuth, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.get('/next-quote', requireAuth, async (req, res) => {
  try {
    const { data: counter } = await supabase.from('counters').select('fy_label, last_seq').eq('name', 'quote').single();
    const state = counter ? { fyLabel: counter.fy_label, lastSeq: counter.last_seq } : {};
    const { number } = nextInvoiceNumber(state, 'QUOTE');
    res.json({ nextQuote: number });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ COMPUTE (live GST preview) ════════════════════

app.post('/compute', requireAuth, async (req, res) => {
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

app.post('/save', requireAuth, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ SINGLE RECORD ════════════════════

app.get('/record/:invoiceNumber', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('documents').select('*').eq('invoice_number', req.params.invoiceNumber).single();
    if (error || !data) return res.status(404).json({ success: false, message: 'Record not found.' });
    res.json({ success: true, record: toRecord(data) });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ HISTORY ════════════════════

app.get('/history', requireAuth, async (req, res) => {
  try {
    const s = await readSettings();
    const { data, error } = await supabase.from('documents').select('*').order('date', { ascending: false });
    if (error) throw new Error(error.message);
    const records = (data || []).map(row => {
      const r = toRecord(row);
      return { ...r, grandTotal: grandTotalOf(r, s) };
    });
    res.json(records);
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ EDIT ════════════════════

app.post('/edit/:invoiceNumber', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ DELETE ════════════════════

app.delete('/delete/:invoiceNumber', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ PAYMENT STATUS ════════════════════

app.post('/payment-status/:invoiceNumber', requireAdmin, async (req, res) => {
  try {
    await supabase.from('documents').update({
      payment_status: req.body.status,
      amount_paid: parseFloat(req.body.amountPaid) || 0
    }).eq('invoice_number', req.params.invoiceNumber);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ INVOICE PAYMENT LOG ════════════════════

app.post('/invoices/:invoiceNumber/payments', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/invoices/:invoiceNumber/payments/:paymentId', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ SEARCH ════════════════════

app.get('/search/:mobile', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('documents').select('*').eq('mobile', req.params.mobile);
    res.json((data || []).map(toRecord));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.get('/search-invoice/:invoice', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('documents').select('*').ilike('invoice_number', `%${req.params.invoice}%`);
    res.json((data || []).map(toRecord));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/update-notes', requireAuth, async (req, res) => {
  try {
    const { mobile, notes } = req.body;
    await supabase.from('documents').update({ notes }).eq('mobile', mobile);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.get('/client/:mobile', requireAuth, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.get('/client-autofill/:mobile', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('documents').select('name, address, recipient_gstin').eq('mobile', req.params.mobile).order('date', { ascending: false }).limit(1);
    if (!data || !data.length) return res.json({ found: false });
    const r = data[0];
    res.json({ found: true, name: r.name, address: r.address, recipientGstin: r.recipient_gstin || '' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ RENDER INVOICE ════════════════════

app.post('/render-invoice', requireAuth, async (req, res) => {
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

app.get('/outstanding', requireAuth, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ ANALYTICS ════════════════════

app.get('/analytics', requireAdmin, async (req, res) => {
  try {
    const s = await readSettings();
    const { data: rows } = await supabase.from('documents').select('*').in('doc_type', ['invoice']).order('date');
    const data = (rows || []).map(toRecord);
    const monthlyMap = {}, yearlyMap = {}, clientMap = {}, monthlyOutstanding = {}, yearlyOutstanding = {};
    data.forEach(record => {
      const total = grandTotalOf(record, s);
      const amountPaid = parseFloat(record.amountPaid) || 0;
      const remaining = record.paymentStatus === 'paid' ? 0 : Math.max(0, total - amountPaid);
      if (record.date) {
        const d = new Date(record.date);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, yk = d.getFullYear();
        monthlyMap[mk] = (monthlyMap[mk] || 0) + total;
        yearlyMap[yk] = (yearlyMap[yk] || 0) + total;
        if (remaining > 0) { monthlyOutstanding[mk] = (monthlyOutstanding[mk] || 0) + remaining; yearlyOutstanding[yk] = (yearlyOutstanding[yk] || 0) + remaining; }
      }
      if (!clientMap[record.mobile]) clientMap[record.mobile] = { name: record.name, mobile: record.mobile, total: 0, invoiceCount: 0 };
      clientMap[record.mobile].total += total; clientMap[record.mobile].invoiceCount += 1;
    });
    const today = new Date().toDateString();
    const dailyRecords = data.filter(r => r.date && new Date(r.date).toDateString() === today);
    const dailyTotal = dailyRecords.reduce((sum, r) => sum + grandTotalOf(r, s), 0);
    const unpaidTotal = data.filter(r => r.paymentStatus !== 'paid').reduce((sum, r) => sum + Math.max(0, grandTotalOf(r, s) - (parseFloat(r.amountPaid) || 0)), 0);
    res.json({ monthly: monthlyMap, yearly: yearlyMap, monthlyOutstanding, yearlyOutstanding,
      topClients: Object.values(clientMap).sort((a, b) => b.total - a.total).slice(0, 10),
      daily: { date: today, invoiceCount: dailyRecords.length, total: dailyTotal }, unpaidTotal });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ CATALOG ════════════════════

app.get('/catalog', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('catalog').select('*').order('name');
    res.json((data || []).map(c => ({ id: c.id, name: c.name, cost: parseFloat(c.cost), hsn: c.hsn || '', unit: c.unit || 'Sq.Ft' })));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/catalog', requireAdmin, async (req, res) => {
  try {
    const { name, cost, hsn, unit } = req.body;
    if (!name || !cost) return res.json({ success: false, message: 'Name and cost required.' });
    const s = await readSettings();
    const { data, error } = await supabase.from('catalog').insert({ name, cost: parseFloat(cost), hsn: hsn || s.defaultHsn, unit: unit || 'Sq.Ft' }).select('id').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, id: data.id });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/catalog/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('catalog').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ BACKUP / RESTORE ════════════════════

app.get('/backup', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/restore', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ INVENTORY ════════════════════

app.get('/inventory', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('inventory').select('*').order('name');
    res.json((data || []).map(toInventory));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/inventory', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.put('/inventory/:id', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/inventory/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('inventory').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ PURCHASES ════════════════════

app.get('/purchases', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('purchases').select('*').order('date', { ascending: false });
    res.json((data || []).map(toPurchase));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/purchases', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.put('/purchases/:id', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/purchases/:id/payments', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/purchases/:id/payments/:paymentId', requireAdmin, async (req, res) => {
  try {
    const { data: row } = await supabase.from('purchases').select('*').eq('id', req.params.id).single();
    if (!row) return res.json({ success: false, message: 'Purchase not found.' });
    const newPayments = (row.payments || []).filter(p => p.id !== req.params.paymentId);
    const newAmountPaid = Math.round(newPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;
    const total = parseFloat(row.total_amount) || 0;
    const newStatus = newAmountPaid >= total ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';
    await supabase.from('purchases').update({ payments: newPayments, amount_paid: newAmountPaid, payment_status: newStatus }).eq('id', req.params.id);
    res.json({ success: true, amountPaid: newAmountPaid, paymentStatus: newStatus });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/purchases/:id', requireAdmin, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ EXPENSES ════════════════════

app.get('/expenses', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('expenses').select('*').order('date', { ascending: false });
    res.json((data || []).map(e => ({ id: e.id, category: e.category, description: e.description, amount: parseFloat(e.amount), notes: e.notes || '', date: e.date })));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/expenses', requireAdmin, async (req, res) => {
  try {
    const { category, description, amount, notes } = req.body;
    if (!description || !amount) return res.json({ success: false, message: 'Description and amount are required.' });
    const { data, error } = await supabase.from('expenses').insert({ category: category || 'Other', description, amount: parseFloat(amount) || 0, notes: notes || '' }).select('id').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, id: data.id });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/expenses/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('expenses').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ DASHBOARD ════════════════════

app.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const s = await readSettings();
    const [{ data: allDocs }, { data: purchases }, { data: expenses }, { data: inv }] = await Promise.all([
      supabase.from('documents').select('*').eq('doc_type', 'invoice'),
      supabase.from('purchases').select('*'),
      supabase.from('expenses').select('*'),
      supabase.from('inventory').select('*')
    ]);
    const data = (allDocs || []).map(toRecord);
    const purch = (purchases || []).map(toPurchase);
    const expArr = expenses || [];
    const invArr = (inv || []).map(toInventory);

    const today = new Date().toDateString();
    const todayFilter = arr => arr.filter(r => r.date && new Date(r.date).toDateString() === today);
    const sum = (arr, key) => arr.reduce((t, r) => t + (parseFloat(r[key]) || 0), 0);
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const todaySales = todayFilter(data).reduce((t, r) => t + grandTotalOf(r, s), 0);
    const todayPurchases = sum(todayFilter(purch), 'totalAmount');
    const todayExpenses = sum(todayFilter(expArr), 'amount');
    const totalSalesMonth = data.filter(r => r.date && r.date.startsWith(ym)).reduce((t, r) => t + grandTotalOf(r, s), 0);
    const totalPurchasesMonth = purch.filter(r => r.date && r.date.startsWith(ym)).reduce((t, r) => t + r.totalAmount, 0);
    const totalExpensesMonth = expArr.filter(r => r.date && r.date.startsWith(ym)).reduce((t, r) => t + r.amount, 0);
    const unpaidTotal = data.filter(r => r.paymentStatus !== 'paid').reduce((t, r) => t + Math.max(0, grandTotalOf(r, s) - (parseFloat(r.amountPaid) || 0)), 0);
    const lowStock = invArr.filter(i => i.stockQty <= i.lowStockAlert);
    const recentSales = [...data].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5).map(r => ({ invoiceNumber: r.invoiceNumber, name: r.name, date: r.date, total: grandTotalOf(r, s), paymentStatus: r.paymentStatus }));

    res.json({
      today: { sales: todaySales, purchases: todayPurchases, expenses: todayExpenses, net: todaySales - todayPurchases - todayExpenses, invoiceCount: todayFilter(data).length },
      month: { sales: totalSalesMonth, purchases: totalPurchasesMonth, expenses: totalExpensesMonth, profit: totalSalesMonth - totalPurchasesMonth - totalExpensesMonth },
      unpaidTotal, lowStock, recentSales
    });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ QUOTES ════════════════════

app.get('/quotes', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('quotes').select('*').order('date', { ascending: false });
    res.json((data || []).map(toQuote));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/quotes', requireAuth, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/quotes/:id', requireAuth, async (req, res) => {
  try {
    await supabase.from('quotes').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/quotes/:id/convert', requireAuth, async (req, res) => {
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ TEMPLATES ════════════════════

app.get('/templates', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('templates').select('*').order('created_at', { ascending: false });
    res.json((data || []).map(t => ({ id: t.id, name: t.name, lines: t.lines || [], notes: t.notes || '', createdAt: t.created_at })));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/templates', requireAdmin, async (req, res) => {
  try {
    const { name, lines, notes } = req.body;
    if (!name) return res.json({ success: false, message: 'Template name is required.' });
    const { data, error } = await supabase.from('templates').insert({ name, lines: lines || [], notes: notes || '' }).select('id').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, id: data.id });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/templates/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('templates').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ USERS ════════════════════

app.get('/users', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('users').select('username, role, must_change_password, permissions').order('username');
    res.json((data || []).map(u => ({ username: u.username, role: u.role, mustChangePassword: !!u.must_change_password, permissions: u.permissions || null })));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role, permissions } = req.body || {};
    if (!username || !password) return res.json({ success: false, message: 'Username and password are required.' });
    if (!['admin', 'staff'].includes(role)) return res.json({ success: false, message: 'Role must be admin or staff.' });
    if (password.length < 6) return res.json({ success: false, message: 'Password must be at least 6 characters.' });
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).limit(1);
    if (existing?.length) return res.json({ success: false, message: 'Username already exists.' });
    const newUser = { username, password_hash: bcrypt.hashSync(password, 10), role, must_change_password: true };
    if (role === 'staff') newUser.permissions = Array.isArray(permissions) ? permissions : ['billing', 'quotations', 'clients'];
    await supabase.from('users').insert(newUser);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.put('/users/:username', requireAdmin, async (req, res) => {
  try {
    const { data: users } = await supabase.from('users').select('*').eq('username', req.params.username).limit(1);
    const user = users?.[0];
    if (!user) return res.json({ success: false, message: 'User not found.' });
    const { newPassword, role, permissions } = req.body || {};
    const updates = {};
    if (role) {
      if (!['admin', 'staff'].includes(role)) return res.json({ success: false, message: 'Invalid role.' });
      if (user.role === 'admin' && role !== 'admin') {
        const { count } = await supabase.from('users').select('id', { count: 'exact' }).eq('role', 'admin');
        if (count <= 1) return res.json({ success: false, message: 'Cannot demote the last admin.' });
      }
      updates.role = role;
      if (role === 'admin') updates.permissions = null;
    }
    if (Array.isArray(permissions) && (updates.role || user.role) === 'staff') updates.permissions = permissions;
    if (newPassword) {
      if (newPassword.length < 6) return res.json({ success: false, message: 'Password must be at least 6 characters.' });
      updates.password_hash = bcrypt.hashSync(newPassword, 10);
      updates.must_change_password = true;
    }
    await supabase.from('users').update(updates).eq('username', req.params.username);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

app.delete('/users/:username', requireAdmin, async (req, res) => {
  try {
    if (req.params.username === req.user.username) return res.json({ success: false, message: 'You cannot delete your own account.' });
    const { data: target } = await supabase.from('users').select('role').eq('username', req.params.username).single();
    if (!target) return res.json({ success: false, message: 'User not found.' });
    if (target.role === 'admin') {
      const { count } = await supabase.from('users').select('id', { count: 'exact' }).eq('role', 'admin');
      if (count <= 1) return res.json({ success: false, message: 'Cannot delete the last admin account.' });
    }
    await supabase.from('users').delete().eq('username', req.params.username);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ GST REPORT ════════════════════

app.get('/gst-report', requireAdmin, async (req, res) => {
  try {
    const s = await readSettings();
    const { month } = req.query;
    let query = supabase.from('documents').select('*').eq('doc_type', 'invoice');
    if (month) query = query.gte('date', month + '-01').lt('date', month.slice(0, 4) + '-' + String(parseInt(month.slice(5)) + 1).padStart(2, '0') + '-01');
    const { data: rows } = await query;
    const data = (rows || []).map(toRecord);
    const b2b = [], b2c = [], rateSummary = {};
    let totTaxable = 0, totCgst = 0, totSgst = 0, totIgst = 0, totTax = 0;
    const rnd = n => Math.round(n * 100) / 100;
    data.forEach(record => {
      const inv = recordToInvoice(record, s);
      const calc = computeInvoice(inv, s);
      totTaxable += calc.totalTaxable; totCgst += calc.totalCgst; totSgst += calc.totalSgst; totIgst += calc.totalIgst; totTax += calc.totalTax;
      calc.slabs.forEach(slab => {
        const k = slab.gstRate;
        if (!rateSummary[k]) rateSummary[k] = { gstRate: k, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
        rateSummary[k].taxable += slab.taxable; rateSummary[k].cgst += slab.cgst; rateSummary[k].sgst += slab.sgst; rateSummary[k].igst += slab.igst;
        rateSummary[k].totalTax += calc.intraState ? (slab.cgst + slab.sgst) : slab.igst;
      });
      const entry = { invoiceNumber: record.invoiceNumber, date: record.date, name: record.name, mobile: record.mobile,
        gstin: record.recipientGstin || '', placeOfSupply: `${record.placeOfSupplyState || s.stateName} (${record.placeOfSupplyStateCode || s.stateCode})`,
        grandTotal: calc.grandTotal, taxable: calc.totalTaxable, cgst: calc.totalCgst, sgst: calc.totalSgst, igst: calc.totalIgst, totalTax: calc.totalTax };
      if (record.recipientGstin) b2b.push(entry); else b2c.push(entry);
    });
    Object.values(rateSummary).forEach(r => { r.taxable = rnd(r.taxable); r.cgst = rnd(r.cgst); r.sgst = rnd(r.sgst); r.igst = rnd(r.igst); r.totalTax = rnd(r.totalTax); });
    res.json({ success: true, month: month || 'all', totalInvoices: data.length, b2b, b2c,
      rateSummary: Object.values(rateSummary).sort((a, b) => a.gstRate - b.gstRate),
      totals: { taxable: rnd(totTaxable), cgst: rnd(totCgst), sgst: rnd(totSgst), igst: rnd(totIgst), totalTax: rnd(totTax) } });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ TALLY EXPORT ════════════════════

app.get('/tally-export', requireAdmin, async (req, res) => {
  try {
    const s = await readSettings();
    const { month } = req.query;
    let query = supabase.from('documents').select('*').eq('doc_type', 'invoice');
    if (month) query = query.gte('date', month + '-01').lt('date', month.slice(0, 4) + '-' + String(parseInt(month.slice(5)) + 1).padStart(2, '0') + '-01');
    const { data: rows } = await query;
    const data = (rows || []).map(toRecord);
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const headers = ['Date','Voucher No','Party Name','Party GSTIN','Place of Supply','Taxable Value','CGST %','CGST Amt','SGST %','SGST Amt','IGST %','IGST Amt','Grand Total','Payment Status'];
    const rowLines = [headers.map(esc).join(',')];
    data.forEach(record => {
      const inv = recordToInvoice(record, s);
      const calc = computeInvoice(inv, s);
      const date = record.date ? new Date(record.date).toLocaleDateString('en-IN') : '';
      if (calc.slabs.length) {
        calc.slabs.forEach((slab, i) => {
          rowLines.push([i === 0 ? date : '', i === 0 ? record.invoiceNumber : '', i === 0 ? record.name : '', i === 0 ? (record.recipientGstin || '') : '',
            i === 0 ? (record.placeOfSupplyState || s.stateName) : '', slab.taxable,
            calc.intraState ? slab.gstRate / 2 : '', calc.intraState ? slab.cgst : '',
            calc.intraState ? slab.gstRate / 2 : '', calc.intraState ? slab.sgst : '',
            !calc.intraState ? slab.gstRate : '', !calc.intraState ? slab.igst : '',
            i === 0 ? calc.grandTotal : '', i === 0 ? (record.paymentStatus || 'unpaid') : ''].map(esc).join(','));
        });
      } else {
        rowLines.push([date, record.invoiceNumber, record.name, record.recipientGstin || '', record.placeOfSupplyState || s.stateName,
          calc.totalTaxable, '', '', '', '', '', '', calc.grandTotal, record.paymentStatus || 'unpaid'].map(esc).join(','));
      }
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="TallyExport_${month || 'all'}.csv"`);
    res.send(rowLines.join('\n'));
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ PROFITABILITY ════════════════════

app.get('/profitability', requireAdmin, async (req, res) => {
  try {
    const s = await readSettings();
    const [{ data: rows }, { data: catalogRows }, { data: invRows }] = await Promise.all([
      supabase.from('documents').select('*').eq('doc_type', 'invoice'),
      supabase.from('catalog').select('*'),
      supabase.from('inventory').select('*')
    ]);
    const data = (rows || []).map(toRecord);
    const costMap = {};
    (catalogRows || []).forEach(c => { costMap[c.name.toLowerCase()] = parseFloat(c.cost) || 0; });
    (invRows || []).forEach(i => { if (!costMap[i.name.toLowerCase()]) costMap[i.name.toLowerCase()] = parseFloat(i.cost_price) || 0; });
    const itemMap = {};
    data.forEach(record => {
      (Array.isArray(record.lines) ? record.lines : []).forEach(l => {
        const desc = (l.description || 'Item').trim(), key = desc.toLowerCase();
        const qty = Number(l.billedQty != null ? l.billedQty : l.qty) || 0;
        const rate = Number(l.rate) || 0, disc = Number(l.discountPct) || 0;
        const revenue = qty * rate * (1 - disc / 100);
        const costPrice = costMap[key] || 0;
        if (!itemMap[desc]) itemMap[desc] = { description: desc, qty: 0, revenue: 0, cost: 0, costKnown: false };
        itemMap[desc].qty += qty; itemMap[desc].revenue += revenue; itemMap[desc].cost += qty * costPrice;
        if (costPrice > 0) itemMap[desc].costKnown = true;
      });
    });
    const rnd = n => Math.round(n * 100) / 100;
    const items = Object.values(itemMap).map(i => {
      const profit = i.costKnown ? rnd(i.revenue - i.cost) : null;
      const margin = (profit != null && i.revenue > 0) ? rnd((profit / i.revenue) * 100) : null;
      return { ...i, qty: rnd(i.qty), revenue: rnd(i.revenue), cost: rnd(i.cost), profit, margin };
    }).sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    res.json({ success: true, items });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ LEDGER ════════════════════

app.get('/ledger', requireAdmin, async (req, res) => {
  try {
    const s = await readSettings();
    const { period, month, year } = req.query;
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentYear = String(now.getFullYear());

    function inRange(dateStr) {
      if (!dateStr) return false;
      if (period === 'month') return dateStr.startsWith(month || currentMonth);
      if (period === 'year') return dateStr.startsWith(year || currentYear);
      return true;
    }

    const [{ data: docRows }, { data: purchRows }, { data: expRows }] = await Promise.all([
      supabase.from('documents').select('*').order('date'),
      supabase.from('purchases').select('*').order('date'),
      supabase.from('expenses').select('*').order('date')
    ]);

    const entries = [];

    (docRows || []).filter(r => inRange(r.date)).forEach(row => {
      const record = toRecord(row);
      const inv = recordToInvoice(record, s);
      const calc = computeInvoice(inv, s);
      const dt = record.docType || 'invoice';
      const ps = record.paymentStatus || 'unpaid';
      let credit = 0, debit = 0, invoiceTotal = 0, outstanding = 0, amountCollected = 0;
      if (dt === 'invoice' || dt === 'proforma') {
        invoiceTotal = calc.grandTotal;
        credit = calc.grandTotal;
        const paid = parseFloat(record.amountPaid) || (ps === 'paid' ? calc.grandTotal : 0);
        amountCollected = Math.min(paid, calc.grandTotal);
        outstanding = Math.max(0, Math.round((calc.grandTotal - amountCollected) * 100) / 100);
      } else if (dt === 'credit-note') { debit = calc.grandTotal; }
        else if (dt === 'debit-note') { credit = calc.grandTotal; }
      const typeLabel = { invoice: 'Sale', proforma: 'Proforma', 'credit-note': 'Credit Note', 'debit-note': 'Debit Note' }[dt] || 'Sale';
      entries.push({ date: record.date, type: typeLabel, docType: dt, reference: record.invoiceNumber || '',
        party: record.name || '', description: record.address || '',
        debit, credit, invoiceTotal, outstanding, amountCollected,
        paymentStatus: ps, amountPaid: parseFloat(record.amountPaid) || 0, payments: record.payments || [] });
    });

    (purchRows || []).filter(r => inRange(r.date)).forEach(row => {
      const p = toPurchase(row);
      const pTotal = p.totalAmount; const pPaid = p.amountPaid || (p.paymentStatus === 'paid' ? pTotal : 0);
      const pOutstanding = Math.max(0, Math.round((pTotal - pPaid) * 100) / 100);
      entries.push({ date: p.date, type: 'Purchase', docType: 'purchase',
        reference: p.supplierBillNo || (p.id ? p.id.slice(0, 8).toUpperCase() : ''),
        party: p.supplier || '', description: (p.items || []).map(i => i.name).join(', '),
        debit: pTotal, credit: 0, paymentStatus: p.paymentStatus || 'paid',
        amountPaid: pPaid, outstanding: pOutstanding, payments: p.payments || [] });
    });

    (expRows || []).filter(r => inRange(r.date)).forEach(e => {
      entries.push({ date: e.date, type: 'Expense', docType: 'expense',
        reference: e.id ? e.id.slice(0, 8).toUpperCase() : '',
        party: e.category || '', description: e.description || '',
        debit: parseFloat(e.amount) || 0, credit: 0, paymentStatus: 'paid', amountPaid: 0 });
    });

    entries.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    let balance = 0;
    const rows = entries.map(e => { balance += (e.credit - e.debit); return { ...e, balance: Math.round(balance * 100) / 100 }; });

    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const salesRows = rows.filter(r => r.docType === 'invoice' || r.docType === 'proforma');
    const totalInvoiced = salesRows.reduce((s, r) => s + (r.invoiceTotal || 0), 0);
    const totalCollected = salesRows.reduce((s, r) => s + (r.amountCollected || 0), 0);
    const totalOutstanding = salesRows.reduce((s, r) => s + (r.outstanding || 0), 0);
    const totalExpenses = rows.filter(r => r.docType === 'expense').reduce((s, r) => s + r.debit, 0);
    const totalPurchases = rows.filter(r => r.docType === 'purchase').reduce((s, r) => s + r.debit, 0);
    // Cash actually paid out on purchases (excludes unpaid payables — those haven't left your hand yet)
    const totalPurchasesPaid = rows.filter(r => r.docType === 'purchase').reduce((s, r) => s + (r.amountPaid || 0), 0);
    const totalPayable = rows.filter(r => r.docType === 'purchase').reduce((s, r) => s + (r.outstanding || 0), 0);

    res.json({ success: true, rows,
      summary: { totalCredit: Math.round(totalCredit * 100) / 100, totalDebit: Math.round(totalDebit * 100) / 100,
        netBalance: Math.round(balance * 100) / 100, totalCollected: Math.round(totalCollected * 100) / 100,
        totalInvoiced: Math.round(totalInvoiced * 100) / 100, totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        totalPayable: Math.round(totalPayable * 100) / 100, totalExpenses, totalPurchases,
        totalPurchasesPaid: Math.round(totalPurchasesPaid * 100) / 100 },
      period: period || 'all', month: month || currentMonth, year: year || currentYear });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ EMAIL INVOICE ════════════════════

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/email-invoice', requireAuth, async (req, res) => {
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
  } catch (err) { res.status(500).json({ success: false, message: 'Email send failed.' }); }
});

// Export for Vercel serverless (api/index.js requires this).
// When run directly (node src/server.js) for local dev, also start the HTTP server.
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅  SAZIN Billing backend running on http://localhost:${PORT}`));
}
