console.log("✓ Renderer process loaded");

// ── AUTH GUARD ──
const TOKEN = sessionStorage.getItem("token");
const currentRole = sessionStorage.getItem("role");
const currentUser = sessionStorage.getItem("username");
let currentPermissions = null; // null = admin (all access); array = staff allowed tabs
try { currentPermissions = JSON.parse(sessionStorage.getItem("permissions") || "null"); } catch(e) {}
if (!TOKEN || !currentRole || !currentUser) window.location.href = "login.html";

const API = "http://localhost:3000";
let SETTINGS = {};
let _historyData = [];

// ── Authenticated fetch (injects token; bounces to login on 401) ──
function apiFetch(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, { "x-auth-token": TOKEN });
  if (opts.body && !opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json";
  return fetch(API + path, opts).then(res => {
    if (res.status === 401) { sessionStorage.clear(); window.location.href = "login.html"; throw new Error("Session expired"); }
    return res;
  });
}

// ── XSS-safe escape ──
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const money = n => "₹ " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── TOAST ──
function showToast(msg, type = "error") {
  let toast = document.getElementById("appToast");
  if (!toast) { toast = document.createElement("div"); toast.id = "appToast"; document.body.appendChild(toast); }
  toast.textContent = msg; toast.className = "app-toast " + type; toast.style.display = "block";
  clearTimeout(toast._timer); toast._timer = setTimeout(() => { toast.style.display = "none"; }, 3500);
}
function showError(msg) { showToast(msg, "toast-error"); }
function showSuccess(msg) { showToast(msg, "toast-success"); }

// ── ROLE UI + DATE + SETTINGS ──
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("welcomeUser").textContent = `👤 ${currentUser}`;
  const roleTag = document.getElementById("roleTag");
  roleTag.textContent = currentRole === "admin" ? "Admin" : "Staff";
  roleTag.className = "role-tag " + (currentRole === "admin" ? "role-admin" : "role-staff");
  if (currentRole !== "admin") {
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
    // Show only permitted tabs; hide the rest (and make billing visible if permitted or fall back)
    document.querySelectorAll(".tab-btn[data-perm]").forEach(btn => {
      const perm = btn.dataset.perm;
      const allowed = Array.isArray(currentPermissions) ? currentPermissions.includes(perm) : false;
      btn.style.display = allowed ? "" : "none";
    });
    // If the default active tab (billing) is not permitted, activate the first visible tab
    if (!Array.isArray(currentPermissions) || !currentPermissions.includes("billing")) {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      const firstVisible = document.querySelector(".tab-btn[data-perm]:not([style*='display: none']):not([style*='display:none'])");
      if (firstVisible) firstVisible.click();
    }
  }
  document.getElementById("changePwdBtn").style.display = "inline-block";
  document.getElementById("currentDate").textContent = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  if (sessionStorage.getItem("mustChangePassword")) document.getElementById("pwdBanner").style.display = "block";
  loadSettings();
  loadInventoryCache();
  // Prefill place of supply for quotes tab once settings load
});

function logout() {
  apiFetch("/logout", { method: "POST" }).catch(() => {}).finally(() => { sessionStorage.clear(); window.location.href = "login.html"; });
}

// ── SETTINGS ──
function loadSettings() {
  apiFetch("/settings").then(r => r.json()).then(s => {
    SETTINGS = s || {};
    document.getElementById("hdrName").textContent = s.name || "";
    document.getElementById("hdrAddr").textContent = s.address || "";
    document.getElementById("hdrGst").textContent = s.gstin ? `GSTIN: ${s.gstin}  |  State: ${s.stateName || ""} (${s.stateCode || ""})` : "⚠️ Set your GSTIN in Settings";
    const ps = document.getElementById("placeOfSupplyState"), pc = document.getElementById("placeOfSupplyStateCode");
    if (ps && !ps.value) ps.value = s.stateName || "";
    if (pc && !pc.value) pc.value = s.stateCode || "";
    const qps = document.getElementById("qPlaceState"), qpc = document.getElementById("qPlaceCode");
    if (qps && !qps.value) qps.value = s.stateName || "";
    if (qpc && !qpc.value) qpc.value = s.stateCode || "";
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? "" : v; };
    set("setName", s.name); set("setGstin", s.gstin); set("setAddress", s.address);
    set("setStateName", s.stateName); set("setStateCode", s.stateCode); set("setPhone", s.phone);
    set("setEmail", s.email); set("setLogoText", s.logoText); set("setInvoicePrefix", s.invoicePrefix);
    set("setDefaultHsn", s.defaultHsn); set("setDefaultGstRate", s.defaultGstRate);
    set("setBankName", s.bankName); set("setBankAccount", s.bankAccount); set("setBankIfsc", s.bankIfsc);
    set("setUpi", s.upi); set("setDeclaration", s.declaration);
    // SMTP
    set("setSmtpHost", s.smtpHost); set("setSmtpPort", s.smtpPort || 587);
    set("setSmtpUser", s.smtpUser); set("setSmtpFrom", s.smtpFrom);
    const badge = document.getElementById("smtpConfigBadge");
    if (badge) badge.innerHTML = s.smtpConfigured
      ? `<span class="payment-badge badge-paid">✅ SMTP configured — email delivery active</span>`
      : `<span class="payment-badge badge-unpaid">❌ SMTP not configured — fill fields below to enable email</span>`;
  }).catch(() => {});
}
function saveSettings() {
  const g = id => document.getElementById(id).value.trim();
  const payload = {
    name: g("setName"), gstin: g("setGstin"), address: g("setAddress"),
    stateName: g("setStateName"), stateCode: g("setStateCode"), phone: g("setPhone"),
    email: g("setEmail"), logoText: g("setLogoText"), invoicePrefix: g("setInvoicePrefix"),
    defaultHsn: g("setDefaultHsn"), defaultGstRate: parseFloat(g("setDefaultGstRate")) || 0,
    bankName: g("setBankName"), bankAccount: g("setBankAccount"), bankIfsc: g("setBankIfsc"),
    upi: g("setUpi"), declaration: g("setDeclaration")
  };
  apiFetch("/settings", { method: "POST", body: JSON.stringify(payload) }).then(r => r.json()).then(res => {
    if (res.success) { showSuccess("Settings saved!"); loadSettings(); } else showError(res.message || "Save failed.");
  });
}
function saveSmtpSettings() {
  const g = id => document.getElementById(id).value.trim();
  const payload = {
    smtpHost: g("setSmtpHost"), smtpPort: parseInt(g("setSmtpPort")) || 587,
    smtpUser: g("setSmtpUser"), smtpFrom: g("setSmtpFrom")
  };
  const pass = g("setSmtpPass");
  if (pass) payload.smtpPass = pass; // Only include if changed
  apiFetch("/settings", { method: "POST", body: JSON.stringify(payload) }).then(r => r.json()).then(res => {
    if (res.success) { showSuccess("Email settings saved!"); document.getElementById("setSmtpPass").value = ""; loadSettings(); }
    else showError(res.message || "Save failed.");
  });
}

