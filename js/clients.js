// ── HISTORY / SEARCH ──
function reloadClientList() { apiFetch("/history").then(res => res.json()).then(renderClients); }
function searchByMobile() {
  const m = document.getElementById("searchMobile").value.trim();
  if (!m) return showError("Enter a mobile number to search!");
  apiFetch(`/search/${m}`).then(res => res.json()).then(renderClients);
}
function searchByInvoice() {
  const i = document.getElementById("searchInvoice").value.trim();
  if (!i) return showError("Enter an invoice number to search!");
  apiFetch(`/search-invoice/${encodeURIComponent(i)}`).then(res => res.json()).then(renderClients);
}
function filterByYear() {
  const year = document.getElementById("filterYear").value;
  if (!year) return showError("Please enter a year!");
  apiFetch("/history").then(res => res.json()).then(data => renderClients(data.filter(c => c.date && new Date(c.date).getFullYear() == year)));
}

// ── CLIENT-SIDE TOTALS (display only) ──
function normalizeLines(record) {
  if (Array.isArray(record.lines)) return record.lines.map(l => ({
    description: l.description || "Item", hsn: l.hsn || "", unit: l.unit || "Sq.Ft",
    billedQty: Number(l.billedQty != null ? l.billedQty : l.qty) || 0,
    rate: Number(l.rate) || 0, discountPct: Number(l.discountPct) || 0,
    gstRate: Number(l.gstRate != null ? l.gstRate : (SETTINGS.defaultGstRate || 0)),
    length: l.length, width: l.width
  }));
  const gstRate = Number(record.gstRate) || 0;
  return (record.measurements || []).map(m => ({
    description: "Item", hsn: SETTINGS.defaultHsn || "", unit: "Sq.Ft",
    billedQty: (Number(m.area) || 0) * (Number(m.quantity) || 1),
    rate: Number(m.cost) || 0, discountPct: 0, gstRate, length: m.length, width: m.width
  }));
}

function quickTotals(record) {
  const home = SETTINGS.stateCode;
  const intra = String(record.placeOfSupplyStateCode || home) === String(home);
  let taxable = 0, cgst = 0, sgst = 0, igst = 0;
  normalizeLines(record).forEach(l => {
    const t = l.billedQty * l.rate * (1 - l.discountPct / 100);
    taxable += t;
    if (intra) { cgst += t * (l.gstRate / 2) / 100; sgst += t * (l.gstRate / 2) / 100; }
    else igst += t * l.gstRate / 100;
  });
  return { intra, taxable, cgst, sgst, igst, grandTotal: Math.round(taxable + cgst + sgst + igst) };
}

function statusBadge(status, amountPaid, grandTotal) {
  if (status === "paid") return `<span class="payment-badge badge-paid">✅ Paid</span>`;
  if (status === "partial") {
    const remaining = Math.max(0, (grandTotal || 0) - (amountPaid || 0));
    return `<span class="payment-badge badge-partial">⚡ Partial — Paid: ₹${(amountPaid || 0).toFixed(2)} | Due: ₹${remaining.toFixed(2)}</span>`;
  }
  return `<span class="payment-badge badge-unpaid">❌ Unpaid</span>`;
}

function docTypeBadge(docType) {
  const map = {
    'invoice': '', 'proforma': '<span class="doctype-badge badge-proforma">PROFORMA</span>',
    'credit-note': '<span class="doctype-badge badge-credit">CREDIT NOTE</span>',
    'debit-note': '<span class="doctype-badge badge-debit">DEBIT NOTE</span>'
  };
  return map[docType || 'invoice'] || '';
}

