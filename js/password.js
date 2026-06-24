// ── CHANGE PASSWORD ──
function showChangePassword() {
  document.getElementById("changePwdModal").style.display = "flex";
  document.getElementById("cpUsername").value = currentUser;
}

function closeChangePassword() {
  document.getElementById("changePwdModal").style.display = "none";
  document.getElementById("cpOldPassword").value = "";
  document.getElementById("cpNewPassword").value = "";
  document.getElementById("changePwdError").style.display = "none";
}

function submitChangePassword() {
  const username = document.getElementById("cpUsername").value.trim();
  const oldPassword = document.getElementById("cpOldPassword").value.trim();
  const newPassword = document.getElementById("cpNewPassword").value.trim();
  apiFetch("/change-password", { method: "POST", body: JSON.stringify({ username, oldPassword, newPassword }) }).then(res => res.json()).then(result => {
    if (result.success) {
      showSuccess("Password changed!");
      sessionStorage.removeItem("mustChangePassword");
      document.getElementById("pwdBanner").style.display = "none";
      closeChangePassword();
    } else {
      const err = document.getElementById("changePwdError");
      err.textContent = result.message;
      err.style.display = "block";
    }
  });
}