// ── TABS ──
function showTab(tab, btn) {
  if (tab === "settings" && currentRole !== "admin") return;
  if (currentRole !== "admin" && !(Array.isArray(currentPermissions) && currentPermissions.includes(tab))) return;
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  if (btn) btn.classList.add("active");
  if (tab === "analytics") loadAnalytics();
  if (tab === "history") loadHistory();
  if (tab === "inventory") loadInventory();
  if (tab === "purchases") { loadPurchases(); initExistingPurchaseRows(); }
  if (tab === "expenses") loadExpenses();
  if (tab === "dashboard") loadDashboard();
  if (tab === "quotations") { loadQuotes(); loadNextQuotePreview(); }
  if (tab === "ledger") { loadLedger(); }
  if (tab === "settings") { loadUsers(); }
}

// ── DOCUMENT TYPE HANDLING (Billing tab) ──
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
function calcBilled(unit, length, width, count) {
  const l = parseFloat(length) || 0, w = parseFloat(width) || 0, c = parseFloat(count) || 0;
  const area = (l * w) / 92903, perim = 2 * (l + w) / 304.8;
  if (unit === "Piece") return { billed: c, area, perim };
  if (unit === "R.Ft") return { billed: perim * c, area, perim };
  return { billed: area * c, area, perim };
}

// ── INVENTORY CACHE (shared by billing + quotes autocomplete) ──
let _inventoryCache = [];
function loadInventoryCache() {
  apiFetch("/inventory").then(r => r.json()).then(items => { _inventoryCache = items; }).catch(() => {});
}

// ── PRODUCT AUTOCOMPLETE ──
// sugBoxes live in <body> with position:fixed to escape overflow:auto clipping from the table wrapper.
// Each input carries a data-sugid that links it to its floating sugBox div.
// On scroll the active sugBox is repositioned so it tracks the input.
const _sugScrollHandlers = new Map(); // uid → { reposition fn }
window.addEventListener("scroll", () => { _sugScrollHandlers.forEach(fn => fn()); }, { passive: true });
// Also reposition on horizontal table scroll
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".main-content, [style*='overflow-x:auto'], [style*='overflow-x: auto']").forEach(el => {
    el.addEventListener("scroll", () => { _sugScrollHandlers.forEach(fn => fn()); }, { passive: true });
  });
});

function _buildProductCell(name, hsn) {
  const n = esc(name || ""), h = esc(hsn || "");
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return `<td class="td-product">
    <div class="prod-ac-wrap">
      <div class="prod-ac-row">
        <input type="text" class="r-desc" value="${n}" placeholder="Product name" autocomplete="off" data-sugid="${uid}">
        <button type="button" class="prod-dropdown-btn" tabindex="-1" title="Browse all inventory">▼</button>
      </div>
      <span class="prod-inv-warn" style="display:none" title="Not in inventory — stock won't be deducted">⚠️ Not in inventory</span>
    </div>
  </td>
  <td><input type="text" class="r-hsn" value="${h}" style="width:70px" placeholder="HSN"></td>`;
}

function _removeSugBox(uid) {
  const el = document.getElementById("sug-" + uid);
  if (el) el.remove();
  _sugScrollHandlers.delete(uid);
}

function attachProductAutocomplete(row, tableId) {
  const input    = row.querySelector(".r-desc");
  const hsnInput = row.querySelector(".r-hsn");
  const dropBtn  = row.querySelector(".prod-dropdown-btn");
  const warnEl   = row.querySelector(".prod-inv-warn");
  const uid      = input.dataset.sugid;

  // Create suggestion box in <body> — escapes the overflow:auto table wrapper
  const sugBox = document.createElement("div");
  sugBox.className = "prod-suggestions";
  sugBox.id = "sug-" + uid;
  document.body.appendChild(sugBox);

  function positionSugBox() {
    const r = input.getBoundingClientRect();
    sugBox.style.top      = (r.bottom + 3) + "px";
    sugBox.style.left     = r.left + "px";
    sugBox.style.minWidth = Math.max(300, r.width + 70) + "px";
  }

  function hideSugBox() {
    sugBox.style.display = "none";
    _sugScrollHandlers.delete(uid);
  }
  function showSugBox() {
    positionSugBox();
    sugBox.style.display = "block";
    _sugScrollHandlers.set(uid, positionSugBox);
  }

  function renderSuggestions(items) {
    if (!items.length) { hideSugBox(); return; }
    sugBox.innerHTML = items.map(item => {
      const stock = parseFloat(item.stockQty || 0);
      const sc = stock <= 0 ? "#dc3545" : stock <= parseFloat(item.lowStockAlert || 5) ? "#fd7e14" : "#28a745";
      return `<div class="prod-sug-item"
        data-name="${esc(item.name)}" data-hsn="${esc(item.hsn || "")}"
        data-unit="${esc(item.unit || "Sq.Ft")}" data-cost="${esc(item.sellingPrice || item.costPrice || 0)}"
        data-gst="${esc(item.gstRate || SETTINGS.defaultGstRate || 18)}" data-id="${esc(item.id || "")}">
        <span class="prod-sug-name">${esc(item.name)}</span>
        <span class="prod-sug-meta">HSN: ${esc(item.hsn || "—")} &nbsp;|&nbsp; <span style="color:${sc}">Stock: ${stock} ${esc(item.unit || "")}</span></span>
      </div>`;
    }).join("");
    showSugBox();
    sugBox.querySelectorAll(".prod-sug-item").forEach(el => {
      el.addEventListener("mousedown", e => {
        e.preventDefault(); // keep focus on the input
        selectInventoryItem(row, {
          name: el.dataset.name, hsn: el.dataset.hsn,
          unit: el.dataset.unit, cost: el.dataset.cost,
          gst: el.dataset.gst, id: el.dataset.id
        }, tableId);
        hideSugBox();
      });
    });
  }

  function checkMatch() {
    const name = input.value.trim().toLowerCase();
    if (!name) { warnEl.style.display = "none"; row.dataset.inventoryId = ""; return; }
    const match = _inventoryCache.find(i => i.name.toLowerCase() === name);
    if (match) {
      warnEl.style.display = "none";
      if (!row.dataset.inventoryId) row.dataset.inventoryId = match.id || "";
    } else {
      warnEl.style.display = "inline-flex";
      row.dataset.inventoryId = "";
    }
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    checkMatch();
    if (!q) { hideSugBox(); return; }
    renderSuggestions(_inventoryCache.filter(i => i.name.toLowerCase().includes(q)).slice(0, 10));
    (tableId === "qMeasurements" ? calcQuoteRow : calculateRow)(row);
  });

  input.addEventListener("focus", () => {
    const q = input.value.trim().toLowerCase();
    if (q) renderSuggestions(_inventoryCache.filter(i => i.name.toLowerCase().includes(q)).slice(0, 10));
  });

  // Delay hide so mousedown on suggestion fires first
  input.addEventListener("blur", () => {
    setTimeout(hideSugBox, 200);
    checkMatch();
  });

  // ▼ button: preventDefault on mousedown stops it stealing focus from the input,
  // which would fire blur and hide the dropdown before click fires.
  dropBtn.addEventListener("mousedown", e => e.preventDefault());
  dropBtn.addEventListener("click", () => {
    if (sugBox.style.display === "block") { hideSugBox(); return; }
    if (_inventoryCache.length) {
      renderSuggestions(_inventoryCache);
    } else {
      sugBox.innerHTML = `<div class="prod-sug-item prod-sug-empty">No inventory items yet — add them in the Inventory tab.</div>`;
      showSugBox();
    }
  });

  // HSN → product lookup (vice versa)
  hsnInput.addEventListener("input", () => {
    const hsn = hsnInput.value.trim();
    (tableId === "qMeasurements" ? calcQuoteRow : calculateRow)(row);
    if (hsn.length >= 4 && !input.value.trim()) {
      const matches = _inventoryCache.filter(i => (i.hsn || "").startsWith(hsn));
      if (matches.length) renderSuggestions(matches);
    }
  });

  if (input.value.trim()) checkMatch();
}

