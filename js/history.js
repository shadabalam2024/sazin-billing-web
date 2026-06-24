// ── HISTORY TAB ──
const DOCTYPE_LABELS = { invoice: 'Invoice', proforma: 'Proforma', quote: 'Quotation', 'credit-note': 'Credit Note', 'debit-note': 'Debit Note' };
const DOCTYPE_COLORS = { invoice: '#0078d7', proforma: '#6f42c1', quote: '#fd7e14', 'credit-note': '#dc3545', 'debit-note': '#e67e22' };

function loadHistory() {
  apiFetch("/history").then(res => res.json()).then(records => {
    _historyData = records;
    filterHistory();
  }).catch(() => {});
}

function renderHistory(records) {
  const el = document.getElementById("historyList");
  if (!records.length) { el.innerHTML = "<p style='color:#888;padding:16px 0;'>No documents found.</p>"; return; }
  el.innerHTML = `<div style="overflow-x:auto;"><table class="result-table" style="table-layout:auto;">
    <thead><tr>
      <th style="min-width:80px;">Date</th>
      <th style="min-width:90px;">Doc #</th>
      <th style="min-width:80px;">Type</th>
      <th style="min-width:120px;text-align:left;">Client</th>
      <th style="min-width:90px;">Amount</th>
      <th style="min-width:80px;">Status</th>
      ${currentRole === "admin" ? '<th style="min-width:220px;">Actions</th>' : ""}
    </tr></thead>
    <tbody>${records.map(r => {
      const color = DOCTYPE_COLORS[r.docType] || '#333';
      const label = DOCTYPE_LABELS[r.docType] || r.docType;
      const ps = r.paymentStatus || 'unpaid';
      const isInvoice = r.docType === 'invoice' || !r.docType;
      const canEdit = isInvoice || r.docType === 'proforma';
      const badge = isInvoice
        ? `<span class="ledger-pay-badge ledger-pay-${ps}">${ps.charAt(0).toUpperCase() + ps.slice(1)}</span>`
        : '<span style="color:#aaa;font-size:0.78rem;">—</span>';
      const actions = currentRole === "admin"
        ? `<td class="inv-actions">
            <button class="btn blue small-btn" onclick="printFromHistory('${esc(r.invoiceNumber)}')">🖨</button>
            ${canEdit ? `<button class="btn blue small-btn" onclick="openEditModal('${esc(r.invoiceNumber)}')">✏️</button>` : ''}
            ${isInvoice && ps !== 'paid' ? `<button class="btn green small-btn" onclick="openInvoicePaymentModal('${esc(r.invoiceNumber)}')">💰</button>` : ''}
            ${isInvoice ? `<button class="btn small-btn" style="background:#e67e22;color:#fff;" onclick="openReturnExchangeModal('${esc(r.invoiceNumber)}')">↩</button>` : ''}
            <button class="btn red small-btn" onclick="deleteHistoryEntry('${esc(r.invoiceNumber)}','${esc(r.docType || 'invoice')}')">🗑</button>
           </td>`
        : '';
      return `<tr>
        <td style="white-space:nowrap;font-size:0.85rem;">${esc(r.dateStr)}</td>
        <td style="font-weight:600;font-size:0.85rem;white-space:nowrap;">${esc(r.invoiceNumber)}</td>
        <td><span style="background:${color}18;color:${color};padding:2px 8px;border-radius:10px;font-size:0.78rem;font-weight:600;white-space:nowrap;">${label}</span></td>
        <td style="text-align:left;">${esc(r.name)}<br><span style="font-size:0.78rem;color:#888;">${esc(r.mobile)}</span></td>
        <td style="font-weight:600;white-space:nowrap;">₹ ${Number(r.grandTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>${badge}</td>
        ${actions}
      </tr>`;
    }).join("")}
    </tbody></table></div>`;
}

function filterHistory() {
  const q = (document.getElementById("historySearch").value || "").toLowerCase();
  const type = document.getElementById("historyTypeFilter").value;
  const status = document.getElementById("historyStatusFilter").value;
  renderHistory(_historyData.filter(r => {
    if (type && r.docType !== type) return false;
    if (status && (r.paymentStatus || "unpaid") !== status) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.mobile.includes(q) && !r.invoiceNumber.toLowerCase().includes(q)) return false;
    return true;
  }));
}

function goToHistoryBill(invoiceNumber) {
  // Set search BEFORE switching tab so loadHistory → filterHistory sees it
  document.getElementById("historySearch").value = invoiceNumber;
  document.getElementById("historyTypeFilter").value = "";
  document.getElementById("historyStatusFilter").value = "";
  // Switch tab (calls loadHistory which calls filterHistory when done)
  const histBtn = document.querySelector('.tab-btn[onclick*="history"]');
  showTab("history", histBtn);
  // After render, scroll to and highlight the row
  setTimeout(() => {
    const rows = document.querySelectorAll("#historyList tbody tr");
    rows.forEach(row => {
      const docCell = row.cells[1];
      if (docCell && docCell.textContent.trim() === invoiceNumber) {
        row.style.transition = "background 0.4s";
        row.style.background = "#fff3cd";
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => { row.style.background = ""; }, 2500);
      }
    });
  }, 700);
}

