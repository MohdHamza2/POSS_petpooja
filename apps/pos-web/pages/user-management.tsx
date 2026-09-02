import React, { useEffect, useState } from "react";
import Head from "next/head";
import { authedFetch, useAuthGuard } from "../lib/auth";
import Nav from "../components/Nav";

// Real response shapes from apps/api/src/routes/user-management.ts.
interface UserRoleApi {
  roleId: string;
  roleName: string;
  outletId: string | null;
  outletName: string | null;
}

interface UserApi {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  hasPin?: boolean;
  userRoles: UserRoleApi[];
}

interface RoleApi {
  id: string;
  name: string;
  description: string | null;
}

interface PermissionApi {
  id: string;
  action: string;
  description: string | null;
}

export default function UserManagement() {
  const { me, loading: authLoading } = useAuthGuard("menu.category.manage");

  const [users, setUsers] = useState<UserApi[]>([]);
  const [roles, setRoles] = useState<RoleApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Per-user pending selection for the assign form.
  const [selectedRole, setSelectedRole] = useState<Record<string, string>>({});
  const [selectedOutlet, setSelectedOutlet] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // For Create User Modal
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPin, setNewUserPin] = useState("");
  const [newUserFirstName, setNewUserFirstName] = useState("");
  const [newUserLastName, setNewUserLastName] = useState("");
  const [newUserPhone, setNewUserPhone] = useState("");
  const [newUserRoleId, setNewUserRoleId] = useState("");
  const [newUserOutletId, setNewUserOutletId] = useState("");

  // For Edit User Modal
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserEmail, setEditUserEmail] = useState("");
  const [editUserPassword, setEditUserPassword] = useState("");
  const [editUserPin, setEditUserPin] = useState("");
  const [editUserFirstName, setEditUserFirstName] = useState("");
  const [editUserLastName, setEditUserLastName] = useState("");
  const [editUserPhone, setEditUserPhone] = useState("");
  const [editUserIsActive, setEditUserIsActive] = useState(true);

  // For delete status
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // Role & permission matrix
  const [permissions, setPermissions] = useState<PermissionApi[]>([]);
  const [showRoleEditor, setShowRoleEditor] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleGrantedIds, setRoleGrantedIds] = useState<Set<string>>(new Set());
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      const res = await authedFetch(`/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          pin: newUserPin || null,
          firstName: newUserFirstName,
          lastName: newUserLastName,
          phone: newUserPhone || null,
          roleId: newUserRoleId || null,
          outletId: newUserOutletId || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "HTTP error " + res.status);
      }
      setShowAddUserModal(false);
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserPin("");
      setNewUserFirstName("");
      setNewUserLastName("");
      setNewUserPhone("");
      setNewUserRoleId("");
      setNewUserOutletId("");
      fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create user");
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId) return;
    setActionError(null);
    try {
      const payload: any = {
        email: editUserEmail,
        firstName: editUserFirstName,
        lastName: editUserLastName,
        phone: editUserPhone || null,
        isActive: editUserIsActive,
      };
      if (editUserPassword) payload.password = editUserPassword;
      if (editUserPin) payload.pin = editUserPin;

      const res = await authedFetch(`/users/${editingUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "HTTP error " + res.status);
      }
      setShowEditUserModal(false);
      setEditingUserId(null);
      fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update user");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm("Are you sure you want to delete this staff account?")) return;
    setActionError(null);
    setDeletingUserId(userId);
    try {
      const res = await authedFetch(`/users/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "HTTP error " + res.status);
      }
      fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeletingUserId(null);
    }
  };

  const fetchData = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      authedFetch(`/users`).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<UserApi[]>;
      }),
      authedFetch(`/roles`).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<RoleApi[]>;
      }),
      authedFetch(`/permissions`).then((res) => {
        if (!res.ok) throw new Error("HTTP error " + res.status);
        return res.json() as Promise<PermissionApi[]>;
      }),
    ])
      .then(([usersRes, rolesRes, permissionsRes]) => {
        setUsers(Array.isArray(usersRes) ? usersRes : []);
        setRoles(Array.isArray(rolesRes) ? rolesRes : []);
        setPermissions(Array.isArray(permissionsRes) ? permissionsRes : []);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load users");
        setUsers([]);
        setRoles([]);
        setPermissions([]);
        setLoading(false);
      });
  };

  const openCreateRole = () => {
    setEditingRoleId(null);
    setRoleName("");
    setRoleDescription("");
    setRoleGrantedIds(new Set());
    setRoleError(null);
    setShowRoleEditor(true);
  };

  const openEditRole = async (role: RoleApi) => {
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setRoleDescription(role.description ?? "");
    setRoleError(null);
    setShowRoleEditor(true);
    try {
      const res = await authedFetch(`/roles/${role.id}/permissions`);
      if (!res.ok) throw new Error("HTTP error " + res.status);
      const body = (await res.json()) as { permissionIds: string[] };
      setRoleGrantedIds(new Set(body.permissionIds));
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "Failed to load role permissions");
      setRoleGrantedIds(new Set());
    }
  };

  const togglePermission = (permissionId: string) => {
    setRoleGrantedIds((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  };

  const saveRole = async () => {
    if (!roleName.trim()) {
      setRoleError("Role name is required.");
      return;
    }
    setRoleSaving(true);
    setRoleError(null);
    try {
      let roleId = editingRoleId;
      if (roleId) {
        const res = await authedFetch(`/roles/${roleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: roleName.trim(), description: roleDescription || null }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "HTTP error " + res.status);
        }
      } else {
        const res = await authedFetch(`/roles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: roleName.trim(), description: roleDescription || null }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "HTTP error " + res.status);
        }
        const created = (await res.json()) as RoleApi;
        roleId = created.id;
      }

      const permRes = await authedFetch(`/roles/${roleId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionIds: Array.from(roleGrantedIds) }),
      });
      if (!permRes.ok) {
        const body = await permRes.json().catch(() => ({}));
        throw new Error(body.error || "HTTP error " + permRes.status);
      }

      setShowRoleEditor(false);
      fetchData();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setRoleSaving(false);
    }
  };

  const deleteRole = async (roleId: string) => {
    if (!window.confirm("Delete this role? Only possible if no users hold it.")) return;
    setDeletingRoleId(roleId);
    setActionError(null);
    try {
      const res = await authedFetch(`/roles/${roleId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "HTTP error " + res.status);
      }
      fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete role");
    } finally {
      setDeletingRoleId(null);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const assignRole = async (userId: string) => {
    const roleId = selectedRole[userId];
    if (!roleId) {
      setActionError("Pick a role before assigning.");
      return;
    }
    const outletId = selectedOutlet[userId] || null;

    setActionError(null);
    setAssigning(userId);
    try {
      const res = await authedFetch(`/users/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, outletId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "HTTP error " + body.error);
      }
      fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to assign role");
    } finally {
      setAssigning(null);
    }
  };

  const revokeRole = async (userId: string, roleId: string) => {
    setActionError(null);
    setRevoking(`${userId}:${roleId}`);
    try {
      const res = await authedFetch(`/users/${userId}/roles/${roleId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "HTTP error " + res.status);
      }
      fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to revoke role");
    } finally {
      setRevoking(null);
    }
  };

  const initials = me?.name
    ? me.name
        .split(" ")
        .map((p) => p.charAt(0))
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <div className="admin-app">
      <Head>
        <title>Kapmeta POS - User & Role Management</title>
        <meta name="description" content="Assign and revoke roles for users across outlets." />
      </Head>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <Nav variant="sidebar" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-badge">
            <span className="brand-icon">⚡</span>
            <span className="brand-name">Kapmeta Analytics</span>
          </div>
        </div>

        <div className="topbar-right">
          <div className="user-profile-badge">
            <div className="avatar-circle">{initials}</div>
            <div className="user-info-text">
              <span className="user-name">{me?.name ?? "Loading..."}</span>
              <span className="user-role">{me?.roles?.[0] ?? ""}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="dashboard-body">
        {authLoading && (
          <div className="empty-state-card">
            <span className="empty-icon">🔐</span>
            <h3>Checking access...</h3>
          </div>
        )}

        {!authLoading && (
          <>
            <section className="dashboard-greeting-row">
              <div>
                <span className="breadcrumb-line">Operations &gt; User & Role Management</span>
                <h1 className="greeting-title">Users &amp; Roles</h1>
                <p className="greeting-subtitle">
                  Assign or revoke roles for staff accounts. Changes write directly to the
                  RolePermission-backed RBAC tables and take effect on the user's next request.
                </p>
              </div>
            </section>

            {actionError && (
              <div className="empty-state-card error-card">
                <span className="empty-icon">⚠️</span>
                <p>{actionError}</p>
              </div>
            )}

            {loading && (
              <div className="empty-state-card">
                <span className="empty-icon">⏳</span>
                <h3>Loading users...</h3>
              </div>
            )}

            {!loading && loadError && (
              <div className="empty-state-card">
                <span className="empty-icon">⚠️</span>
                <h3>Could not load users</h3>
                <p>{loadError}. Check that the API is running and you are signed in.</p>
              </div>
            )}

            {!loading && !loadError && users.length === 0 && (
              <div className="empty-state-card">
                <span className="empty-icon">🧑‍💼</span>
                <h3>No users found</h3>
              </div>
            )}

            {!loading && !loadError && users.length > 0 && (
              <section className="panel-card invoices-table-card">
                <div className="panel-header">
                  <div>
                    <h3>All Users</h3>
                    <p className="panel-sub">From GET /users — real DB rows only</p>
                  </div>
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <button className="add-user-btn" onClick={() => setShowAddUserModal(true)}>
                      + Add Staff Member
                    </button>
                    <span className="total-badge">{users.length} users</span>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="clean-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th>Current Roles</th>
                        <th>Assign New Role</th>
                        <th>Outlet (blank = org-wide)</th>
                        <th></th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <strong>
                              {user.firstName} {user.lastName}
                            </strong>
                            {!user.isActive && <div className="inactive-tag">Inactive</div>}
                            {user.hasPin ? <div className="inactive-tag" style={{ color: "#047857" }}>PIN set</div> : <div className="inactive-tag">No PIN</div>}
                          </td>
                          <td>{user.email}</td>
                          <td>
                            {user.userRoles.length === 0 && (
                              <span className="no-roles">No roles assigned</span>
                            )}
                            {user.userRoles.map((ur) => (
                              <div key={ur.roleId} className="role-chip">
                                <span>
                                  {ur.roleName}
                                  {ur.outletName ? ` @ ${ur.outletName}` : " (org-wide)"}
                                </span>
                                <button
                                  className="revoke-btn"
                                  disabled={revoking === `${user.id}:${ur.roleId}`}
                                  onClick={() => revokeRole(user.id, ur.roleId)}
                                >
                                  {revoking === `${user.id}:${ur.roleId}` ? "..." : "✕"}
                                </button>
                              </div>
                            ))}
                          </td>
                          <td>
                            <select
                              value={selectedRole[user.id] ?? ""}
                              onChange={(e) =>
                                setSelectedRole((prev) => ({ ...prev, [user.id]: e.target.value }))
                              }
                              className="role-select"
                            >
                              <option value="">Select role...</option>
                              {roles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder="Outlet ID (optional)"
                              value={selectedOutlet[user.id] ?? ""}
                              onChange={(e) =>
                                setSelectedOutlet((prev) => ({ ...prev, [user.id]: e.target.value }))
                              }
                              className="outlet-input"
                            />
                          </td>
                          <td>
                            <button
                              className="assign-btn"
                              disabled={assigning === user.id}
                              onClick={() => assignRole(user.id)}
                            >
                              {assigning === user.id ? "Assigning..." : "Assign"}
                            </button>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                className="edit-btn"
                                onClick={() => {
                                  setEditingUserId(user.id);
                                  setEditUserEmail(user.email);
                                  setEditUserFirstName(user.firstName);
                                  setEditUserLastName(user.lastName);
                                  setEditUserPhone(user.phone || "");
                                  setEditUserIsActive(user.isActive);
                                  setEditUserPassword("");
                                  setEditUserPin("");
                                  setShowEditUserModal(true);
                                }}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                className="delete-btn"
                                disabled={deletingUserId === user.id || user.id === me?.userId}
                                onClick={() => handleDeleteUser(user.id)}
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {!loading && !loadError && (
              <section className="panel-card invoices-table-card">
                <div className="panel-header">
                  <div>
                    <h3>Roles & Permissions</h3>
                    <p className="panel-sub">Custom roles write directly to RolePermission — new roles show up in Assign New Role above instantly</p>
                  </div>
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <button className="add-user-btn" onClick={openCreateRole}>+ New Role</button>
                    <span className="total-badge">{roles.length} roles</span>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="clean-table">
                    <thead>
                      <tr>
                        <th>Role</th>
                        <th>Description</th>
                        <th>Users assigned</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map((role) => {
                        const assignedCount = users.filter((u) => u.userRoles.some((ur) => ur.roleId === role.id)).length;
                        return (
                          <tr key={role.id}>
                            <td><strong>{role.name}</strong></td>
                            <td>{role.description || <span className="no-roles">—</span>}</td>
                            <td>{assignedCount}</td>
                            <td>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button className="edit-btn" onClick={() => openEditRole(role)}>✏️ Edit</button>
                                <button
                                  className="delete-btn"
                                  disabled={deletingRoleId === role.id || assignedCount > 0}
                                  onClick={() => deleteRole(role.id)}
                                  title={assignedCount > 0 ? "Revoke from all users first" : undefined}
                                >
                                  {deletingRoleId === role.id ? "..." : "🗑️ Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Create User Modal */}
            {showAddUserModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <div className="modal-header">
                    <h4>Add New Staff Member</h4>
                    <button className="close-modal-btn" onClick={() => setShowAddUserModal(false)}>✕</button>
                  </div>
                  <form onSubmit={handleCreateUser} className="modal-form">
                    <div className="form-group">
                      <label>First Name *</label>
                      <input type="text" required value={newUserFirstName} onChange={(e) => setNewUserFirstName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Last Name *</label>
                      <input type="text" required value={newUserLastName} onChange={(e) => setNewUserLastName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Email Address *</label>
                      <input type="email" required value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Password *</label>
                      <input type="password" required value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>POS Pin (4-digit, optional)</label>
                      <input type="text" maxLength={4} value={newUserPin} onChange={(e) => setNewUserPin(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Phone Number</label>
                      <input type="text" value={newUserPhone} onChange={(e) => setNewUserPhone(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Initial Role</label>
                      <select value={newUserRoleId} onChange={(e) => setNewUserRoleId(e.target.value)}>
                        <option value="">None</option>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Outlet Scope (blank = org-wide)</label>
                      <input type="text" placeholder="Outlet ID" value={newUserOutletId} onChange={(e) => setNewUserOutletId(e.target.value)} />
                    </div>
                    <div className="modal-actions">
                      <button type="button" className="cancel-modal-btn" onClick={() => setShowAddUserModal(false)}>Cancel</button>
                      <button type="submit" className="submit-modal-btn">Create Account</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Edit User Modal */}
            {showEditUserModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <div className="modal-header">
                    <h4>Edit Staff Member</h4>
                    <button className="close-modal-btn" onClick={() => { setShowEditUserModal(false); setEditingUserId(null); }}>✕</button>
                  </div>
                  <form onSubmit={handleUpdateUser} className="modal-form">
                    <div className="form-group">
                      <label>First Name</label>
                      <input type="text" required value={editUserFirstName} onChange={(e) => setEditUserFirstName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Last Name</label>
                      <input type="text" required value={editUserLastName} onChange={(e) => setEditUserLastName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Email Address</label>
                      <input type="email" required value={editUserEmail} onChange={(e) => setEditUserEmail(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Reset Password (leave blank to keep current)</label>
                      <input type="password" value={editUserPassword} onChange={(e) => setEditUserPassword(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Reset POS Pin (leave blank to keep current)</label>
                      <input type="text" maxLength={4} value={editUserPin} onChange={(e) => setEditUserPin(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Phone Number</label>
                      <input type="text" value={editUserPhone} onChange={(e) => setEditUserPhone(e.target.value)} />
                    </div>
                    <div className="form-group-checkbox">
                      <label>
                        <input type="checkbox" checked={editUserIsActive} onChange={(e) => setEditUserIsActive(e.target.checked)} />
                        Account is Active
                      </label>
                    </div>
                    <div className="modal-actions">
                      <button type="button" className="cancel-modal-btn" onClick={() => { setShowEditUserModal(false); setEditingUserId(null); }}>Cancel</button>
                      <button type="submit" className="submit-modal-btn">Save Changes</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            {/* Role Editor Modal — permission matrix */}
            {showRoleEditor && (
              <div className="modal-overlay">
                <div className="modal-content" style={{ width: 640, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
                  <div className="modal-header">
                    <h4>{editingRoleId ? "Edit Role" : "New Role"}</h4>
                    <button className="close-modal-btn" onClick={() => setShowRoleEditor(false)}>✕</button>
                  </div>
                  {roleError && (
                    <div className="empty-state-card error-card" style={{ marginBottom: 12 }}>
                      <p>{roleError}</p>
                    </div>
                  )}
                  <div className="modal-form" style={{ overflowY: "auto", paddingRight: 4 }}>
                    <div className="form-group">
                      <label>Role Name *</label>
                      <input type="text" required value={roleName} onChange={(e) => setRoleName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Description</label>
                      <input type="text" value={roleDescription} onChange={(e) => setRoleDescription(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Permissions ({roleGrantedIds.size} granted)</label>
                      <div className="permission-matrix">
                        {permissions.map((p) => (
                          <label key={p.id} className="permission-row">
                            <input
                              type="checkbox"
                              checked={roleGrantedIds.has(p.id)}
                              onChange={() => togglePermission(p.id)}
                            />
                            <span className="permission-action">{p.action}</span>
                            {p.description && <span className="permission-desc">{p.description}</span>}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="cancel-modal-btn" onClick={() => setShowRoleEditor(false)}>Cancel</button>
                    <button type="button" className="submit-modal-btn" disabled={roleSaving} onClick={saveRole}>
                      {roleSaving ? "Saving..." : "Save Role"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .admin-app {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          width: 100vw;
          background-color: var(--bg-base);
          color: var(--text-primary);
        }

        .topbar {
          height: 64px;
          background-color: var(--bg-card);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          position: sticky;
          top: 0;
          z-index: 20;
        }

        .topbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .brand-badge {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .brand-icon {
          width: 32px;
          height: 32px;
          border-radius: var(--radius-sm);
          background: var(--dark-btn);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
        }

        .brand-name {
          font-size: 1.125rem;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .nav-pill-group {
          display: flex;
          background-color: var(--bg-subtle);
          padding: 4px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--border);
          gap: 4px;
        }

        .nav-item {
          padding: 6px 16px;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-secondary);
          text-decoration: none;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .nav-item:hover {
          color: var(--text-primary);
        }

        .nav-item.active {
          background-color: var(--bg-card);
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
        }

        .topbar-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .user-profile-badge {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .avatar-circle {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 0.8125rem;
        }

        .user-info-text {
          display: flex;
          flex-direction: column;
        }

        .user-name {
          font-size: 0.8125rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .user-role {
          font-size: 0.6875rem;
          color: var(--text-secondary);
        }

        .dashboard-body {
          padding: 24px 32px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 1500px;
          margin: 0 auto;
          width: 100%;
        }

        .dashboard-greeting-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding-bottom: 8px;
        }

        .breadcrumb-line {
          font-size: 0.75rem;
          color: var(--text-muted);
          font-weight: 600;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .greeting-title {
          margin: 4px 0 2px 0;
          font-size: 1.75rem;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .greeting-subtitle {
          margin: 0;
          font-size: 0.875rem;
          color: var(--text-secondary);
          max-width: 640px;
        }

        .panel-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
          box-shadow: var(--shadow-card);
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .panel-header h3 {
          margin: 0 0 2px 0;
          font-size: 1.125rem;
          font-weight: 800;
        }

        .panel-sub {
          margin: 0;
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .total-badge {
          font-size: 0.8125rem;
          color: var(--text-secondary);
          background: var(--bg-subtle);
          padding: 4px 10px;
          border-radius: var(--radius-pill);
        }

        .table-responsive {
          overflow-x: auto;
        }

        .clean-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .clean-table th {
          padding: 12px 16px;
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.5px;
          text-transform: uppercase;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }

        .clean-table td {
          padding: 14px 16px;
          font-size: 0.875rem;
          border-bottom: 1px solid var(--border-subtle);
          vertical-align: top;
        }

        .clean-table tr:hover td {
          background: var(--bg-subtle);
        }

        .inactive-tag {
          font-size: 0.6875rem;
          color: #b91c1c;
          font-weight: 700;
          margin-top: 2px;
        }

        .no-roles {
          color: var(--text-muted);
          font-size: 0.8125rem;
        }

        .role-chip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 4px 8px;
          margin-bottom: 6px;
          font-size: 0.75rem;
        }

        .revoke-btn {
          border: none;
          background: transparent;
          color: #b91c1c;
          cursor: pointer;
          font-weight: 700;
          font-size: 0.8125rem;
          padding: 0 4px;
        }

        .revoke-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .role-select,
        .outlet-input {
          padding: 6px 10px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 0.8125rem;
          background: var(--bg-base);
          color: var(--text-primary);
          min-width: 160px;
        }

        .assign-btn {
          padding: 8px 16px;
          background: var(--dark-btn);
          color: #fff;
          border: none;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }

        .assign-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .empty-state-card {
          text-align: center;
          padding: 60px 20px;
          background: var(--bg-card);
          border: 1px dashed var(--border);
          border-radius: var(--radius-lg);
        }

        .empty-state-card.error-card {
          padding: 20px;
          border-color: #b91c1c;
        }

        .empty-icon {
          font-size: 40px;
          display: block;
          margin-bottom: 12px;
        }

        /* User CRUD modals & styling */
        .add-user-btn {
          padding: 8px 16px;
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
        }

        .edit-btn {
          border: 1px solid var(--border);
          background: var(--bg-card);
          color: var(--text-primary);
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
        }

        .delete-btn {
          border: 1px solid #fca5a5;
          background: #fef2f2;
          color: #b91c1c;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
        }

        .delete-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }

        .modal-content {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          width: 480px;
          padding: 24px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 12px;
          margin-bottom: 16px;
        }

        .modal-header h4 {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 800;
          color: var(--text-primary);
        }

        .close-modal-btn {
          border: none;
          background: transparent;
          font-size: 1.125rem;
          cursor: pointer;
          color: var(--text-muted);
        }

        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .form-group label {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .form-group input, .form-group select {
          padding: 8px 12px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 0.875rem;
          background: var(--bg-base);
          color: var(--text-primary);
        }

        .form-group-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.875rem;
          color: var(--text-primary);
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 16px;
        }

        .cancel-modal-btn {
          padding: 8px 16px;
          border: 1px solid var(--border);
          background: transparent;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
          color: var(--text-secondary);
        }

        .permission-matrix {
          display: flex;
          flex-direction: column;
          gap: 2px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          max-height: 320px;
          overflow-y: auto;
          padding: 6px;
        }

        .permission-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 0.8125rem;
        }

        .permission-row:hover {
          background: var(--bg-subtle);
        }

        .permission-action {
          font-family: monospace;
          font-weight: 700;
          color: var(--text-primary);
        }

        .permission-desc {
          color: var(--text-muted);
          font-size: 0.75rem;
        }

        .submit-modal-btn {
          padding: 8px 16px;
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: var(--radius-pill);
          font-size: 0.8125rem;
          font-weight: 700;
          cursor: pointer;
        }
      ` }} />
      </div>
      </div>
    </div>
  );
}