function renderClients(data) {
  const activeId = document.activeElement ? document.activeElement.id : null;
  if (!data.length) {
    document.getElementById("searchResults").innerHTML = "<p>No records found.</p>";
    if (activeId) { const el = document.getElementById(activeId); if (el) el.focus(); }
    return;
  }
  data = [...data].reverse();
  const isAdmin = currentRole === "admin" || (Array.isArray(currentPermissions) && currentPermissions.includes("clients"));
  document.getElementById("searchResults").innerHTML = data.map(client => {
    const t = quickTotals(client);
    const status = client.paymentStatus || "unpaid";
    const amountPaid = parseFloat(client.amountPaid) || 0;
    const lines = normalizeLines(client);
    const inv = client.invoiceNumber || "N/A";
    const dtBadge = docTypeBadge(client.docType);
    const controls = isAdmin ? `
      <div class="card-actions">
        <select class="status-select status-${status}" onchange="handlePaymentStatusChange('${esc(inv)}',this.value,${t.grandTotal},this)">
          <option value="unpaid"  ${status==="unpaid"?"selected":""}>❌ Unpaid</option>
          <option value="partial" ${status==="partial"?"selected":""}>⚡ Partial</option>
          <option value="paid"    ${status==="paid"?"selected":""}>✅ Paid</option>
        </select>
        <button class="btn blue small-btn" onclick="printFromHistory('${esc(inv)}')">🖨️</button>
        <button class="btn green small-btn" onclick="whatsappFromHistory('${esc(inv)}')">💬</button>
        <button class="btn blue small-btn" onclick="emailFromHistory('${esc(inv)}')">📧</button>
        <button class="btn blue small-btn" onclick="openEditModal('${esc(inv)}')">✏️</button>
        ${(client.docType === 'invoice' || !client.docType) ? `<button class="btn small-btn" style="background:#e67e22;color:#fff;" onclick="openReturnExchangeModal('${esc(inv)}')">↩</button>` : ''}
        <button class="btn red  small-btn" onclick="deleteInvoice('${esc(inv)}')">🗑️</button>
      </div>` : `<div class="card-actions">${statusBadge(status, amountPaid, t.grandTotal)}</div>`;
    return `
      <div class="client-card" id="card-${esc(inv)}">
        <div class="card-header-row">
          <div class="invoice-tag">📄 <strong>${esc(inv)}</strong> ${dtBadge}</div>
          ${controls}
        </div>
        <h3>${esc(client.name)} (${esc(client.mobile)})</h3>
        <span class="bill-date">${client.date ? new Date(client.date).toLocaleDateString("en-IN") : ""}</span>
        <p>${esc(client.address)}</p>
        ${isAdmin ? `<div id="payment-detail-${esc(inv)}">${statusBadge(status, amountPaid, t.grandTotal)}</div>` : ""}
        <table class="result-table">
          <thead><tr><th>Description</th><th>HSN</th><th>Unit</th><th>Billed</th><th>Rate</th><th>Disc%</th><th>GST%</th><th>Taxable</th></tr></thead>
          <tbody>${lines.map(l => `<tr><td>${esc(l.description)}</td><td>${esc(l.hsn)}</td><td>${esc(l.unit)}</td><td>${l.billedQty.toFixed(2)}</td><td>${l.rate}</td><td>${l.discountPct}</td><td>${l.gstRate}</td><td>${(l.billedQty*l.rate*(1-l.discountPct/100)).toFixed(2)}</td></tr>`).join("")}</tbody>
        </table>
        <p style="text-align:right;color:#555;font-size:0.9rem;">Taxable: ${money(t.taxable)} ${t.intra?`| CGST: ${money(t.cgst)} | SGST: ${money(t.sgst)}`:`| IGST: ${money(t.igst)}`}</p>
        <p class="grand-total">Grand Total: ${money(t.grandTotal)}</p>
      </div>`;
  }).join("");
  if (activeId) { const el = document.getElementById(activeId); if (el) { const v = el.value; el.focus(); el.value = ""; el.value = v; } }
}