function selectInventoryItem(row, item, tableId) {
  row.querySelector(".r-desc").value = item.name;
  row.querySelector(".r-hsn").value  = item.hsn || "";
  const unitSel = row.querySelector(".r-unit");
  if (item.unit) {
    const opt = [...unitSel.options].find(o => o.value === item.unit);
    if (opt) unitSel.value = item.unit;
  }
  if (item.cost && !row.querySelector(".r-rate").value) {
    row.querySelector(".r-rate").value = parseFloat(item.cost) || "";
  }
  if (item.gst) row.querySelector(".r-gst").value = parseFloat(item.gst) || SETTINGS.defaultGstRate || 18;
  row.dataset.inventoryId   = item.id   || "";
  row.dataset.inventoryName = item.name || "";
  row.querySelector(".prod-inv-warn").style.display = "none";
  const recalc = tableId === "qMeasurements" ? calcQuoteRow : calculateRow;
  recalc(row);
}

// ── ADD ROW (billing) ──
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
    <td><select class="r-unit"><option ${unit==="Sq.Ft"?"selected":""}>Sq.Ft</option><option ${unit==="R.Ft"?"selected":""}>R.Ft</option><option ${unit==="Piece"?"selected":""}>Piece</option></select></td>
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

// ── GRAND TOTAL via server compute (authoritative CGST/SGST/IGST) ──
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

// ── AUTO-FILL ──
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
  // Clean up floating suggestion boxes before clearing rows
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

// ── client-side totals (display only) ──
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
  const isAdmin = currentRole === "admin";
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
  // Always silently refresh analytics and dashboard (they hold running totals)
  if (currentRole === "admin") {
    loadAnalytics();
    loadDashboard();
    // Refresh ledger if data is loaded
    if (_ledgerData) loadLedger();
  }
  // Refresh inventory display if stock was affected
  if (type === "invoice" || type === "purchase") {
    loadInventoryCache(); // keep autocomplete cache fresh
    if (document.getElementById("tab-inventory")?.classList.contains("active")) loadInventory();
  }
  // Refresh history tab if open
  if (_historyData.length && document.getElementById("tab-history")?.classList.contains("active")) loadHistory();
}

// ── DELETE ──
function deleteInvoice(invoiceNumber) {
  // Fetch the record first so we can show a meaningful impact summary
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
    <td><select class="e-unit"><option ${unit==="Sq.Ft"?"selected":""}>Sq.Ft</option><option ${unit==="R.Ft"?"selected":""}>R.Ft</option><option ${unit==="Piece"?"selected":""}>Piece</option></select></td>
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
      if (result.success) { showSuccess("Invoice updated!"); closeEditModal(); loadHistory(); }
      else showError("Update failed: " + result.message);
    });
}

