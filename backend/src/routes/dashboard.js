const express = require('express');
const supabase = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { logError } = require('../logger');
const { readSettings } = require('../settings');
const { toRecord, toPurchase, toInventory } = require('../records');
const { grandTotalOf } = require('../invoiceHelpers');

const router = express.Router();

router.get('/dashboard', requireAuth, requirePerm('dashboard'), async (req, res) => {
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
  } catch (err) { logError(req, err); res.status(500).json({ success: false, message: 'An internal error occurred.' }); }
});

module.exports = router;
