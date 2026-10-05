import { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";

const fullName = (u) => `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username;
const initials = (u) => fullName(u).substring(0, 2).toUpperCase();
const statusOf = (u) => (u.is_deactivated ? "inactive" : u.invite_pending ? "invited" : "active");
const STATUS_LABEL = { active: "Active", inactive: "Inactive", invited: "Invited" };
const FILTER_LABEL = { active: "Active", inactive: "Inactive", all: "All" };
const TYPE_LABEL = { ADMIN: "Admin", MANAGER: "Manager", MEMBER: "Member" };

function errorText(err, fallback) {
  const d = err?.response?.data;
  if (!d) return fallback;
  if (typeof d.detail === "string") return d.detail;
  const first = Object.values(d).flat()[0];
  return typeof first === "string" ? first : fallback;
}

// ── Organization chart ───────────────────────────────────────────────────────
function OrgNode({ node, childrenOf, seen }) {
  seen.add(node.id);
  const kids = (childrenOf.get(node.id) || []).filter((k) => !seen.has(k.id));
  const status = statusOf(node);
  return (
    <li>
      <div className={`org-node ${status === "inactive" ? "inactive" : ""}`} title={node.email}>
        <div className="org-node-avatar">{initials(node)}</div>
        <div className="org-node-name">{fullName(node)}</div>
        <div className="org-node-role">{node.designation || "No designation"}</div>
        <span className={`tm-type ${node.user_type}`}>{TYPE_LABEL[node.user_type] || "Member"}</span>
        {status !== "active" && <span className={`tm-pill ${status}`}>{STATUS_LABEL[status]}</span>}
        {kids.length > 0 && <div className="org-node-count">{kids.length} direct report{kids.length === 1 ? "" : "s"}</div>}
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <OrgNode key={k.id} node={k} childrenOf={childrenOf} seen={seen} />
          ))}
        </ul>
      )}
    </li>
  );
}

function OrgChart({ users }) {
  const [showInactive, setShowInactive] = useState(true);

  const { roots, childrenOf } = useMemo(() => {
    const visible = users.filter((u) => showInactive || !u.is_deactivated);
    const ids = new Set(visible.map((u) => u.id));
    const byName = (a, b) => fullName(a).localeCompare(fullName(b));
    const childrenOf = new Map();
    const roots = [];
    visible.forEach((u) => {
      if (u.reporting_manager && ids.has(u.reporting_manager)) {
        if (!childrenOf.has(u.reporting_manager)) childrenOf.set(u.reporting_manager, []);
        childrenOf.get(u.reporting_manager).push(u);
      } else {
        roots.push(u);
      }
    });
    childrenOf.forEach((arr) => arr.sort(byName));
    roots.sort(byName);
    return { roots, childrenOf };
  }, [users, showInactive]);

  const seen = new Set();

  return (
    <div className="tm-card">
      <div className="tm-toolbar">
        <div>
          <h3 className="tm-card-title">Organization chart</h3>
          <p className="tm-muted">Built from each person's reporting manager. People without a manager appear at the top.</p>
        </div>
        <label className="tm-check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive users
        </label>
      </div>
      {roots.length === 0 ? (
        <div className="tm-empty">No users to show.</div>
      ) : (
        <div className="org-scroll">
          <div className="org-tree">
            <ul className="org-roots">
              {roots.map((r) => (
                <OrgNode key={r.id} node={r} childrenOf={childrenOf} seen={seen} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Teams() {
  const { user: me } = useAuth();
  const canManage = !!me?.can_manage_users; // Admins and Managers can add people
  const isAdmin = me?.user_type === "ADMIN"; // only Admins set user types
  const canToggle = !!me?.can_toggle_users; // only Admins activate / deactivate

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("members");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [notice, setNotice] = useState(null); // { type: "ok" | "warn" | "error", text }

  // add-user form
  const [showAdd, setShowAdd] = useState(false);
  const emptyForm = () => ({ name: "", email: "", designation: "", user_type: "MEMBER", reporting_manager: isAdmin ? "" : String(me?.id || "") });
  const [form, setForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState("");

  // edit window for the selected user
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState({ name: "", designation: "", user_type: "MEMBER", reporting_manager: "" });
  const [modalError, setModalError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    return api
      .get("/auth/users/")
      .then((res) => setUsers(res.data?.results || res.data || []))
      .catch(() => setNotice({ type: "error", text: "Could not load team members." }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const activeUsers = useMemo(
    () => users.filter((u) => !u.is_deactivated).sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [users]
  );
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const selected = selectedId ? usersById.get(selectedId) : null;

  // Everyone below `id` in the reporting line (they can't become that person's manager)
  function descendantsOf(id) {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      users.forEach((u) => {
        if (u.reporting_manager && out.has(u.reporting_manager) && !out.has(u.id)) {
          out.add(u.id);
          grew = true;
        }
      });
    }
    return out;
  }

  // Who may be picked as a reporting manager: Admins any active user; Managers themselves + their own team.
  function managerChoices(exclude) {
    const team = isAdmin ? null : descendantsOf(me?.id);
    return activeUsers.filter((m) => (!team || team.has(m.id)) && (!exclude || !exclude.has(m.id)));
  }

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    const matches =
      !q ||
      fullName(u).toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.designation || "").toLowerCase().includes(q);
    const inFilter =
      statusFilter === "all" ||
      (statusFilter === "active" && !u.is_deactivated) || // active + invited-but-not-yet-joined
      (statusFilter === "inactive" && u.is_deactivated);
    return matches && inFilter;
  });

  async function handleAdd(e) {
    e.preventDefault();
    setFormError("");
    if (!form.name.trim() || !form.email.trim()) {
      setFormError("Name and email are required.");
      return;
    }
    setAdding(true);
    try {
      const res = await api.post("/auth/users/", {
        name: form.name.trim(),
        email: form.email.trim(),
        designation: form.designation.trim(),
        user_type: form.user_type,
        reporting_manager: form.reporting_manager || null,
      });
      setNotice(
        res.data.email_sent
          ? { type: "ok", text: `Invitation sent to ${res.data.email}.` }
          : { type: "warn", text: `${res.data.email} was added, but the invitation email could not be sent. Use "Resend invite".` }
      );
      setForm(emptyForm());
      setShowAdd(false);
      await load();
    } catch (err) {
      setFormError(errorText(err, "Could not add this user."));
    } finally {
      setAdding(false);
    }
  }

  function openUser(u) {
    setSelectedId(u.id);
    setDraft({ name: fullName(u), designation: u.designation || "", user_type: u.user_type || "MEMBER", reporting_manager: u.reporting_manager || "" });
    setModalError("");
  }

  function closeUser() {
    if (busy) return;
    setSelectedId(null);
    setModalError("");
  }

  async function saveUser() {
    if (!draft.name.trim()) {
      setModalError("Name cannot be empty.");
      return;
    }
    setBusy(true);
    setModalError("");
    try {
      const payload = {
        name: draft.name.trim(),
        designation: draft.designation,
        reporting_manager: draft.reporting_manager || null,
      };
      if (isAdmin && draft.user_type !== selected.user_type) payload.user_type = draft.user_type;
      await api.patch(`/auth/users/${selected.id}/`, payload);
      setNotice({ type: "ok", text: `${draft.name.trim()} was updated.` });
      setSelectedId(null);
      await load();
    } catch (err) {
      setModalError(errorText(err, "Could not save changes."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    const u = selected;
    const deactivate = !u.is_deactivated;
    const ok = window.confirm(
      deactivate
        ? `Deactivate ${fullName(u)}? They will be signed out and unable to log in. Their name stays on existing issues, marked as inactive.`
        : `Reactivate ${fullName(u)}?`
    );
    if (!ok) return;
    setBusy(true);
    setModalError("");
    try {
      await api.patch(`/auth/users/${u.id}/`, { is_deactivated: deactivate });
      setNotice({ type: "ok", text: `${fullName(u)} is now ${deactivate ? "inactive" : "active"}.` });
      setSelectedId(null);
      await load();
    } catch (err) {
      setModalError(errorText(err, "Could not update this user."));
    } finally {
      setBusy(false);
    }
  }

  async function resendInvite() {
    const u = selected;
    setBusy(true);
    setModalError("");
    try {
      const res = await api.post(`/auth/users/${u.id}/resend-invite/`);
      setNotice(
        res.data.email_sent
          ? { type: "ok", text: `Invitation re-sent to ${u.email}.` }
          : { type: "warn", text: `The invitation email to ${u.email} could not be sent.` }
      );
      setSelectedId(null);
    } catch (err) {
      setModalError(errorText(err, "Could not resend the invitation."));
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    all: users.length,
    active: users.filter((u) => !u.is_deactivated).length,
    inactive: users.filter((u) => u.is_deactivated).length,
  };

  return (
    <div className="jira-app-shell">
      <Navbar />
      <main className="jira-workspace-main" style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        <div className="jira-projects-page-header">
          <div>
            <h1 className="jira-projects-title">Teams</h1>
            <p className="jira-projects-desc">Everyone in your workspace, who they report to, and who is active.</p>
          </div>
          {canManage && tab === "members" && (
            <button className="jira-btn-primary" onClick={() => { setShowAdd((s) => !s); setFormError(""); }}>
              {showAdd ? "Close" : "+ Add user"}
            </button>
          )}
        </div>

        <div className="tm-tabs">
          <button className={`tm-tab ${tab === "members" ? "active" : ""}`} onClick={() => setTab("members")}>
            Members <span className="tm-tab-count">{counts.all}</span>
          </button>
          <button className={`tm-tab ${tab === "chart" ? "active" : ""}`} onClick={() => setTab("chart")}>
            Organization chart
          </button>
        </div>

        {notice && (
          <div className={`tm-notice ${notice.type}`}>
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        {tab === "members" && (
          <>
            {canManage && showAdd && (
              <form className="tm-card tm-form" onSubmit={handleAdd}>
                <h3 className="tm-card-title">Add a user</h3>
                <p className="tm-muted">They'll get an email with a link that signs them straight in — no verification code needed.</p>
                {formError && <div className="tm-notice error"><span>{formError}</span></div>}
                <div className="tm-form-grid">
                  <label>
                    <span>Full name *</span>
                    <input className="jira-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Jane Doe" autoFocus />
                  </label>
                  <label>
                    <span>Email *</span>
                    <input className="jira-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
                  </label>
                  <label>
                    <span>Role / designation</span>
                    <input className="jira-input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Senior Engineer" />
                  </label>
                  <label>
                    <span>User type</span>
                    <select className="jira-select" value={form.user_type} disabled={!isAdmin} onChange={(e) => setForm({ ...form, user_type: e.target.value })}>
                      {(isAdmin ? ["MEMBER", "MANAGER", "ADMIN"] : ["MEMBER"]).map((k) => (
                        <option key={k} value={k}>{TYPE_LABEL[k]}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Reporting manager</span>
                    <select className="jira-select" value={form.reporting_manager} onChange={(e) => setForm({ ...form, reporting_manager: e.target.value })}>
                      {isAdmin && <option value="">No manager</option>}
                      {managerChoices().map((u) => (
                        <option key={u.id} value={u.id}>
                          {fullName(u)}{u.designation ? ` — ${u.designation}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="tm-form-actions">
                  <button type="button" className="jira-btn-cancel" onClick={() => setShowAdd(false)}>Cancel</button>
                  <button type="submit" className="jira-btn-primary" disabled={adding}>
                    {adding ? "Sending invitation…" : "Add & send invitation"}
                  </button>
                </div>
              </form>
            )}

            <div className="tm-card">
              <div className="tm-toolbar">
                <input
                  className="jira-input-sm"
                  style={{ width: 260 }}
                  placeholder="Search name, email or role…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="tm-filters">
                  {["active", "inactive", "all"].map((f) => (
                    <button key={f} className={`tm-filter ${statusFilter === f ? "active" : ""}`} onClick={() => setStatusFilter(f)}>
                      {FILTER_LABEL[f]} ({counts[f]})
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="tm-empty">Loading team…</div>
              ) : filtered.length === 0 ? (
                <div className="tm-empty">No users match your filters.</div>
              ) : (
                <div className="tm-table-wrap">
                  <table className="tm-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role / designation</th>
                        <th>User type</th>
                        <th>Reporting manager</th>
                        <th>Projects</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((u) => {
                        const status = statusOf(u);
                        const manager = u.reporting_manager ? usersById.get(u.reporting_manager) : null;
                        return (
                          <tr
                            key={u.id}
                            className={`tm-row ${status === "inactive" ? "inactive" : ""}`}
                            onClick={() => openUser(u)}
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && openUser(u)}
                          >
                            <td>
                              <div className="tm-user">
                                <div className="tm-avatar">{initials(u)}</div>
                                <div>
                                  <div className="tm-user-name">
                                    {fullName(u)}
                                    {u.id === me?.id && <span className="tm-you">you</span>}
                                  </div>
                                  <div className="tm-muted">{u.email}</div>
                                </div>
                              </div>
                            </td>
                            <td>{u.designation || <span className="tm-muted">—</span>}</td>
                            <td><span className={`tm-type ${u.user_type}`}>{TYPE_LABEL[u.user_type] || "Member"}</span></td>
                            <td>
                              {manager ? fullName(manager) : u.reporting_manager_name || <span className="tm-muted">—</span>}
                            </td>
                            <td>{u.projects_count ?? 0}</td>
                            <td><span className={`tm-pill ${status}`}>{STATUS_LABEL[status]}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {selected && (
          <div className="jira-modal-backdrop" onClick={closeUser}>
            <div
              className="jira-modal-container"
              style={{ maxWidth: 520 }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === "Escape" && closeUser()}
            >
              <div className="jira-modal-header">
                <div className="tm-user">
                  <div className="tm-avatar" style={{ width: 42, height: 42 }}>{initials(selected)}</div>
                  <div>
                    <h2 className="jira-modal-title" style={{ margin: 0 }}>{fullName(selected)}</h2>
                    <span className="tm-muted">{selected.email}</span>
                  </div>
                </div>
                <button className="jira-btn-icon-close" onClick={closeUser}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              <div className="jira-modal-body">
                {modalError && <div className="tm-notice error"><span>{modalError}</span></div>}
                {!selected.can_edit && (
                  <div className="tm-notice warn">
                    <span>
                      {canManage
                        ? "You can only edit people in your own team."
                        : "Only Admins and Managers can edit user details."}
                    </span>
                  </div>
                )}

                <div className="tm-form-grid" style={{ gridTemplateColumns: "1fr" }}>
                  <label>
                    <span>Full name</span>
                    <input className="jira-input" value={draft.name} disabled={!selected.can_edit} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </label>
                  <label>
                    <span>Email</span>
                    <input className="jira-input" value={selected.email} disabled />
                  </label>
                  <label>
                    <span>Role / designation</span>
                    <input className="jira-input" value={draft.designation} disabled={!selected.can_edit} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} placeholder="e.g. Senior Engineer" />
                  </label>
                  <label>
                    <span>User type</span>
                    <select className="jira-select" value={draft.user_type} disabled={!isAdmin || !selected.can_edit} onChange={(e) => setDraft({ ...draft, user_type: e.target.value })}>
                      {["ADMIN", "MANAGER", "MEMBER"].map((k) => (
                        <option key={k} value={k}>{TYPE_LABEL[k]}</option>
                      ))}
                    </select>
                    {!isAdmin && <span className="tm-muted" style={{ fontWeight: 400 }}>Only Admins can change a user type.</span>}
                  </label>
                  <label>
                    <span>Reporting manager</span>
                    <select className="jira-select" value={draft.reporting_manager} disabled={!selected.can_edit} onChange={(e) => setDraft({ ...draft, reporting_manager: e.target.value })}>
                      {(isAdmin || !draft.reporting_manager) && <option value="">No manager</option>}
                      {managerChoices(descendantsOf(selected.id))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {fullName(m)}{m.designation ? ` — ${m.designation}` : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                <div className="tm-status-box">
                  <div>
                    <div className="tm-user-name">
                      Status: <span className={`tm-pill ${statusOf(selected)}`}>{STATUS_LABEL[statusOf(selected)]}</span>
                    </div>
                    <div className="tm-muted" style={{ marginTop: 4 }}>
                      {selected.is_deactivated
                        ? "Cannot log in. Their name still shows on existing work, marked as inactive."
                        : statusOf(selected) === "invited"
                        ? "Invitation sent, not opened yet."
                        : "Can log in and be assigned work."}
                    </div>
                  </div>
                  {selected.can_edit && (
                    <div className="tm-actions">
                      {statusOf(selected) === "invited" && (
                        <button className="tm-link" disabled={busy} onClick={resendInvite}>Resend invite</button>
                      )}
                      {canToggle && selected.id !== me?.id && (
                        <button className={`tm-link ${selected.is_deactivated ? "" : "danger"}`} disabled={busy} onClick={toggleActive}>
                          {selected.is_deactivated ? "Activate user" : "Deactivate user"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="jira-modal-footer">
                <button type="button" className="jira-btn-cancel" onClick={closeUser}>{selected.can_edit ? "Cancel" : "Close"}</button>
                {selected.can_edit && (
                  <button type="button" className="jira-btn-primary" disabled={busy} onClick={saveUser}>
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "chart" && (loading ? <div className="tm-card"><div className="tm-empty">Loading…</div></div> : <OrgChart users={users} />)}
      </main>
    </div>
  );
}
