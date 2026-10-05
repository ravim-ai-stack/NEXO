import { useMemo, useState } from "react";

const fullName = (u) => `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username;

/**
 * Dropdown for picking one or several people.
 *
 * Props: users ([{ id, username, email, first_name, last_name }]),
 *        value (array of selected ids), onChange(newIds), disabled, placeholder
 *
 * The list opens in the page flow (not floating) so it can never be clipped by a scrolling modal.
 */
export default function MultiUserSelect({ users = [], value = [], onChange, disabled = false, placeholder = "Select people…" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = users.filter((u) => value.includes(u.id));
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(
      (u) => !q || fullName(u).toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)
    );
  }, [users, query]);

  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="mus">
      <div
        className={`mus-trigger ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && (e.preventDefault(), setOpen((o) => !o))}
      >
        <div className="mus-chips">
          {selected.length === 0 && <span className="tm-muted" style={{ fontWeight: 400 }}>{placeholder}</span>}
          {selected.map((u) => (
            <span key={u.id} className="mus-chip">
              {fullName(u)}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${fullName(u)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(u.id);
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <span className="mus-caret">▾</span>
      </div>

      {open && (
        <div className="mus-panel">
          <input
            className="jira-input-sm"
            style={{ width: "100%" }}
            placeholder="Search people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="mus-list">
            {visible.length === 0 && <div className="tm-muted" style={{ padding: 10 }}>No one matches.</div>}
            {visible.map((u) => (
              <label key={u.id} className={`mus-item ${value.includes(u.id) ? "on" : ""}`}>
                <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} />
                <span className="tm-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{fullName(u).substring(0, 2).toUpperCase()}</span>
                <span>
                  {fullName(u)}
                  <span className="tm-muted"> · {u.email || u.username}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mus-footer">
            <span className="tm-muted">{value.length} selected</span>
            <span>
              {value.length > 0 && <button type="button" className="tm-link muted" onClick={() => onChange([])}>Clear</button>}{" "}
              <button type="button" className="tm-link" onClick={() => { setOpen(false); setQuery(""); }}>Done</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