function deleteHistoryEntry(invoiceNumber, docType) {
  const label = DOCTYPE_LABELS[docType] || docType;
  if (!confirm(`Delete ${label} ${invoiceNumber}? This cannot be undone.`)) return;
  apiFetch(`/delete/${encodeURIComponent(invoiceNumber)}`, { method: "DELETE" }).then(res => res.json()).then(r => {
    if (r.success) {
      showSuccess(`${label} ${invoiceNumber} deleted.`);
      loadHistory();
      refreshAffectedSections(docType);
    } else showError(r.message || "Delete failed.");
  });
}

// ── INVOICE PAYMENT LOG MODAL ──
let _invPayRecord = null;

function openInvoicePaymentModal(invoiceNumber) {
  const r = _historyData.find(r => r.invoiceNumber === invoiceNumber);
  if (!r) return showError("Invoice not found.");
  _invPayRecord = r;
  document.getElementById("invPayInvoiceNum").value = invoiceNumber;
  document.getElementById("invPayClient").textContent = `${r.name} — ${r.invoiceNumber}`;
  document.getElementById("invPayDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("invPayAmount").value = "";
  document.getElementById("invPayNote").value = "";
  _renderInvPayModal(r);
  document.getElementById("invoicePaymentModal").style.display = "flex";
  setTimeout(() => document.getElementById("invPayAmount").focus(), 50);
}

function _renderInvPayModal(r) {
  const total = parseFloat(r.grandTotal || 0);
  const amountPaid = typeof r.amountPaid === "number" ? r.amountPaid
    : (r.paymentStatus === "paid" ? total : 0);
  const remaining = Math.max(0, total - amountPaid);
  document.getElementById("invPaySummary").innerHTML =
    `<span>📋 Total: <strong>₹ ${total.toFixed(2)}</strong></span>
     <span>💰 Paid: <strong style="color:#28a745;">₹ ${amountPaid.toFixed(2)}</strong></span>
     ${remaining > 0 ? `<span>⏳ Remaining: <strong style="color:#e67e22;">₹ ${remaining.toFixed(2)}</strong></span>` : '<span style="color:#28a745;font-weight:600;">✅ Fully Paid</span>'}`;
  const payments = r.payments || [];
  if (!payments.length) {
    document.getElementById("invPayLog").innerHTML = `<p style="color:#aaa;font-size:0.85rem;margin-bottom:0;">No payment records yet.</p>`;
  } else {
    document.getElementById("invPayLog").innerHTML = `
      <div style="font-size:0.82rem;font-weight:600;color:#555;margin-bottom:6px;">Payment History</div>
      ${payments.map(p => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:0.85rem;flex-wrap:wrap;">
          <span style="color:#555;white-space:nowrap;">${new Date(p.date).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })}</span>
          <span style="font-weight:600;color:#0078d7;white-space:nowrap;">₹ ${parseFloat(p.amount || 0).toFixed(2)}</span>
          <span style="flex:1;color:#888;">${esc(p.note || "—")}</span>
          <button class="btn red small-btn" onclick="deleteInvoicePayment('${esc(r.invoiceNumber)}','${esc(p.id)}')" style="padding:2px 7px;font-size:0.75rem;">✕</button>
        </div>`).join("")}`;
  }
}

function closeInvoicePaymentModal() {
  document.getElementById("invoicePaymentModal").style.display = "none";
  _invPayRecord = null;
}

function _refreshAfterInvoicePayment(invoiceNumber) {
  apiFetch("/history").then(r => r.json()).then(records => {
    _historyData = records;
    _invPayRecord = records.find(r => r.invoiceNumber === invoiceNumber) || null;
    if (_invPayRecord && document.getElementById("invoicePaymentModal").style.display !== "none") {
      _renderInvPayModal(_invPayRecord);
    }
    renderHistory(_historyData);
    // Keep ledger and analytics in sync
    if (typeof loadLedger === "function" && _ledgerData) loadLedger();
    if (typeof loadAnalytics === "function") loadAnalytics();
    if (typeof loadDashboard === "function") loadDashboard();
  });
}

function submitInvoicePayment() {
  const invoiceNumber = document.getElementById("invPayInvoiceNum").value;
  const amount = parseFloat(document.getElementById("invPayAmount").value) || 0;
  if (!amount || amount <= 0) return showError("Enter a valid payment amount.");
  const note = document.getElementById("invPayNote").value.trim();
  const date = document.getElementById("invPayDate").value;
  apiFetch(`/invoices/${encodeURIComponent(invoiceNumber)}/payments`, { method: "POST", body: JSON.stringify({ amount, note, date }) })
    .then(r => r.json()).then(res => {
      if (res.success) {
        showSuccess("Payment recorded!");
        document.getElementById("invPayAmount").value = "";
        document.getElementById("invPayNote").value = "";
        _refreshAfterInvoicePayment(invoiceNumber);
      } else showError(res.message || "Failed to record payment.");
    });
}

function deleteInvoicePayment(invoiceNumber, paymentId) {
  if (!confirm("Remove this payment record?")) return;
  apiFetch(`/invoices/${encodeURIComponent(invoiceNumber)}/payments/${paymentId}`, { method: "DELETE" })
    .then(r => r.json()).then(res => {
      if (res.success) {
        showSuccess("Payment removed.");
        _refreshAfterInvoicePayment(invoiceNumber);
      } else showError("Failed to remove payment.");
    });
}

// ── RETURN / EXCHANGE ──
let _returnSourceRecord = null;

function openReturnExchangeModal(invoiceNumber) {
  apiFetch(`/record/${encodeURIComponent(invoiceNumber)}`).then(r => r.json()).then(data => {
    if (!data.success) return showError("Invoice not found.");
    _returnSourceRecord = data.record;
    document.getElementById("returnOriginalInv").textContent = invoiceNumber;
    document.getElementById("returnClientName").textContent = data.record.name;
    document.getElementById("returnNote").value = "";
    const lines = normalizeLines(data.record);
    document.getElementById("returnItemsList").innerHTML = lines.map((l, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f0f0f0;flex-wrap:wrap;">
        <input type="checkbox" class="return-item-check" data-idx="${i}" checked style="width:auto;margin:0;flex-shrink:0;">
        <span style="flex:2;min-width:130px;font-size:0.9rem;">${esc(l.description)}
          <span style="color:#888;font-size:0.78rem;display:block;">${esc(l.unit)} &nbsp;·&nbsp; Billed: ${l.billedQty.toFixed(2)}</span>
        </span>
        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;margin:0;font-size:0.88rem;">
          Return Qty<input type="number" class="return-qty" data-idx="${i}" value="${l.billedQty.toFixed(2)}" max="${l.billedQty.toFixed(2)}" min="0.01" step="0.01" style="width:80px;margin:0;">
        </label>
        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;margin:0;font-size:0.88rem;">
          Rate ₹<input type="number" class="return-rate" data-idx="${i}" value="${esc(String(l.rate || 0))}" min="0" style="width:80px;margin:0;">
        </label>
      </div>`).join("");
    document.getElementById("returnExchangeModal").style.display = "flex";
  });
}

