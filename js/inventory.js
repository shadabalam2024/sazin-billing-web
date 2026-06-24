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
  el.innerHTML = `<div style="overflow-x:auto;"><table class="result-table inv-table"><thead><tr>
    <th style="text-align:left;min-width:120px;">Product</th>
    <th style="min-width:80px;">Category</th>
    <th style="min-width:55px;">Unit</th>
    <th style="min-width:60px;">HSN</th>
    <th style="min-width:70px;">Cost ₹</th>
    <th style="min-width:75px;">Selling ₹</th>
    <th style="min-width:60px;">Stock</th>
    <th style="min-width:170px;">Actions</th>
  </tr></thead><tbody>${items.map(i => {
    const isLow = parseFloat(i.stockQty) <= parseFloat(i.lowStockAlert || 5);
    return `<tr>
      <td style="text-align:left;">${esc(i.name)}</td>
      <td>${esc(i.category || "")}</td>
      <td>${esc(i.unit || "")}</td>
      <td>${esc(i.hsn || "")}</td>
      <td>₹ ${parseFloat(i.costPrice || 0).toFixed(2)}</td>
      <td>₹ ${parseFloat(i.sellingPrice || 0).toFixed(2)}</td>
      <td style="color:${isLow ? "#dc3545" : "inherit"};font-weight:${isLow ? "700" : "400"}">${i.stockQty}${isLow ? " ⚠️" : ""}</td>
      <td class="inv-actions">
        <button class="btn green small-btn" onclick="openAddStockModal('${esc(i.id)}')">➕</button>
        <button class="btn blue small-btn" onclick="openAddInventoryModal('${esc(i.id)}')">Edit</button>
        <button class="btn red small-btn" onclick="deleteInventoryItem('${esc(i.id)}')">Del</button>
      </td>
    </tr>`;
  }).join("")}</tbody></table></div>`;
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

// ── QUICK ADD STOCK ──
function openAddStockModal(id) {
  const item = _inventoryAll.find(i => i.id === id);
  if (!item) return;
  document.getElementById("addStockItemId").value = id;
  document.getElementById("addStockItemName").textContent = item.name;
  document.getElementById("addStockCurrentQty").textContent = `Current stock: ${item.stockQty} ${item.unit || ""}`;
  document.getElementById("addStockQty").value = "";
  document.getElementById("addStockModal").style.display = "flex";
  setTimeout(() => document.getElementById("addStockQty").focus(), 50);
}

function closeAddStockModal() {
  document.getElementById("addStockModal").style.display = "none";
}

function submitAddStock() {
  const id = document.getElementById("addStockItemId").value;
  const addQty = parseFloat(document.getElementById("addStockQty").value);
  if (!addQty || addQty <= 0) return showError("Enter a valid quantity to add.");
  const item = _inventoryAll.find(i => i.id === id);
  if (!item) return showError("Item not found.");
  const newQty = (parseFloat(item.stockQty) || 0) + addQty;
  const payload = {
    name: item.name, category: item.category, unit: item.unit, hsn: item.hsn,
    costPrice: item.costPrice, sellingPrice: item.sellingPrice,
    stockQty: newQty, lowStockAlert: item.lowStockAlert
  };
  apiFetch(`/inventory/${id}`, { method: "PUT", body: JSON.stringify(payload) }).then(r => r.json()).then(res => {
    if (res.success) {
      showSuccess(`Stock updated: ${item.name} → ${newQty} ${item.unit || ""}`);
      closeAddStockModal();
      loadInventory();
      loadInventoryCache();
    } else showError(res.message || "Failed to update stock.");
  });
}
