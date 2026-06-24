// ── DASHBOARD ──
let _dashMonthChart = null;
let _dashTodayChart = null;

function loadDashboard() {
  if (currentRole !== "admin") return;
  apiFetch("/dashboard").then(r => r.json()).then(data => {
    document.getElementById("dashTodayCards").innerHTML = `
      <div class="stat-box"><span class="stat-label">Sales Today</span><span class="stat-value">${money(data.today.sales)}</span></div>
      <div class="stat-box"><span class="stat-label">Purchases Today</span><span class="stat-value">${money(data.today.purchases)}</span></div>
      <div class="stat-box"><span class="stat-label">Expenses Today</span><span class="stat-value">${money(data.today.expenses)}</span></div>
      <div class="stat-box"><span class="stat-label">Net Today</span><span class="stat-value" style="color:${data.today.net >= 0 ? "#16a34a" : "#dc2626"}">${money(data.today.net)}</span></div>
      <div class="stat-box"><span class="stat-label">Invoices Today</span><span class="stat-value">${data.today.invoiceCount}</span></div>`;
    document.getElementById("dashMonthCards").innerHTML = `
      <div class="stat-box"><span class="stat-label">Sales (Month)</span><span class="stat-value">${money(data.month.sales)}</span></div>
      <div class="stat-box"><span class="stat-label">Purchases (Month)</span><span class="stat-value">${money(data.month.purchases)}</span></div>
      <div class="stat-box"><span class="stat-label">Expenses (Month)</span><span class="stat-value">${money(data.month.expenses)}</span></div>
      <div class="stat-box"><span class="stat-label">Profit (Month)</span><span class="stat-value" style="color:${data.month.profit >= 0 ? "#16a34a" : "#dc2626"}">${money(data.month.profit)}</span></div>
      <div class="stat-box clickable" onclick="showOutstandingModal()"><span class="stat-label">Outstanding</span><span class="stat-value dues">${money(data.unpaidTotal)}</span><span style="font-size:0.7rem;color:#dc2626;">Click to view</span></div>`;
    document.getElementById("dashRecentSales").innerHTML = data.recentSales.length
      ? `<table class="result-table"><thead><tr><th>Invoice</th><th>Client</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>${data.recentSales.map(r => `<tr><td>${esc(r.invoiceNumber)}</td><td>${esc(r.name)}</td><td>${r.date ? new Date(r.date).toLocaleDateString("en-IN") : ""}</td><td>${money(r.total)}</td><td>${statusBadge(r.paymentStatus, 0, r.total)}</td></tr>`).join("")}</tbody></table>`
      : "<p style='color:#888'>No sales today.</p>";
    document.getElementById("dashLowStock").innerHTML = data.lowStock.length
      ? `<table class="result-table"><thead><tr><th>Product</th><th>Stock</th><th>Alert at</th></tr></thead><tbody>${data.lowStock.map(i => `<tr><td>${esc(i.name)}</td><td style="color:#dc2626;font-weight:700">${i.stockQty}</td><td>${i.lowStockAlert}</td></tr>`).join("")}</tbody></table>`
      : "<p style='color:#16a34a'>All stock levels are healthy! ✅</p>";
    _renderDashCharts(data);
  }).catch(() => {});
}

function _chartDefaults() {
  Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#64748b";
}

function _renderDashCharts(data) {
  _chartDefaults();
  const profit = data.month.profit || 0;

  // Month at a Glance — bar chart
  const mCtx = document.getElementById("dashMonthChart");
  if (mCtx) {
    if (_dashMonthChart) { _dashMonthChart.destroy(); _dashMonthChart = null; }
    _dashMonthChart = new Chart(mCtx, {
      type: "bar",
      data: {
        labels: ["Sales", "Purchases", "Expenses", profit >= 0 ? "Net Profit" : "Net Loss"],
        datasets: [{
          data: [data.month.sales, data.month.purchases, data.month.expenses, Math.abs(profit)],
          backgroundColor: ["rgba(0,120,215,0.82)", "rgba(220,38,38,0.78)", "rgba(234,88,12,0.78)", profit >= 0 ? "rgba(22,163,74,0.82)" : "rgba(185,28,28,0.82)"],
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 52,
        }]
      },
      options: {
        responsive: true,
        aspectRatio: 2.8,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => " ₹" + c.parsed.y.toLocaleString("en-IN", { minimumFractionDigits: 2 }) } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.04)" }, border: { display: false }, ticks: { callback: v => "₹" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v), maxTicksLimit: 5 } },
          x: { grid: { display: false }, border: { display: false } }
        }
      }
    });
  }

  // Today's Snapshot — doughnut
  const tCtx = document.getElementById("dashTodayChart");
  if (tCtx) {
    if (_dashTodayChart) { _dashTodayChart.destroy(); _dashTodayChart = null; }
    const tSales = data.today.sales || 0;
    const tPurch = data.today.purchases || 0;
    const tExp   = data.today.expenses || 0;
    const hasData = tSales + tPurch + tExp > 0;
    _dashTodayChart = new Chart(tCtx, {
      type: "doughnut",
      data: {
        labels: ["Sales", "Purchases", "Expenses"],
        datasets: [{
          data: hasData ? [tSales, tPurch, tExp] : [1, 1, 1],
          backgroundColor: hasData
            ? ["rgba(0,120,215,0.85)", "rgba(220,38,38,0.78)", "rgba(234,88,12,0.78)"]
            : ["#e2e8f0", "#e2e8f0", "#e2e8f0"],
          borderWidth: 0,
          hoverOffset: 4,
        }]
      },
      options: {
        responsive: true,
        aspectRatio: 2.2,
        cutout: "68%",
        plugins: {
          legend: { position: "right", labels: { padding: 14, boxWidth: 10, boxHeight: 10, font: { size: 12 } } },
          tooltip: hasData
            ? { callbacks: { label: c => " ₹" + c.parsed.toLocaleString("en-IN", { minimumFractionDigits: 2 }) } }
            : { enabled: false }
        }
      }
    });
  }
}