function closeReturnExchangeModal() {
  document.getElementById("returnExchangeModal").style.display = "none";
  _returnSourceRecord = null;
}

function _buildReturnLines() {
  const lines = normalizeLines(_returnSourceRecord);
  const returnLines = [];
  document.querySelectorAll("#returnItemsList .return-item-check").forEach((cb, i) => {
    if (!cb.checked) return;
    const qty = parseFloat(document.querySelector(`.return-qty[data-idx="${i}"]`)?.value) || 0;
    const rate = parseFloat(document.querySelector(`.return-rate[data-idx="${i}"]`)?.value) || 0;
    if (qty <= 0) return;
    const l = lines[i];
    returnLines.push({
      description: l.description, hsn: l.hsn, unit: l.unit,
      length: l.length, width: l.width, count: qty, billedQty: qty,
      rate, discountPct: l.discountPct, gstRate: l.gstRate,
      area: "0", perimeter: "0"
    });
  });
  return returnLines;
}

function submitReturn() {
  const returnLines = _buildReturnLines();
  if (!returnLines.length) return showError("Select at least one item to return.");
  const r = _returnSourceRecord;
  const note = document.getElementById("returnNote").value.trim();
  const payload = {
    name: r.name, mobile: r.mobile, address: r.address,
    recipientGstin: r.recipientGstin || "",
    placeOfSupplyState: r.placeOfSupplyState || SETTINGS.stateName,
    placeOfSupplyStateCode: r.placeOfSupplyStateCode || SETTINGS.stateCode,
    docType: "credit-note",
    originalInvoice: r.invoiceNumber,
    lines: returnLines,
    paymentStatus: "paid",
    amountPaid: 0,
    notes: note || ""
  };
  apiFetch("/save", { method: "POST", body: JSON.stringify(payload) }).then(res => res.json()).then(result => {
    if (result.success) {
      showSuccess(`Credit Note ${result.invoiceNumber} created for return.`);
      closeReturnExchangeModal();
      loadHistory();
    } else showError(result.message || "Failed to create credit note.");
  });
}