// ── PAYMENT STATUS CHANGE ──
function handlePaymentStatusChange(invoiceNumber, status, grandTotal, selectEl) {
  if (status === "partial") {
    const detailEl = document.getElementById(`payment-detail-${invoiceNumber}`);
    if (detailEl) {
      detailEl.innerHTML = `
        <div class="partial-input-row">
          <label>Amount Paid: ₹</label>
          <input type="number" id="partial-amt-${invoiceNumber}" placeholder="Enter amount paid" min="0" max="${grandTotal.toFixed(2)}" style="width:150px;margin:0 8px;">
          <button class="btn green small-btn" onclick="submitPartialPayment('${invoiceNumber}',${grandTotal})">Save</button>
          <span id="partial-remaining-${invoiceNumber}" class="partial-remaining"></span>
        </div>`;
      const input = document.getElementById(`partial-amt-${invoiceNumber}`);
      input.addEventListener("input", () => {
        const remaining = Math.max(0, grandTotal - (parseFloat(input.value) || 0));
        document.getElementById(`partial-remaining-${invoiceNumber}`).textContent = `Remaining: ₹ ${remaining.toFixed(2)}`;
      });
    }
  } else {
    updatePaymentStatus(invoiceNumber, status, status === "paid" ? grandTotal : 0, selectEl);
  }
}

function submitPartialPayment(invoiceNumber, grandTotal) {
  const amountPaid = parseFloat(document.getElementById(`partial-amt-${invoiceNumber}`)?.value) || 0;
  if (amountPaid <= 0) return showError("Please enter amount paid.");
  if (amountPaid >= grandTotal) { if (!confirm("Amount paid equals or exceeds total. Mark as fully Paid?")) return; updatePaymentStatus(invoiceNumber, "paid", grandTotal, null); }
  else updatePaymentStatus(invoiceNumber, "partial", amountPaid, null);
}

function updatePaymentStatus(invoiceNumber, status, amountPaid, selectEl) {
  apiFetch(`/payment-status/${encodeURIComponent(invoiceNumber)}`, { method: "POST", body: JSON.stringify({ status, amountPaid }) })
    .then(res => res.json()).then(result => {
      if (result.success) { if (selectEl) selectEl.className = `status-select status-${status}`; showSuccess(`Payment updated: ${status}`); loadHistory(); }
      else showError("Failed to update status.");
    });
}

// ── REFRESH ALL SECTIONS AFFECTED BY A DELETION ──
function refreshAffectedSections(type) {
  const canSee = tab => currentRole === "admin" || (Array.isArray(currentPermissions) && currentPermissions.includes(tab));
  if (canSee("analytics")) loadAnalytics();
  if (canSee("dashboard")) loadDashboard();
  if (canSee("ledger") && _ledgerData) loadLedger();
  if (type === "invoice" || type === "purchase") {
    loadInventoryCache();
    if (document.getElementById("tab-inventory")?.classList.contains("active")) loadInventory();
  }
  if (_historyData.length && document.getElementById("tab-history")?.classList.contains("active")) loadHistory();
}

// ── DELETE ──
function deleteInvoice(invoiceNumber) {
  apiFetch(`/record/${encodeURIComponent(invoiceNumber)}`).then(r => r.json()).then(data => {
    if (!data.success) return showError("Invoice not found.");
    const record = data.record;
    const t = quickTotals(record);
    const dt = record.docType || "invoice";
    const dtLabel = { invoice: "Tax Invoice", proforma: "Proforma", "credit-note": "Credit Note", "debit-note": "Debit Note" }[dt] || "Document";
    const lines = Array.isArray(record.lines) ? record.lines : [];
    const impacts = [];
    if (dt === "invoice") {
      impacts.push(`• Removes ₹${t.grandTotal.toFixed(2)} from revenue`);
      const invMatches = lines.filter(l => l.description && _inventoryCache.some(i => i.name.toLowerCase() === (l.description||"").toLowerCase())).length;
      if (invMatches) impacts.push(`• Restores stock for ${invMatches} inventory item(s)`);
    } else if (dt === "proforma") {
      impacts.push(`• Removes this proforma of ₹${t.grandTotal.toFixed(2)}`);
    } else if (dt === "credit-note") {
      impacts.push(`• Removes this credit note of ₹${t.grandTotal.toFixed(2)}`);
    } else if (dt === "debit-note") {
      impacts.push(`• Removes this debit note of ₹${t.grandTotal.toFixed(2)}`);
    }
    impacts.push("• Cannot be undone");
    const msg = `Delete ${dtLabel}: ${invoiceNumber}\nClient: ${record.name}\n\nImpact:\n${impacts.join("\n")}`;
    if (!confirm(msg)) return;
    apiFetch(`/delete/${encodeURIComponent(invoiceNumber)}`, { method: "DELETE" })
      .then(r => r.json()).then(result => {
        if (result.success) {
          document.getElementById(`card-${invoiceNumber}`)?.remove();
          const extra = result.stockRestored ? ` Stock restored for ${result.stockRestored} item(s).` : "";
          showSuccess(`${invoiceNumber} deleted.${extra}`);
          refreshAffectedSections("invoice");
        } else showError("Delete failed: " + result.message);
      });
  });
}

