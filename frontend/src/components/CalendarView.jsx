import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import MentionInput from "./MentionInput";
import MentionTextarea from "./MentionTextarea";
import MultiUserSelect from "./MultiUserSelect";
import { userLabel } from "../utils/userLabel";

const KINDS = [
  { key: "REMINDER", label: "Reminder" },
  { key: "TASK", label: "Task" },
  { key: "EVENT", label: "Event" },
  { key: "MEETING", label: "Meeting" },
  { key: "OTHER", label: "Other" },
];

const pad = (n) => String(n).padStart(2, "0");
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // local date, no timezone shifting
const todayKey = () => {
  const n = new Date();
  return toKey(n.getFullYear(), n.getMonth(), n.getDate());
};
const longDate = (key) =>
  new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const emptyForm = (date) => ({ kind: "REMINDER", title: "", description: "", date, time: "", participant_ids: [] });

function errorText(err, fallback) {
  const d = err?.response?.data;
  if (!d) return fallback;
  if (typeof d.detail === "string") return d.detail;
  const first = Object.values(d).flat()[0];
  return typeof first === "string" ? first : fallback;
}

/**
 * Project calendar. Issues with a due date show up automatically; clicking a day adds a
 * reminder / task / event / meeting. Everyone involved (assignees + anyone @mentioned) is
 * emailed and notified right away, and again when the day arrives.
 *
 * Props: projectId, members ([{ user }]), currentUser, canAdd (not a Viewer), isAdmin (project admin)
 */