// ── CLIENT NOTES (list-based, with strikethrough toggle) ──
const _clientNotes = {}; // mobile → [ {id, text, done, createdAt} ]

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

    // Seed in-memory notes (backend already normalises to array)
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

    // Rate-wise summary (GSTR-3B style)
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
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  let csv = "GSTR-1 / GSTR-3B Summary Export\n\n";
  csv += "Rate-wise Summary\n";
  csv += ["GST Rate","Taxable Value","CGST","SGST","IGST","Total Tax"].map(esc).join(",") + "\n";
  d.rateSummary.forEach(s => { csv += [s.gstRate + "%", s.taxable, s.cgst, s.sgst, s.igst, s.totalTax].map(esc).join(",") + "\n"; });
  csv += ["Total", d.totals.taxable, d.totals.cgst, d.totals.sgst, d.totals.igst, d.totals.totalTax].map(esc).join(",") + "\n\n";
  if (d.b2b.length) {
    csv += "B2B Sales\n";
    csv += ["Invoice No","Date","Party Name","GSTIN","Place of Supply","Taxable","CGST","SGST","IGST","Grand Total"].map(esc).join(",") + "\n";
    d.b2b.forEach(r => { csv += [r.invoiceNumber, r.date ? new Date(r.date).toLocaleDateString("en-IN") : "", r.name, r.gstin, r.placeOfSupply, r.taxable, r.cgst, r.sgst, r.igst, r.grandTotal].map(esc).join(",") + "\n"; });
    csv += "\n";
  }
  if (d.b2c.length) {
    csv += "B2C Sales\n";
    csv += ["Invoice No","Date","Party Name","Taxable","CGST","SGST","IGST","Grand Total"].map(esc).join(",") + "\n";
    d.b2c.forEach(r => { csv += [r.invoiceNumber, r.date ? new Date(r.date).toLocaleDateString("en-IN") : "", r.name, r.taxable, r.cgst, r.sgst, r.igst, r.grandTotal].map(esc).join(",") + "\n"; });
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

// ── HISTORY ──
const DOCTYPE_LABELS = { invoice: 'Invoice', proforma: 'Proforma', quote: 'Quotation', 'credit-note': 'Credit Note', 'debit-note': 'Debit Note' };
const DOCTYPE_COLORS = { invoice: '#0078d7', proforma: '#6f42c1', quote: '#fd7e14', 'credit-note': '#dc3545', 'debit-note': '#e67e22' };

function loadHistory() {
  apiFetch("/history").then(res => res.json()).then(records => {
    _historyData = records;
    renderHistory(records);
  }).catch(() => {});
}

function renderHistory(records) {
  const el = document.getElementById("historyList");
  if (!records.length) { el.innerHTML = "<p style='color:#888;padding:16px 0;'>No documents found.</p>"; return; }
  el.innerHTML = `<div style="overflow-x:auto;"><table class="result-table">
    <thead><tr>
      <th>Date</th><th>Doc #</th><th>Type</th><th>Client</th><th>Amount</th><th>Status</th>
      ${currentRole === "admin" ? "<th>Actions</th>" : ""}
    </tr></thead>
    <tbody>${records.map(r => {
      const color = DOCTYPE_COLORS[r.docType] || '#333';
      const label = DOCTYPE_LABELS[r.docType] || r.docType;
      const ps = r.paymentStatus || 'unpaid';
      const statusBadge = r.docType === 'invoice' || !r.docType
        ? `<span class="ledger-pay-badge ledger-pay-${ps}">${ps.charAt(0).toUpperCase() + ps.slice(1)}</span>`
        : '<span style="color:#aaa;font-size:0.78rem;">—</span>';
      const actions = currentRole === "admin"
        ? `<td style="white-space:nowrap;">
            <button class="btn blue small-btn" onclick="printFromHistory('${esc(r.invoiceNumber)}')">🖨 Print</button>
            <button class="btn red small-btn" onclick="deleteHistoryEntry('${esc(r.invoiceNumber)}','${esc(r.docType || 'invoice')}')">Delete</button>
           </td>`
        : '';
      return `<tr>
        <td style="white-space:nowrap;font-size:0.85rem;">${esc(r.dateStr)}</td>
        <td style="font-weight:600;font-size:0.85rem;">${esc(r.invoiceNumber)}</td>
        <td><span style="background:${color}18;color:${color};padding:2px 8px;border-radius:10px;font-size:0.78rem;font-weight:600;">${label}</span></td>
        <td>${esc(r.name)}<br><span style="font-size:0.78rem;color:#888;">${esc(r.mobile)}</span></td>
        <td style="font-weight:600;">₹ ${Number(r.grandTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>${statusBadge}</td>
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

function deleteHistoryEntry(invoiceNumber, docType) {
  const label = DOCTYPE_LABELS[docType] || docType;
  if (!confirm(`Delete ${label} ${invoiceNumber}? This cannot be undone.`)) return;
  apiFetch(`/delete/${invoiceNumber}`, { method: "DELETE" }).then(res => res.json()).then(r => {
    if (r.success) {
      showSuccess(`${label} ${invoiceNumber} deleted.`);
      loadHistory();
      refreshAffectedSections(docType);
    } else showError(r.message || "Delete failed.");
  });
}

// ── BACKUP ──
function exportBackup() {
  apiFetch("/backup").then(res => res.json()).then(result => {
    if (!result.success) return showError("Backup failed.");
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(SETTINGS.invoicePrefix||"BACKUP")}_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showSuccess(`Backup exported — ${result.data.length} records.`);
  });
}
function restoreBackup() {
  const file = document.getElementById("restoreFile").files[0];
  if (!file) return showError("Please select a backup file first.");
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const backup = JSON.parse(e.target.result);
      const data = backup.data || backup;
      if (!Array.isArray(data)) return showError("Invalid backup file format.");
      if (!confirm(`Restore ${data.length} records? This will REPLACE all current data.`)) return;
      apiFetch("/restore", { method: "POST", body: JSON.stringify({ data, quotes: backup.quotes, templates: backup.templates }) }).then(res => res.json()).then(result => {
        if (result.success) { document.getElementById("backupStatus").innerHTML = `<div class="toast-success" style="padding:12px;border-radius:6px;margin-top:12px;">✅ Restored ${result.count} records.</div>`; showSuccess(`Restored ${result.count} records!`); }
        else showError("Restore failed: " + result.message);
      });
    } catch (e) { showError("Could not read file. Make sure it's a valid JSON backup."); }
  };
  reader.readAsText(file);
}

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
function printBill() {
  const record = buildRecordFromForm();
  if (!record.lines.length) return showError("Add at least one item to print.");
  renderInvoiceHTML(record).then(html => {
    if (window.api && window.api.printBill) window.api.printBill(html).catch(err => showError("Print failed: " + err));
    else showError("Print API not available.");
  }).catch(err => showError("Render failed: " + err.message));
}
function savePDF() {
  const record = buildRecordFromForm();
  if (!record.lines.length) return showError("Add at least one item to save.");
  renderInvoiceHTML(record).then(html => {
    if (window.api && window.api.savePDF) window.api.savePDF(html).then(result => {
      if (result.success) showSuccess("PDF saved: " + result.filePath);
      else if (result.message !== "Cancelled") showError("PDF failed: " + result.message);
    }).catch(err => showError("PDF failed: " + err));
    else showError("Save PDF API not available.");
  }).catch(err => showError("Render failed: " + err.message));
}
function printFromHistory(invoiceNumber) {
  apiFetch(`/record/${encodeURIComponent(invoiceNumber)}`).then(res => res.json()).then(data => {
    if (!data.success) return showError("Record not found.");
    renderInvoiceHTML(data.record).then(html => {
      if (window.api && window.api.printBill) window.api.printBill(html).catch(err => showError("Print failed: " + err));
      else showError("Print API not available.");
    }).catch(err => showError("Render failed: " + err.message));
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
  if (window.api && window.api.openExternal) window.api.openExternal(url);
  else window.open(url, "_blank");
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
    <td><select class="r-unit"><option ${unit==="Sq.Ft"?"selected":""}>Sq.Ft</option><option ${unit==="R.Ft"?"selected":""}>R.Ft</option><option ${unit==="Piece"?"selected":""}>Piece</option></select></td>
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

// ── USER MANAGEMENT ──
function loadUsers() {
  if (currentRole !== "admin") return;
  apiFetch("/users").then(res => res.json()).then(users => {
    const el = document.getElementById("userList");
    if (!users.length) { el.innerHTML = "<p style='color:#888'>No users found.</p>"; return; }
    el.innerHTML = `<table class="result-table"><thead><tr><th>Username</th><th>Role</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${users.map(u => `<tr>
        <td style="font-weight:600;">${esc(u.username)}</td>
        <td><span class="role-tag ${u.role === 'admin' ? 'role-admin' : 'role-staff'}">${u.role === 'admin' ? 'Admin' : 'Staff'}</span></td>
        <td style="font-size:0.8rem;color:#555;">${u.role === 'admin' ? '<em>All tabs</em>' : (Array.isArray(u.permissions) ? u.permissions.length + ' tabs' : 'default')}</td>
        <td>${u.mustChangePassword ? '<span style="color:#dc3545;font-size:0.8rem;">Must change password</span>' : '<span style="color:#28a745;font-size:0.8rem;">Active</span>'}</td>
        <td>
          <button class="btn blue small-btn" data-perms='${JSON.stringify(u.permissions || null)}' onclick="showEditUserModal('${esc(u.username)}','${esc(u.role)}',JSON.parse(this.dataset.perms))">Edit</button>
          ${u.username !== currentUser ? `<button class="btn red small-btn" onclick="deleteUser('${esc(u.username)}')">Delete</button>` : '<span style="font-size:0.75rem;color:#888;padding:0 6px;">(you)</span>'}
        </td>
      </tr>`).join("")}
    </tbody></table>`;
  }).catch(() => {});
}
function _setPermCheckboxes(perms) {
  const defaults = ["billing","quotations","clients"];
  const active = Array.isArray(perms) ? perms : defaults;
  document.querySelectorAll("#userPermissionsSection input[name=perm]").forEach(cb => {
    cb.checked = active.includes(cb.value);
  });
}
function onUserRoleChange() {
  const role = document.getElementById("newUserRole").value;
  document.getElementById("userPermissionsSection").style.display = role === "staff" ? "" : "none";
}
function showAddUserModal() {
  document.getElementById("addUserModalTitle").textContent = "👤 Add User";
  document.getElementById("editingUsername").value = "";
  document.getElementById("newUsername").value = "";
  document.getElementById("newUsername").disabled = false;
  document.getElementById("newUserRole").value = "staff";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newPasswordLabel").textContent = "Password (min 6 chars)";
  document.getElementById("addUserError").style.display = "none";
  document.getElementById("userPermissionsSection").style.display = "";
  _setPermCheckboxes(null);
  document.getElementById("addUserModal").style.display = "flex";
}
function showEditUserModal(username, role, permissions) {
  document.getElementById("addUserModalTitle").textContent = "✏️ Edit User";
  document.getElementById("editingUsername").value = username;
  document.getElementById("newUsername").value = username;
  document.getElementById("newUsername").disabled = true;
  document.getElementById("newUserRole").value = role;
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newPasswordLabel").textContent = "New Password (leave blank to keep existing)";
  document.getElementById("addUserError").style.display = "none";
  const isStaff = role === "staff";
  document.getElementById("userPermissionsSection").style.display = isStaff ? "" : "none";
  if (isStaff) _setPermCheckboxes(permissions);
  document.getElementById("addUserModal").style.display = "flex";
}
function closeAddUserModal() { document.getElementById("addUserModal").style.display = "none"; }
function _getSelectedPermissions() {
  return Array.from(document.querySelectorAll("#userPermissionsSection input[name=perm]:checked")).map(cb => cb.value);
}
function submitAddUser() {
  const editingUsername = document.getElementById("editingUsername").value;
  const username = document.getElementById("newUsername").value.trim();
  const role = document.getElementById("newUserRole").value;
  const password = document.getElementById("newUserPassword").value.trim();
  const errEl = document.getElementById("addUserError");
  errEl.style.display = "none";
  const permissions = role === "staff" ? _getSelectedPermissions() : undefined;
  if (editingUsername) {
    // Edit mode
    const payload = { role };
    if (password) payload.newPassword = password;
    if (permissions !== undefined) payload.permissions = permissions;
    apiFetch(`/users/${editingUsername}`, { method: "PUT", body: JSON.stringify(payload) }).then(res => res.json()).then(r => {
      if (r.success) { showSuccess("User updated!"); closeAddUserModal(); loadUsers(); }
      else { errEl.textContent = r.message; errEl.style.display = "block"; }
    });
  } else {
    // Add mode
    if (!username) { errEl.textContent = "Username is required."; errEl.style.display = "block"; return; }
    if (!password) { errEl.textContent = "Password is required."; errEl.style.display = "block"; return; }
    const body = { username, role, password };
    if (permissions !== undefined) body.permissions = permissions;
    apiFetch("/users", { method: "POST", body: JSON.stringify(body) }).then(res => res.json()).then(r => {
      if (r.success) { showSuccess(`User "${username}" created!`); closeAddUserModal(); loadUsers(); }
      else { errEl.textContent = r.message; errEl.style.display = "block"; }
    });
  }
}
function deleteUser(username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  apiFetch(`/users/${username}`, { method: "DELETE" }).then(res => res.json()).then(r => {
    if (r.success) { showSuccess(`User "${username}" deleted.`); loadUsers(); }
    else showError(r.message || "Delete failed.");
  });
}

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

// ── INVENTORY ──
let _inventoryAll = [];
function loadInventory() {
  apiFetch("/inventory").then(r => r.json()).then(items => {
    _inventoryAll = items; renderInventoryTable(items);
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
    const sel = document.getElementById("invCategoryFilter"); const current = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option>${esc(c)}</option>`).join("");
    sel.value = current;
  });
}
function renderInventoryTable(items) {
  const el = document.getElementById("inventoryList");
  if (!items.length) { el.innerHTML = "<p style='color:#888'>No products yet. Click '+ Add Product' to add one.</p>"; return; }
  el.innerHTML = `<table class="result-table"><thead><tr><th>Product</th><th>Category</th><th>Unit</th><th>HSN</th><th>Cost ₹</th><th>Selling ₹</th><th>Stock</th><th>Actions</th></tr></thead><tbody>${items.map(i => {
    const isLow = parseFloat(i.stockQty) <= parseFloat(i.lowStockAlert || 5);
    return `<tr><td>${esc(i.name)}</td><td>${esc(i.category || "")}</td><td>${esc(i.unit || "")}</td><td>${esc(i.hsn || "")}</td><td>₹ ${parseFloat(i.costPrice || 0).toFixed(2)}</td><td>₹ ${parseFloat(i.sellingPrice || 0).toFixed(2)}</td><td style="color:${isLow ? "#dc3545" : "inherit"};font-weight:${isLow ? "700" : "400"}">${i.stockQty}${isLow ? " ⚠️" : ""}</td><td><button class="btn blue small-btn" onclick="openAddInventoryModal('${esc(i.id)}')">Edit</button><button class="btn red small-btn" onclick="deleteInventoryItem('${esc(i.id)}')">Delete</button></td></tr>`;
  }).join("")}</tbody></table>`;
}
function filterInventoryTable() {
  const q = document.getElementById("invSearchInput").value.toLowerCase();
  const cat = document.getElementById("invCategoryFilter").value;
  renderInventoryTable(_inventoryAll.filter(i => (!q || i.name.toLowerCase().includes(q) || (i.category || "").toLowerCase().includes(q)) && (!cat || i.category === cat)));
}
function openAddInventoryModal(id) {
  document.getElementById("inventoryModalTitle").textContent = id ? "Edit Product" : "Add Product";
  const iconEl = document.getElementById("inventoryModalIcon");
  if (iconEl) { iconEl.textContent = id ? "✏" : "+"; iconEl.style.background = id ? "#fff3cd" : "#e8f0fe"; iconEl.style.color = id ? "#856404" : "#0078d7"; }
  document.getElementById("invEditId").value = id || "";
  ["invName", "invCategory", "invHsn", "invCostPrice", "invSellingPrice", "invStockQty", "invLowStockAlert"].forEach(f => { const el = document.getElementById(f); if (el) el.value = ""; });
  document.getElementById("invUnit").value = "Piece";
  if (id) {
    const item = _inventoryAll.find(i => i.id === id);
    if (item) {
      document.getElementById("invName").value = item.name || "";
      document.getElementById("invCategory").value = item.category || "";
      document.getElementById("invUnit").value = item.unit || "Piece";
      document.getElementById("invHsn").value = item.hsn || "";
      document.getElementById("invCostPrice").value = item.costPrice != null ? item.costPrice : "";
      document.getElementById("invSellingPrice").value = item.sellingPrice != null ? item.sellingPrice : "";
      document.getElementById("invStockQty").value = item.stockQty != null ? item.stockQty : "";
      document.getElementById("invLowStockAlert").value = item.lowStockAlert != null ? item.lowStockAlert : "";
    }
  }
  document.getElementById("inventoryModal").style.display = "flex";
}
function closeInventoryModal() { document.getElementById("inventoryModal").style.display = "none"; }
function submitInventoryModal() {
  const g = id => document.getElementById(id).value.trim();
  const name = g("invName"); if (!name) return showError("Product name is required!");
  const id = g("invEditId");
  const payload = { name, category: g("invCategory"), unit: g("invUnit"), hsn: g("invHsn"), costPrice: parseFloat(g("invCostPrice")) || 0, sellingPrice: parseFloat(g("invSellingPrice")) || 0, stockQty: parseFloat(g("invStockQty")) || 0, lowStockAlert: parseFloat(g("invLowStockAlert")) || 5 };
  apiFetch(id ? `/inventory/${id}` : "/inventory", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) }).then(r => r.json()).then(res => {
    if (res.success) { showSuccess(id ? "Product updated!" : "Product added!"); closeInventoryModal(); loadInventory(); loadInventoryCache(); }
    else showError(res.message || "Failed.");
  });
}
function deleteInventoryItem(id) {
  if (!confirm("Delete this product from inventory?")) return;
  apiFetch(`/inventory/${id}`, { method: "DELETE" }).then(r => r.json()).then(res => {
    if (res.success) { showSuccess("Product deleted."); loadInventory(); loadInventoryCache(); } else showError("Delete failed.");
  });
}

// ── PURCHASES ──
function loadPurchases() {
  apiFetch("/purchases").then(r => r.json()).then(purchases => {
    const el = document.getElementById("purchaseHistory");
    if (!purchases.length) { el.innerHTML = "<p style='color:#888'>No purchases recorded yet.</p>"; return; }
    el.innerHTML = [...purchases].reverse().map(p => `
      <div class="client-card">
        <div class="card-header-row">
          <div><strong>${esc(p.supplier)}</strong> <span class="bill-date">${p.date ? new Date(p.date).toLocaleDateString("en-IN") : ""}</span></div>
          <div class="card-actions">
            <span class="payment-badge ${p.paymentStatus === "paid" ? "badge-paid" : p.paymentStatus === "partial" ? "badge-partial" : "badge-unpaid"}">${esc(p.paymentStatus || "paid")}</span>
            <button class="btn red small-btn" onclick="deletePurchase('${esc(p.id)}')">🗑️</button>
          </div>
        </div>
        <table class="result-table"><thead><tr><th>Item</th><th>Qty</th><th>Cost/Unit</th><th>Total</th><th>Inventory</th></tr></thead>
        <tbody>${(p.items || []).map(i => {
          const invBadge = i.addToInventory ? (i.productId ? `<span style="color:#28a745;font-size:0.78rem;font-weight:700;">📦 Linked</span>` : `<span style="color:#0078d7;font-size:0.78rem;font-weight:700;">📦 New Entry</span>`) : `<span style="color:#aaa;font-size:0.78rem;">—</span>`;
          return `<tr><td>${esc(i.name || "")}</td><td>${i.qty}</td><td>₹ ${parseFloat(i.costPrice || 0).toFixed(2)}</td><td>₹ ${((parseFloat(i.qty) || 0) * (parseFloat(i.costPrice) || 0)).toFixed(2)}</td><td>${invBadge}</td></tr>`;
        }).join("")}</tbody></table>
        <p style="text-align:right;font-weight:700;margin-top:6px;">Total: ₹ ${parseFloat(p.totalAmount || 0).toFixed(2)}</p>
        ${p.notes ? `<p style="color:#666;margin-top:4px;">${esc(p.notes)}</p>` : ""}
      </div>`).join("");
  });
}
function populateInvSelect(sel) {
  apiFetch("/inventory").then(r => r.json()).then(items => {
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Create new inventory entry --</option>' + items.map(i => `<option value="${esc(i.id)}">${esc(i.name)} (Stock: ${i.stockQty} ${esc(i.unit || "")})</option>`).join("");
    sel.value = cur;
  });
}
function wireUpPurchaseRow(row) {
  row.querySelectorAll(".pi-qty,.pi-cost").forEach(inp => {
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
function initExistingPurchaseRows() { document.querySelectorAll(".purchase-item-row").forEach(row => wireUpPurchaseRow(row)); }
function _purchaseRowHTML() {
  return `<input class="pi-name" placeholder="Item name" style="flex:2;min-width:140px;margin:0;"><input class="pi-qty" type="number" placeholder="Qty" style="flex:0.5;min-width:70px;margin:0;"><input class="pi-cost" type="number" placeholder="Cost/unit ₹" style="flex:1;min-width:90px;margin:0;"><span class="pi-total" style="min-width:80px;line-height:38px;font-weight:600;color:#0078d7;">₹ 0</span><label class="pi-inv-toggle"><input type="checkbox" class="pi-inv-check"> 📦 Add to Inventory</label><select class="pi-product" style="display:none;padding:8px;border:1px solid #ccc;border-radius:4px;min-width:180px;font-size:0.85rem;"><option value="">-- Create new inventory entry --</option></select><button class="btn red small-btn" onclick="removePurchaseRow(this)" style="margin:0;">✕</button>`;
}
function addPurchaseRow() {
  const row = document.createElement("div"); row.className = "purchase-item-row"; row.innerHTML = _purchaseRowHTML();
  document.getElementById("purchaseItemsContainer").appendChild(row); wireUpPurchaseRow(row);
}
function removePurchaseRow(btn) {
  const rows = document.querySelectorAll(".purchase-item-row");
  if (rows.length <= 1) return showError("At least one item row is required.");
  btn.closest(".purchase-item-row").remove(); updatePurchaseGrandTotal();
}
function updatePurchaseRowTotal(row) {
  const qty = parseFloat(row.querySelector(".pi-qty").value) || 0, cost = parseFloat(row.querySelector(".pi-cost").value) || 0;
  row.querySelector(".pi-total").textContent = `₹ ${(qty * cost).toFixed(2)}`; updatePurchaseGrandTotal();
}
function updatePurchaseGrandTotal() {
  let total = 0;
  document.querySelectorAll(".purchase-item-row").forEach(row => { total += (parseFloat(row.querySelector(".pi-qty").value) || 0) * (parseFloat(row.querySelector(".pi-cost").value) || 0); });
  document.getElementById("purchaseTotal").textContent = `₹ ${total.toFixed(2)}`;
}
function savePurchase() {
  const supplier = document.getElementById("purchaseSupplier").value.trim();
  if (!supplier) return showError("Supplier name is required!");
  const items = []; let valid = true;
  document.querySelectorAll(".purchase-item-row").forEach(row => {
    if (!valid) return;
    const name = row.querySelector(".pi-name").value.trim(), qty = parseFloat(row.querySelector(".pi-qty").value) || 0, costPrice = parseFloat(row.querySelector(".pi-cost").value) || 0;
    const addToInventory = row.querySelector(".pi-inv-check").checked, productId = addToInventory ? (row.querySelector(".pi-product").value || null) : null;
    if (!name) { showError("All items must have a name."); valid = false; return; }
    if (!qty) { showError("All items must have a quantity > 0."); valid = false; return; }
    items.push({ name, qty, costPrice, addToInventory, productId });
  });
  if (!valid) return;
  if (!items.length) return showError("Add at least one item!");
  const paymentStatus = document.getElementById("purchasePayment").value, notes = document.getElementById("purchaseNotes").value.trim();
  apiFetch("/purchases", { method: "POST", body: JSON.stringify({ supplier, items, paymentStatus, notes }) }).then(r => r.json()).then(res => {
    if (res.success) {
      showSuccess(items.filter(i => i.addToInventory).length ? `Purchase saved! ${items.filter(i=>i.addToInventory).length} item(s) updated in inventory.` : "Purchase saved!");
      document.getElementById("purchaseSupplier").value = ""; document.getElementById("purchaseNotes").value = "";
      document.getElementById("purchasePayment").value = "paid"; document.getElementById("purchaseTotal").textContent = "₹ 0.00";
      const container = document.getElementById("purchaseItemsContainer"); container.innerHTML = "";
      const firstRow = document.createElement("div"); firstRow.className = "purchase-item-row"; firstRow.innerHTML = _purchaseRowHTML(); container.appendChild(firstRow); wireUpPurchaseRow(firstRow);
      loadPurchases(); if (items.some(i => i.addToInventory)) loadInventory();
    } else showError(res.message || "Save failed.");
  });
}
function deletePurchase(id) {
  apiFetch("/purchases").then(r => r.json()).then(purchases => {
    const p = purchases.find(p => p.id === id);
    if (!p) return showError("Purchase not found.");

    const total = parseFloat(p.totalAmount || 0);
    const invItems = (p.items || []).filter(i => i.addToInventory || (!('addToInventory' in i) && i.productId));

    const impacts = [
      `• Removes ₹${total.toFixed(2)} from purchase totals`,
    ];
    if (invItems.length) impacts.push(`• Reverses stock addition for ${invItems.length} inventory item(s)`);
    impacts.push("• Cannot be undone");

    const msg = `Delete purchase from: ${p.supplier}\n\nImpact:\n${impacts.join("\n")}`;
    if (!confirm(msg)) return;

    apiFetch(`/purchases/${id}`, { method: "DELETE" }).then(r => r.json()).then(res => {
      if (res.success) {
        const extra = res.stockReversed ? ` Stock reversed for ${res.stockReversed} item(s).` : "";
        showSuccess(`Purchase deleted.${extra}`);
        loadPurchases();
        refreshAffectedSections("purchase");
      } else showError("Delete failed.");
    });
  });
}

// ── EXPENSES ──
function saveExpense() {
  const category = document.getElementById("expCategory").value, amount = parseFloat(document.getElementById("expAmount").value) || 0;
  const description = document.getElementById("expDescription").value.trim(), notes = document.getElementById("expNotes").value.trim();
  if (!description) return showError("Description is required!"); if (!amount) return showError("Amount is required!");
  apiFetch("/expenses", { method: "POST", body: JSON.stringify({ category, amount, description, notes }) }).then(r => r.json()).then(res => {
    if (res.success) { showSuccess("Expense saved!"); document.getElementById("expAmount").value = ""; document.getElementById("expDescription").value = ""; document.getElementById("expNotes").value = ""; loadExpenses(); }
    else showError(res.message || "Save failed.");
  });
}
function loadExpenses() {
  const filterCat = document.getElementById("expFilterCategory").value;
  apiFetch("/expenses").then(r => r.json()).then(expenses => {
    const filtered = filterCat ? expenses.filter(e => e.category === filterCat) : expenses;
    const el = document.getElementById("expenseHistory");
    if (!filtered.length) { el.innerHTML = "<p style='color:#888'>No expenses recorded.</p>"; return; }
    const total = filtered.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    el.innerHTML = `<div style="margin-bottom:12px;font-weight:700;color:#555;">Total: ₹ ${total.toFixed(2)}</div>` +
      [...filtered].reverse().map(e => `
        <div class="client-card" style="padding:12px;margin-bottom:8px;">
          <div class="card-header-row">
            <div><strong>${esc(e.category)}</strong> &mdash; ${esc(e.description)} <span class="bill-date">${e.date ? new Date(e.date).toLocaleDateString("en-IN") : ""}</span></div>
            <div class="card-actions"><span style="font-weight:700;color:#dc3545;">₹ ${parseFloat(e.amount || 0).toFixed(2)}</span><button class="btn red small-btn" onclick="deleteExpense('${esc(e.id)}')">🗑️</button></div>
          </div>
          ${e.notes ? `<p style="color:#888;margin-top:4px;">${esc(e.notes)}</p>` : ""}
        </div>`).join("");
  });
}
function deleteExpense(id) {
  apiFetch("/expenses").then(r => r.json()).then(expenses => {
    const e = expenses.find(e => e.id === id);
    if (!e) return showError("Expense not found.");

    const msg = `Delete expense?\n\nCategory: ${e.category}\nDescription: ${e.description}\nAmount: ₹${parseFloat(e.amount || 0).toFixed(2)}\n\nImpact:\n• Removes ₹${parseFloat(e.amount || 0).toFixed(2)} from expense totals\n• Cannot be undone`;
    if (!confirm(msg)) return;

    apiFetch(`/expenses/${id}`, { method: "DELETE" }).then(r => r.json()).then(res => {
      if (res.success) {
        showSuccess("Expense deleted.");
        loadExpenses();
        refreshAffectedSections("expense");
      } else showError("Delete failed.");
    });
  });
}

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
    renderLedgerSummary(data.summary);
    applyLedgerFilter();
  }).catch(err => showError("Ledger failed: " + err.message));
}

function renderLedgerSummary(s) {
  const netColor = s.netBalance >= 0 ? "#0a7c3e" : "#dc3545";
  document.getElementById("ledgerSummary").innerHTML = `
    <div class="ledger-stat"><span class="ledger-stat-label">Sales</span><span class="ledger-stat-value credit-val">${money(s.totalSales)}</span></div>
    <div class="ledger-stat"><span class="ledger-stat-label">Total Credit</span><span class="ledger-stat-value credit-val">${money(s.totalCredit)}</span></div>
    <div class="ledger-stat"><span class="ledger-stat-label">Purchases</span><span class="ledger-stat-value debit-val">${money(s.totalPurchases)}</span></div>
    <div class="ledger-stat"><span class="ledger-stat-label">Expenses</span><span class="ledger-stat-value debit-val">${money(s.totalExpenses)}</span></div>
    <div class="ledger-stat"><span class="ledger-stat-label">Total Debit</span><span class="ledger-stat-value debit-val">${money(s.totalDebit)}</span></div>
    <div class="ledger-stat ledger-stat-net"><span class="ledger-stat-label">Net Balance</span><span class="ledger-stat-value" style="color:${netColor};font-size:1.15rem;">${money(s.netBalance)}</span></div>`;
}

function applyLedgerFilter() {
  if (!_ledgerData) return;
  const filter = document.getElementById("ledgerTypeFilter").value;
  const rows = filter ? _ledgerData.rows.filter(r => r.type === filter) : _ledgerData.rows;
  document.getElementById("ledgerRowCount").textContent = rows.length + " transaction" + (rows.length !== 1 ? "s" : "");
  renderLedgerTable(rows);
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
    <th style="width:90px">Date</th>
    <th style="width:110px">Type</th>
    <th style="width:110px">Reference</th>
    <th>Party / Description</th>
    <th class="r" style="width:110px">Debit (₹)</th>
    <th class="r" style="width:110px">Credit (₹)</th>
    <th class="r" style="width:120px">Balance (₹)</th>
  </tr>`;
  const tbody = [...rows].reverse().map(r => {
    const s = LEDGER_TYPE_STYLE[r.type] || { bg: "#f5f5f5", color: "#333", icon: "•" };
    const dateStr = r.date ? new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
    const debitCell  = r.debit  ? `<td class="ledger-debit">${money(r.debit)}</td>`  : `<td class="ledger-nil">—</td>`;
    const creditCell = r.credit ? `<td class="ledger-credit">${money(r.credit)}</td>` : `<td class="ledger-nil">—</td>`;
    const balColor = r.balance >= 0 ? "#0a7c3e" : "#dc3545";
    const shortDesc = r.description ? esc(r.description.slice(0,55)) + (r.description.length>55?"…":"") : "";
    const partyDesc = shortDesc
      ? `${esc(r.party)}<br><small style="color:#999">${shortDesc}</small>`
      : esc(r.party);
    const payBadge = (r.type === "Sale" || r.type === "Proforma")
      ? `<span class="ledger-pay-badge ledger-pay-${r.paymentStatus}">${r.paymentStatus}</span>` : "";
    return `<tr class="ledger-row">
      <td class="ledger-date">${dateStr}</td>
      <td><span class="ledger-type-chip" style="background:${s.bg};color:${s.color}">${s.icon} ${r.type}</span></td>
      <td class="ledger-ref">${esc(r.reference)}<br>${payBadge}</td>
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
  let csv = ["Date","Type","Reference","Party","Description","Debit","Credit","Balance","Payment Status"].map(c).join(",") + "\n";
  rows.forEach(r => {
    csv += [
      r.date ? new Date(r.date).toLocaleDateString("en-IN") : "",
      r.type, r.reference, r.party, r.description,
      r.debit || "", r.credit || "", r.balance, r.paymentStatus || ""
    ].map(c).join(",") + "\n";
  });
  const period = _ledgerPeriod === "month" ? (_ledgerMonth || "month") : _ledgerPeriod === "year" ? (_ledgerYear || "year") : "all";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `Ledger_${period}.csv`;
  a.click();
  showSuccess("Ledger exported!");
}

// ── CHANGE PASSWORD ──
function showChangePassword() { document.getElementById("changePwdModal").style.display = "flex"; document.getElementById("cpUsername").value = currentUser; }
function closeChangePassword() {
  document.getElementById("changePwdModal").style.display = "none";
  document.getElementById("cpOldPassword").value = ""; document.getElementById("cpNewPassword").value = "";
  document.getElementById("changePwdError").style.display = "none";
}
function submitChangePassword() {
  const username = document.getElementById("cpUsername").value.trim();
  const oldPassword = document.getElementById("cpOldPassword").value.trim();
  const newPassword = document.getElementById("cpNewPassword").value.trim();
  apiFetch("/change-password", { method: "POST", body: JSON.stringify({ username, oldPassword, newPassword }) }).then(res => res.json()).then(result => {
    if (result.success) { showSuccess("Password changed!"); sessionStorage.removeItem("mustChangePassword"); document.getElementById("pwdBanner").style.display = "none"; closeChangePassword(); }
    else { const err = document.getElementById("changePwdError"); err.textContent = result.message; err.style.display = "block"; }
  });
}
