import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import Navbar from "../components/Navbar";
import MentionInput from "../components/MentionInput";
import { useAuth } from "../context/AuthContext";
import { can, ACTIONS } from "../permissions";
import { userLabel } from "../utils/userLabel";

const STATUSES = [
  { key: "TODO", label: "To Do" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "DONE", label: "Done" },
];
const DEFAULT_STATUSES = ["TODO", "IN_PROGRESS"]; // Done tasks are one filter click away
const PRIORITIES = [
  { key: "CRITICAL", label: "Critical", color: "#DE350B" },
  { key: "HIGH", label: "High", color: "#FF5630" },
  { key: "MEDIUM", label: "Medium", color: "#FFAB00" },
  { key: "LOW", label: "Low", color: "#36B37E" },
];
const RESOLUTIONS = ["Unresolved", "Resolved", "Solved", "Won't Fix"];

const defaultFilters = () => ({ status: DEFAULT_STATUSES, q: "", project: "", assignee: "", reporter: "", priority: "" });
const todayKey = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};
const personName = (u) => (u ? userLabel(u) : "—");

function errorText(err, fallback) {
  const d = err?.response?.data;
  if (!d) return fallback;
  if (typeof d.detail === "string") return d.detail;
  const first = Object.values(d).flat()[0];
  return typeof first === "string" ? first : fallback;
}

