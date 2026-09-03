const express = require('express');
const supabase = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { logError } = require('../logger');
const { readSettings } = require('../settings');
const { toRecord, toPurchase } = require('../records');
const { recordToInvoice, grandTotalOf } = require('../invoiceHelpers');
const { computeInvoice } = require('../gst');

const router = express.Router();

// ════════════════════ ANALYTICS ════════════════════

router.get('/analytics', requireAuth, requirePerm('analytics'), async (req, res) => {
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
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ GST REPORT ════════════════════

router.get('/gst-report', requireAuth, requirePerm('analytics'), async (req, res) => {
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
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ TALLY EXPORT ════════════════════

router.get('/tally-export', requireAuth, requirePerm('analytics'), async (req, res) => {
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
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ PROFITABILITY ════════════════════

router.get('/profitability', requireAuth, requirePerm('analytics'), async (req, res) => {
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
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

// ════════════════════ LEDGER ════════════════════

router.get('/ledger', requireAuth, requirePerm('ledger'), async (req, res) => {
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
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
