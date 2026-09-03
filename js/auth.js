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
  }

  // Restore the tab from the URL hash (set by showTab below) so a refresh
  // or a shared link lands back on the same tab instead of always Billing.
  const hashTab = location.hash.slice(1);
  if (!(hashTab && applyTab(hashTab))) redirectToDefaultTab();
  window.addEventListener("hashchange", () => {
    const tab = location.hash.slice(1);
    // showTab() already applies the tab directly before touching the URL;
    // the hash assignment there fires this same event a moment later. If
    // that tab is already showing, this is that redundant echo, not a
    // real navigation (e.g. browser back/forward) — skip re-running the
    // load functions a second time.
    const active = document.querySelector(".tab-content.active");
    if (active && active.id === "tab-" + tab) return;
    if (!applyTab(tab)) redirectToDefaultTab();
  });

  document.getElementById("changePwdBtn").style.display = "inline-block";
  document.getElementById("currentDate").textContent = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  if (sessionStorage.getItem("mustChangePassword")) document.getElementById("pwdBanner").style.display = "block";
  loadSettings();
  loadInventoryCache();
  apiFetch("/version").then(r => r.json()).then(v => {
    document.getElementById("appVersion").textContent = `v${v.version} · ${v.commit}`;
  }).catch(() => {});
});

function logout() {
  apiFetch("/logout", { method: "POST" }).catch(() => {}).finally(() => { sessionStorage.clear(); window.location.href = "login.html"; });
}

function tabButton(tab) {
  return document.querySelector(`.tab-btn[data-perm="${tab}"]`) || (tab === "settings" ? document.querySelector(".tab-btn.admin-only") : null);
}

// Lands on Billing (or, for a staff user without Billing access, their first
// permitted tab) when the requested hash is missing, unknown, or not permitted.
function redirectToDefaultTab() {
  history.replaceState(null, "", location.pathname + location.search);
  if (currentRole !== "admin" && !(Array.isArray(currentPermissions) && currentPermissions.includes("billing"))) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    const firstVisible = document.querySelector(".tab-btn[data-perm]:not([style*='display: none']):not([style*='display:none'])");
    if (firstVisible) firstVisible.click();
  } else {
    location.hash = "billing";
  }
}

// Switches to `tab` and updates document state (active classes, lazy loads).
// Does NOT touch the URL — callers that should update it call showTab() instead.
function applyTab(tab, btn) {
  if (tab === "settings" && currentRole !== "admin") return false;
  if (currentRole !== "admin" && !(Array.isArray(currentPermissions) && currentPermissions.includes(tab))) return false;
  const content = document.getElementById("tab-" + tab);
  if (!content) return false;
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
  content.classList.add("active");
  const targetBtn = btn || tabButton(tab);
  if (targetBtn) targetBtn.classList.add("active");
  if (tab === "analytics") withTabLoading(tab, loadAnalytics);
  if (tab === "history") withTabLoading(tab, loadHistory);
  if (tab === "inventory") withTabLoading(tab, loadInventory);
  if (tab === "purchases") { withTabLoading(tab, loadPurchases); initExistingPurchaseRows(); }
  if (tab === "expenses") withTabLoading(tab, loadExpenses);
  if (tab === "dashboard") withTabLoading(tab, loadDashboard);
  if (tab === "quotations") { withTabLoading(tab, loadQuotes); loadNextQuotePreview(); }
  if (tab === "ledger") { withTabLoading(tab, loadLedger); }
  if (tab === "settings") { withTabLoading(tab, loadUsers); }
  return true;
}

function showTab(tab, btn) {
  if (!applyTab(tab, btn)) return;
  if (location.hash !== "#" + tab) location.hash = tab;
}