// ── EDIT MODAL ──
let editingInvoiceNumber = null;
function openEditModal(invoiceNumber) {
  apiFetch("/history").then(res => res.json()).then(data => {
    const record = data.find(r => r.invoiceNumber === invoiceNumber);
    if (!record) return showError("Invoice not found.");
    editingInvoiceNumber = invoiceNumber;
    document.getElementById("editName").value = record.name;
    document.getElementById("editMobile").value = record.mobile;
    document.getElementById("editAddress").value = record.address;
    const tbody = document.getElementById("editMeasurementsTbody");
    tbody.innerHTML = "";
    normalizeLines(record).forEach(l => addEditRow(tbody, l));
    document.getElementById("editModal").style.display = "flex";
    updateEditGrandTotal();
  });
}

function addEditRow(tbody, l = {}) {
  const row = document.createElement("tr");
  const unit = l.unit || "Sq.Ft";
  row.innerHTML = `
    <td><input type="text" class="e-desc" value="${esc(l.description || "")}"></td>
    <td><input type="text" class="e-hsn" value="${esc(l.hsn || (SETTINGS.defaultHsn||""))}" style="width:70px"></td>
    <td><input type="number" class="e-length" value="${esc(l.length || "")}"></td>
    <td><input type="number" class="e-width" value="${esc(l.width || "")}"></td>
    <td>${_buildUnitSelect("e-unit", unit)}</td>
    <td><input type="number" class="e-count" value="${esc(l.count || 1)}" style="width:60px"></td>
    <td class="e-billed">${(Number(l.billedQty)||0).toFixed(2)}</td>
    <td><input type="number" class="e-rate" value="${esc(l.rate || "")}" style="width:80px"></td>
    <td><input type="number" class="e-disc" value="${esc(l.discountPct || 0)}" style="width:55px"></td>
    <td><input type="number" class="e-gst" value="${esc(l.gstRate != null ? l.gstRate : (SETTINGS.defaultGstRate||0))}" style="width:55px"></td>
    <td class="e-taxable">0</td>
    <td><button onclick="this.closest('tr').remove();updateEditGrandTotal()">Delete</button></td>`;
  tbody.appendChild(row);
  row.querySelectorAll("input,select").forEach(inp => inp.addEventListener("input", () => recalcEditRow(row)));
  recalcEditRow(row);
}

function recalcEditRow(row) {
  const unit = row.querySelector(".e-unit").value;
  const { billed } = calcBilled(unit, row.querySelector(".e-length").value, row.querySelector(".e-width").value, row.querySelector(".e-count").value);
  const rate = parseFloat(row.querySelector(".e-rate").value) || 0, disc = parseFloat(row.querySelector(".e-disc").value) || 0;
  row.querySelector(".e-billed").textContent = billed.toFixed(2);
  row.querySelector(".e-taxable").textContent = (billed * rate * (1 - disc / 100)).toFixed(2);
  updateEditGrandTotal();
}

