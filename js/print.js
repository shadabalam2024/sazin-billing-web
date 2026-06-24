// ── PRINT / PDF ──
function buildRecordFromForm() {
  return {
    invoiceNumber: document.getElementById("invoiceNumber").textContent.trim(),
    date: new Date().toISOString(),
    docType: document.getElementById("billDocType").value,
    originalInvoice: document.getElementById("originalInvoiceNo") ? document.getElementById("originalInvoiceNo").value.trim() : "",
    name: document.getElementById("name").value.trim(),
    mobile: document.getElementById("mobile").value.trim(),
    address: document.getElementById("address").value.trim(),
    recipientGstin: document.getElementById("recipientGstin").value.trim(),
    placeOfSupplyState: document.getElementById("placeOfSupplyState").value.trim() || SETTINGS.stateName,
    placeOfSupplyStateCode: document.getElementById("placeOfSupplyStateCode").value.trim() || SETTINGS.stateCode,
    lines: getBillingLines()
  };
}

function renderInvoiceHTML(record) {
  return apiFetch("/render-invoice", { method: "POST", body: JSON.stringify({ record }) }).then(r => r.json())
    .then(res => { if (!res.success) throw new Error(res.message); return res.html; });
}

function _openPrintWindow(html) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { showError("Pop-up blocked. Please allow pop-ups for this site and try again."); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice</title></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
}

function printBill() {
  const record = buildRecordFromForm();
  if (!record.lines.length) return showError("Add at least one item to print.");
  renderInvoiceHTML(record).then(_openPrintWindow).catch(err => showError("Render failed: " + err.message));
}

function savePDF() {
  const record = buildRecordFromForm();
  if (!record.lines.length) return showError("Add at least one item to save.");
  showSuccess("Opening print dialog — choose 'Save as PDF' as the destination.");
  renderInvoiceHTML(record).then(_openPrintWindow).catch(err => showError("Render failed: " + err.message));
}

function printFromHistory(invoiceNumber) {
  apiFetch(`/record/${encodeURIComponent(invoiceNumber)}`).then(res => res.json()).then(data => {
    if (!data.success) return showError("Record not found.");
    renderInvoiceHTML(data.record).then(_openPrintWindow).catch(err => showError("Render failed: " + err.message));
  });
}

// ── WHATSAPP ──
function waMessage(record, grandTotal) {
  const co = SETTINGS.name || "";
  const inv = record.invoiceNumber && record.invoiceNumber !== "Loading..." ? record.invoiceNumber : "(draft)";
  let msg = `Hello ${record.name || ""},\n\nThank you for your order with ${co}.\n`;
  msg += `Invoice: ${inv}\n`;
  msg += `Amount: ₹ ${Number(grandTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}\n`;
  const paid = parseFloat(record.amountPaid) || 0;
  if (record.paymentStatus === "partial") msg += `Paid: ₹ ${paid.toFixed(2)} | Due: ₹ ${(grandTotal - paid).toFixed(2)}\n`;
  else if (record.paymentStatus === "paid") msg += `Status: Paid in full ✅\n`;
  msg += `\nRegards,\n${co}`;
  return msg;
}

