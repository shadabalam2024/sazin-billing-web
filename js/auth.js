// ── ROLE UI + PERMISSIONS + DATE ──
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("welcomeUser").textContent = `👤 ${currentUser}`;
  const roleTag = document.getElementById("roleTag");
  roleTag.textContent = currentRole === "admin" ? "Admin" : "Staff";
  roleTag.className = "role-tag " + (currentRole === "admin" ? "role-admin" : "role-staff");
  if (currentRole !== "admin") {
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
    document.querySelectorAll(".tab-btn[data-perm]").forEach(btn => {
      const perm = btn.dataset.perm;
      const allowed = Array.isArray(currentPermissions) ? currentPermissions.includes(perm) : false;
      btn.style.display = allowed ? "" : "none";
    });
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
});

function logout() {
  apiFetch("/logout", { method: "POST" }).catch(() => {}).finally(() => { sessionStorage.clear(); window.location.href = "login.html"; });
}

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
