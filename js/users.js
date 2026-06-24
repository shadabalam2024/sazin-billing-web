// ── USER MANAGEMENT ──
function loadUsers() {
  if (currentRole !== "admin") return;
  apiFetch("/users").then(res => res.json()).then(users => {
    const el = document.getElementById("userList");
    if (!users.length) { el.innerHTML = "<p style='color:#888'>No users found.</p>"; return; }
    el.innerHTML = `<table class="result-table"><thead><tr><th>Username</th><th>Role</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${users.map(u => `<tr>
        <td style="font-weight:600;">${esc(u.username)}</td>
        <td><span class="role-tag ${u.role === 'admin' ? 'role-admin' : 'role-staff'}">${u.role === 'admin' ? 'Admin' : 'Staff'}</span></td>
        <td style="font-size:0.8rem;color:#555;">${u.role === 'admin' ? '<em>All tabs</em>' : (Array.isArray(u.permissions) ? u.permissions.length + ' tabs' : 'default')}</td>
        <td>${u.mustChangePassword ? '<span style="color:#dc3545;font-size:0.8rem;">Must change password</span>' : '<span style="color:#28a745;font-size:0.8rem;">Active</span>'}</td>
        <td>
          <button class="btn blue small-btn" data-perms='${JSON.stringify(u.permissions || null)}' onclick="showEditUserModal('${esc(u.username)}','${esc(u.role)}',JSON.parse(this.dataset.perms))">Edit</button>
          ${u.username !== currentUser ? `<button class="btn red small-btn" onclick="deleteUser('${esc(u.username)}')">Delete</button>` : '<span style="font-size:0.75rem;color:#888;padding:0 6px;">(you)</span>'}
        </td>
      </tr>`).join("")}
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

function deleteUser(username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  apiFetch(`/users/${username}`, { method: "DELETE" }).then(res => res.json()).then(r => {
    if (r.success) { showSuccess(`User "${username}" deleted.`); loadUsers(); }
    else showError(r.message || "Delete failed.");
  });
}