function openWhatsApp(mobile, text) {
  const num = ("91" + String(mobile || "").replace(/\D/g, "")).replace(/^9191/, "91");
  const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

function shareWhatsApp() {
  const record = buildRecordFromForm();
  if (!/^\d{10}$/.test(record.mobile)) return showError("Enter a valid 10-digit mobile first.");
  record.paymentStatus = document.getElementById("billPaymentStatus").value;
  record.amountPaid = parseFloat(document.getElementById("billAmountPaid").value) || 0;
  openWhatsApp(record.mobile, waMessage(record, grandTotalValue()));
}

function whatsappFromHistory(invoiceNumber) {
  apiFetch("/history").then(res => res.json()).then(data => {
    const record = data.find(r => r.invoiceNumber === invoiceNumber);
    if (!record) return showError("Invoice not found.");
    openWhatsApp(record.mobile, waMessage(record, quickTotals(record).grandTotal));
  });
}

// ── EMAIL MODAL ──
let _emailRecord = null;
function showEmailModal() {
  _emailRecord = buildRecordFromForm();
  const dt = _emailRecord.docType || "invoice";
  const labels = { invoice: "Tax Invoice", proforma: "Proforma Invoice", "credit-note": "Credit Note", "debit-note": "Debit Note" };
  document.getElementById("emailDocLabel").textContent = `Document: ${labels[dt] || "Invoice"} — ${_emailRecord.invoiceNumber}`;
  document.getElementById("emailRecipient").value = "";
  document.getElementById("emailModalError").style.display = "none";
  document.getElementById("emailModal").style.display = "flex";
}

function emailFromHistory(invoiceNumber) {
  apiFetch("/history").then(res => res.json()).then(data => {
    const record = data.find(r => r.invoiceNumber === invoiceNumber);
    if (!record) return showError("Invoice not found.");
    _emailRecord = record;
    const dt = record.docType || "invoice";
    const labels = { invoice: "Tax Invoice", proforma: "Proforma Invoice", "credit-note": "Credit Note", "debit-note": "Debit Note" };
    document.getElementById("emailDocLabel").textContent = `Document: ${labels[dt] || "Invoice"} — ${esc(record.invoiceNumber)}`;
    document.getElementById("emailRecipient").value = "";
    document.getElementById("emailModalError").style.display = "none";
    document.getElementById("emailModal").style.display = "flex";
  });
}

function closeEmailModal() { document.getElementById("emailModal").style.display = "none"; _emailRecord = null; }

function submitEmailInvoice() {
  const recipientEmail = document.getElementById("emailRecipient").value.trim();
  const errEl = document.getElementById("emailModalError");
  if (!recipientEmail || !/^[^@]+@[^@]+\.[^@]+$/.test(recipientEmail)) { errEl.textContent = "Please enter a valid email address."; errEl.style.display = "block"; return; }
  if (!_emailRecord) { errEl.textContent = "No document to send."; errEl.style.display = "block"; return; }
  errEl.style.display = "none";
  apiFetch("/email-invoice", { method: "POST", body: JSON.stringify({ record: _emailRecord, recipientEmail }) })
    .then(res => res.json()).then(result => {
      if (result.success) { showSuccess(`Invoice emailed to ${recipientEmail}!`); closeEmailModal(); }
      else { errEl.textContent = result.message; errEl.style.display = "block"; }
    });
}

// ── TEMPLATES ──
function showSaveTemplateModal() {
  const lines = getBillingLines();
  if (!lines.length) return showError("Add at least one item before saving as template.");
  document.getElementById("templateName").value = "";
  document.getElementById("templateNotes").value = "";
  document.getElementById("saveTemplateModal").style.display = "flex";
}
function closeSaveTemplateModal() { document.getElementById("saveTemplateModal").style.display = "none"; }
function submitSaveTemplate() {
  const name = document.getElementById("templateName").value.trim();
  if (!name) return showError("Template name is required.");
  const lines = getBillingLines();
  const notes = document.getElementById("templateNotes").value.trim();
  apiFetch("/templates", { method: "POST", body: JSON.stringify({ name, lines, notes }) }).then(res => res.json()).then(r => {
    if (r.success) { showSuccess(`Template "${name}" saved!`); closeSaveTemplateModal(); }
    else showError(r.message || "Save failed.");
  });
}
function openLoadTemplateModal() {
  apiFetch("/templates").then(res => res.json()).then(templates => {
    const list = document.getElementById("templatePickerList");
    if (!templates.length) { list.innerHTML = "<p style='color:#888'>No templates saved yet. Create an invoice and click '💾 Template' to save one.</p>"; }
    else list.innerHTML = templates.map(t => `
      <div class="catalog-pick-row">
        <div style="flex:1;">
          <strong>${esc(t.name)}</strong>
          ${t.notes ? `<br><small style="color:#888">${esc(t.notes)}</small>` : ""}
          <br><small style="color:#aaa">${t.lines ? t.lines.length + " items" : ""} — ${t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-IN") : ""}</small>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn blue small-btn" onclick='loadTemplateItems(${JSON.stringify(t).replace(/'/g,"&#39;")});closeLoadTemplateModal()'>Load</button>
          ${currentRole === "admin" ? `<button class="btn red small-btn" onclick="deleteTemplate('${esc(t.id)}',this.closest('.catalog-pick-row'))">Delete</button>` : ""}
        </div>
      </div>`).join("");
    document.getElementById("loadTemplateModal").style.display = "flex";
  });
}
function closeLoadTemplateModal() { document.getElementById("loadTemplateModal").style.display = "none"; }
function loadTemplateItems(template) {
  document.querySelector("#measurements tbody").innerHTML = "";
  (template.lines || []).forEach(l => addRow({ name: l.description, cost: l.rate, hsn: l.hsn, unit: l.unit }));
  showSuccess(`Template "${template.name}" loaded!`);
}
function deleteTemplate(id, rowEl) {
  if (!confirm("Delete this template?")) return;
  apiFetch(`/templates/${id}`, { method: "DELETE" }).then(res => res.json()).then(r => {
    if (r.success) { rowEl && rowEl.remove(); showSuccess("Template deleted."); }
    else showError(r.message || "Delete failed.");
  });
}
