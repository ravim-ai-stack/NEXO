import { useEffect, useRef, useState } from "react";

/**
 * Single-line input with an @mention autocomplete (same behaviour as MentionTextarea).
 * Enter picks the highlighted person while the list is open; otherwise it bubbles up
 * so a parent row/form can submit.
 *
 * Props: value, onChange(newValue), members ([{ user: { username } }]),
 *        placeholder, className, autoFocus, disabled
 */
export default function MentionInput({
  value,
  onChange,
  members = [],
  placeholder = "",
  className = "jira-inline-input",
  autoFocus = false,
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(-1);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  const usernames = members
    .filter((m) => m.user?.username && !m.user.is_deactivated)
    .map((m) => m.user.username);
  const suggestions = usernames.filter((u) => u.toLowerCase().startsWith(query.toLowerCase()));

  function handleChange(e) {
    const val = e.target.value;
    const caret = e.target.selectionStart;
    onChange(val);
    const match = val.slice(0, caret).match(/@([\w]*)$/);
    if (match) {
      setQuery(match[1]);
      setStart(caret - match[0].length);
      setOpen(true);
      setIndex(0);
    } else {
      setOpen(false);
    }
  }

  function insert(username) {
    const caret = inputRef.current?.selectionStart ?? start + query.length + 1;
    const before = value.slice(0, start);
    const after = value.slice(caret);
    onChange(`${before}@${username} ${after}`);
    setOpen(false);
    setTimeout(() => {
      const pos = before.length + username.length + 2;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    }, 0);
  }

  function handleKeyDown(e) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation(); // choosing a person must not submit the row
      insert(suggestions[index]);
    } else if (e.key === "Escape") {
      e.stopPropagation(); // close the list, not the whole row
      setOpen(false);
    }
  }

  useEffect(() => {
    function onDocClick(e) {
      if (inputRef.current && !inputRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="jira-mention-wrap">
      <input
        ref={inputRef}
        type="text"
        className={className}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
      />
      {open && suggestions.length > 0 && (
        <div className="jira-mention-dropdown up">
          {suggestions.map((username, i) => (
            <button
              key={username}
              type="button"
              className={`jira-mention-item ${i === index ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(username);
              }}
            >
              <div className="jira-mention-avatar">{username.substring(0, 2).toUpperCase()}</div>
              <span>@{username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
