console.log("✓ Renderer process loaded");

// ── AUTH GUARD ──
const TOKEN = sessionStorage.getItem("token");
const currentRole = sessionStorage.getItem("role");
const currentUser = sessionStorage.getItem("username");
let currentPermissions = null;
try { currentPermissions = JSON.parse(sessionStorage.getItem("permissions") || "null"); } catch(e) {}
if (!TOKEN || !currentRole || !currentUser) window.location.href = "login.html";

// Re-check auth when browser restores page from back-forward cache (bfcache).
// Without this, pressing Back after logout shows the cached app page.
window.addEventListener("pageshow", (e) => {
  if (e.persisted && !sessionStorage.getItem("token")) window.location.href = "login.html";
});

// API base URL — set window.SAZIN_API_URL in config.js (or index.html) to point at your backend.
const API = window.SAZIN_API_URL || "http://localhost:3000";
let SETTINGS = {};
let _historyData = [];

function apiFetch(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, { "x-auth-token": TOKEN });
  if (opts.body && !opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json";
  return fetch(API + path, opts).then(res => {
    if (res.status === 401) { sessionStorage.clear(); window.location.href = "login.html"; throw new Error("Session expired"); }
    return res;
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const money = n => "₹ " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function showToast(msg, type = "error") {
  let toast = document.getElementById("appToast");
  if (!toast) { toast = document.createElement("div"); toast.id = "appToast"; document.body.appendChild(toast); }
  toast.textContent = msg; toast.className = "app-toast " + type; toast.style.display = "block";
  clearTimeout(toast._timer); toast._timer = setTimeout(() => { toast.style.display = "none"; }, 3500);
}
function showError(msg) { showToast(msg, "toast-error"); }
function showSuccess(msg) { showToast(msg, "toast-success"); }

// ── TAB LOADING INDICATOR ──
// Switching to a data-driven tab (Dashboard, History, etc.) used to leave
// the tab looking blank/stuck for the ~1s round trip to the API. Show a
// spinner over the tab immediately, hide it once the load finishes either
// way.
function showTabLoading(tab) {
  const el = document.getElementById("tab-" + tab);
  if (!el || el.querySelector(".tab-loading-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "tab-loading-overlay";
  overlay.innerHTML = `<div class="tab-spinner"></div><span>Loading…</span>`;
  el.appendChild(overlay);
}
function hideTabLoading(tab) {
  const el = document.getElementById("tab-" + tab);
  const overlay = el && el.querySelector(".tab-loading-overlay");
  if (overlay) overlay.remove();
}
// Wraps a tab's load call. First visit to a tab this session: show the
// spinner (there's nothing to look at yet). Every visit after that: the
// previous render is still sitting in the DOM (tabs are hidden via CSS,
// never destroyed), so skip the spinner entirely and just refetch quietly
// in the background — the load function's own render call updates the
// content in place once it lands. This is what stops every tab switch
// from feeling like a fresh reload: revisiting a tab is instant, and data
// still self-corrects within about a second if something changed
// elsewhere (e.g. an invoice saved while you were on a different tab).
const _tabLoadedOnce = new Set();
function withTabLoading(tab, fn) {
  const firstLoad = !_tabLoadedOnce.has(tab);
  if (firstLoad) showTabLoading(tab);
  Promise.resolve(fn())
    .then(() => { _tabLoadedOnce.add(tab); })
    .catch(() => {})
    .finally(() => { if (firstLoad) hideTabLoading(tab); });
}
