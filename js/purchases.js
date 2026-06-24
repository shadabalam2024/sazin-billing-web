// ── PURCHASES ──
let _purchaseData = [];

function loadPurchases() {
  apiFetch("/purchases").then(r => r.json()).then(purchases => {
    _purchaseData = [...purchases].reverse();
    renderPurchases(_purchaseData);
  });
}

function filterPurchases() {
  const q = (document.getElementById("purchaseSearch").value || "").toLowerCase().trim();
  const status = document.getElementById("purchaseStatusFilter").value;
  renderPurchases(_purchaseData.filter(p => {
    if (status && (p.paymentStatus || "paid") !== status) return false;
    if (q && !(p.supplier || "").toLowerCase().includes(q) && !(p.notes || "").toLowerCase().includes(q)) return false;
    return true;
  }));
}

function renderPurchases(purchases) {
  const el = document.getElementById("purchaseHistory");
  if (!purchases.length) { el.innerHTML = "<p style='color:#888'>No purchases found.</p>"; return; }
  const canEdit = currentRole === "admin" || (Array.isArray(currentPermissions) && currentPermissions.includes("purchases"));
  el.innerHTML = purchases.map(p => {
    const total = parseFloat(p.totalAmount || 0);
    const amountPaid = typeof p.amountPaid === "number" ? p.amountPaid
      : (p.paymentStatus === "paid" ? total : 0);
    const remaining = Math.max(0, total - amountPaid);
    const ps = p.paymentStatus || "paid";
    const payments = p.payments || [];
    const intra = p.isIntraState !== false;

    // GST breakup row
    let gstHtml = "";
    if (p.totalTaxable != null && p.totalGst != null && p.totalGst > 0) {
      gstHtml = `<div style="font-size:0.82rem;color:#555;margin-top:6px;padding:6px 8px;background:#f8f9fa;border-radius:4px;">
        <span>Taxable: <strong>₹ ${parseFloat(p.totalTaxable).toFixed(2)}</strong></span>
        ${intra
          ? `&nbsp;|&nbsp;<span>CGST: <strong>₹ ${parseFloat(p.totalCgst || 0).toFixed(2)}</strong></span>
             &nbsp;|&nbsp;<span>SGST: <strong>₹ ${parseFloat(p.totalSgst || 0).toFixed(2)}</strong></span>`
          : `&nbsp;|&nbsp;<span>IGST: <strong>₹ ${parseFloat(p.totalIgst || 0).toFixed(2)}</strong></span>`}
        &nbsp;|&nbsp;<span style="color:#0078d7;font-weight:700;">Total: ₹ ${total.toFixed(2)}</span>
      </div>`;
    }

    const paymentBar = `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;background:#f8f9fa;border-radius:6px;font-size:0.88rem;">
      <span>💰 Paid: <strong style="color:#28a745;">₹ ${amountPaid.toFixed(2)}</strong></span>
      <span>📋 Total: <strong>₹ ${total.toFixed(2)}</strong></span>
      ${remaining > 0 ? `<span>⏳ Remaining: <strong style="color:#e67e22;">₹ ${remaining.toFixed(2)}</strong></span>` : ""}
    </div>`;

    const paymentLog = payments.length ? `
      <div style="margin-top:8px;">
        <div style="font-size:0.82rem;font-weight:600;color:#555;margin-bottom:4px;">Payment History</div>
        ${payments.map(pay => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:0.85rem;">
            <span style="color:#555;">${new Date(pay.date).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })}</span>
            <span style="font-weight:600;color:#0078d7;">₹ ${parseFloat(pay.amount || 0).toFixed(2)}</span>
            <span style="color:#888;flex:1;text-align:center;">${esc(pay.note || "—")}</span>
            ${canEdit ? `<button class="btn red small-btn" onclick="deletePurchasePayment('${esc(p.id)}','${esc(pay.id)}')" style="padding:2px 7px;font-size:0.75rem;">✕</button>` : ""}
          </div>`).join("")}
      </div>` : "";

    return `<div class="client-card">
      <div class="card-header-row">
        <div>
          <strong>${esc(p.supplier)}</strong>
          ${p.supplierBillNo ? `<span style="font-size:0.82rem;color:#0078d7;margin-left:8px;font-weight:600;background:#e8f0fe;padding:1px 7px;border-radius:8px;">Bill# ${esc(p.supplierBillNo)}</span>` : ""}
          ${p.supplierState ? `<span style="font-size:0.8rem;color:#888;margin-left:6px;">📍 ${esc(p.supplierState)}</span>` : ""}
          <span class="bill-date">${p.date ? new Date(p.date).toLocaleDateString("en-IN") : ""}</span>
        </div>
        <div class="card-actions">
          <span class="payment-badge ${ps === "paid" ? "badge-paid" : ps === "partial" ? "badge-partial" : "badge-unpaid"}">${ps.charAt(0).toUpperCase() + ps.slice(1)}</span>
          ${canEdit ? `<button class="btn blue small-btn" onclick="openEditPurchaseModal('${esc(p.id)}')">✏️</button>` : ""}
          ${canEdit ? `<button class="btn red small-btn" onclick="deletePurchase('${esc(p.id)}')">🗑️</button>` : ""}
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table class="result-table"><thead><tr><th>Item</th><th>HSN</th><th>Qty</th><th>Cost/Unit</th><th>GST%</th><th>Taxable</th><th>GST Amt</th><th>Total</th><th>Inventory</th></tr></thead>
        <tbody>${(p.items || []).map(i => {
          const taxable = (parseFloat(i.qty) || 0) * (parseFloat(i.costPrice) || 0);
          const gstAmt = taxable * (parseFloat(i.gstRate) || 0) / 100;
          const lineTotal = taxable + gstAmt;
          const invBadge = i.addToInventory ? (i.productId ? `<span style="color:#28a745;font-size:0.78rem;font-weight:700;">📦 Linked</span>` : `<span style="color:#0078d7;font-size:0.78rem;font-weight:700;">📦 New</span>`) : `<span style="color:#aaa;font-size:0.78rem;">—</span>`;
          return `<tr>
            <td>${esc(i.name || "")}</td>
            <td style="color:#888;font-size:0.82rem;">${esc(i.hsn || "—")}</td>
            <td>${i.qty}</td>
            <td>₹ ${parseFloat(i.costPrice || 0).toFixed(2)}</td>
            <td>${parseFloat(i.gstRate || 0)}%</td>
            <td>₹ ${taxable.toFixed(2)}</td>
            <td>₹ ${gstAmt.toFixed(2)}</td>
            <td style="font-weight:600;">₹ ${lineTotal.toFixed(2)}</td>
            <td>${invBadge}</td>
          </tr>`;
        }).join("")}</tbody></table>
      </div>
      ${gstHtml}
      ${paymentBar}
      ${paymentLog}
      ${canEdit && ps !== "paid" ? `<div style="margin-top:10px;"><button class="btn green small-btn" onclick="openAddPurchasePaymentModal('${esc(p.id)}')">💰 Record Payment</button></div>` : ""}
      ${p.notes ? `<p style="color:#666;margin-top:8px;font-size:0.88rem;">${esc(p.notes)}</p>` : ""}
    </div>`;
  }).join("");
}

// ── NEW PURCHASE FORM ──
function _isPurchaseIntraState() {
  const supplierState = (document.getElementById("purchaseSupplierState")?.value || "").trim().toLowerCase();
  const bizState = (SETTINGS.stateName || "").trim().toLowerCase();
  return !supplierState || supplierState === bizState;
}

function onPurchasePaymentChange() {
  const status = document.getElementById("purchasePayment").value;
  const row = document.getElementById("purchasePartialRow");
  if (row) row.style.display = status === "partial" ? "block" : "none";
  onPurchaseAmountPaidInput();
}

function onPurchaseAmountPaidInput() {
  const totalText = (document.getElementById("purchaseTotal").textContent || "").replace(/[^0-9.]/g, "");
  const total = parseFloat(totalText) || 0;
  const paid = parseFloat(document.getElementById("purchaseAmountPaid").value) || 0;
  const remaining = Math.max(0, total - paid);
  const disp = document.getElementById("purchaseRemainingDisplay");
  if (disp) disp.textContent = total > 0 ? `Remaining after this payment: ₹ ${remaining.toFixed(2)}` : "";
}

function populateInvSelect(sel) {
  apiFetch("/inventory").then(r => r.json()).then(items => {
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Create new inventory entry --</option>' + items.map(i => `<option value="${esc(i.id)}">${esc(i.name)} (Stock: ${i.stockQty} ${esc(i.unit || "")})</option>`).join("");
    sel.value = cur;
  });
}

function wireUpPurchaseRow(row) {
  row.querySelectorAll(".pi-qty,.pi-cost,.pi-gst").forEach(inp => {
    if (!inp._piInited) { inp._piInited = true; inp.addEventListener("input", () => updatePurchaseRowTotal(row)); }
  });
  const checkbox = row.querySelector(".pi-inv-check"), label = row.querySelector(".pi-inv-toggle"), sel = row.querySelector(".pi-product");
  if (checkbox && !checkbox._invInited) {
    checkbox._invInited = true;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) { sel.style.display = ""; label.classList.add("checked"); populateInvSelect(sel); }
      else { sel.style.display = "none"; sel.value = ""; label.classList.remove("checked"); }
    });
  }
}

function initExistingPurchaseRows() { document.querySelectorAll("#purchaseItemsContainer .purchase-item-row").forEach(row => wireUpPurchaseRow(row)); }

function _purchaseRowHTML() {
  const gst = SETTINGS && SETTINGS.defaultGstRate != null ? SETTINGS.defaultGstRate : 18;
  return `<input class="pi-name" placeholder="Item name" style="flex:2;min-width:130px;margin:0;">
    <input class="pi-hsn" placeholder="HSN" style="flex:0.6;min-width:65px;margin:0;">
    <input class="pi-qty" type="number" placeholder="Qty" style="flex:0.5;min-width:65px;margin:0;">
    <input class="pi-cost" type="number" placeholder="Cost/unit ₹" style="flex:0.8;min-width:85px;margin:0;">
    <input class="pi-gst" type="number" placeholder="GST %" style="flex:0.4;min-width:58px;margin:0;" value="${gst}">
    <span class="pi-total" style="min-width:100px;line-height:38px;font-weight:600;color:#0078d7;">₹ 0.00</span>
    <label class="pi-inv-toggle"><input type="checkbox" class="pi-inv-check"> 📦 Inventory</label>
    <select class="pi-product" style="display:none;padding:8px;border:1px solid #ccc;border-radius:4px;min-width:180px;font-size:0.85rem;"><option value="">-- Create new inventory entry --</option></select>
    <button class="btn red small-btn" onclick="removePurchaseRow(this)" style="margin:0;">✕</button>`;
}

function addPurchaseRow() {
  const row = document.createElement("div"); row.className = "purchase-item-row"; row.innerHTML = _purchaseRowHTML();
  document.getElementById("purchaseItemsContainer").appendChild(row); wireUpPurchaseRow(row);
}

function removePurchaseRow(btn) {
  const rows = document.querySelectorAll("#purchaseItemsContainer .purchase-item-row");
  if (rows.length <= 1) return showError("At least one item row is required.");
  btn.closest(".purchase-item-row").remove(); updatePurchaseGrandTotal();
}

function updatePurchaseRowTotal(row) {
  const qty = parseFloat(row.querySelector(".pi-qty").value) || 0;
  const cost = parseFloat(row.querySelector(".pi-cost").value) || 0;
  const gst = parseFloat(row.querySelector(".pi-gst").value) || 0;
  const taxable = qty * cost;
  const gstAmt = taxable * gst / 100;
  row.querySelector(".pi-total").textContent = `₹ ${(taxable + gstAmt).toFixed(2)}`;
  updatePurchaseGrandTotal();
}

function updatePurchaseGrandTotal() {
  const intra = _isPurchaseIntraState();
  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
  document.querySelectorAll("#purchaseItemsContainer .purchase-item-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".pi-qty").value) || 0;
    const cost = parseFloat(row.querySelector(".pi-cost").value) || 0;
    const gst = parseFloat(row.querySelector(".pi-gst").value) || 0;
    const taxable = qty * cost;
    totalTaxable += taxable;
    if (intra) { totalCgst += taxable * gst / 2 / 100; totalSgst += taxable * gst / 2 / 100; }
    else { totalIgst += taxable * gst / 100; }
  });
  const totalGst = intra ? totalCgst + totalSgst : totalIgst;
  const grandTotal = totalTaxable + totalGst;
  document.getElementById("purchaseTotal").textContent = `₹ ${grandTotal.toFixed(2)}`;

  const breakupEl = document.getElementById("purchaseGstBreakup");
  if (breakupEl) {
    if (totalGst > 0) {
      const stateNote = intra
        ? `<span style="color:#28a745;font-size:0.78rem;">(${esc(SETTINGS.stateName || "same state")} — Intra)</span>`
        : `<span style="color:#e67e22;font-size:0.78rem;">(Inter-state — IGST)</span>`;
      breakupEl.innerHTML = intra
        ? `Taxable: <strong>₹ ${totalTaxable.toFixed(2)}</strong> &nbsp;|&nbsp;
           CGST: <strong>₹ ${totalCgst.toFixed(2)}</strong> &nbsp;|&nbsp;
           SGST: <strong>₹ ${totalSgst.toFixed(2)}</strong> &nbsp; ${stateNote}`
        : `Taxable: <strong>₹ ${totalTaxable.toFixed(2)}</strong> &nbsp;|&nbsp;
           IGST: <strong>₹ ${totalIgst.toFixed(2)}</strong> &nbsp; ${stateNote}`;
    } else {
      breakupEl.innerHTML = "";
    }
  }

  if (document.getElementById("purchasePartialRow")?.style.display !== "none") onPurchaseAmountPaidInput();
}

function savePurchase() {
  const supplier = document.getElementById("purchaseSupplier").value.trim();
  if (!supplier) return showError("Supplier name is required!");
  const supplierBillNo = document.getElementById("purchaseBillNo").value.trim();
  const supplierState = document.getElementById("purchaseSupplierState").value.trim();
  const intra = _isPurchaseIntraState();
  const items = []; let valid = true;
  document.querySelectorAll("#purchaseItemsContainer .purchase-item-row").forEach(row => {
    if (!valid) return;
    const name = row.querySelector(".pi-name").value.trim();
    const qty = parseFloat(row.querySelector(".pi-qty").value) || 0;
    const costPrice = parseFloat(row.querySelector(".pi-cost").value) || 0;
    const hsn = row.querySelector(".pi-hsn").value.trim();
    const gstRate = parseFloat(row.querySelector(".pi-gst").value) || 0;
    const addToInventory = row.querySelector(".pi-inv-check").checked;
    const productId = addToInventory ? (row.querySelector(".pi-product").value || null) : null;
    if (!name) { showError("All items must have a name."); valid = false; return; }
    if (!qty) { showError("All items must have a quantity > 0."); valid = false; return; }
    items.push({ name, hsn, qty, costPrice, gstRate, addToInventory, productId });
  });
  if (!valid) return;
  if (!items.length) return showError("Add at least one item!");

  // Compute totals
  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
  items.forEach(i => {
    const taxable = (parseFloat(i.qty) || 0) * (parseFloat(i.costPrice) || 0);
    totalTaxable += taxable;
    if (intra) { totalCgst += taxable * i.gstRate / 2 / 100; totalSgst += taxable * i.gstRate / 2 / 100; }
    else { totalIgst += taxable * i.gstRate / 100; }
  });
  const totalGst = intra ? totalCgst + totalSgst : totalIgst;

  const paymentStatus = document.getElementById("purchasePayment").value;
  const notes = document.getElementById("purchaseNotes").value.trim();
  const amountPaid = paymentStatus === "partial" ? (parseFloat(document.getElementById("purchaseAmountPaid").value) || 0) : null;
  const paymentNote = paymentStatus === "partial" ? document.getElementById("purchaseAmountNote").value.trim() : "";
  const paymentDate = paymentStatus === "partial" ? document.getElementById("purchaseAmountDate").value : "";

  const payload = { supplier, supplierBillNo, supplierState, isIntraState: intra, items, paymentStatus, notes, amountPaid, paymentNote, paymentDate,
    totalTaxable: Math.round(totalTaxable * 100) / 100,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalIgst: Math.round(totalIgst * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100 };

  apiFetch("/purchases", { method: "POST", body: JSON.stringify(payload) }).then(r => r.json()).then(res => {
    if (res.success) {
      showSuccess(items.filter(i => i.addToInventory).length ? `Purchase saved! ${items.filter(i=>i.addToInventory).length} item(s) updated in inventory.` : "Purchase saved!");
      document.getElementById("purchaseSupplier").value = "";
      document.getElementById("purchaseBillNo").value = "";
      document.getElementById("purchaseSupplierState").value = "";
      document.getElementById("purchaseNotes").value = "";
      document.getElementById("purchasePayment").value = "paid";
      document.getElementById("purchaseTotal").textContent = "₹ 0.00";
      document.getElementById("purchaseGstBreakup").innerHTML = "";
      document.getElementById("purchasePartialRow").style.display = "none";
      document.getElementById("purchaseAmountPaid").value = "";
      document.getElementById("purchaseAmountNote").value = "";
      document.getElementById("purchaseAmountDate").value = "";
      document.getElementById("purchaseRemainingDisplay").textContent = "";
      const container = document.getElementById("purchaseItemsContainer"); container.innerHTML = "";
      const firstRow = document.createElement("div"); firstRow.className = "purchase-item-row"; firstRow.innerHTML = _purchaseRowHTML(); container.appendChild(firstRow); wireUpPurchaseRow(firstRow);
      loadPurchases(); if (items.some(i => i.addToInventory)) loadInventory();
    } else showError(res.message || "Save failed.");
  });
}

function deletePurchase(id) {
  const p = _purchaseData.find(p => p.id === id);
  if (!p) return showError("Purchase not found.");
  const total = parseFloat(p.totalAmount || 0);
  const invItems = (p.items || []).filter(i => i.addToInventory || (!('addToInventory' in i) && i.productId));
  const impacts = [`• Removes ₹${total.toFixed(2)} from purchase totals`];
  if (invItems.length) impacts.push(`• Reverses stock addition for ${invItems.length} inventory item(s)`);
  impacts.push("• Cannot be undone");
  if (!confirm(`Delete purchase from: ${p.supplier}\n\nImpact:\n${impacts.join("\n")}`)) return;
  apiFetch(`/purchases/${id}`, { method: "DELETE" }).then(r => r.json()).then(res => {
    if (res.success) {
      const extra = res.stockReversed ? ` Stock reversed for ${res.stockReversed} item(s).` : "";
      showSuccess(`Purchase deleted.${extra}`);
      loadPurchases(); refreshAffectedSections("purchase");
    } else showError("Delete failed.");
  });
}

// ── ADD PAYMENT MODAL ──
function openAddPurchasePaymentModal(id) {
  const p = _purchaseData.find(p => p.id === id);
  if (!p) return showError("Purchase not found.");
  const amountPaid = typeof p.amountPaid === "number" ? p.amountPaid : (p.paymentStatus === "paid" ? parseFloat(p.totalAmount || 0) : 0);
  const remaining = Math.max(0, parseFloat(p.totalAmount || 0) - amountPaid);
  document.getElementById("addPaymentPurchaseId").value = id;
  document.getElementById("addPaymentSupplierName").textContent = p.supplier;
  document.getElementById("addPaymentSummary").textContent = `Total: ₹ ${parseFloat(p.totalAmount || 0).toFixed(2)}  |  Paid: ₹ ${amountPaid.toFixed(2)}  |  Remaining: ₹ ${remaining.toFixed(2)}`;
  document.getElementById("addPaymentAmount").value = "";
  document.getElementById("addPaymentNote").value = "";
  document.getElementById("addPaymentDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("addPurchasePaymentModal").style.display = "flex";
  setTimeout(() => document.getElementById("addPaymentAmount").focus(), 50);
}

function closeAddPurchasePaymentModal() {
  document.getElementById("addPurchasePaymentModal").style.display = "none";
}

function submitPurchasePayment() {
  const id = document.getElementById("addPaymentPurchaseId").value;
  const amount = parseFloat(document.getElementById("addPaymentAmount").value) || 0;
  if (!amount || amount <= 0) return showError("Enter a valid payment amount.");
  const note = document.getElementById("addPaymentNote").value.trim();
  const date = document.getElementById("addPaymentDate").value;
  apiFetch(`/purchases/${id}/payments`, { method: "POST", body: JSON.stringify({ amount, note, date }) })
    .then(r => r.json()).then(res => {
      if (res.success) { showSuccess("Payment recorded!"); closeAddPurchasePaymentModal(); loadPurchases(); }
      else showError(res.message || "Failed to record payment.");
    });
}

function deletePurchasePayment(purchaseId, paymentId) {
  if (!confirm("Remove this payment record? The amount will be deducted from paid total.")) return;
  apiFetch(`/purchases/${purchaseId}/payments/${paymentId}`, { method: "DELETE" })
    .then(r => r.json()).then(res => {
      if (res.success) { showSuccess("Payment removed."); loadPurchases(); }
      else showError("Failed to remove payment.");
    });
}

// ── EDIT PURCHASE MODAL ──
function _editPurchaseRowHTML(item = {}) {
  const taxable = ((parseFloat(item.qty) || 0) * (parseFloat(item.costPrice) || 0));
  const gstAmt = taxable * (parseFloat(item.gstRate) || 0) / 100;
  const lineTotal = (taxable + gstAmt).toFixed(2);
  const invBadge = item.productId
    ? '<span style="font-size:0.75rem;color:#28a745;white-space:nowrap;padding:0 4px;">📦 Linked</span>'
    : (item.addToInventory ? '<span style="font-size:0.75rem;color:#0078d7;white-space:nowrap;padding:0 4px;">📦 Inv</span>' : '');
  return `<div class="purchase-item-row">
    <input type="hidden" class="epi-productId" value="${esc(item.productId || '')}">
    <input type="hidden" class="epi-addToInventory" value="${item.addToInventory ? 'true' : 'false'}">
    <input class="epi-name" placeholder="Item name" style="flex:2;min-width:120px;margin:0;" value="${esc(item.name || '')}">
    <input class="epi-hsn" placeholder="HSN" style="flex:0.6;min-width:60px;margin:0;" value="${esc(item.hsn || '')}">
    <input class="epi-qty" type="number" placeholder="Qty" style="flex:0.5;min-width:55px;margin:0;" value="${esc(String(item.qty || ''))}">
    <input class="epi-cost" type="number" placeholder="Cost/unit ₹" style="flex:0.8;min-width:80px;margin:0;" value="${esc(String(item.costPrice || ''))}">
    <input class="epi-gst" type="number" placeholder="GST %" style="flex:0.4;min-width:55px;margin:0;" value="${esc(String(item.gstRate != null ? item.gstRate : (SETTINGS.defaultGstRate || 18)))}">
    <span class="epi-total" style="min-width:90px;line-height:38px;font-weight:600;color:#0078d7;">₹ ${lineTotal}</span>
    ${invBadge}
    <button class="btn red small-btn" onclick="removeEditPurchaseRow(this)" style="margin:0;">✕</button>
  </div>`;
}

function addEditPurchaseRow() {
  const container = document.getElementById("editPurchaseItemsContainer");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = _editPurchaseRowHTML();
  const row = wrapper.firstElementChild;
  container.appendChild(row);
  wireUpEditPurchaseRow(row);
}

function removeEditPurchaseRow(btn) {
  const rows = document.querySelectorAll("#editPurchaseItemsContainer .purchase-item-row");
  if (rows.length <= 1) return showError("At least one item is required.");
  btn.closest(".purchase-item-row").remove();
  updateEditPurchaseGrandTotal();
}

function wireUpEditPurchaseRow(row) {
  row.querySelectorAll(".epi-qty,.epi-cost,.epi-gst").forEach(inp => {
    if (!inp._epiInited) { inp._epiInited = true; inp.addEventListener("input", () => updateEditPurchaseRowTotal(row)); }
  });
}

function updateEditPurchaseRowTotal(row) {
  const qty = parseFloat(row.querySelector(".epi-qty").value) || 0;
  const cost = parseFloat(row.querySelector(".epi-cost").value) || 0;
  const gst = parseFloat(row.querySelector(".epi-gst").value) || 0;
  const taxable = qty * cost;
  row.querySelector(".epi-total").textContent = `₹ ${(taxable + taxable * gst / 100).toFixed(2)}`;
  updateEditPurchaseGrandTotal();
}

function updateEditPurchaseGrandTotal() {
  let total = 0;
  document.querySelectorAll("#editPurchaseItemsContainer .purchase-item-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".epi-qty").value) || 0;
    const cost = parseFloat(row.querySelector(".epi-cost").value) || 0;
    const gst = parseFloat(row.querySelector(".epi-gst").value) || 0;
    const taxable = qty * cost;
    total += taxable + taxable * gst / 100;
  });
  document.getElementById("editPurchaseTotal").textContent = `₹ ${total.toFixed(2)}`;
}

function openEditPurchaseModal(id) {
  const p = _purchaseData.find(p => p.id === id);
  if (!p) return showError("Purchase not found.");
  document.getElementById("editPurchaseId").value = id;
  document.getElementById("editPurchaseSupplier").value = p.supplier || "";
  document.getElementById("editPurchaseBillNo").value = p.supplierBillNo || "";
  document.getElementById("editPurchaseNotes").value = p.notes || "";
  const container = document.getElementById("editPurchaseItemsContainer");
  container.innerHTML = (p.items || []).map(_editPurchaseRowHTML).join("");
  container.querySelectorAll(".purchase-item-row").forEach(row => wireUpEditPurchaseRow(row));
  updateEditPurchaseGrandTotal();
  document.getElementById("editPurchaseModal").style.display = "flex";
}

function closeEditPurchaseModal() {
  document.getElementById("editPurchaseModal").style.display = "none";
}

function submitEditPurchase() {
  const id = document.getElementById("editPurchaseId").value;
  const supplier = document.getElementById("editPurchaseSupplier").value.trim();
  if (!supplier) return showError("Supplier name is required!");
  const supplierBillNo = document.getElementById("editPurchaseBillNo").value.trim();
  const items = []; let valid = true;
  document.querySelectorAll("#editPurchaseItemsContainer .purchase-item-row").forEach(row => {
    if (!valid) return;
    const name = row.querySelector(".epi-name").value.trim();
    const qty = parseFloat(row.querySelector(".epi-qty").value) || 0;
    const costPrice = parseFloat(row.querySelector(".epi-cost").value) || 0;
    const hsn = row.querySelector(".epi-hsn").value.trim();
    const gstRate = parseFloat(row.querySelector(".epi-gst").value) || 0;
    const productId = row.querySelector(".epi-productId").value || null;
    const addToInventory = row.querySelector(".epi-addToInventory").value === "true";
    if (!name) { showError("All items must have a name."); valid = false; return; }
    if (!qty) { showError("All items must have a quantity > 0."); valid = false; return; }
    items.push({ name, hsn, qty, costPrice, gstRate, productId, addToInventory });
  });
  if (!valid) return;
  const notes = document.getElementById("editPurchaseNotes").value.trim();

  // Recompute totals (use existing isIntraState from the record)
  const p = _purchaseData.find(p => p.id === id);
  const intra = p ? p.isIntraState !== false : true;
  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
  items.forEach(i => {
    const taxable = (parseFloat(i.qty) || 0) * (parseFloat(i.costPrice) || 0);
    totalTaxable += taxable;
    if (intra) { totalCgst += taxable * i.gstRate / 2 / 100; totalSgst += taxable * i.gstRate / 2 / 100; }
    else { totalIgst += taxable * i.gstRate / 100; }
  });
  const totalGst = intra ? totalCgst + totalSgst : totalIgst;

  apiFetch(`/purchases/${id}`, { method: "PUT", body: JSON.stringify({
    supplier, supplierBillNo, items, notes,
    totalTaxable: Math.round(totalTaxable * 100) / 100,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalIgst: Math.round(totalIgst * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100
  }) }).then(r => r.json()).then(res => {
    if (res.success) {
      showSuccess("Purchase updated!");
      closeEditPurchaseModal();
      loadPurchases();
      refreshAffectedSections("purchase");
    } else showError(res.message || "Update failed.");
  });
}
