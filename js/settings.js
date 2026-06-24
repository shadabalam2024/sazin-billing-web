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
  if (pass) payload.smtpPass = pass;
  apiFetch("/settings", { method: "POST", body: JSON.stringify(payload) }).then(r => r.json()).then(res => {
    if (res.success) { showSuccess("Email settings saved!"); document.getElementById("setSmtpPass").value = ""; loadSettings(); }
    else showError(res.message || "Save failed.");
  });
}
