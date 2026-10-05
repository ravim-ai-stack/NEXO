import { useState } from "react";
import { userLabel } from "../utils/userLabel";
import { IssueTypeIcon, PriorityIcon } from "./Icons";

export default function SummaryView({
  project,
  issues = [],
  members = [],
  onSelectIssue,
  onCreateIssueTrigger,
}) {
  const [copiedReport, setCopiedReport] = useState(false);

  const total = issues.length;
  const todoIssues = issues.filter((i) => i.status === "TODO");
  const inProgressIssues = issues.filter((i) => i.status === "IN_PROGRESS");
  const doneIssues = issues.filter((i) => i.status === "DONE");

  const donePercent = total > 0 ? Math.round((doneIssues.length / total) * 100) : 0;
  const inProgressPercent = total > 0 ? Math.round((inProgressIssues.length / total) * 100) : 0;
  const todoPercent = total > 0 ? Math.round((todoIssues.length / total) * 100) : 0;

  // Group by priority
  const criticalIssues = issues.filter((i) => i.priority === "CRITICAL");
  const highIssues = issues.filter((i) => i.priority === "HIGH");
  const mediumIssues = issues.filter((i) => i.priority === "MEDIUM");
  const lowIssues = issues.filter((i) => i.priority === "LOW");

  // Group by type
  const taskCount = issues.filter((i) => i.issue_type === "TASK").length;
  const bugCount = issues.filter((i) => i.issue_type === "BUG").length;
  const storyCount = issues.filter((i) => i.issue_type === "STORY").length;

  // Unassigned issues
  const unassignedIssues = issues.filter((i) => !i.assignee);

  // Copy Executive Report to clipboard
  function handleCopyReport() {
    const lines = [
      `EXECUTIVE PROJECT REPORT: ${project?.name || "NEXO Project"} (${project?.key || "KAN"})`,
      `==================================================`,
      `Generated: ${new Date().toLocaleDateString()} | Lead: ${project?.created_by?.username || "Admin"}`,
      `Description: ${project?.description || "Sprint project workspace"}`,
      ``,
      `SPRINT PROGRESS OVERVIEW:`,
      `- Total Work Items: ${total}`,
      `- Completed: ${doneIssues.length} (${donePercent}%)`,
      `- In Progress: ${inProgressIssues.length} (${inProgressPercent}%)`,
      `- To Do: ${todoIssues.length} (${todoPercent}%)`,
      `- Critical Blockers: ${criticalIssues.length}`,
      ``,
      `TEAM MEMBERS WORKLOAD BREAKDOWN:`,
      ...members.map((m) => {
        const username = m.user ? userLabel(m.user) : m.username;
        const userIssues = issues.filter((i) => i.assignee?.id === (m.user?.id || m.id));
        const userDone = userIssues.filter((i) => i.status === "DONE").length;
        const userInProgress = userIssues.filter((i) => i.status === "IN_PROGRESS").length;
        const taskTitles = userIssues.map((i) => `  * [${project?.key}-${i.id}] ${i.title} (${i.status})`).join("\n");
        return `• ${username} (${m.role || "Member"}): ${userIssues.length} assigned (${userDone} done, ${userInProgress} in progress)\n${taskTitles || "  * (No assigned tasks)"}`;
      }),
      ``,
      `• Unassigned: ${unassignedIssues.length} tasks needing triage`,
    ];

    navigator.clipboard?.writeText(lines.join("\n"));
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2200);
  }

  return (
    <div className="jira-summary-container">
      {/* 1. Executive Project Description & Header Report */}
      <div className="jira-summary-report-card">
        <div className="jira-summary-report-header">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="jira-project-avatar-lg">
              {project?.name ? project.name.substring(0, 2).toUpperCase() : "PJ"}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h1 className="jira-summary-project-name">{project?.name || "Project Overview"}</h1>
                <span className="jira-summary-key-pill">{project?.key || "KAN"}</span>
                <span className="jira-status-pill jira-status-done">ACTIVE SPRINT</span>
              </div>
              <p className="jira-summary-lead-text">
                Lead: <strong>{project?.created_by?.username || "Project Lead"}</strong> • Created: {new Date(project?.created_at || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="jira-btn-secondary" onClick={handleCopyReport} title="Copy formatted text report">
              {copiedReport ? "Copied!" : "Copy Report"}
            </button>
            <button className="jira-btn-secondary" onClick={() => window.print()} title="Print or save as PDF">
              Print
            </button>
            {onCreateIssueTrigger && (
              <button className="jira-btn-primary" onClick={onCreateIssueTrigger}>
                + Create Issue
              </button>
            )}
          </div>
        </div>

        {/* Project Description Section */}
        <div className="jira-summary-desc-box">
          <div className="jira-summary-desc-title">Project Objective & Scope</div>
          <p className="jira-summary-desc-content">
            {project?.description ||
              "Core agile sprint workspace for cross-functional collaboration, tracking development milestones, managing backlog items, and streamlining sprint delivery across team members."}
          </p>
        </div>
      </div>

      {/* 2. Top Metric Statistics Grid */}
      <div className="jira-summary-cards-grid" style={{ marginTop: 16 }}>
        <div className="jira-metric-card">
          <span className="jira-metric-label">Total Work Items</span>
          <span className="jira-metric-val">{total}</span>
          <span className="jira-metric-note">{taskCount} Tasks • {bugCount} Bugs • {storyCount} Stories</span>
        </div>

        <div className="jira-metric-card">
          <span className="jira-metric-label">Sprint Completion</span>
          <span className="jira-metric-val" style={{ color: "#00875a" }}>{donePercent}%</span>
          <div className="jira-progress-bar-thin">
            <div className="jira-bar-fill-done" style={{ width: `${donePercent}%` }}></div>
          </div>
          <span className="jira-metric-note">{doneIssues.length} of {total} completed</span>
        </div>

        <div className="jira-metric-card">
          <span className="jira-metric-label">Active Work</span>
          <span className="jira-metric-val" style={{ color: "#0052cc" }}>{inProgressIssues.length}</span>
          <span className="jira-metric-note">{inProgressPercent}% actively in development</span>
        </div>

        <div className="jira-metric-card">
          <span className="jira-metric-label">Queue (To Do)</span>
          <span className="jira-metric-val" style={{ color: "#42526e" }}>{todoIssues.length}</span>
          <span className="jira-metric-note">{unassignedIssues.length} unassigned tickets</span>
        </div>
      </div>

      {/* 3. Detailed Team Members Work Breakdown Report */}
      <div className="jira-summary-report-card" style={{ marginTop: 20 }}>
        <div className="jira-summary-box-header">
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Team Members Work & Contributions Report</h3>
            <p style={{ fontSize: 12.5, color: "var(--jira-text-secondary)", marginTop: 2 }}>
              Detailed breakdown of assigned tasks, active workload, and delivery status per team member.
            </p>
          </div>
          <span className="jira-box-count">{members.length} active contributors</span>
        </div>

        <div className="jira-members-work-list">
          {members.map((m) => {
            const username = m.user ? userLabel(m.user) : m.username;
            const userId = m.user?.id || m.id;
            const userIssues = issues.filter((i) => i.assignee?.id === userId);
            const userDone = userIssues.filter((i) => i.status === "DONE");
            const userInProgress = userIssues.filter((i) => i.status === "IN_PROGRESS");
            const userTodo = userIssues.filter((i) => i.status === "TODO");
            const userPercent = userIssues.length > 0 ? Math.round((userDone.length / userIssues.length) * 100) : 0;

            return (
              <div key={userId} className="jira-member-work-row">
                <div className="jira-member-work-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="jira-avatar-circle" style={{ width: 34, height: 34, fontSize: 13 }}>
                      {username.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <h4 className="jira-member-name">{username}</h4>
                        <span className="jira-member-role-badge">{m.role || "Member"}</span>
                      </div>
                      <span className="jira-member-sub-stat">
                        {userIssues.length} total tasks assigned • {userDone.length} completed ({userPercent}%)
                      </span>
                    </div>
                  </div>

                  {/* Progress bar per member */}
                  <div className="jira-member-progress-wrap">
                    <div className="jira-progress-bar-thin" style={{ width: 140 }}>
                      <div className="jira-bar-fill-done" style={{ width: `${userPercent}%` }} />
                    </div>
                    <span className="jira-member-percent-text">{userPercent}%</span>
                  </div>
                </div>

                {/* Member's Tasks List */}
                <div className="jira-member-tasks-grid">
                  {userIssues.length > 0 ? (
                    userIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className={`jira-member-task-item ${issue.status === "DONE" ? "done" : ""}`}
                        onClick={() => onSelectIssue && onSelectIssue(issue.id)}
                        title="Click to view issue details"
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12 }}>
                            <IssueTypeIcon type={issue.issue_type} size={12} />
                          </span>
                          <span className="jira-task-key">{project?.key}-{issue.id}</span>
                          <span className="jira-task-title-trunc">{issue.title}</span>
                        </div>
                        <span className={`jira-status-pill jira-status-${issue.status.toLowerCase().replace("_", "")}`}>
                          {issue.status.replace("_", " ")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="jira-empty-member-tasks">No tasks assigned yet.</div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Unassigned Work Items Row */}
          {unassignedIssues.length > 0 && (
            <div className="jira-member-work-row unassigned">
              <div className="jira-member-work-header">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="jira-avatar-circle unassigned" style={{ width: 34, height: 34, fontSize: 13 }}>
                    ?
                  </div>
                  <div>
                    <h4 className="jira-member-name">Unassigned Tasks</h4>
                    <span className="jira-member-sub-stat">
                      {unassignedIssues.length} tickets needing developer assignment
                    </span>
                  </div>
                </div>
              </div>

              <div className="jira-member-tasks-grid">
                {unassignedIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="jira-member-task-item"
                    onClick={() => onSelectIssue && onSelectIssue(issue.id)}
                    title="Click to assign ticket"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12 }}>
                        <IssueTypeIcon type={issue.issue_type} size={12} />
                      </span>
                      <span className="jira-task-key">{project?.key}-{issue.id}</span>
                      <span className="jira-task-title-trunc">{issue.title}</span>
                    </div>
                    <span className="jira-status-pill jira-status-todo">UNASSIGNED</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Priority & Category Breakdown Grid */}
      <div className="jira-summary-sections-grid" style={{ marginTop: 20 }}>
        {/* Status Distribution */}
        <div className="jira-summary-box">
          <div className="jira-summary-box-header">
            <h3>Status Overview</h3>
            <span className="jira-box-count">{total} total items</span>
          </div>

          <div className="jira-status-stacked-bar">
            {todoPercent > 0 && (
              <div className="bar-segment todo" style={{ width: `${todoPercent}%` }} title={`To Do: ${todoIssues.length} (${todoPercent}%)`}></div>
            )}
            {inProgressPercent > 0 && (
              <div className="bar-segment in-progress" style={{ width: `${inProgressPercent}%` }} title={`In Progress: ${inProgressIssues.length} (${inProgressPercent}%)`}></div>
            )}
            {donePercent > 0 && (
              <div className="bar-segment done" style={{ width: `${donePercent}%` }} title={`Done: ${doneIssues.length} (${donePercent}%)`}></div>
            )}
          </div>

          <div className="jira-summary-legend-list">
            <div className="jira-legend-item">
              <div className="jira-legend-left">
                <span className="jira-legend-dot todo"></span>
                <span>To Do</span>
              </div>
              <span className="jira-legend-count">{todoIssues.length}</span>
            </div>

            <div className="jira-legend-item">
              <div className="jira-legend-left">
                <span className="jira-legend-dot in-progress"></span>
                <span>In Progress</span>
              </div>
              <span className="jira-legend-count">{inProgressIssues.length}</span>
            </div>

            <div className="jira-legend-item">
              <div className="jira-legend-left">
                <span className="jira-legend-dot done"></span>
                <span>Done</span>
              </div>
              <span className="jira-legend-count">{doneIssues.length}</span>
            </div>
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="jira-summary-box">
          <div className="jira-summary-box-header">
            <h3>Priority Breakdown</h3>
            <span className="jira-box-count">By urgency</span>
          </div>

          <div className="jira-priority-list">
            <div className="jira-priority-bar-row">
              <span className="jira-pri-tag critical"><PriorityIcon priority="CRITICAL" size={11} /> Critical</span>
              <div className="jira-pri-track">
                <div className="jira-pri-fill critical" style={{ width: `${total ? (criticalIssues.length / total) * 100 : 0}%` }}></div>
              </div>
              <span className="jira-pri-count">{criticalIssues.length}</span>
            </div>

            <div className="jira-priority-bar-row">
              <span className="jira-pri-tag high"><PriorityIcon priority="HIGH" size={11} /> High</span>
              <div className="jira-pri-track">
                <div className="jira-pri-fill high" style={{ width: `${total ? (highIssues.length / total) * 100 : 0}%` }}></div>
              </div>
              <span className="jira-pri-count">{highIssues.length}</span>
            </div>

            <div className="jira-priority-bar-row">
              <span className="jira-pri-tag medium"><PriorityIcon priority="MEDIUM" size={11} /> Medium</span>
              <div className="jira-pri-track">
                <div className="jira-pri-fill medium" style={{ width: `${total ? (mediumIssues.length / total) * 100 : 0}%` }}></div>
              </div>
              <span className="jira-pri-count">{mediumIssues.length}</span>
            </div>

            <div className="jira-priority-bar-row">
              <span className="jira-pri-tag low"><PriorityIcon priority="LOW" size={11} /> Low</span>
              <div className="jira-pri-track">
                <div className="jira-pri-fill low" style={{ width: `${total ? (lowIssues.length / total) * 100 : 0}%` }}></div>
              </div>
              <span className="jira-pri-count">{lowIssues.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

