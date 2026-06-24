// ── DASHBOARD ──
function loadDashboard() {
  if (currentRole !== "admin") return;
  apiFetch("/dashboard").then(r => r.json()).then(data => {
    document.getElementById("dashTodayCards").innerHTML = `
      <div class="stat-box"><span class="stat-label">Sales Today</span><span class="stat-value">${money(data.today.sales)}</span></div>
      <div class="stat-box"><span class="stat-label">Purchases Today</span><span class="stat-value">${money(data.today.purchases)}</span></div>
      <div class="stat-box"><span class="stat-label">Expenses Today</span><span class="stat-value">${money(data.today.expenses)}</span></div>
      <div class="stat-box"><span class="stat-label">Net Today</span><span class="stat-value" style="color:${data.today.net >= 0 ? "#28a745" : "#dc3545"}">${money(data.today.net)}</span></div>
      <div class="stat-box"><span class="stat-label">Invoices Today</span><span class="stat-value">${data.today.invoiceCount}</span></div>`;
    document.getElementById("dashMonthCards").innerHTML = `
      <div class="stat-box"><span class="stat-label">Sales (Month)</span><span class="stat-value">${money(data.month.sales)}</span></div>
      <div class="stat-box"><span class="stat-label">Purchases (Month)</span><span class="stat-value">${money(data.month.purchases)}</span></div>
      <div class="stat-box"><span class="stat-label">Expenses (Month)</span><span class="stat-value">${money(data.month.expenses)}</span></div>
      <div class="stat-box"><span class="stat-label">Profit (Month)</span><span class="stat-value" style="color:${data.month.profit >= 0 ? "#28a745" : "#dc3545"}">${money(data.month.profit)}</span></div>
      <div class="stat-box clickable" onclick="showOutstandingModal()"><span class="stat-label">Outstanding</span><span class="stat-value dues">${money(data.unpaidTotal)}</span><span style="font-size:0.7rem;color:#dc3545;">Click to view</span></div>`;
    document.getElementById("dashRecentSales").innerHTML = data.recentSales.length
      ? `<table class="result-table"><thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>${data.recentSales.map(r => `<tr><td>${esc(r.invoiceNumber)}</td><td>${esc(r.name)}</td><td>${r.date ? new Date(r.date).toLocaleDateString("en-IN") : ""}</td><td>${money(r.total)}</td><td>${statusBadge(r.paymentStatus, 0, r.total)}</td></tr>`).join("")}</tbody></table>`
      : "<p style='color:#888'>No sales today.</p>";
    document.getElementById("dashLowStock").innerHTML = data.lowStock.length
      ? `<table class="result-table"><thead><tr><th>Product</th><th>Stock</th><th>Alert at</th></tr></thead><tbody>${data.lowStock.map(i => `<tr><td>${esc(i.name)}</td><td style="color:#dc3545;font-weight:700">${i.stockQty}</td><td>${i.lowStockAlert}</td></tr>`).join("")}</tbody></table>`
      : "<p style='color:#28a745'>All stock levels are healthy! ✅</p>";
  }).catch(() => {});
}
