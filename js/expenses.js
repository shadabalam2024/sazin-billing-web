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