function submitExchange() {
  const returnLines = _buildReturnLines();
  if (!returnLines.length) return showError("Select at least one item to return.");
  const r = _returnSourceRecord;
  const note = document.getElementById("returnNote").value.trim();
  const payload = {
    name: r.name, mobile: r.mobile, address: r.address,
    recipientGstin: r.recipientGstin || "",
    placeOfSupplyState: r.placeOfSupplyState || SETTINGS.stateName,
    placeOfSupplyStateCode: r.placeOfSupplyStateCode || SETTINGS.stateCode,
    docType: "credit-note",
    originalInvoice: r.invoiceNumber,
    lines: returnLines,
    paymentStatus: "paid",
    amountPaid: 0,
    notes: note ? `Exchange return: ${note}` : "Exchange return"
  };
  apiFetch("/save", { method: "POST", body: JSON.stringify(payload) }).then(res => res.json()).then(result => {
    if (result.success) {
      closeReturnExchangeModal();
      showSuccess(`Credit Note ${result.invoiceNumber} created. Billing form pre-filled for replacement items.`);
      loadHistory();
      // Pre-fill billing form for replacement and switch to billing tab
      document.getElementById("name").value = r.name;
      document.getElementById("mobile").value = r.mobile;
      document.getElementById("address").value = r.address;
      if (document.getElementById("recipientGstin")) document.getElementById("recipientGstin").value = r.recipientGstin || "";
      document.querySelectorAll("#measurements .r-desc[data-sugid]").forEach(inp => _removeSugBox(inp.dataset.sugid));
      document.querySelector("#measurements tbody").innerHTML = "";
      addRow();
      showTab("billing", document.querySelector('[data-perm="billing"]'));
    } else showError(result.message || "Failed to create credit note.");
  });
}