export default function CalendarView({
  issues = [],
  onSelectIssue,
  projectId,
  members = [],
  currentUser,
  canAdd = false,
  isAdmin = false,
}) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState([]);
  const [modal, setModal] = useState(null); // { entry? } while open
  const [form, setForm] = useState(emptyForm(todayKey()));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleString("default", { month: "long" });

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarCells = [];
  for (let i = 0; i < firstDayIndex; i++) calendarCells.push({ day: null, key: `pad-${i}` });
  for (let day = 1; day <= totalDaysInMonth; day++) calendarCells.push({ day, key: `day-${day}` });

  const loadEntries = useCallback(() => {
    if (!projectId) return;
    api
      .get(`/calendar-entries/?project=${projectId}&from=${toKey(year, month, 1)}&to=${toKey(year, month, totalDaysInMonth)}`)
      .then((res) => setEntries(res.data?.results || res.data || []))
      .catch(() => {});
  }, [projectId, year, month, totalDaysInMonth]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const activeMembers = members.filter((m) => m.user && !m.user.is_deactivated);
  const others = activeMembers.filter((m) => m.user.id !== currentUser?.id).map((m) => m.user);

  function openNew(dateKey) {
    setForm(emptyForm(dateKey));
    setError("");
    setModal({});
  }

  function openEntry(entry) {
    setForm({
      kind: entry.kind,
      title: entry.title,
      description: entry.description || "",
      date: entry.date,
      time: entry.time ? entry.time.slice(0, 5) : "",
      participant_ids: (entry.participants || []).map((p) => p.id),
    });
    setError("");
    setModal({ entry });
  }

  const canEditEntry = (entry) => !entry || (canAdd && (entry.created_by?.id === currentUser?.id || isAdmin));

  async function save(ev) {
    ev?.preventDefault();
    if (!form.title.trim()) {
      setError("Give it a title.");
      return;
    }
    setSaving(true);
    setError("");
    const body = {
      project: Number(projectId),
      kind: form.kind,
      title: form.title.trim(),
      description: form.description,
      date: form.date,
      time: form.time || null,
      participant_ids: form.participant_ids,
    };
    try {
      if (modal.entry) await api.patch(`/calendar-entries/${modal.entry.id}/`, body);
      else await api.post("/calendar-entries/", body);
      setModal(null);
      loadEntries();
    } catch (err) {
      setError(errorText(err, "Could not save this entry."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${modal.entry.title}"?`)) return;
    setSaving(true);
    try {
      await api.delete(`/calendar-entries/${modal.entry.id}/`);
      setModal(null);
      loadEntries();
    } catch (err) {
      setError(errorText(err, "Could not delete this entry."));
    } finally {
      setSaving(false);
    }
  }

  const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const handleToday = () => setCurrentDate(new Date());

  const today = todayKey();
  const editable = canEditEntry(modal?.entry);

  return (
    <div className="jira-calendar-container">
      <div className="jira-calendar-header">
        <div className="jira-cal-title-wrap">
          <h2 className="jira-cal-month">{monthName} {year}</h2>
          <span className="jira-cal-badge">{canAdd ? "Click a day to add a reminder" : "Live Due Dates"}</span>
        </div>
        <div className="jira-cal-controls">
          <button className="jira-btn-secondary-sm" onClick={handlePrevMonth}>‹</button>
          <button className="jira-btn-secondary-sm" onClick={handleToday}>Today</button>
          <button className="jira-btn-secondary-sm" onClick={handleNextMonth}>›</button>
        </div>
      </div>

      <div className="jira-calendar-grid">
        <div className="jira-cal-weekdays">
          {days.map((d) => (
            <div key={d} className="jira-cal-weekday-cell">{d}</div>
          ))}
        </div>

        <div className="jira-cal-days-grid">
          {calendarCells.map((cell) => {
            if (!cell.day) return <div key={cell.key} className="jira-cal-day-cell empty" />;

            const key = toKey(year, month, cell.day);
            const isToday = key === today;
            const clickable = canAdd && key >= today;

            const dayIssues = issues.filter((i) => i.due_date === key);
            const dayEntries = entries.filter((e) => e.date === key);

            return (
              <div
                key={cell.key}
                className={`jira-cal-day-cell ${isToday ? "today" : ""} ${clickable ? "clickable" : ""}`}
                onClick={() => clickable && openNew(key)}
                title={clickable ? "Click to add a reminder, task or event" : undefined}
              >
                <div
                  className="jira-cal-day-number"
                  style={isToday ? { background: "var(--jira-blue)", color: "#fff", borderRadius: "50%", width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center" } : {}}
                >
                  {cell.day}
                </div>
                <div className="jira-cal-day-events">
                  {dayEntries.map((entry) => (
                    <div
                      key={`e-${entry.id}`}
                      className={`jira-cal-event-pill jira-cal-entry kind-${entry.kind}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openEntry(entry);
                      }}
                      title={`${entry.kind_label}: ${entry.title}${entry.time ? ` at ${entry.time.slice(0, 5)}` : ""}`}
                    >
                      {entry.time && <strong style={{ marginRight: 4 }}>{entry.time.slice(0, 5)}</strong>}
                      {entry.title}
                    </div>
                  ))}
                  {dayIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className={`jira-cal-event-pill status-${issue.status.toLowerCase().replace("_", "")}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSelectIssue && onSelectIssue(issue.id);
                      }}
                      title={`[${issue.status}] ${issue.title}`}
                    >
                      <span style={{ marginRight: 4 }}>
                        {issue.issue_type === "BUG" ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#DE350B" strokeWidth="2"><circle cx="12" cy="13" r="4"/><path d="M12 9v-2"/><path d="M8.5 9.5L6 7"/><path d="M15.5 9.5L18 7"/><path d="M8 13H4"/><path d="M20 13h-4"/></svg>
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="9 12 11 14 15 10"/></svg>
                        )}
                      </span>
                      {issue.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {modal && (
        <div className="jira-modal-backdrop" onClick={() => !saving && setModal(null)}>
          <form
            className="jira-modal-container"
            style={{ maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && !saving && setModal(null)}
            onSubmit={save}
          >
            <div className="jira-modal-header">
              <div>
                <h2 className="jira-modal-title" style={{ margin: 0 }}>
                  {modal.entry ? (editable ? "Edit entry" : modal.entry.kind_label) : "Add to calendar"}
                </h2>
                <span className="tm-muted">{longDate(form.date)}</span>
                {modal.entry?.created_by && (
                  <span className="tm-muted"> · added by {userLabel(modal.entry.created_by)}</span>
                )}
              </div>
              <button type="button" className="jira-btn-icon-close" onClick={() => setModal(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="jira-modal-body">
              {error && <div className="tm-notice error"><span>{error}</span></div>}

              <div className="tm-form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <label>
                  <span>Type</span>
                  <select className="jira-select" value={form.kind} disabled={!editable} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                    {KINDS.map((k) => (
                      <option key={k.key} value={k.key}>{k.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Time (optional)</span>
                  <input className="jira-input" type="time" value={form.time} disabled={!editable} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  <span>Title</span>
                  {editable ? (
                    <MentionInput
                      value={form.title}
                      onChange={(title) => setForm({ ...form, title })}
                      members={activeMembers}
                      placeholder="What should we remember? Use @name to mention"
                      className="jira-input"
                      autoFocus
                    />
                  ) : (
                    <input className="jira-input" value={form.title} disabled />
                  )}
                </label>
              </div>
              <div className="tm-muted" style={{ marginTop: 6 }}>No time? The reminder goes out in the morning.</div>

              <div style={{ marginTop: 12 }}>
                <div className="tm-label">Notes</div>
                {editable ? (
                  <MentionTextarea
                    value={form.description}
                    onChange={(description) => setForm({ ...form, description })}
                    members={activeMembers}
                    placeholder="Details… Use @name to mention someone"
                    rows={3}
                  />
                ) : (
                  <p className="tm-muted" style={{ whiteSpace: "pre-wrap" }}>{form.description || "—"}</p>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="tm-label">Notify / assign to</div>
                <MultiUserSelect
                  users={others}
                  value={form.participant_ids}
                  onChange={(participant_ids) => setForm({ ...form, participant_ids })}
                  disabled={!editable}
                  placeholder={others.length ? "Select one or more project members…" : "No other members on this project yet"}
                />
                <p className="tm-muted" style={{ marginTop: 8 }}>
                  They (and anyone you @mention) get an email and a notification as soon as you save, and again
                  when the day{form.time ? " and time" : ""} arrives. You get the reminder too.
                </p>
              </div>
            </div>

            <div className="jira-modal-footer" style={{ justifyContent: "space-between" }}>
              <div>
                {modal.entry && editable && (
                  <button type="button" className="tm-link danger" disabled={saving} onClick={remove}>Delete</button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="jira-btn-cancel" onClick={() => setModal(null)}>{editable ? "Cancel" : "Close"}</button>
                {editable && (
                  <button type="submit" className="jira-btn-primary" disabled={saving}>
                    {saving ? "Saving…" : modal.entry ? "Save changes" : "Add"}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
