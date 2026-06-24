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
