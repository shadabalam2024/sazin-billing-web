// ── INVENTORY CACHE ──
let _inventoryCache = [];
function loadInventoryCache() {
  apiFetch("/inventory").then(r => r.json()).then(items => { _inventoryCache = items; }).catch(() => {});
}

// ── PRODUCT AUTOCOMPLETE ──
// sugBoxes live in <body> with position:fixed to escape overflow:auto clipping.
// Each input carries a data-sugid linking it to its floating sugBox div.
// On scroll the active sugBox is repositioned so it tracks the input.
const _sugScrollHandlers = new Map();
window.addEventListener("scroll", () => { _sugScrollHandlers.forEach(fn => fn()); }, { passive: true });
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
        e.preventDefault();
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

  // Only suggest items that are in stock (stockQty > 0)
  function inStockItems() { return _inventoryCache.filter(i => (parseFloat(i.stockQty) || 0) > 0); }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    checkMatch();
    if (!q) { hideSugBox(); return; }
    const matches = inStockItems().filter(i => i.name.toLowerCase().includes(q)).slice(0, 10);
    if (matches.length) renderSuggestions(matches); else hideSugBox();
    (tableId === "qMeasurements" ? calcQuoteRow : calculateRow)(row);
  });

  input.addEventListener("focus", () => {
    const q = input.value.trim().toLowerCase();
    if (q) {
      const matches = inStockItems().filter(i => i.name.toLowerCase().includes(q)).slice(0, 10);
      if (matches.length) renderSuggestions(matches);
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(hideSugBox, 200);
    checkMatch();
  });

  dropBtn.addEventListener("mousedown", e => e.preventDefault());
  dropBtn.addEventListener("click", () => {
    if (sugBox.style.display === "block") { hideSugBox(); return; }
    const inStock = inStockItems();
    if (inStock.length) {
      renderSuggestions(inStock);
    } else if (_inventoryCache.length) {
      sugBox.innerHTML = `<div class="prod-sug-item prod-sug-empty">All items are out of stock. Add stock in the Inventory tab.</div>`;
      showSugBox();
    } else {
      sugBox.innerHTML = `<div class="prod-sug-item prod-sug-empty">No inventory items yet — add them in the Inventory tab.</div>`;
      showSugBox();
    }
  });

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