function updateEditGrandTotal() {
  let taxable = 0, tax = 0;
  document.querySelectorAll("#editMeasurementsTbody tr").forEach(row => {
    const t = parseFloat(row.querySelector(".e-taxable").textContent) || 0;
    const g = parseFloat(row.querySelector(".e-gst").value) || 0;
    taxable += t; tax += t * g / 100;
  });
  document.getElementById("editGrandTotal").textContent = `Grand Total: ${money(Math.round(taxable + tax))}`;
}

function closeEditModal() { document.getElementById("editModal").style.display = "none"; editingInvoiceNumber = null; }

function submitEdit() {
  const name = document.getElementById("editName").value.trim();
  const mobile = document.getElementById("editMobile").value.trim();
  const address = document.getElementById("editAddress").value.trim();
  if (!name) return showError("Name is required!");
  if (!/^\d{10}$/.test(mobile)) return showError("Mobile must be 10 digits!");
  if (!address) return showError("Address is required!");
  const lines = [];
  document.querySelectorAll("#editMeasurementsTbody tr").forEach(row => {
    const unit = row.querySelector(".e-unit").value;
    const length = row.querySelector(".e-length").value, width = row.querySelector(".e-width").value, count = row.querySelector(".e-count").value;
    const { billed, area, perim } = calcBilled(unit, length, width, count);
    lines.push({
      description: row.querySelector(".e-desc").value.trim() || "Item", hsn: row.querySelector(".e-hsn").value.trim(),
      length, width, unit, count, billedQty: billed, area: area.toFixed(2), perimeter: perim.toFixed(2),
      rate: parseFloat(row.querySelector(".e-rate").value) || 0,
      discountPct: parseFloat(row.querySelector(".e-disc").value) || 0,
      gstRate: parseFloat(row.querySelector(".e-gst").value) || 0
    });
  });
  apiFetch(`/edit/${encodeURIComponent(editingInvoiceNumber)}`, { method: "POST", body: JSON.stringify({ name, mobile, address, lines }) })
    .then(res => res.json()).then(result => {
      if (result.success) {
        showSuccess("Invoice updated!");
        closeEditModal();
        // refresh whichever views are currently visible
        reloadClientList();
        if (document.getElementById("tab-history")?.classList.contains("active")) loadHistory();
      } else showError("Update failed: " + result.message);
    });
}

// ── CLIENT NOTES ──
const _clientNotes = {};

function renderClientNotesList(mobile) {
  const el = document.getElementById("clientNotesList");
  if (!el) return;
  const notes = _clientNotes[mobile] || [];
  if (!notes.length) {
    el.innerHTML = `<p class="notes-empty">No notes yet. Add one below.</p>`;
    return;
  }
  el.innerHTML = notes.map(n => `
    <div class="note-item${n.done ? " note-done" : ""}" data-id="${esc(n.id)}">
      <span class="note-text">${esc(n.text)}</span>
      <div class="note-actions">
        <button class="note-cut-btn" title="${n.done ? "Mark as pending" : "Mark as done / cut"}"
          onclick="toggleClientNote('${esc(mobile)}','${esc(n.id)}')">${n.done ? "↩" : "✂"}</button>
        <button class="note-del-btn" title="Delete note"
          onclick="deleteClientNote('${esc(mobile)}','${esc(n.id)}')">✕</button>
      </div>
    </div>`).join("");
}

function addClientNote(mobile) {
  const input = document.getElementById("clientNoteInput");
  const text = input.value.trim();
  if (!text) { showError("Note cannot be empty."); return; }
  const notes = _clientNotes[mobile] || [];
  notes.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false, createdAt: new Date().toISOString() });
  _clientNotes[mobile] = notes;
  input.value = "";
  renderClientNotesList(mobile);
  persistClientNotes(mobile);
}

