// ── LEDGER ──
let _ledgerData = null;
let _ledgerPeriod = "month";
let _ledgerMonth = null;
let _ledgerYear = null;

function setLedgerPeriod(period, btn, opts) {
  opts = opts || {};
  _ledgerPeriod = period;
  if (opts.month) _ledgerMonth = opts.month;
  if (opts.year)  _ledgerYear  = String(opts.year);
  if (btn) {
    document.querySelectorAll(".ledger-period-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const now = new Date();
    if (period === "month" && !opts.month) {
      const m = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
      document.getElementById("ledgerCustomMonth").value = m;
      _ledgerMonth = m;
    }
    if (period === "year" && !opts.year) {
      const y = String(now.getFullYear());
      document.getElementById("ledgerCustomYear").value = y;
      _ledgerYear = y;
    }
  }
  loadLedger();
}

function loadLedger() {
  if (currentRole !== "admin") return;
  const params = new URLSearchParams({ period: _ledgerPeriod });
  if (_ledgerPeriod === "month" && _ledgerMonth) params.set("month", _ledgerMonth);
  if (_ledgerPeriod === "year"  && _ledgerYear)  params.set("year",  _ledgerYear);
  apiFetch("/ledger?" + params.toString()).then(r => r.json()).then(data => {
    if (!data.success) { showError(data.message || "Failed to load ledger"); return; }
    _ledgerData = data;
    _ledgerShowOutstanding = false;
    _ledgerShowPayable = false;
    renderLedgerSummary(data.summary);
    applyLedgerFilter();
  }).catch(err => showError("Ledger failed: " + err.message));
}

function renderLedgerSummary(s) {
  const netColor = s.netBalance >= 0 ? "#0a7c3e" : "#dc3545";
  const cashNet = s.totalCollected - s.totalPurchases - s.totalExpenses;
  const cashColor = cashNet >= 0 ? "#0a7c3e" : "#dc3545";
  document.getElementById("ledgerSummary").innerHTML = `
    <div class="ledger-stat">
      <span class="ledger-stat-label">Total Invoiced</span>
      <span class="ledger-stat-value" style="color:#0057b8;">${money(s.totalInvoiced)}</span>
    </div>
    <div class="ledger-stat">
      <span class="ledger-stat-label">Collected</span>
      <span class="ledger-stat-value credit-val">${money(s.totalCollected)}</span>
    </div>
    <div class="ledger-stat${s.totalOutstanding > 0 ? ' ledger-stat-clickable' : ''}" ${s.totalOutstanding > 0 ? 'onclick="showOutstandingBills()" title="Click to view outstanding bills"' : ''} id="ledgerOutstandingStat">
      <span class="ledger-stat-label">Outstanding</span>
      <span class="ledger-stat-value" style="color:${s.totalOutstanding > 0 ? '#e67e22' : '#28a745'};">${money(s.totalOutstanding)}</span>
      ${s.totalOutstanding > 0 ? `<span style="font-size:0.72rem;color:#e67e22;display:block;">Click to view bills ›</span>` : ""}
    </div>
    <div class="ledger-stat">
      <span class="ledger-stat-label">Purchases</span>
      <span class="ledger-stat-value debit-val">${money(s.totalPurchases)}</span>
    </div>
    <div class="ledger-stat${s.totalPayable > 0 ? ' ledger-stat-clickable ledger-stat-payable' : ''}" ${s.totalPayable > 0 ? 'onclick="showPayableBills()" title="Click to view pending purchase payments"' : ''} id="ledgerPayableStat">
      <span class="ledger-stat-label">Payable</span>
      <span class="ledger-stat-value" style="color:${s.totalPayable > 0 ? '#b91c1c' : '#28a745'};">${money(s.totalPayable || 0)}</span>
      ${s.totalPayable > 0 ? `<span style="font-size:0.72rem;color:#b91c1c;display:block;">Click to view bills ›</span>` : ""}
    </div>
    <div class="ledger-stat">
      <span class="ledger-stat-label">Expenses</span>
      <span class="ledger-stat-value debit-val">${money(s.totalExpenses)}</span>
    </div>
    <div class="ledger-stat">
      <span class="ledger-stat-label">Cash in Hand</span>
      <span class="ledger-stat-value" style="color:${cashColor};font-size:1rem;">${money(cashNet)}</span>
      <span style="font-size:0.72rem;color:#888;display:block;">Collected − Costs</span>
    </div>
    <div class="ledger-stat ledger-stat-net">
      <span class="ledger-stat-label">Net Balance</span>
      <span class="ledger-stat-value" style="color:${netColor};font-size:1.15rem;">${money(s.netBalance)}</span>
      <span style="font-size:0.72rem;color:#888;display:block;">Incl. outstanding receivables</span>
    </div>`;
}

let _ledgerShowOutstanding = false;
let _ledgerShowPayable = false;

function applyLedgerFilter() {
  if (!_ledgerData) return;
  const filter = document.getElementById("ledgerTypeFilter").value;
  let rows = filter ? _ledgerData.rows.filter(r => r.type === filter) : _ledgerData.rows;
  if (_ledgerShowOutstanding) {
    rows = rows.filter(r => (r.docType === 'invoice' || r.docType === 'proforma') && r.outstanding > 0);
  } else if (_ledgerShowPayable) {
    rows = rows.filter(r => r.docType === 'purchase' && r.outstanding > 0);
  }
  document.getElementById("ledgerRowCount").textContent = rows.length + " transaction" + (rows.length !== 1 ? "s" : "");
  renderLedgerTable(rows);
}

function showOutstandingBills() {
  if (!_ledgerData) return;
  _ledgerShowOutstanding = !_ledgerShowOutstanding;
  _ledgerShowPayable = false;
  _updateStatHighlight("ledgerOutstandingStat", _ledgerShowOutstanding, "#e67e22", "Outstanding");
  _updateStatHighlight("ledgerPayableStat", false, "#b91c1c", "Payable");
  applyLedgerFilter();
  if (_ledgerShowOutstanding) document.getElementById("ledgerTableWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showPayableBills() {
  if (!_ledgerData) return;
  _ledgerShowPayable = !_ledgerShowPayable;
  _ledgerShowOutstanding = false;
  _updateStatHighlight("ledgerPayableStat", _ledgerShowPayable, "#b91c1c", "Payable");
  _updateStatHighlight("ledgerOutstandingStat", false, "#e67e22", "Outstanding");
  applyLedgerFilter();
  if (_ledgerShowPayable) document.getElementById("ledgerTableWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

function _updateStatHighlight(id, active, color, baseLabel) {
  const stat = document.getElementById(id);
  if (!stat) return;
  stat.style.outline = active ? `2px solid ${color}` : "";
  const label = stat.querySelector(".ledger-stat-label");
  if (label) label.textContent = active ? `${baseLabel} ✕` : baseLabel;
}

const LEDGER_TYPE_STYLE = {
  "Sale":        { bg: "#e8f5e9", color: "#155724", icon: "💰" },
  "Proforma":    { bg: "#e8f0fe", color: "#0057b8", icon: "📄" },
  "Credit Note": { bg: "#fce4ec", color: "#880e4f", icon: "🔴" },
  "Debit Note":  { bg: "#fff8e1", color: "#e65100", icon: "🟡" },
  "Purchase":    { bg: "#fce8e8", color: "#7f1d1d", icon: "🛒" },
  "Expense":     { bg: "#f3e5f5", color: "#4a148c", icon: "💸" }
};

function renderLedgerTable(rows) {
  const wrap = document.getElementById("ledgerTableWrap");
  if (!rows.length) {
    wrap.innerHTML = `<div class="ledger-empty">No transactions found for this period.</div>`;
    return;
  }
  const thead = `<tr>
    <th style="width:88px">Date</th>
    <th style="width:105px">Type</th>
    <th style="width:120px">Reference</th>
    <th>Party / Description</th>
    <th class="r" style="width:148px">Debit (₹)</th>
    <th class="r" style="width:148px">Credit (₹)</th>
    <th class="r" style="width:110px">Balance (₹)</th>
  </tr>`;
  const tbody = [...rows].reverse().map(r => {
    const st = LEDGER_TYPE_STYLE[r.type] || { bg: "#f5f5f5", color: "#333", icon: "•" };
    const dateStr = r.date ? new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
    const balColor = r.balance >= 0 ? "#0a7c3e" : "#dc3545";
    const shortDesc = r.description ? esc(r.description.slice(0,55)) + (r.description.length>55?"…":"") : "";
    const partyDesc = shortDesc
      ? `${esc(r.party)}<br><small style="color:#999">${shortDesc}</small>`
      : esc(r.party);

    const isInvoiceType = r.type === "Sale" || r.type === "Proforma";
    const isPurchase    = r.type === "Purchase";

    // Build credit cell
    let creditCell;
    if (isInvoiceType) {
      const collected = r.amountCollected || 0;
      const outstanding = r.outstanding || 0;
      if (r.paymentStatus === "paid") {
        creditCell = `<td class="ledger-credit">${money(r.credit)}</td>`;
      } else if (r.paymentStatus === "partial") {
        creditCell = `<td class="ledger-credit">
          ${money(r.credit)}
          <br><small style="color:#28a745;">✓ Collected: ${money(collected)}</small>
          <br><small style="color:#e67e22;font-weight:600;">⏳ Outstanding: ${money(outstanding)}</small>
        </td>`;
      } else {
        creditCell = `<td class="ledger-credit">
          ${money(r.credit)}
          <br><small style="color:#e67e22;font-weight:600;">⏳ Outstanding: ${money(outstanding)}</small>
        </td>`;
      }
    } else {
      creditCell = r.credit ? `<td class="ledger-credit">${money(r.credit)}</td>` : `<td class="ledger-nil">—</td>`;
    }

    // Build debit cell
    let debitCell;
    if (isPurchase) {
      const paid = r.amountPaid || 0;
      const payable = r.outstanding || 0;
      if (r.paymentStatus === "paid") {
        debitCell = `<td class="ledger-debit">${money(r.debit)}</td>`;
      } else if (r.paymentStatus === "partial") {
        debitCell = `<td class="ledger-debit">
          ${money(r.debit)}
          <br><small style="color:#28a745;">✓ Paid: ${money(paid)}</small>
          <br><small style="color:#b91c1c;font-weight:600;">⏳ Payable: ${money(payable)}</small>
        </td>`;
      } else {
        debitCell = `<td class="ledger-debit">
          ${money(r.debit)}
          <br><small style="color:#b91c1c;font-weight:600;">⏳ Payable: ${money(payable)}</small>
        </td>`;
      }
    } else {
      debitCell = r.debit ? `<td class="ledger-debit">${money(r.debit)}</td>` : `<td class="ledger-nil">—</td>`;
    }

    // Build reference cell — badge + installment log for invoices and purchases
    const showBadge = isInvoiceType || isPurchase;
    const payBadge = showBadge
      ? `<span class="ledger-pay-badge ledger-pay-${r.paymentStatus}">${r.paymentStatus}</span>` : "";

    const pmts = r.payments || [];
    const paymentLog = showBadge && pmts.length > 0
      ? `<div style="margin-top:4px;font-size:0.75rem;color:#666;border-top:1px solid #f0f0f0;padding-top:3px;">
          ${pmts.map(p => {
            const pDate = p.date ? new Date(p.date).toLocaleDateString("en-IN", { day:"2-digit", month:"short" }) : "—";
            return `<div style="display:flex;justify-content:space-between;gap:8px;padding:1px 0;">
              <span style="color:#999;white-space:nowrap;">${pDate}</span>
              <span style="color:${isPurchase ? '#b91c1c' : '#0078d7'};font-weight:600;white-space:nowrap;">${money(p.amount)}</span>
            </div>`;
          }).join("")}
        </div>` : "";

    return `<tr class="ledger-row">
      <td class="ledger-date">${dateStr}</td>
      <td><span class="ledger-type-chip" style="background:${st.bg};color:${st.color}">${st.icon} ${r.type}</span></td>
      <td class="ledger-ref">${esc(r.reference)}<br>${payBadge}${paymentLog}</td>
      <td class="ledger-party">${partyDesc}</td>
      ${debitCell}
      ${creditCell}
      <td class="ledger-balance" style="color:${balColor}">${money(r.balance)}</td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `<table class="ledger-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

function exportLedgerCSV() {
  if (!_ledgerData || !_ledgerData.rows.length) { showError("Load the ledger first."); return; }
  const filter = document.getElementById("ledgerTypeFilter").value;
  const rows = filter ? _ledgerData.rows.filter(r => r.type === filter) : _ledgerData.rows;
  const c = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  let csv = ["Date","Type","Reference","Party","Description","Invoiced (Credit)","Collected","Debit","Outstanding","Balance","Payment Status"].map(c).join(",") + "\n";
  rows.forEach(r => {
    csv += [
      r.date ? new Date(r.date).toLocaleDateString("en-IN") : "",
      r.type, r.reference, r.party, r.description,
      r.credit || "", r.amountCollected || "", r.debit || "", r.outstanding || "", r.balance, r.paymentStatus || ""
    ].map(c).join(",") + "\n";
  });
  const period = _ledgerPeriod === "month" ? (_ledgerMonth || "month") : _ledgerPeriod === "year" ? (_ledgerYear || "year") : "all";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `Ledger_${period}.csv`;
  a.click();
  showSuccess("Ledger exported!");
}
