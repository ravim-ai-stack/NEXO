import { useState, useEffect } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import WorkflowEditor from "./WorkflowEditor";

export default function SettingsModal({ isOpen, onClose }) {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState("general");
  const [email, setEmail] = useState(user?.email || "");
  const [firstName, setFirstName] = useState(user?.first_name || "");
  const [lastName, setLastName] = useState(user?.last_name || "");
  const [defaultIssueType, setDefaultIssueType] = useState("TASK");
  const [defaultView, setDefaultView] = useState("list");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Workflow section state
  const [projects, setProjects] = useState([]);
  const [selectedWorkflowProject, setSelectedWorkflowProject] = useState(null);
  const [isAdminInAnyProject, setIsAdminInAnyProject] = useState(false);

  useEffect(() => {
    api.get("/projects/").then((res) => {
      setProjects(res.data);
      if (res.data.length > 0) setSelectedWorkflowProject(res.data[0]);
      // Check if user is Admin in at least one project
      const hasAdmin = res.data.some((p) => p.my_role === "ADMIN" || p.my_role === "MANAGER");
      setIsAdminInAnyProject(hasAdmin);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      setEmail(user.email || "");
      setFirstName(user.first_name || "");
      setLastName(user.last_name || "");
    }
  }, [user]);

  if (!isOpen) return null;

  async function handleSaveSettings() {
    setSaving(true);
    try {
      await api.patch("/auth/me/", {
        email,
        first_name: firstName,
        last_name: lastName,
      });
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1000);
    } catch (e) {
      alert("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="jira-modal-backdrop" onClick={onClose}>
      <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 780 }}>
        <div className="jira-modal-header">
          <div className="jira-modal-title-group">
            <h2 className="jira-modal-title">Jira Workspace & Profile Settings</h2>
            <span className="jira-sub-key">Configure your account, project preferences, and notifications</span>
          </div>
          <button className="jira-btn-icon-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="jira-modal-body" style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 20, minHeight: 320 }}>
          {/* Settings Sidebar */}
          <div className="jira-settings-sidebar">
            <button className={`jira-settings-nav-item ${activeSection === "general" ? "active" : ""}`} onClick={() => setActiveSection("general")}>
              Profile & Account
            </button>
            <button className={`jira-settings-nav-item ${activeSection === "preferences" ? "active" : ""}`} onClick={() => setActiveSection("preferences")}>
              Preferences
            </button>
            {isAdminInAnyProject && (
              <button className={`jira-settings-nav-item ${activeSection === "workflows" ? "active" : ""}`} onClick={() => setActiveSection("workflows")}>
                Workflows & Statuses
              </button>
            )}
            <button className={`jira-settings-nav-item ${activeSection === "notifications" ? "active" : ""}`} onClick={() => setActiveSection("notifications")}>
              Notifications
            </button>
          </div>

          {/* Settings Content Pane */}
          <div className="jira-settings-pane">
            {activeSection === "general" && (
              <div className="jira-settings-group">
                <h3 className="jira-section-title">User Account Information</h3>
                <div className="jira-form-field">
                  <label className="jira-field-label">Username</label>
                  <input type="text" className="jira-input" value={user?.username || ""} disabled style={{ background: "#FAFBFC" }} />
                </div>
                <div className="jira-form-field" style={{ marginTop: 10 }}>
                  <label className="jira-field-label">Email Address</label>
                  <input type="email" className="jira-input" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="jira-form-row-2" style={{ marginTop: 10 }}>
                  <div className="jira-form-field">
                    <label className="jira-field-label">First Name</label>
                    <input type="text" className="jira-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div className="jira-form-field">
                    <label className="jira-field-label">Last Name</label>
                    <input type="text" className="jira-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {activeSection === "preferences" && (
              <div className="jira-settings-group">
                <h3 className="jira-section-title">General Preferences</h3>
                <div className="jira-setting-row">
                  <div>
                    <strong>Default Issue Type</strong>
                    <p className="jira-setting-desc">The default issue type pre-selected when clicking Create.</p>
                  </div>
                  <select
                    className="jira-select-sm"
                    value={defaultIssueType}
                    onChange={(e) => setDefaultIssueType(e.target.value)}
                  >
                    <option value="TASK">Task</option>
                    <option value="BUG">Bug</option>
                    <option value="STORY">Story</option>
                  </select>
                </div>

                <div className="jira-setting-row">
                  <div>
                    <strong>Default View Tab</strong>
                    <p className="jira-setting-desc">Which view opens when entering a project board.</p>
                  </div>
                  <select
                    className="jira-select-sm"
                    value={defaultView}
                    onChange={(e) => setDefaultView(e.target.value)}
                  >
                    <option value="list">List View</option>
                    <option value="board">Kanban Board</option>
                    <option value="summary">Summary</option>
                    <option value="calendar">Calendar</option>
                    <option value="docs">Docs</option>
                  </select>
                </div>
              </div>
            )}

            {activeSection === "workflows" && isAdminInAnyProject && (
              <div className="jira-settings-group">
                <h3 className="jira-section-title">Project Workflow Columns</h3>
                <p className="jira-setting-desc" style={{ marginBottom: 12 }}>
                  Customize statuses and allowed transitions per project. Changes take effect immediately on the Kanban board.
                </p>
                {projects.length === 0 ? (
                  <div className="jira-wf-empty">No projects yet. Create a project first.</div>
                ) : (
                  <>
                    <div className="jira-form-field" style={{ marginBottom: 14 }}>
                      <label className="jira-field-label">Select Project</label>
                      <select
                        className="jira-select"
                        value={selectedWorkflowProject?.id || ""}
                        onChange={(e) => {
                          const p = projects.find((p) => p.id === parseInt(e.target.value));
                          setSelectedWorkflowProject(p || null);
                        }}
                      >
                        {projects.filter((p) => p.my_role === "ADMIN" || p.my_role === "MANAGER").map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.key})</option>
                        ))}
                      </select>
                    </div>
                    {selectedWorkflowProject && (
                      <WorkflowEditor project={selectedWorkflowProject} />
                    )}
                  </>
                )}
              </div>
            )}

            {activeSection === "notifications" && (
              <div className="jira-settings-group">
                <h3 className="jira-section-title">Email & In-App Notifications</h3>
                <div className="jira-setting-row">
                  <div>
                    <strong>Task Assignment Alerts</strong>
                    <p className="jira-setting-desc">Receive real-time notifications for assigned tasks.</p>
                  </div>
                  <input
                    type="checkbox"
                    className="jira-checkbox"
                    checked={emailNotifications}
                    onChange={(e) => setEmailNotifications(e.target.checked)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="jira-modal-footer">
          <button className="jira-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="jira-btn-primary" onClick={handleSaveSettings} disabled={saving}>
            {savedSuccess ? "Saved!" : saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
