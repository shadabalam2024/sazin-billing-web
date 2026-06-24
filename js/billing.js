// ── DOCUMENT TYPE HANDLING ──
function onDocTypeChange() {
  const dt = document.getElementById("billDocType").value;
  const origRow = document.getElementById("originalInvoiceRow");
  origRow.style.display = (dt === "credit-note" || dt === "debit-note") ? "flex" : "none";
  const labels = { invoice: "Invoice No:", proforma: "Proforma No:", "credit-note": "Credit Note No:", "debit-note": "Debit Note No:" };
  document.getElementById("docNumLabel").textContent = labels[dt] || "Invoice No:";
  const numEl = document.getElementById("invoiceNumber");
  numEl.textContent = "Loading..."; numEl.classList.remove("preview", "confirmed");
  fetchDocNumberPreview(dt);
}

function fetchDocNumberPreview(docType, attempts = 20, delay = 500) {
  apiFetch(`/next-invoice?docType=${docType}`).then(res => res.json()).then(result => {
    if (result.nextInvoice) {
      const el = document.getElementById("invoiceNumber");
      if (el && !el.classList.contains("confirmed")) { el.textContent = result.nextInvoice; el.classList.add("preview"); }
    }
  }).catch(() => {
    if (attempts > 1) setTimeout(() => fetchDocNumberPreview(docType, attempts - 1, delay), delay);
    else { const el = document.getElementById("invoiceNumber"); if (el) el.textContent = "Server not ready"; }
  });
}

function fetchInvoiceWithRetry(attempts = 20, delay = 500) {
  const dt = (document.getElementById("billDocType") || {}).value || "invoice";
  fetchDocNumberPreview(dt, attempts, delay);
}
fetchInvoiceWithRetry();
function loadNextInvoicePreview() { fetchInvoiceWithRetry(5, 300); }

// ── LINE HELPERS ──
// Units that use the count field directly (no dimension calculation)
const _COUNT_UNITS = new Set(["Piece", "Pcs", "Kg", "Gram", "Feet", "Meter", "Box", "Bag", "Set", "Ltr", "No.", "Roll", "Bundle"]);

function calcBilled(unit, length, width, count) {
  const l = parseFloat(length) || 0, w = parseFloat(width) || 0, c = parseFloat(count) || 0;
  const area = (l * w) / 92903;           // mm² → Sq.Ft
  const areaMt = (l * w) / 1000000;       // mm² → Sq.Mt
  const perim = 2 * (l + w) / 304.8;     // mm → R.Ft
  if (_COUNT_UNITS.has(unit)) return { billed: c, area, perim };
  if (unit === "R.Ft")  return { billed: perim  * c, area, perim };
  if (unit === "Sq.Mt") return { billed: areaMt * c, area, perim };
  return { billed: area * c, area, perim }; // default: Sq.Ft
}

// Shared unit <select> builder used by billing, quotations, and edit modal
function _buildUnitSelect(cls, selected) {
  const units = [
    ["── Area ──", null],
    ["Sq.Ft", "Sq.Ft"],
    ["Sq.Mt", "Sq.Mt"],
    ["── Length / Perimeter ──", null],
    ["R.Ft (Running Feet)", "R.Ft"],
    ["Feet", "Feet"],
    ["Meter", "Meter"],
    ["── Quantity ──", null],
    ["Piece", "Piece"],
    ["Pcs", "Pcs"],
    ["Kg", "Kg"],
    ["Gram", "Gram"],
    ["Box", "Box"],
    ["Bag", "Bag"],
    ["Set", "Set"],
    ["Ltr", "Ltr"],
    ["Roll", "Roll"],
    ["Bundle", "Bundle"],
    ["No.", "No."],
  ];
  const opts = units.map(([label, val]) =>
    val === null
      ? `<option disabled>${label}</option>`
      : `<option value="${val}"${val === selected ? " selected" : ""}>${label}</option>`
  ).join("");
  return `<select class="${cls}">${opts}</select>`;
}

