// ── QUOTATIONS ──
function loadNextQuotePreview(attempts = 20, delay = 500) {
  apiFetch("/next-quote").then(res => res.json()).then(result => {
    if (result.nextQuote) {
      const el = document.getElementById("quoteNumber");
      if (el) { el.textContent = result.nextQuote; el.classList.add("preview"); }
    }
  }).catch(() => { if (attempts > 1) setTimeout(() => loadNextQuotePreview(attempts - 1, delay), delay); });
}

function addQuoteRow(preset = {}) {
  const tbody = document.querySelector("#qMeasurements tbody");
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
    <td><button onclick="deleteQuoteRow(this)">Delete</button></td>`;
  tbody.appendChild(row);
  attachProductAutocomplete(row, "qMeasurements");
  row.querySelectorAll("input:not(.r-desc):not(.r-hsn),select").forEach(inp => inp.addEventListener("input", () => calcQuoteRow(row)));
  calcQuoteRow(row);
}

function calcQuoteRow(row) {
  const unit = row.querySelector(".r-unit").value;
  const { billed } = calcBilled(unit, row.querySelector(".r-length").value, row.querySelector(".r-width").value, row.querySelector(".r-count").value);
  const rate = parseFloat(row.querySelector(".r-rate").value) || 0;
  const disc = parseFloat(row.querySelector(".r-disc").value) || 0;
  row.querySelector(".r-billed").textContent = billed.toFixed(2);
  row.querySelector(".r-taxable").textContent = (billed * rate * (1 - disc / 100)).toFixed(2);
  updateQuoteTotal();
}

function deleteQuoteRow(btn) {
  const row = btn.closest("tr");
  const inp = row.querySelector(".r-desc[data-sugid]");
  if (inp) _removeSugBox(inp.dataset.sugid);
  row.remove();
  updateQuoteTotal();
}

function updateQuoteTotal() {
  let taxable = 0, tax = 0;
  document.querySelectorAll("#qMeasurements tbody tr").forEach(row => {
    const t = parseFloat(row.querySelector(".r-taxable").textContent) || 0;
    const g = parseFloat(row.querySelector(".r-gst").value) || 0;
    taxable += t; tax += t * g / 100;
  });
  document.getElementById("quoteGrandTotal").textContent = `Grand Total: ${money(Math.round(taxable + tax))}`;
}

function getQuoteLines() {
  const lines = [];
  document.querySelectorAll("#qMeasurements tbody tr").forEach(row => {
    const unit = row.querySelector(".r-unit").value;
    const { billed, area, perim } = calcBilled(unit, row.querySelector(".r-length").value, row.querySelector(".r-width").value, row.querySelector(".r-count").value);
    lines.push({
      description: row.querySelector(".r-desc").value.trim() || "Item",
      hsn: row.querySelector(".r-hsn").value.trim(),
      length: row.querySelector(".r-length").value, width: row.querySelector(".r-width").value,
      unit, count: row.querySelector(".r-count").value, billedQty: billed,
      area: area.toFixed(2), perimeter: perim.toFixed(2),
      rate: parseFloat(row.querySelector(".r-rate").value) || 0,
      discountPct: parseFloat(row.querySelector(".r-disc").value) || 0,
      gstRate: parseFloat(row.querySelector(".r-gst").value) || 0
    });
  });
  return lines;
}

function saveQuote() {
  const name = document.getElementById("qName").value.trim();
  const mobile = document.getElementById("qMobile").value.trim();
  const address = document.getElementById("qAddress").value.trim();
  if (!name) return showError("Client name is required!");
  if (!/^\d{10}$/.test(mobile)) return showError("Mobile must be 10 digits!");
  if (!address) return showError("Address is required!");
  const lines = getQuoteLines();
  if (!lines.length) return showError("Add at least one item.");
  const record = {
    name, mobile, address,
    recipientGstin: document.getElementById("qGstin").value.trim(),
    placeOfSupplyState: document.getElementById("qPlaceState").value.trim() || SETTINGS.stateName,
    placeOfSupplyStateCode: document.getElementById("qPlaceCode").value.trim() || SETTINGS.stateCode,
    lines
  };
  apiFetch("/quotes", { method: "POST", body: JSON.stringify(record) }).then(res => res.json()).then(result => {
    if (result.success) {
      const el = document.getElementById("quoteNumber");
      el.textContent = result.quoteNumber; el.classList.remove("preview"); el.classList.add("confirmed");
      showSuccess(`Quote saved: ${result.quoteNumber}`);
      resetQuoteForm();
      loadQuotes();
    } else showError("Error: " + result.message);
  });
}

function resetQuoteForm() {
  ["qName","qMobile","qAddress","qGstin"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.querySelectorAll("#qMeasurements .r-desc[data-sugid]").forEach(inp => _removeSugBox(inp.dataset.sugid));
  document.querySelector("#qMeasurements tbody").innerHTML = "";
  document.getElementById("quoteGrandTotal").textContent = "Grand Total: ₹ 0.00";
  document.getElementById("quoteNumber").classList.remove("confirmed");
  loadNextQuotePreview();
}

function printQuote() {
  const name = document.getElementById("qName").value.trim();
  const lines = getQuoteLines();
  if (!lines.length || !name) return showError("Fill in client details and add items first.");
  const record = {
    invoiceNumber: document.getElementById("quoteNumber").textContent.trim(),
    date: new Date().toISOString(), docType: "quote",
    name, mobile: document.getElementById("qMobile").value.trim(),
    address: document.getElementById("qAddress").value.trim(),
    recipientGstin: document.getElementById("qGstin").value.trim(),
    placeOfSupplyState: document.getElementById("qPlaceState").value.trim() || SETTINGS.stateName,
    placeOfSupplyStateCode: document.getElementById("qPlaceCode").value.trim() || SETTINGS.stateCode,
    lines
  };
  renderInvoiceHTML(record).then(html => {
    if (window.api && window.api.printBill) window.api.printBill(html).catch(err => showError("Print failed: " + err));
    else showError("Print API not available.");
  }).catch(err => showError("Render failed: " + err.message));
}

function loadQuotes() {
  apiFetch("/quotes").then(res => res.json()).then(quotes => {
    const filterStatus = document.getElementById("quoteStatusFilter").value;
    const filtered = filterStatus ? quotes.filter(q => q.status === filterStatus) : quotes;
    const el = document.getElementById("quoteHistory");
    if (!filtered.length) { el.innerHTML = "<p style='color:#888'>No quotations found.</p>"; return; }
    el.innerHTML = [...filtered].reverse().map(q => {
      const statusColor = { open: "#0078d7", converted: "#28a745", cancelled: "#dc3545" }[q.status] || "#888";
      const totalAmt = (q.lines || []).reduce((s, l) => {
        const qty = Number(l.billedQty != null ? l.billedQty : l.qty) || 0;
        const rate = Number(l.rate) || 0, disc = Number(l.discountPct) || 0;
        const taxable = qty * rate * (1 - disc / 100);
        const tax = taxable * (Number(l.gstRate) || 0) / 100;
        return s + taxable + tax;
      }, 0);
      return `<div class="client-card">
        <div class="card-header-row">
          <div>
            <span class="invoice-tag">📝 <strong>${esc(q.quoteNumber)}</strong></span>
            <span style="margin-left:8px;padding:2px 10px;border-radius:10px;font-size:0.78rem;font-weight:700;background:#e8f0fe;color:${statusColor};">${q.status.toUpperCase()}</span>
          </div>
          <div class="card-actions">
            ${q.status === "open" ? `<button class="btn green small-btn" onclick="convertQuoteToInvoice('${esc(q.id)}')">✅ Convert to Invoice</button>` : ""}
            ${q.status === "converted" ? `<span style="font-size:0.8rem;color:#28a745">→ ${esc(q.convertedToInvoice || "")}</span>` : ""}
            <button class="btn red small-btn" onclick="deleteQuote('${esc(q.id)}')">🗑️</button>
          </div>
        </div>
        <h3>${esc(q.name)} (${esc(q.mobile)})</h3>
        <span class="bill-date">${q.date ? new Date(q.date).toLocaleDateString("en-IN") : ""}</span>
        <p>${esc(q.address)}</p>
        <div style="overflow-x:auto;margin-top:8px;">
        <table class="result-table">
          <thead><tr><th>Product Name</th><th>HSN</th><th>Unit</th><th>Billed</th><th>Rate (₹)</th><th>GST%</th><th>Taxable (₹)</th></tr></thead>
          <tbody>${(q.lines||[]).map(l => { const qty = Number(l.billedQty!=null?l.billedQty:l.qty)||0; const taxable = qty * (Number(l.rate)||0) * (1 - (Number(l.discountPct)||0)/100); return `<tr><td style="min-width:140px;">${esc(l.description)}</td><td style="color:#888;">${esc(l.hsn||'—')}</td><td>${esc(l.unit||'')}</td><td style="text-align:right;">${qty.toFixed(2)}</td><td style="text-align:right;">${money(l.rate)}</td><td style="text-align:center;">${l.gstRate}%</td><td style="text-align:right;">${money(taxable)}</td></tr>`; }).join("")}</tbody>
        </table>
        </div>
        <p class="grand-total">Grand Total: ${money(Math.round(totalAmt))}</p>
      </div>`;
    }).join("");
  });
}

function convertQuoteToInvoice(id) {
  if (!confirm("Convert this quotation to a Tax Invoice?")) return;
  apiFetch(`/quotes/${id}/convert`, { method: "POST" }).then(res => res.json()).then(result => {
    if (result.success) { showSuccess(`Invoice created: ${result.invoiceNumber}`); loadQuotes(); }
    else showError(result.message || "Conversion failed.");
  });
}

function deleteQuote(id) {
  if (!confirm("Delete this quotation?")) return;
  apiFetch(`/quotes/${id}`, { method: "DELETE" }).then(res => res.json()).then(r => {
    if (r.success) { showSuccess("Quote deleted."); loadQuotes(); }
    else showError("Delete failed.");
  });
}
