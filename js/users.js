// ── USER MANAGEMENT ──
function loadUsers() {
  if (currentRole !== "admin") return;
  apiFetch("/users").then(res => res.json()).then(users => {
    const el = document.getElementById("userList");
    if (!users.length) { el.innerHTML = "<p style='color:#888'>No users found.</p>"; return; }
    el.innerHTML = `<table class="result-table"><thead><tr><th>Username</th><th>Role</th><th>Access</th><th>Last Login</th><th>Session</th><th>Actions</th></tr></thead><tbody>
      ${users.map(u => {
        const lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Never';
        const sessionBadge = u.sessionActive
          ? `<span style="color:#16a34a;font-size:0.8rem;font-weight:600;">● Active</span>`
          : (u.lastLoginAt ? `<span style="color:#9ca3af;font-size:0.8rem;">○ Logged out</span>` : `<span style="color:#9ca3af;font-size:0.8rem;">—</span>`);
        return `<tr>
          <td style="font-weight:600;">${esc(u.username)}${u.mustChangePassword ? ' <span style="color:#dc3545;font-size:0.75rem;">(pwd change req.)</span>' : ''}</td>
          <td><span class="role-tag ${u.role === 'admin' ? 'role-admin' : 'role-staff'}">${u.role === 'admin' ? 'Admin' : 'Staff'}</span></td>
          <td style="font-size:0.8rem;color:#555;">${u.role === 'admin' ? '<em>All tabs</em>' : (Array.isArray(u.permissions) ? u.permissions.length + ' tabs' : 'default')}</td>
          <td style="font-size:0.8rem;color:#555;white-space:nowrap;">${lastLogin}</td>
          <td>${sessionBadge}</td>
          <td style="white-space:nowrap;">
            <button class="btn blue small-btn" data-perms='${JSON.stringify(u.permissions || null)}' onclick="showEditUserModal('${esc(u.username)}','${esc(u.role)}',JSON.parse(this.dataset.perms))">Edit</button>
            ${u.username !== currentUser
              ? `<button class="btn small-btn" style="background:#e67e22;color:#fff;" onclick="forceLogout('${esc(u.username)}')" title="Kick off all devices">⏏ Logout</button>
                 <button class="btn red small-btn" onclick="deleteUser('${esc(u.username)}')">Delete</button>`
              : '<span style="font-size:0.75rem;color:#888;padding:0 6px;">(you)</span>'}
          </td>
        </tr>`;
      }).join("")}
    </tbody></table>`;
  }).catch(() => {});
}

function _setPermCheckboxes(perms) {
  const defaults = ["billing","quotations","clients","history","inventory","purchases","expenses"];
  const active = Array.isArray(perms) ? perms : defaults;
  document.querySelectorAll("#userPermissionsSection input[name=perm]").forEach(cb => {
    cb.checked = active.includes(cb.value);
  });
}

function onUserRoleChange() {
  const role = document.getElementById("newUserRole").value;
  document.getElementById("userPermissionsSection").style.display = role === "staff" ? "" : "none";
}

function showAddUserModal() {
  document.getElementById("addUserModalTitle").textContent = "👤 Add User";
  document.getElementById("editingUsername").value = "";
  document.getElementById("newUsername").value = "";
  document.getElementById("newUsername").disabled = false;
  document.getElementById("newUserRole").value = "staff";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newPasswordLabel").textContent = "Password (min 6 chars)";
  document.getElementById("addUserError").style.display = "none";
  document.getElementById("userPermissionsSection").style.display = "";
  _setPermCheckboxes(null);
  document.getElementById("addUserModal").style.display = "flex";
}

function showEditUserModal(username, role, permissions) {
  document.getElementById("addUserModalTitle").textContent = "✏️ Edit User";
  document.getElementById("editingUsername").value = username;
  document.getElementById("newUsername").value = username;
  document.getElementById("newUsername").disabled = true;
  document.getElementById("newUserRole").value = role;
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newPasswordLabel").textContent = "New Password (leave blank to keep existing)";
  document.getElementById("addUserError").style.display = "none";
  const isStaff = role === "staff";
  document.getElementById("userPermissionsSection").style.display = isStaff ? "" : "none";
  if (isStaff) _setPermCheckboxes(permissions);
  document.getElementById("addUserModal").style.display = "flex";
}

function closeAddUserModal() { document.getElementById("addUserModal").style.display = "none"; }

function _getSelectedPermissions() {
  return Array.from(document.querySelectorAll("#userPermissionsSection input[name=perm]:checked")).map(cb => cb.value);
}

function submitAddUser() {
  const editingUsername = document.getElementById("editingUsername").value;
  const username = document.getElementById("newUsername").value.trim();
  const role = document.getElementById("newUserRole").value;
  const password = document.getElementById("newUserPassword").value.trim();
  const errEl = document.getElementById("addUserError");
  errEl.style.display = "none";
  const permissions = role === "staff" ? _getSelectedPermissions() : undefined;
  if (editingUsername) {
    const payload = { role };
    if (password) payload.newPassword = password;
    if (permissions !== undefined) payload.permissions = permissions;
    apiFetch(`/users/${editingUsername}`, { method: "PUT", body: JSON.stringify(payload) }).then(res => res.json()).then(r => {
      if (r.success) { showSuccess("User updated!"); closeAddUserModal(); loadUsers(); }
      else { errEl.textContent = r.message; errEl.style.display = "block"; }
    });
  } else {
    if (!username) { errEl.textContent = "Username is required."; errEl.style.display = "block"; return; }
    if (!password) { errEl.textContent = "Password is required."; errEl.style.display = "block"; return; }
    const body = { username, role, password };
    if (permissions !== undefined) body.permissions = permissions;
    apiFetch("/users", { method: "POST", body: JSON.stringify(body) }).then(res => res.json()).then(r => {
      if (r.success) { showSuccess(`User "${username}" created!`); closeAddUserModal(); loadUsers(); }
      else { errEl.textContent = r.message; errEl.style.display = "block"; }
    });
  }
}

function forceLogout(username) {
  if (!confirm(`Force-logout "${username}" from all devices? They will need to sign in again.`)) return;
  apiFetch(`/users/${username}/force-logout`, { method: 'POST' }).then(r => r.json()).then(r => {
    if (r.success) { showSuccess(`"${username}" has been logged out from all devices.`); loadUsers(); }
    else showError(r.message || 'Force-logout failed.');
  });
}

function deleteUser(username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  apiFetch(`/users/${username}`, { method: "DELETE" }).then(res => res.json()).then(r => {
    if (r.success) { showSuccess(`User "${username}" deleted.`); loadUsers(); }
    else showError(r.message || "Delete failed.");
  });
}