// ── ADD / CALCULATE / DELETE ROW (billing) ──
function addRow(preset = {}) {
  const tbody = document.querySelector("#measurements tbody");
  const row = document.createElement("tr");
  const hsn = preset.hsn || SETTINGS.defaultHsn || "3925";
  const gst = SETTINGS.defaultGstRate != null ? SETTINGS.defaultGstRate : 18;
  const unit = preset.unit || "Sq.Ft";
  row.innerHTML =
    _buildProductCell(preset.name, preset.hsn || hsn) +
    `<td><input type="number" class="r-length" placeholder="mm"></td>
    <td><input type="number" class="r-width" placeholder="mm"></td>
    <td>${_buildUnitSelect("r-unit", unit)}</td>
    <td><input type="number" class="r-count" value="1" style="width:60px"></td>
    <td class="r-billed">0</td>
    <td><input type="number" class="r-rate" value="${preset.cost != null ? esc(preset.cost) : ""}" style="width:80px"></td>
    <td><input type="number" class="r-disc" value="0" style="width:55px"></td>
    <td><input type="number" class="r-gst" value="${esc(gst)}" style="width:55px"></td>
    <td class="r-taxable">0</td>
    <td><button onclick="deleteRow(this)">Delete</button></td>`;
  tbody.appendChild(row);
  attachProductAutocomplete(row, "measurements");
  row.querySelectorAll("input:not(.r-desc):not(.r-hsn),select").forEach(inp => inp.addEventListener("input", () => calculateRow(row)));
  calculateRow(row);
}

function calculateRow(row) {
  const unit = row.querySelector(".r-unit").value;
  const { billed } = calcBilled(unit, row.querySelector(".r-length").value, row.querySelector(".r-width").value, row.querySelector(".r-count").value);
  const rate = parseFloat(row.querySelector(".r-rate").value) || 0;
  const disc = parseFloat(row.querySelector(".r-disc").value) || 0;
  row.querySelector(".r-billed").textContent = billed.toFixed(2);
  row.querySelector(".r-taxable").textContent = (billed * rate * (1 - disc / 100)).toFixed(2);
  updateGrandTotal();
}

function deleteRow(btn) {
  const row = btn.closest("tr");
  const inp = row.querySelector(".r-desc[data-sugid]");
  if (inp) _removeSugBox(inp.dataset.sugid);
  row.remove();
  updateGrandTotal();
}

function getBillingLines() {
  const lines = [];
  document.querySelectorAll("#measurements tbody tr").forEach(row => {
    const unit = row.querySelector(".r-unit").value;
    const length = row.querySelector(".r-length").value, width = row.querySelector(".r-width").value, count = row.querySelector(".r-count").value;
    const { billed, area, perim } = calcBilled(unit, length, width, count);
    lines.push({
      description: row.querySelector(".r-desc").value.trim() || "Item",
      hsn: row.querySelector(".r-hsn").value.trim(),
      length, width, unit, count, billedQty: billed, area: area.toFixed(2), perimeter: perim.toFixed(2),
      rate: parseFloat(row.querySelector(".r-rate").value) || 0,
      discountPct: parseFloat(row.querySelector(".r-disc").value) || 0,
      gstRate: parseFloat(row.querySelector(".r-gst").value) || 0
    });
  });
  return lines;
}

// ── GRAND TOTAL via server compute ──
let _computeTimer = null;
function updateGrandTotal() { clearTimeout(_computeTimer); _computeTimer = setTimeout(doCompute, 200); }
function doCompute() {
  const lines = getBillingLines().map(l => ({ qty: l.billedQty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate }));
  const code = document.getElementById("placeOfSupplyStateCode").value.trim();
  if (!lines.length) { renderTaxBreakup(null); return; }
  apiFetch("/compute", { method: "POST", body: JSON.stringify({ placeOfSupplyStateCode: code, lines }) })
    .then(r => r.json()).then(res => { if (res.success) renderTaxBreakup(res.calc); }).catch(() => {});
}
function renderTaxBreakup(calc) {
  const box = document.getElementById("taxBreakup");
  if (!calc) { box.innerHTML = ""; document.getElementById("grandTotal").textContent = "Grand Total: ₹ 0.00"; updatePartialRemaining(); return; }
  box.innerHTML = calc.intraState
    ? `<div>Taxable: ${money(calc.totalTaxable)}</div><div>CGST: ${money(calc.totalCgst)} &nbsp; SGST: ${money(calc.totalSgst)}</div><div>Round Off: ${calc.roundOff>=0?"+":"−"} ${money(Math.abs(calc.roundOff))}</div>`
    : `<div>Taxable: ${money(calc.totalTaxable)}</div><div>IGST: ${money(calc.totalIgst)}</div><div>Round Off: ${calc.roundOff>=0?"+":"−"} ${money(Math.abs(calc.roundOff))}</div>`;
  document.getElementById("grandTotal").textContent = `Grand Total: ${money(calc.grandTotal)}`;
  updatePartialRemaining();
}

