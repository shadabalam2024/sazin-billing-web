// ── ANALYTICS ──
function loadAnalytics() {
  if (currentRole !== "admin") return;
  apiFetch("/analytics").then(res => res.json()).then(data => {
    document.getElementById("dailyReport").innerHTML = `
      <div class="stat-box"><span class="stat-label">Date</span><span class="stat-value">${esc(data.daily.date)}</span></div>
      <div class="stat-box"><span class="stat-label">Invoices Today</span><span class="stat-value">${data.daily.invoiceCount}</span></div>
      <div class="stat-box"><span class="stat-label">Revenue Today</span><span class="stat-value">${money(data.daily.total)}</span></div>
      <div class="stat-box clickable" onclick="showOutstandingModal()"><span class="stat-label">Outstanding Dues</span><span class="stat-value dues">${money(data.unpaidTotal)}</span><span style="font-size:0.7rem;color:#dc3545;">Click to view</span></div>`;
    const years = Object.keys(data.yearly).sort((a, b) => b - a);
    document.getElementById("yearlyReport").innerHTML = `<table class="result-table"><thead><tr><th>Year</th><th>Revenue</th><th>Outstanding</th></tr></thead><tbody>${years.map(y => `<tr><td>${y}</td><td>${money(data.yearly[y])}</td><td><a href="#" class="client-link" onclick="showOutstandingForPeriod('year','${y}')">${money(data.yearlyOutstanding[y]||0)}</a></td></tr>`).join("")}</tbody></table>`;
    const months = Object.keys(data.monthly).sort((a, b) => b.localeCompare(a)).slice(0, 12);
    document.getElementById("monthlyReport").innerHTML = `<table class="result-table"><thead><tr><th>Month</th><th>Revenue</th><th>Outstanding</th></tr></thead><tbody>${months.map(m => { const [yr, mo] = m.split("-"); const label = new Date(yr, mo - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }); return `<tr><td>${label}</td><td>${money(data.monthly[m])}</td><td><a href="#" class="client-link" onclick="showOutstandingForPeriod('month','${m}')">${money(data.monthlyOutstanding[m]||0)}</a></td></tr>`; }).join("")}</tbody></table>`;
    document.getElementById("topClientsReport").innerHTML = `<table class="result-table"><thead><tr><th>Rank</th><th>Name</th><th>Mobile</th><th>Invoices</th><th>Total Revenue</th></tr></thead><tbody>${data.topClients.map((c, i) => `<tr><td>${i + 1}</td><td><a href="#" onclick="openClientFromAnalytics('${esc(c.mobile)}')" class="client-link">${esc(c.name)}</a></td><td>${esc(c.mobile)}</td><td>${c.invoiceCount}</td><td>${money(c.total)}</td></tr>`).join("")}</tbody></table>`;
  });
  loadProfitability();
}

function openClientFromAnalytics(mobile) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
  document.getElementById("tab-clients").classList.add("active");
  document.getElementById("clientSearchMobile").value = mobile;
  loadClientProfile();
}