export default function Tasks() {
  const { user: me } = useAuth();

  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null); // { type, text }

  const [filters, setFilters] = useState(defaultFilters);
  const [qInput, setQInput] = useState(""); // typed search, applied after a short pause
  const patchFilters = (patch) => setFilters((f) => ({ ...f, ...patch }));

  // add-a-task row
  const [adding, setAdding] = useState(false);
  const emptyDraft = (project = "") => ({
    project, title: "", assignee: "", reporter: me?.id ? String(me.id) : "",
    priority: "MEDIUM", status: "TODO", due: "", resolution: "Unresolved",
  });
  const [draft, setDraft] = useState(emptyDraft);
  const [draftMembers, setDraftMembers] = useState([]); // members of the chosen project
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/projects/").then((res) => setProjects(res.data?.results || res.data || [])).catch(() => {});
    api.get("/auth/users/").then((res) => setUsers(res.data?.results || res.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const next = qInput.trim();
    const t = setTimeout(() => setFilters((f) => (f.q === next ? f : { ...f, q: next })), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.status.length) params.set("status", filters.status.join(","));
    ["project", "assignee", "reporter", "priority", "q"].forEach((k) => filters[k] && params.set(k, filters[k]));
    return api
      .get(`/issues/?${params.toString()}`)
      .then((res) => setTasks(res.data?.results || res.data || []))
      .catch(() => setNotice({ type: "error", text: "Could not load tasks." }))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const roleOf = useMemo(() => new Map(projects.map((p) => [p.id, p.my_role])), [projects]);
  const membersOf = useMemo(
    () => new Map(projects.map((p) => [p.id, (p.members || []).filter((m) => m.user && !m.user.is_deactivated).map((m) => m.user)])),
    [projects]
  );
  const creatable = useMemo(() => projects.filter((p) => can(p.my_role, ACTIONS.CREATE_ISSUE)), [projects]);
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => Number(!!a.is_deactivated) - Number(!!b.is_deactivated) || a.username.localeCompare(b.username)),
    [users]
  );

  const canDeleteAny = projects.some((p) => can(p.my_role, ACTIONS.DELETE_ISSUE));

  const isDefault =
    filters.status.length === DEFAULT_STATUSES.length &&
    DEFAULT_STATUSES.every((s) => filters.status.includes(s)) &&
    !filters.q && !filters.project && !filters.assignee && !filters.reporter && !filters.priority;

  function toggleStatus(key) {
    patchFilters({ status: filters.status.includes(key) ? filters.status.filter((s) => s !== key) : [...filters.status, key] });
  }

  function resetFilters() {
    setFilters(defaultFilters());
    setQInput("");
  }

  // ── inline status / resolution edits (same pairing as the list view) ──────
  async function update(task, payload) {
    try {
      await api.patch(`/issues/${task.id}/`, payload);
      await load();
    } catch (err) {
      setNotice({ type: "error", text: errorText(err, "Could not update this task.") });
    }
  }
  const changeStatus = (task, status) =>
    update(task, { status, ...(status === "DONE" ? { resolution: "Resolved" } : status === "TODO" ? { resolution: "Unresolved" } : {}) });
  const changeResolution = (task, resolution) =>
    update(task, { resolution, ...(["Resolved", "Solved"].includes(resolution) ? { status: "DONE" } : resolution === "Unresolved" ? { status: "TODO" } : {}) });

  // Only org Admins can delete a task
  async function deleteTask(task) {
    if (!window.confirm(`Delete "${task.title}" (${task.project_key}-${task.id})? This cannot be undone.`)) return;
    try {
      await api.delete(`/issues/${task.id}/`);
      setNotice({ type: "ok", text: `Deleted ${task.project_key}-${task.id}.` });
      await load();
    } catch (err) {
      setNotice({ type: "error", text: errorText(err, "Could not delete this task.") });
    }
  }

  // ── add a task ───────────────────────────────────────────────────────────
  function openAdd() {
    const preferred = creatable.find((p) => String(p.id) === filters.project) || (creatable.length === 1 ? creatable[0] : null);
    setDraft(emptyDraft(preferred ? String(preferred.id) : ""));
    setAdding(true);
  }

  // load the chosen project's members for the assignee / reporter / @mention lists
  useEffect(() => {
    if (!adding || !draft.project) {
      setDraftMembers([]);
      return;
    }
    api.get(`/projects/${draft.project}/`).then((res) => {
      const members = (res.data.members || []).filter((m) => m.user && !m.user.is_deactivated);
      setDraftMembers(members);
      setDraft((d) => ({
        ...d,
        assignee: members.some((m) => String(m.user.id) === d.assignee) ? d.assignee : "",
        reporter: members.some((m) => String(m.user.id) === d.reporter) ? d.reporter : "",
      }));
    }).catch(() => setDraftMembers([]));
  }, [adding, draft.project]);

  function cancelAdd() {
    setAdding(false);
    setDraft(emptyDraft());
  }

  async function createTask() {
    if (!draft.project) return setNotice({ type: "error", text: "Choose a project for the task." });
    if (!draft.title.trim()) return setNotice({ type: "error", text: "Enter the task name." });
    setSaving(true);
    try {
      const res = await api.post("/issues/", {
        project: Number(draft.project),
        title: draft.title.trim(),
        priority: draft.priority,
        status: draft.status,
        resolution: draft.resolution,
        assignee_id: draft.assignee ? Number(draft.assignee) : null,
        reporter_id: draft.reporter ? Number(draft.reporter) : null,
        due_date: draft.due || null,
      });
      const project = projects.find((p) => p.id === Number(draft.project));
      const hidden = filters.status.length && !filters.status.includes(draft.status);
      setNotice({
        type: "ok",
        text: `Added ${project?.key}-${res.data.id}. It also shows on the project's board and list.${hidden ? " It's hidden by the current status filter." : ""}`,
      });
      cancelAdd();
      await load();
    } catch (err) {
      setNotice({ type: "error", text: errorText(err, "Could not add the task.") });
    } finally {
      setSaving(false);
    }
  }

  const today = todayKey();

  return (
    <div className="jira-app-shell">
      <Navbar />
      <main className="jira-workspace-main" style={{ background: "#F0F2F5", minHeight: "100vh" }}>
        <div className="db-page-header">
          <div>
            <h1 className="db-page-title">Tasks</h1>
            <p className="db-page-subtitle">Every task across your projects. Open and in-progress by default.</p>
          </div>
          {creatable.length > 0 && (
            <button className="jira-btn-primary" onClick={() => (adding ? cancelAdd() : openAdd())}>
              {adding ? "Close" : "+ Add task"}
            </button>
          )}
        </div>

        <div style={{ padding: "20px 24px 32px" }}>
          {notice && (
            <div className={`tm-notice ${notice.type}`}>
              <span>{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          {/* ── Filters ── */}
          <div className="tm-card" style={{ marginBottom: 16 }}>
            <div className="task-filters">
              <input
                className="jira-input-sm"
                placeholder="Search task name…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
              <select className="jira-select-sm" value={filters.project} onChange={(e) => patchFilters({ project: e.target.value })}>
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.key} — {p.name}</option>
                ))}
              </select>
              <select className="jira-select-sm" value={filters.assignee} onChange={(e) => patchFilters({ assignee: e.target.value })}>
                <option value="">Any assignee</option>
                <option value="none">Unassigned</option>
                {sortedUsers.map((u) => (
                  <option key={u.id} value={u.id}>{userLabel(u)}</option>
                ))}
              </select>
              <select className="jira-select-sm" value={filters.reporter} onChange={(e) => patchFilters({ reporter: e.target.value })}>
                <option value="">Any reporter</option>
                {sortedUsers.map((u) => (
                  <option key={u.id} value={u.id}>{userLabel(u)}</option>
                ))}
              </select>
              <select className="jira-select-sm" value={filters.priority} onChange={(e) => patchFilters({ priority: e.target.value })}>
                <option value="">Any priority</option>
                {PRIORITIES.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="tm-toolbar" style={{ margin: "12px 0 0" }}>
              <div className="tm-filters">
                {STATUSES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`tm-filter ${filters.status.includes(s.key) ? "active" : ""}`}
                    onClick={() => toggleStatus(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
                {filters.status.length === 0 && <span className="tm-muted" style={{ alignSelf: "center" }}>showing every status</span>}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="tm-muted">{loading ? "Loading…" : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}</span>
                {!isDefault && <button type="button" className="tm-link" onClick={resetFilters}>Reset filters</button>}
              </div>
            </div>
          </div>

          {/* ── Table ── */}
          <div className="tm-card" style={{ padding: 0 }}>
            <div className="tm-table-wrap">
              <table className="tm-table task-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 280 }}>Task</th>
                    <th>Project</th>
                    <th>Assignee</th>
                    <th>Reporter</th>
                    <th>Priority</th>
                    <th>Due date</th>
                    <th>Status</th>
                    <th>Resolution</th>
                    {canDeleteAny && <th style={{ width: 44 }} />}
                  </tr>
                </thead>
                <tbody>
                  {adding && (
                    <tr
                      className="task-add-row"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target.tagName === "INPUT") {
                          e.preventDefault();
                          createTask();
                        } else if (e.key === "Escape") cancelAdd();
                      }}
                    >
                      <td>
                        <MentionInput
                          value={draft.title}
                          onChange={(title) => setDraft((d) => ({ ...d, title }))}
                          members={draftMembers}
                          placeholder={draft.project ? "Task name — use @name to mention" : "Pick a project first, then name the task"}
                          autoFocus
                        />
                        <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                          <button type="button" className="jira-btn-primary-sm" disabled={saving} onClick={createTask}>
                            {saving ? "Adding…" : "Add task"}
                          </button>
                          <button type="button" className="jira-btn-secondary-sm" onClick={cancelAdd}>Cancel</button>
                        </div>
                      </td>
                      <td>
                        <select className="jira-select-inline task-cell" value={draft.project} onChange={(e) => setDraft((d) => ({ ...d, project: e.target.value }))}>
                          <option value="">Project…</option>
                          {creatable.map((p) => (
                            <option key={p.id} value={p.id}>{p.key} — {p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select className="jira-select-inline task-cell" value={draft.assignee} onChange={(e) => setDraft((d) => ({ ...d, assignee: e.target.value }))}>
                          <option value="">Unassigned</option>
                          {draftMembers.map((m) => (
                            <option key={m.user.id} value={m.user.id}>{m.user.username}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select className="jira-select-inline task-cell" value={draft.reporter} onChange={(e) => setDraft((d) => ({ ...d, reporter: e.target.value }))}>
                          <option value="">Me</option>
                          {draftMembers.map((m) => (
                            <option key={m.user.id} value={m.user.id}>{m.user.username}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select className="jira-select-inline task-cell" value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
                          {PRIORITIES.map((p) => (
                            <option key={p.key} value={p.key}>{p.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="date" className="jira-select-inline task-cell" value={draft.due} onChange={(e) => setDraft((d) => ({ ...d, due: e.target.value }))} />
                      </td>
                      <td>
                        <select
                          className="jira-select-inline task-cell"
                          value={draft.status}
                          onChange={(e) => {
                            const status = e.target.value;
                            setDraft((d) => ({ ...d, status, resolution: status === "DONE" ? "Resolved" : status === "TODO" ? "Unresolved" : d.resolution }));
                          }}
                        >
                          {STATUSES.map((s) => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="jira-select-inline task-cell"
                          value={draft.resolution}
                          onChange={(e) => {
                            const resolution = e.target.value;
                            setDraft((d) => ({
                              ...d,
                              resolution,
                              status: ["Resolved", "Solved"].includes(resolution) ? "DONE" : resolution === "Unresolved" ? "TODO" : d.status,
                            }));
                          }}
                        >
                          {RESOLUTIONS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </td>
                      {canDeleteAny && <td />}
                    </tr>
                  )}

                  {tasks.map((t) => {
                    const role = roleOf.get(t.project);
                    const canStatus = can(role, ACTIONS.CHANGE_ISSUE_STATUS);
                    const canResolution = can(role, ACTIONS.CHANGE_RESOLUTION);
                    const canEdit = can(role, ACTIONS.EDIT_ISSUE); // admins + managers: assignee, priority, due date
                    const canDelete = can(role, ACTIONS.DELETE_ISSUE); // admins only
                    const roster = membersOf.get(t.project) || [];
                    const assigneeOptions = t.assignee && !roster.some((u) => u.id === t.assignee.id) ? [t.assignee, ...roster] : roster;
                    const pri = PRIORITIES.find((p) => p.key === t.priority);
                    const overdue = t.due_date && t.due_date < today && t.status !== "DONE";
                    return (
                      <tr key={t.id}>
                        <td>
                          <Link className="task-title" to={`/projects/${t.project}/board?issue=${t.id}`} title="Open this task">
                            {t.title}
                          </Link>
                          <div className="tm-muted">{t.project_key}-{t.id}</div>
                        </td>
                        <td>
                          <Link className="tm-link" to={`/projects/${t.project}/board`} style={{ textDecoration: "none" }}>{t.project_name}</Link>
                        </td>
                        <td>
                          {canEdit ? (
                            <select
                              className="jira-select-inline task-cell"
                              value={t.assignee?.id || ""}
                              onChange={(e) => update(t, { assignee_id: e.target.value ? Number(e.target.value) : null })}
                            >
                              <option value="">Unassigned</option>
                              {assigneeOptions.map((u) => (
                                <option key={u.id} value={u.id}>{userLabel(u)}</option>
                              ))}
                            </select>
                          ) : t.assignee ? personName(t.assignee) : <span className="tm-muted">Unassigned</span>}
                        </td>
                        <td>{personName(t.reporter)}</td>
                        <td>
                          {canEdit ? (
                            <select className="jira-select-inline task-cell" value={t.priority} onChange={(e) => update(t, { priority: e.target.value })}>
                              {PRIORITIES.map((p) => (
                                <option key={p.key} value={p.key}>{p.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="task-pri">
                              <span className="task-pri-dot" style={{ background: pri?.color || "#97A0AF" }} />
                              {pri?.label || t.priority}
                            </span>
                          )}
                        </td>
                        <td style={overdue ? { color: "#DE350B", fontWeight: 600 } : undefined}>
                          {canEdit ? (
                            <input
                              type="date"
                              className="jira-select-inline task-cell"
                              defaultValue={t.due_date || ""}
                              key={`${t.id}-${t.due_date || ""}`}
                              onChange={(e) => (e.target.value === "" || /^(19|2\d)\d{2}-\d{2}-\d{2}$/.test(e.target.value)) && update(t, { due_date: e.target.value || null })}
                            />
                          ) : t.due_date ? (
                            new Date(`${t.due_date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
                          ) : (
                            <span className="tm-muted">—</span>
                          )}
                        </td>
                        <td>
                          <select className={`jira-select-inline task-cell status-${t.status}`} value={t.status} disabled={!canStatus} onChange={(e) => changeStatus(t, e.target.value)}>
                            {STATUSES.map((s) => (
                              <option key={s.key} value={s.key}>{s.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select className="jira-select-inline task-cell" value={t.resolution || "Unresolved"} disabled={!canResolution} onChange={(e) => changeResolution(t, e.target.value)}>
                            {[...new Set([t.resolution || "Unresolved", ...RESOLUTIONS])].map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        {canDeleteAny && (
                          <td style={{ textAlign: "right" }}>
                            {canDelete && (
                              <button type="button" className="tm-link danger" title="Delete task" onClick={() => deleteTask(t)}>
                                Delete
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!loading && tasks.length === 0 && (
              <div className="tm-empty">
                No tasks match these filters.{" "}
                {!isDefault && <button type="button" className="tm-link" onClick={resetFilters}>Reset filters</button>}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