// ── PAYMENT STATUS ON FORM ──
function onBillPaymentChange() {
  const status = document.getElementById("billPaymentStatus").value;
  document.getElementById("partialAmountRow").style.display = status === "partial" ? "flex" : "none";
  if (status === "partial") updatePartialRemaining();
}
function grandTotalValue() { return parseFloat(document.getElementById("grandTotal").textContent.replace(/[^0-9.]/g, "")) || 0; }
function updatePartialRemaining() {
  const amountPaidEl = document.getElementById("billAmountPaid"), remainingEl = document.getElementById("billRemaining");
  if (!amountPaidEl || !remainingEl) return;
  const remaining = Math.max(0, grandTotalValue() - (parseFloat(amountPaidEl.value) || 0));
  remainingEl.textContent = `Remaining: ₹ ${remaining.toFixed(2)}`;
}

// ── AUTO-FILL client on mobile input ──
document.addEventListener("DOMContentLoaded", () => {
  const mobileInput = document.getElementById("mobile");
  if (mobileInput) mobileInput.addEventListener("input", () => {
    const val = mobileInput.value.trim();
    if (/^\d{10}$/.test(val)) {
      apiFetch(`/client-autofill/${val}`).then(res => res.json()).then(data => {
        if (data.found) {
          const nameEl = document.getElementById("name"), addrEl = document.getElementById("address"), gstEl = document.getElementById("recipientGstin");
          if (!nameEl.value) nameEl.value = data.name;
          if (!addrEl.value) addrEl.value = data.address;
          if (gstEl && !gstEl.value && data.recipientGstin) gstEl.value = data.recipientGstin;
          showSuccess("Client details auto-filled!");
        }
      }).catch(() => {});
    }
  });
});

// ── SAVE ──
function saveData() {
  const name = document.getElementById("name").value.trim();
  const mobile = document.getElementById("mobile").value.trim();
  const address = document.getElementById("address").value.trim();
  if (!name) return showError("Client name is required!");
  if (!/^\d{10}$/.test(mobile)) return showError("Mobile number must be exactly 10 digits!");
  if (!address) return showError("Address is required!");
  const lines = getBillingLines();
  if (!lines.length) return showError("Add at least one item.");

  const docType = document.getElementById("billDocType").value;
  const paymentStatus = document.getElementById("billPaymentStatus").value;
  const amountPaid = paymentStatus === "partial" ? parseFloat(document.getElementById("billAmountPaid").value) || 0
    : paymentStatus === "paid" ? grandTotalValue() : 0;

  const record = {
    name, mobile, address, docType,
    recipientGstin: document.getElementById("recipientGstin").value.trim(),
    placeOfSupplyState: document.getElementById("placeOfSupplyState").value.trim() || SETTINGS.stateName,
    placeOfSupplyStateCode: document.getElementById("placeOfSupplyStateCode").value.trim() || SETTINGS.stateCode,
    originalInvoice: document.getElementById("originalInvoiceNo") ? document.getElementById("originalInvoiceNo").value.trim() : "",
    lines, paymentStatus, amountPaid
  };
  apiFetch("/save", { method: "POST", body: JSON.stringify(record) }).then(res => res.json()).then(result => {
    if (result.success) {
      const el = document.getElementById("invoiceNumber");
      el.textContent = result.invoiceNumber; el.classList.remove("preview"); el.classList.add("confirmed");
      showSuccess(`Saved: ${result.invoiceNumber}`);
      resetForm();
    } else showError("Error: " + result.message);
  }).catch(err => console.error("Save failed:", err));
}

function resetForm() {
  ["name", "mobile", "address", "recipientGstin", "originalInvoiceNo"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.querySelectorAll("#measurements .r-desc[data-sugid]").forEach(inp => _removeSugBox(inp.dataset.sugid));
  document.querySelector("#measurements tbody").innerHTML = "";
  document.getElementById("billPaymentStatus").value = "unpaid";
  document.getElementById("partialAmountRow").style.display = "none";
  document.getElementById("billAmountPaid").value = "";
  document.getElementById("billRemaining").textContent = "";
  document.getElementById("grandTotal").textContent = "Grand Total: ₹ 0.00";
  document.getElementById("taxBreakup").innerHTML = "";
  document.getElementById("invoiceNumber").classList.remove("confirmed");
  document.getElementById("billDocType").value = "invoice";
  document.getElementById("originalInvoiceRow").style.display = "none";
  document.getElementById("docNumLabel").textContent = "Invoice No:";
  loadNextInvoicePreview();
}
