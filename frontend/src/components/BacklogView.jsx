import { useEffect, useState } from "react";
import { userLabel } from "../utils/userLabel";
import api from "../api/client";
import IssueModal from "./IssueModal";
import { IssueTypeIcon, PriorityIcon, SprintGoalIcon } from "./Icons";
import { can as canPermission, ACTIONS } from "../permissions";

// Issue type config (no emojis)
const TYPE_ICONS = {
  BUG:   { color: "#DE350B" },
  TASK:  { color: "#0052CC" },
  STORY: { color: "#00875A" },
  EPIC:  { color: "#6554C0" },
};

const PRIORITY_LABELS = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export default function BacklogView({ project, issues = [], members = [], onRefresh, currentUser, role: roleProp, isViewer = false, isAdmin = false }) {
  // Derive role string for can() calls
  const role = roleProp || (isAdmin ? "ADMIN" : readOnly ? "VIEWER" : "MANAGER");
  const can = (action, ctx = {}) => canPermission(role, action, ctx);
  const readOnly = !can(ACTIONS.MOVE_ISSUE); // Viewers and Members: look, don't touch
  const [sprints, setSprints] = useState([]);
  const [selectedIssueId, setSelectedIssueId] = useState(null);

  // Sprint creation state
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [newSprintName, setNewSprintName] = useState("");
  const [newSprintGoal, setNewSprintGoal] = useState("");
  const [newSprintStart, setNewSprintStart] = useState("");
  const [newSprintEnd, setNewSprintEnd] = useState("");
  const [creatingSprin, setCreatingSprint] = useState(false);

  // Sprint edit state
  const [editingSprintId, setEditingSprintId] = useState(null);
  const [editSprintName, setEditSprintName] = useState("");
  const [editSprintGoal, setEditSprintGoal] = useState("");
  const [editSprintStart, setEditSprintStart] = useState("");
  const [editSprintEnd, setEditSprintEnd] = useState("");

  // Complete sprint modal
  const [completingSprintId, setCompletingSprintId] = useState(null);
  const [moveToSprintId, setMoveToSprintId] = useState("");

  // Inline issue create per section
  const [inlineSection, setInlineSection] = useState(null); // sprint id or "backlog"
  const [inlineTitle, setInlineTitle] = useState("");
  const [inlineType, setInlineType] = useState("TASK");

  // Drag state
  const [draggingIssueId, setDraggingIssueId] = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);

  // Collapsed sections
  const [collapsed, setCollapsed] = useState({});

  // Search
  const [search, setSearch] = useState("");

  const projectId = project?.id;

  function loadSprints() {
    if (!projectId) return;
    api.get(`/sprints/?project=${projectId}`)
      .then((res) => setSprints(res.data))
      .catch(() => {});
  }

  useEffect(() => {
    loadSprints();
  }, [projectId]);

  function refresh() {
    loadSprints();
    onRefresh && onRefresh();
  }

  // Issues partitioned by sprint
  const sprintMap = {};
  const backlogIssues = [];

  const filtered = issues.filter((i) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      i.title.toLowerCase().includes(q) ||
      `${project?.key}-${i.id}`.toLowerCase().includes(q) ||
      (i.assignee?.username || "").toLowerCase().includes(q)
    );
  });

  filtered.forEach((issue) => {
    if (issue.sprint_id) {
      if (!sprintMap[issue.sprint_id]) sprintMap[issue.sprint_id] = [];
      sprintMap[issue.sprint_id].push(issue);
    } else {
      backlogIssues.push(issue);
    }
  });

  // ----- Sprint CRUD -----
  async function handleCreateSprint(e) {
    e.preventDefault();
    if (!newSprintName.trim()) return;
    setCreatingSprint(true);
    try {
      await api.post("/sprints/", {
        project: projectId,
        name: newSprintName.trim(),
        goal: newSprintGoal.trim(),
        start_date: newSprintStart || null,
        end_date: newSprintEnd || null,
      });
      setNewSprintName("");
      setNewSprintGoal("");
      setNewSprintStart("");
      setNewSprintEnd("");
      setShowCreateSprint(false);
      refresh();
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not create sprint.");
    } finally {
      setCreatingSprint(false);
    }
  }

  async function handleStartSprint(sprintId) {
    try {
      await api.post(`/sprints/${sprintId}/start/`);
      refresh();
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not start sprint.");
    }
  }

  async function handleCompleteSprint(e) {
    e.preventDefault();
    try {
      await api.post(`/sprints/${completingSprintId}/complete/`, {
        move_to_sprint_id: moveToSprintId || null,
      });
      setCompletingSprintId(null);
      setMoveToSprintId("");
      refresh();
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not complete sprint.");
    }
  }

  async function handleDeleteSprint(sprintId) {
    if (!window.confirm("Delete this sprint? Issues will be moved to the backlog.")) return;
    try {
      await api.delete(`/sprints/${sprintId}/`);
      refresh();
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not delete sprint.");
    }
  }

  async function handleSaveEditSprint(e) {
    e.preventDefault();
    try {
      await api.patch(`/sprints/${editingSprintId}/`, {
        name: editSprintName.trim(),
        goal: editSprintGoal.trim(),
        start_date: editSprintStart || null,
        end_date: editSprintEnd || null,
      });
      setEditingSprintId(null);
      refresh();
    } catch (err) {
      alert("Could not save sprint.");
    }
  }

  // ----- Inline issue create -----
  async function handleInlineCreate(e, sprintId) {
    e.preventDefault();
    if (!inlineTitle.trim()) return;
    try {
      await api.post("/issues/", {
        project: projectId,
        title: inlineTitle.trim(),
        issue_type: inlineType,
        priority: "MEDIUM",
        status: "TODO",
        sprint_id: sprintId === "backlog" ? null : sprintId,
      });
      setInlineTitle("");
      setInlineSection(null);
      refresh();
    } catch {
      alert("Could not create issue.");
    }
  }

  // ----- Drag & drop to move issues between sections -----
  async function handleDrop(targetSprintId) {
    if (!draggingIssueId) return;
    setDragOverSection(null);
    try {
      await api.patch(`/issues/${draggingIssueId}/`, {
        sprint_id: targetSprintId === "backlog" ? null : targetSprintId,
      });
      refresh();
    } catch {
      alert("Could not move issue.");
    }
    setDraggingIssueId(null);
  }

  function toggleCollapse(sectionKey) {
    setCollapsed((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  }

  const activeSprint = sprints.find((s) => s.status === "ACTIVE");
  const plannedSprints = sprints.filter((s) => s.status === "PLANNED");
  const completedSprints = sprints.filter((s) => s.status === "COMPLETED");
  const otherSprintsForMove = sprints.filter(
    (s) => s.id !== completingSprintId && s.status !== "COMPLETED"
  );

  return (
    <div className="jira-backlog-container">
      {/* Toolbar */}
      <div className="jira-backlog-toolbar">
        <div className="jira-backlog-toolbar-left">
          <div className="jira-search-work-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search backlog..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="jira-search-work-input"
            />
          </div>
        </div>
        {can(ACTIONS.CREATE_SPRINT) && (
          <button className="jira-btn-primary-sm" onClick={() => setShowCreateSprint(true)}>
            + Create Sprint
          </button>
        )}
      </div>

      {/* Create Sprint Form — Admin only */}
      {showCreateSprint && can(ACTIONS.CREATE_SPRINT) && (
        <div className="jira-sprint-create-card">
          <h4 className="jira-sprint-create-title">New Sprint</h4>
          <form onSubmit={handleCreateSprint} className="jira-sprint-create-form">
            <div className="jira-sprint-form-row">
              <div className="jira-form-group" style={{ flex: 2 }}>
                <label className="jira-drawer-field-label">Sprint Name *</label>
                <input
                  type="text"
                  className="jira-input"
                  placeholder="e.g. Sprint 1"
                  value={newSprintName}
                  onChange={(e) => setNewSprintName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="jira-form-group" style={{ flex: 1 }}>
                <label className="jira-drawer-field-label">Start Date</label>
                <input
                  type="date"
                  className="jira-input"
                  value={newSprintStart}
                  onChange={(e) => setNewSprintStart(e.target.value)}
                />
              </div>
              <div className="jira-form-group" style={{ flex: 1 }}>
                <label className="jira-drawer-field-label">End Date</label>
                <input
                  type="date"
                  className="jira-input"
                  value={newSprintEnd}
                  onChange={(e) => setNewSprintEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="jira-form-group">
              <label className="jira-drawer-field-label">Sprint Goal</label>
              <input
                type="text"
                className="jira-input"
                placeholder="What does this sprint aim to achieve?"
                value={newSprintGoal}
                onChange={(e) => setNewSprintGoal(e.target.value)}
              />
            </div>
            <div className="jira-sprint-form-actions">
              <button type="submit" className="jira-btn-primary-sm" disabled={creatingSprin}>
                {creatingSprin ? "Creating..." : "Create Sprint"}
              </button>
              <button type="button" className="jira-btn-secondary-sm" onClick={() => setShowCreateSprint(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sprint Sections */}
      {[...(activeSprint ? [activeSprint] : []), ...plannedSprints].map((sprint) => {
        const sprintIssues = sprintMap[sprint.id] || [];
        const doneCount = sprintIssues.filter((i) => i.status === "DONE").length;
        const isCollapsed = collapsed[`sprint-${sprint.id}`];
        const isEditing = editingSprintId === sprint.id;

        return (
          <div
            key={sprint.id}
            className={`jira-sprint-section ${sprint.status === "ACTIVE" ? "active-sprint" : ""} ${dragOverSection === sprint.id ? "drag-over" : ""}`}
            onDragOver={readOnly ? undefined : (e) => { e.preventDefault(); setDragOverSection(sprint.id); }}
            onDragLeave={readOnly ? undefined : () => setDragOverSection(null)}
            onDrop={readOnly ? undefined : () => handleDrop(sprint.id)}
          >
            {/* Sprint Header */}
            <div className="jira-sprint-header">
              <button
                className="jira-sprint-collapse-btn"
                onClick={() => toggleCollapse(`sprint-${sprint.id}`)}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                  style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {isEditing ? (
                <form onSubmit={handleSaveEditSprint} className="jira-sprint-edit-form">
                  <input
                    type="text"
                    className="jira-input-sm"
                    value={editSprintName}
                    onChange={(e) => setEditSprintName(e.target.value)}
                    required
                    autoFocus
                  />
                  <input
                    type="text"
                    className="jira-input-sm"
                    placeholder="Sprint goal..."
                    value={editSprintGoal}
                    onChange={(e) => setEditSprintGoal(e.target.value)}
                  />
                  <input type="date" className="jira-input-sm" value={editSprintStart} onChange={(e) => setEditSprintStart(e.target.value)} />
                  <input type="date" className="jira-input-sm" value={editSprintEnd} onChange={(e) => setEditSprintEnd(e.target.value)} />
                  <button type="submit" className="jira-btn-primary-sm">Save</button>
                  <button type="button" className="jira-btn-secondary-sm" onClick={() => setEditingSprintId(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <div className="jira-sprint-header-info">
                    <span className="jira-sprint-name">{sprint.name}</span>
                    {sprint.status === "ACTIVE" && (
                      <span className="jira-sprint-active-badge">ACTIVE</span>
                    )}
                    {sprint.start_date && sprint.end_date && (
                      <span className="jira-sprint-dates">
                        {new Date(sprint.start_date).toLocaleDateString()} – {new Date(sprint.end_date).toLocaleDateString()}
                      </span>
                    )}
                    {sprint.goal && (
                      <span className="jira-sprint-goal" title={sprint.goal}>
                        <SprintGoalIcon size={12} /> {sprint.goal}
                      </span>
                    )}
                    <span className="jira-sprint-count">
                      {doneCount}/{sprintIssues.length} done
                    </span>
                  </div>

                  <div className="jira-sprint-header-actions">
                    {can(ACTIONS.START_COMPLETE_SPRINT) && sprint.status === "PLANNED" && (
                      <button className="jira-btn-primary-sm" onClick={() => handleStartSprint(sprint.id)}>
                        Start Sprint
                      </button>
                    )}
                    {can(ACTIONS.START_COMPLETE_SPRINT) && sprint.status === "ACTIVE" && (
                      <button className="jira-btn-complete-sprint" onClick={() => setCompletingSprintId(sprint.id)}>
                        Complete Sprint
                      </button>
                    )}
                    {can(ACTIONS.EDIT_PROJECT_SETTINGS) && (
                      <button className="jira-btn-icon-plain" title="Edit sprint"
                        onClick={() => { setEditingSprintId(sprint.id); setEditSprintName(sprint.name); setEditSprintGoal(sprint.goal || ""); setEditSprintStart(sprint.start_date || ""); setEditSprintEnd(sprint.end_date || ""); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    )}
                    {can(ACTIONS.CREATE_SPRINT) && sprint.status === "PLANNED" && (
                      <button className="jira-btn-icon-plain" title="Delete sprint" onClick={() => handleDeleteSprint(sprint.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#de350b" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Sprint Issues */}
            {!isCollapsed && (
              <>
                <div className="jira-backlog-issue-list">
                  {sprintIssues.length === 0 && (
                    <div className="jira-backlog-empty-drop">
                      {readOnly ? "No issues in this sprint." : "Drag issues here to add them to this sprint"}
                    </div>
                  )}
                  {sprintIssues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      projectKey={project?.key}
                      onOpen={() => setSelectedIssueId(issue.id)}
                      onDragStart={readOnly ? undefined : () => setDraggingIssueId(issue.id)}
                    />
                  ))}
                </div>
                {/* Inline create — Member/Admin only */}
                {can(ACTIONS.CREATE_ISSUE) && (inlineSection === sprint.id ? (
                  <InlineCreate
                    title={inlineTitle}
                    setTitle={setInlineTitle}
                    type={inlineType}
                    setType={setInlineType}
                    onSubmit={(e) => handleInlineCreate(e, sprint.id)}
                    onCancel={() => setInlineSection(null)}
                  />
                ) : (
                  <button
                    className="jira-backlog-create-btn"
                    onClick={() => { setInlineSection(sprint.id); setInlineTitle(""); }}
                  >
                    + Create issue
                  </button>
                ))}
              </>
            )}
          </div>
        );
      })}

      {/* Backlog Section */}
      <div
        className={`jira-sprint-section backlog-section ${dragOverSection === "backlog" ? "drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOverSection("backlog"); }}
        onDragLeave={() => setDragOverSection(null)}
        onDrop={() => handleDrop("backlog")}
      >
        <div className="jira-sprint-header">
          <button
            className="jira-sprint-collapse-btn"
            onClick={() => toggleCollapse("backlog")}
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
              style={{ transform: collapsed["backlog"] ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div className="jira-sprint-header-info">
            <span className="jira-sprint-name">Backlog</span>
            <span className="jira-sprint-count">{backlogIssues.length} issues</span>
          </div>
        </div>

        {!collapsed["backlog"] && (
          <>
            <div className="jira-backlog-issue-list">
              {backlogIssues.length === 0 && (
                <div className="jira-backlog-empty-drop">
                  {readOnly ? "No issues in backlog." : "No issues in backlog. Create one below or drag issues here from sprints."}
                </div>
              )}
              {backlogIssues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  projectKey={project?.key}
                  onOpen={() => setSelectedIssueId(issue.id)}
                  onDragStart={readOnly ? undefined : () => setDraggingIssueId(issue.id)}
                />
              ))}
            </div>
            {can(ACTIONS.CREATE_ISSUE) && (inlineSection === "backlog" ? (
              <InlineCreate
                title={inlineTitle}
                setTitle={setInlineTitle}
                type={inlineType}
                setType={setInlineType}
                onSubmit={(e) => handleInlineCreate(e, "backlog")}
                onCancel={() => setInlineSection(null)}
              />
            ) : (
              <button
                className="jira-backlog-create-btn"
                onClick={() => { setInlineSection("backlog"); setInlineTitle(""); }}
              >
                + Create issue
              </button>
            ))}
          </>
        )}
      </div>

      {/* Completed Sprints (collapsed by default) */}
      {completedSprints.length > 0 && (
        <div className="jira-completed-sprints-wrap">
          <button
            className="jira-completed-sprints-toggle"
            onClick={() => toggleCollapse("completed")}
          >
            {collapsed["completed"] ? "▶" : "▼"} Completed Sprints ({completedSprints.length})
          </button>
          {!collapsed["completed"] && completedSprints.map((sprint) => {
            const sprintIssues = sprintMap[sprint.id] || [];
            return (
              <div key={sprint.id} className="jira-sprint-section completed-sprint">
                <div className="jira-sprint-header">
                  <div className="jira-sprint-header-info">
                    <span className="jira-sprint-name">{sprint.name}</span>
                    <span className="jira-sprint-completed-badge">COMPLETED</span>
                    {sprint.completed_at && (
                      <span className="jira-sprint-dates">
                        Completed {new Date(sprint.completed_at).toLocaleDateString()}
                      </span>
                    )}
                    <span className="jira-sprint-count">{sprintIssues.length} issues</span>
                  </div>
                </div>
                <div className="jira-backlog-issue-list">
                  {sprintIssues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      projectKey={project?.key}
                      onOpen={() => setSelectedIssueId(issue.id)}
                      onDragStart={() => setDraggingIssueId(issue.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Complete Sprint Modal */}
      {completingSprintId && (
        <div className="jira-modal-overlay" onClick={() => setCompletingSprintId(null)}>
          <div className="jira-auth-modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="jira-auth-modal-header">
              <div className="jira-auth-modal-icon-badge">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <h3 className="jira-auth-modal-title">Complete Sprint</h3>
                <p className="jira-auth-modal-desc">
                  {(() => {
                    const sprint = sprints.find((s) => s.id === completingSprintId);
                    const sprintIssues = sprintMap[completingSprintId] || [];
                    const unfinished = sprintIssues.filter((i) => i.status !== "DONE").length;
                    const done = sprintIssues.filter((i) => i.status === "DONE").length;
                    return `${done} issues done, ${unfinished} unfinished in "${sprint?.name}".`;
                  })()}
                </p>
              </div>
            </div>

            <form onSubmit={handleCompleteSprint} style={{ padding: "0 4px" }}>
              <div className="jira-form-group" style={{ marginTop: 12 }}>
                <label className="jira-drawer-field-label">Move unfinished issues to</label>
                <select
                  className="jira-select"
                  value={moveToSprintId}
                  onChange={(e) => setMoveToSprintId(e.target.value)}
                >
                  <option value="">Backlog (default)</option>
                  {otherSprintsForMove.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="jira-sprint-form-actions" style={{ marginTop: 16 }}>
                <button type="submit" className="jira-btn-complete-sprint">
                  Complete Sprint
                </button>
                <button type="button" className="jira-btn-secondary-sm" onClick={() => setCompletingSprintId(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issue Modal */}
      {selectedIssueId && (
        <IssueModal
          issueId={selectedIssueId}
          projectKey={project?.key}
          members={members}
          currentUser={currentUser}
          role={role}
          onClose={() => setSelectedIssueId(null)}
          onUpdate={refresh}
        />
      )}
    </div>
  );
}

// ---- Sub-components ----

function IssueRow({ issue, projectKey, onOpen, onDragStart }) {
  const typeColor = TYPE_ICONS[issue.issue_type]?.color || "#0052CC";
  const keyStr = `${projectKey}-${issue.id}`;

  return (
    <div
      className={`jira-backlog-issue-row ${issue.status === "DONE" ? "done" : ""}`}
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      title="Click to open · Drag to move to a sprint"
    >
      <span className="jira-backlog-drag-handle" title="Drag to reorder">
        <svg width="10" height="16" viewBox="0 0 10 16" fill="#97A0AF">
          <circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>
          <circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>
          <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
        </svg>
      </span>
      <span className="jira-backlog-type-icon" style={{ color: typeColor }} title={issue.issue_type}>
        <IssueTypeIcon type={issue.issue_type} size={14} />
      </span>
      <span className="jira-backlog-key">{keyStr}</span>
      <span className="jira-backlog-title">{issue.title}</span>
      <div className="jira-backlog-row-right">
        <PriorityIcon priority={issue.priority} size={12} />
        <span className={`jira-status-pill-mini ${issue.status.toLowerCase().replace("_", "-")}`}>
          {issue.status === "IN_PROGRESS" ? "In Progress" : issue.status === "DONE" ? "Done" : "To Do"}
        </span>
        {issue.assignee ? (
          <div className="jira-avatar-circle small" title={userLabel(issue.assignee)}>
            {issue.assignee.username.substring(0, 2).toUpperCase()}
          </div>
        ) : (
          <div className="jira-avatar-circle small unassigned" title="Unassigned">?</div>
        )}
      </div>
    </div>
  );
}

function InlineCreate({ title, setTitle, type, setType, onSubmit, onCancel }) {
  return (
    <form className="jira-backlog-inline-create" onSubmit={onSubmit}>
      <select
        className="jira-select-sm"
        value={type}
        onChange={(e) => setType(e.target.value)}
        style={{ width: 110, flexShrink: 0 }}
      >
        <option value="TASK">Task</option>
        <option value="BUG">Bug</option>
        <option value="STORY">Story</option>
        <option value="EPIC">Epic</option>
      </select>
      <input
        type="text"
        className="jira-input-sm"
        placeholder="What needs to be done?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        required
        style={{ flex: 1 }}
      />
      <button type="submit" className="jira-btn-primary-sm">Add</button>
      <button type="button" className="jira-btn-secondary-sm" onClick={onCancel}>Cancel</button>
    </form>
  );
}