function toggleClientNote(mobile, noteId) {
  const notes = _clientNotes[mobile] || [];
  const n = notes.find(n => n.id === noteId);
  if (n) n.done = !n.done;
  renderClientNotesList(mobile);
  persistClientNotes(mobile);
}

function deleteClientNote(mobile, noteId) {
  _clientNotes[mobile] = (_clientNotes[mobile] || []).filter(n => n.id !== noteId);
  renderClientNotesList(mobile);
  persistClientNotes(mobile);
}

function persistClientNotes(mobile) {
  const notes = _clientNotes[mobile] || [];
  apiFetch("/update-notes", { method: "POST", body: JSON.stringify({ mobile, notes }) })
    .then(r => r.json()).then(r => { if (!r.success) showError("Failed to save note."); });
}

// ── CLIENT PROFILE ──
function loadClientProfile() {
  const mobile = document.getElementById("clientSearchMobile").value.trim();
  if (!mobile) return showError("Enter a mobile number!");
  apiFetch(`/client/${mobile}`).then(res => res.json()).then(data => {
    if (!data.found) { document.getElementById("clientProfile").innerHTML = "<p>No client found.</p>"; return; }
    _clientNotes[data.mobile] = Array.isArray(data.notes) ? data.notes : [];
    const invoicesHtml = data.invoices.map(inv => {
      const t = quickTotals(inv);
      const amountPaid = parseFloat(inv.amountPaid) || 0;
      const lines = normalizeLines(inv);
      return `<div class="mini-invoice-card">
        <div class="mini-invoice-header">
          <span class="invoice-tag">📄 ${esc(inv.invoiceNumber || "N/A")}</span>
          <span class="bill-date">${inv.date ? new Date(inv.date).toLocaleDateString("en-IN") : ""}</span>
          ${docTypeBadge(inv.docType)}
          ${statusBadge(inv.paymentStatus || "unpaid", amountPaid, t.grandTotal)}
          <span class="grand-total">${money(t.grandTotal)}</span>
        </div>
        <table class="result-table">
          <thead><tr><th>Description</th><th>HSN</th><th>Unit</th><th>Billed</th><th>Rate</th><th>Taxable</th></tr></thead>
          <tbody>${lines.map(l => `<tr><td>${esc(l.description)}</td><td>${esc(l.hsn)}</td><td>${esc(l.unit)}</td><td>${l.billedQty.toFixed(2)}</td><td>${l.rate}</td><td>${(l.billedQty*l.rate*(1-l.discountPct/100)).toFixed(2)}</td></tr>`).join("")}</tbody>
        </table></div>`;
    }).join("");
    document.getElementById("clientProfile").innerHTML = `
      <div class="client-profile-box">
        <div class="profile-header">
          <div><h3>👤 ${esc(data.name)}</h3><p>📞 ${esc(data.mobile)} &nbsp;|&nbsp; 📍 ${esc(data.address)}</p></div>
          <div class="profile-stats">
            <div class="stat-box"><span class="stat-label">Total Business</span><span class="stat-value">${money(data.totalBusiness)}</span></div>
            <div class="stat-box"><span class="stat-label">Total Invoices</span><span class="stat-value">${data.invoiceCount}</span></div>
          </div>
        </div>
        <div class="notes-section">
          <div class="notes-header">
            <strong>📝 Client Notes</strong>
            <span class="notes-count" id="notesCount"></span>
          </div>
          <div id="clientNotesList" class="notes-list"></div>
          <div class="notes-add-row">
            <input type="text" id="clientNoteInput" class="notes-input"
              placeholder="Type a note and press Enter…"
              onkeydown="if(event.key==='Enter')addClientNote('${esc(data.mobile)}')">
            <button class="btn green small-btn" onclick="addClientNote('${esc(data.mobile)}')">+ Add</button>
          </div>
        </div>
        <h4 style="margin:15px 0 8px;">All Documents (${data.invoices.length})</h4>
        ${invoicesHtml}
      </div>`;
    renderClientNotesList(data.mobile);
  });
}
