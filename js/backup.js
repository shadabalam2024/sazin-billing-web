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