// ── GST RETURN REPORT ──
let _lastGSTReport = null;
function loadGSTReport() {
  if (currentRole !== "admin") return;
  const month = document.getElementById("gstReportMonth").value;
  const url = month ? `/gst-report?month=${month}` : "/gst-report";
  apiFetch(url).then(res => res.json()).then(data => {
    if (!data.success) { showError(data.message || "Failed to load GST report"); return; }
    _lastGSTReport = data;
    const el = document.getElementById("gstReportContent");
    const period = month ? new Date(month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "All Time";
    let html = `<div class="gst-report-summary">
      <div class="stat-box"><span class="stat-label">Period</span><span class="stat-value" style="font-size:1rem;">${period}</span></div>
      <div class="stat-box"><span class="stat-label">Total Invoices</span><span class="stat-value">${data.totalInvoices}</span></div>
      <div class="stat-box"><span class="stat-label">Total Taxable</span><span class="stat-value" style="font-size:1rem;">${money(data.totals.taxable)}</span></div>
      <div class="stat-box"><span class="stat-label">Total Tax</span><span class="stat-value" style="font-size:1rem;">${money(data.totals.totalTax)}</span></div>
    </div>`;
    html += `<h4 style="margin:16px 0 8px;color:#0078d7;">Rate-wise Tax Summary (GSTR-3B)</h4>
      <table class="result-table"><thead><tr><th>GST Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total Tax</th></tr></thead><tbody>
      ${data.rateSummary.map(s => `<tr><td>${s.gstRate}%</td><td>${money(s.taxable)}</td><td>${money(s.cgst)}</td><td>${money(s.sgst)}</td><td>${money(s.igst)}</td><td>${money(s.totalTax)}</td></tr>`).join("")}
      <tr style="font-weight:700;background:#f0f7ff;"><td>Total</td><td>${money(data.totals.taxable)}</td><td>${money(data.totals.cgst)}</td><td>${money(data.totals.sgst)}</td><td>${money(data.totals.igst)}</td><td>${money(data.totals.totalTax)}</td></tr>
      </tbody></table>`;
    if (data.b2b.length) {
      html += `<h4 style="margin:16px 0 8px;color:#0078d7;">B2B Sales (GSTR-1 Table 4 — ${data.b2b.length} invoices)</h4>
        <div style="overflow-x:auto;"><table class="result-table"><thead><tr><th>Invoice</th><th>Date</th><th>Party</th><th>GSTIN</th><th>Place</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead><tbody>
        ${data.b2b.map(r => `<tr><td>${esc(r.invoiceNumber)}</td><td>${r.date ? new Date(r.date).toLocaleDateString("en-IN") : ""}</td><td>${esc(r.name)}</td><td>${esc(r.gstin)}</td><td>${esc(r.placeOfSupply)}</td><td>${money(r.taxable)}</td><td>${money(r.cgst)}</td><td>${money(r.sgst)}</td><td>${money(r.igst)}</td><td>${money(r.grandTotal)}</td></tr>`).join("")}
        </tbody></table></div>`;
    }
    if (data.b2c.length) {
      html += `<h4 style="margin:16px 0 8px;color:#0078d7;">B2C Sales (GSTR-1 Table 5 — ${data.b2c.length} invoices)</h4>
        <div style="overflow-x:auto;"><table class="result-table"><thead><tr><th>Invoice</th><th>Date</th><th>Party</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead><tbody>
        ${data.b2c.map(r => `<tr><td>${esc(r.invoiceNumber)}</td><td>${r.date ? new Date(r.date).toLocaleDateString("en-IN") : ""}</td><td>${esc(r.name)}</td><td>${money(r.taxable)}</td><td>${money(r.cgst)}</td><td>${money(r.sgst)}</td><td>${money(r.igst)}</td><td>${money(r.grandTotal)}</td></tr>`).join("")}
        </tbody></table></div>`;
    }
    el.innerHTML = html;
  }).catch(err => showError("GST report failed: " + err.message));
}

function exportGSTReportCSV() {
  if (!_lastGSTReport) { showError("Generate a GST report first."); return; }
  const d = _lastGSTReport;
  const c = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  let csv = "GSTR-1 / GSTR-3B Summary Export\n\n";
  csv += "Rate-wise Summary\n";
  csv += ["GST Rate","Taxable Value","CGST","SGST","IGST","Total Tax"].map(c).join(",") + "\n";
  d.rateSummary.forEach(s => { csv += [s.gstRate + "%", s.taxable, s.cgst, s.sgst, s.igst, s.totalTax].map(c).join(",") + "\n"; });
  csv += ["Total", d.totals.taxable, d.totals.cgst, d.totals.sgst, d.totals.igst, d.totals.totalTax].map(c).join(",") + "\n\n";
  if (d.b2b.length) {
    csv += "B2B Sales\n";
    csv += ["Invoice No","Date","Party Name","GSTIN","Place of Supply","Taxable","CGST","SGST","IGST","Grand Total"].map(c).join(",") + "\n";
    d.b2b.forEach(r => { csv += [r.invoiceNumber, r.date ? new Date(r.date).toLocaleDateString("en-IN") : "", r.name, r.gstin, r.placeOfSupply, r.taxable, r.cgst, r.sgst, r.igst, r.grandTotal].map(c).join(",") + "\n"; });
    csv += "\n";
  }
  if (d.b2c.length) {
    csv += "B2C Sales\n";
    csv += ["Invoice No","Date","Party Name","Taxable","CGST","SGST","IGST","Grand Total"].map(c).join(",") + "\n";
    d.b2c.forEach(r => { csv += [r.invoiceNumber, r.date ? new Date(r.date).toLocaleDateString("en-IN") : "", r.name, r.taxable, r.cgst, r.sgst, r.igst, r.grandTotal].map(c).join(",") + "\n"; });
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `GSTReport_${d.month}.csv`;
  a.click();
}

// ── ITEM-WISE PROFITABILITY ──
function loadProfitability() {
  if (currentRole !== "admin") return;
  apiFetch("/profitability").then(res => res.json()).then(data => {
    const el = document.getElementById("profitabilityReport");
    if (!data.success || !data.items.length) { el.innerHTML = "<p style='color:#888'>No invoice data to analyse yet.</p>"; return; }
    el.innerHTML = `<p style="color:#666;font-size:0.82rem;margin-bottom:10px;">Cost prices pulled from Catalog & Inventory. Items without a known cost show revenue only.</p>
      <div style="overflow-x:auto;"><table class="result-table"><thead><tr>
        <th>Item Description</th><th>Total Qty</th><th>Revenue</th><th>Est. Cost</th><th>Est. Profit</th><th>Margin %</th>
      </tr></thead><tbody>
      ${data.items.map(i => {
        const margin = i.margin != null ? i.margin.toFixed(1) + "%" : "—";
        const marginColor = i.margin == null ? "#aaa" : i.margin >= 30 ? "#28a745" : i.margin >= 10 ? "#fd7e14" : "#dc3545";
        const profit = i.profit != null ? money(i.profit) : "—";
        return `<tr>
          <td style="text-align:left;">${esc(i.description)}</td>
          <td>${i.qty.toFixed(2)}</td>
          <td>${money(i.revenue)}</td>
          <td>${i.costKnown ? money(i.cost) : "—"}</td>
          <td>${profit}</td>
          <td style="font-weight:700;color:${marginColor}">${margin}</td>
        </tr>`;
      }).join("")}
      </tbody></table></div>`;
  }).catch(() => {});
}

// ── TALLY EXPORT ──
function exportTally() {
  const month = document.getElementById("gstReportMonth") ? document.getElementById("gstReportMonth").value : "";
  const url = month ? `/tally-export?month=${month}` : "/tally-export";
  apiFetch(url).then(res => res.blob()).then(blob => {
    const month2 = (document.getElementById("gstReportMonth") || {}).value || "all";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `TallyExport_${month2}.csv`;
    a.click();
    showSuccess("Tally export downloaded!");
  }).catch(() => showError("Tally export failed."));
}

// ── OUTSTANDING MODAL ──
function showOutstandingModal() { apiFetch("/outstanding").then(res => res.json()).then(records => renderOutstandingModal(records, "All Outstanding Dues")); }
function showOutstandingForPeriod(type, value) {
  apiFetch("/outstanding").then(res => res.json()).then(records => {
    let filtered, label;
    if (type === "year") { filtered = records.filter(r => r.date && new Date(r.date).getFullYear().toString() === value); label = `Outstanding — ${value}`; }
    else { const [yr, mo] = value.split("-"); filtered = records.filter(r => { if (!r.date) return false; const d = new Date(r.date); return d.getFullYear().toString() === yr && String(d.getMonth() + 1).padStart(2, "0") === mo; }); label = `Outstanding — ${new Date(yr, mo - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`; }
    renderOutstandingModal(filtered, label);
  });
}
function renderOutstandingModal(records, title) {
  const totalDue = records.reduce((s, r) => s + r.remaining, 0);
  document.getElementById("outstandingTitle").textContent = title;
  document.getElementById("outstandingBody").innerHTML = records.length === 0
    ? "<p style='padding:16px;color:#888'>No outstanding dues! 🎉</p>"
    : `<div style="margin-bottom:12px;font-weight:700;color:#dc3545;">Total Due: ₹ ${totalDue.toFixed(2)}</div>`
    + records.map(r => `<div class="outstanding-row">
        <div class="outstanding-info">
          <strong>${esc(r.invoiceNumber)}</strong> — ${esc(r.name)} (${esc(r.mobile)})
          <span class="bill-date" style="margin-left:8px">${r.date ? new Date(r.date).toLocaleDateString("en-IN") : ""}</span>
        </div>
        <div class="outstanding-amounts">
          <span>Total: ₹ ${r.grandTotal.toFixed(2)}</span>
          <span class="badge-paid" style="padding:2px 8px;border-radius:8px;background:#d4edda;">Paid: ₹ ${r.amountPaid.toFixed(2)}</span>
          <span class="badge-unpaid" style="padding:2px 8px;border-radius:8px;background:#f8d7da;">Due: ₹ ${r.remaining.toFixed(2)}</span>
          <button class="btn green small-btn" style="margin:0;" onclick='sendWhatsAppReminder(${JSON.stringify({name:r.name,mobile:r.mobile,invoiceNumber:r.invoiceNumber,grandTotal:r.grandTotal,amountPaid:r.amountPaid,remaining:r.remaining})})'>💬 Remind</button>
        </div>
      </div>`).join("");
  document.getElementById("outstandingModal").style.display = "flex";
}
function closeOutstandingModal() { document.getElementById("outstandingModal").style.display = "none"; }
function sendWhatsAppReminder(r) {
  const co = SETTINGS.name || "us";
  let msg = `Dear ${r.name},\n\nThis is a friendly reminder from ${co}.\n\nInvoice: ${r.invoiceNumber}\nTotal Amount: ₹ ${Number(r.grandTotal).toLocaleString("en-IN", {minimumFractionDigits:2})}`;
  if (r.amountPaid > 0) msg += `\nAmount Paid: ₹ ${Number(r.amountPaid).toFixed(2)}`;
  msg += `\nBalance Due: ₹ ${Number(r.remaining).toFixed(2)}\n\nKindly clear the outstanding at your earliest convenience.\n\nRegards,\n${co}`;
  openWhatsApp(r.mobile, msg);
}

// ── EXPORT EXCEL (CSV) ──
function csvCell(v) {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
function exportToExcel() {
  apiFetch("/history").then(res => res.json()).then(data => {
    if (!data.length) return showError("No records to export!");
    let csv = ["Invoice No","Doc Type","Date","Payment Status","Amount Paid","Client Name","Mobile","Address","Place of Supply","Description","HSN","Unit","Billed Qty","Rate","Disc%","GST%","Taxable"].map(csvCell).join(",") + "\n";
    data.forEach(record => {
      const date = record.date ? new Date(record.date).toLocaleDateString("en-IN") : "";
      const base = [record.invoiceNumber, record.docType || "invoice", date, record.paymentStatus || "unpaid", record.amountPaid || 0, record.name, record.mobile, record.address, record.placeOfSupplyState || ""];
      const lines = normalizeLines(record);
      if (!lines.length) csv += base.map(csvCell).join(",") + ",,,,,,,\n";
      else lines.forEach((l, i) => {
        const lead = i === 0 ? base : ["","","","","","","","",""];
        csv += [...lead, l.description, l.hsn, l.unit, l.billedQty.toFixed(2), l.rate, l.discountPct, l.gstRate, (l.billedQty*l.rate*(1-l.discountPct/100)).toFixed(2)].map(csvCell).join(",") + "\n";
      });
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = `${(SETTINGS.invoicePrefix||"EXPORT")}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });
}
