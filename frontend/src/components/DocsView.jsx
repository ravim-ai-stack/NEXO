import { useState, useEffect } from "react";
import { userLabel } from "../utils/userLabel";
import api from "../api/client";

const TEMPLATES = [
  {
    id: "PRD",
    name: "Product Requirements (PRD)",
    tag: "Product Specs",
    icon: "PRD",
    content: `## Objective & Goal\nDefine the business problem, user pain points, and success metrics for this feature.\n\n### Target Personas\n- **Primary Persona**: Data Scientist / Engineer\n- **Use Case**: Real-time batch predictions and automated pipeline execution\n\n### Functional Requirements\n1. **REST API**: Endpoint to trigger data ingestion pipeline with status callbacks\n2. **Validation**: Auto-check CSV schema before loading into model\n3. **Performance**: Process 10k rows in < 1.5 seconds\n\n### Key Performance Indicators (KPIs)\n- 99.9% uptime on prediction microservice\n- < 200ms latency for single-record inference`,
  },
  {
    id: "ARCHITECTURE",
    name: "Architecture & System Design",
    tag: "Architecture",
    icon: "ARC",
    content: `## System Architecture Overview\nHigh-level architectural design and service boundaries.\n\n### Technology Stack\n- **Backend**: Django REST Framework (Python 3.12)\n- **Frontend**: React 19 + Vite + Atlassian Design System\n- **Database**: PostgreSQL / SQLite with indexed key lookups\n- **Cache & Async**: Redis + Celery worker queue\n\n### API Endpoints\n- \`GET /api/projects/\`: List workspaces for authenticated user\n- \`POST /api/issues/\`: Create new task or subtask\n- \`PATCH /api/issues/{id}/\`: Update status, priority, or assignee`,
  },
  {
    id: "RETRO",
    name: "Sprint Retrospective",
    tag: "Sprint Notes",
    icon: "RET",
    content: `## Sprint Retrospective Summary\nReviewing sprint velocity, team feedback, and next sprint commitments.\n\n### What Went Well\n- Completed all priority backlog tasks on schedule\n- Zero blocker bugs introduced during sprint\n- Clean separation between frontend components\n\n### What Could Be Improved\n- Add automated end-to-end tests for issue status transitions\n- Improve ticket estimation precision for subtasks\n\n### Action Items\n- [ ] Set up GitHub Actions CI pipeline\n- [ ] Update API documentation and model schemas`,
  },
  {
    id: "MEETING",
    name: "Team Meeting Notes & Decisions",
    tag: "Meeting Notes",
    icon: "MTG",
    content: `## Weekly Standup & Planning\n**Agenda**: Review sprint burndown and align on API specifications.\n\n### Agenda Items\n1. Review sprint burndown trajectory\n2. Align on Figma UI design specifications\n3. Coordinate model deployment timeline\n\n### Key Decisions Made\n- Standardize on Atlassian design tokens for the entire project board\n- Use direct status transitions for seamless Kanban board updates`,
  },
];

export default function DocsView({ project, currentUser }) {
  const currentUserName = currentUser?.username || "Project Member";

  const [docs, setDocs] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editor form state
  const [editTitle, setEditTitle] = useState("");
  const [editTemplateType, setEditTemplateType] = useState("PRD");
  const [editContent, setEditContent] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("PRD");

  function loadDocs() {
    if (!project?.id) return;
    setLoading(true);
    api.get(`/docs/?project=${project.id}`)
      .then(async (res) => {
        let loadedDocs = res.data || [];
        if (loadedDocs.length === 0) {
          // Auto-seed default initial project docs in database
          try {
            const initialDoc = await api.post("/docs/", {
              project: project.id,
              title: `${project?.name || "Project"} Overview & Architecture`,
              template_type: "ARCHITECTURE",
              content: `## ${project?.name || "Project"} Documentation Hub\n\nWelcome to the official documentation workspace for **${project?.name}**.\n\n### Objectives\n- Coordinate team sprint deliverables\n- Centralize technical documentation, API schemas, and release notes\n- Track design specs and live Figma embeds\n\n### Key Contributors\n- **Project Lead**: ${currentUserName}\n- **Workspace**: ${project?.name}`,
            });
            loadedDocs = [initialDoc.data];
          } catch (e) {}
        }
        setDocs(loadedDocs);
        if (loadedDocs.length > 0 && !selectedDocId) {
          setSelectedDocId(loadedDocs[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDocs();
  }, [project?.id]);

  const selectedDoc = docs.find((d) => d.id === selectedDocId) || docs[0];

  function handleStartEdit() {
    if (!selectedDoc) return;
    setEditTitle(selectedDoc.title);
    setEditTemplateType(selectedDoc.template_type || "CUSTOM");
    setEditContent(selectedDoc.content);
    setIsEditing(true);
  }

  async function handleSaveEdit() {
    if (!editTitle.trim() || !selectedDoc) return;
    setSaving(true);
    try {
      const res = await api.patch(`/docs/${selectedDoc.id}/`, {
        title: editTitle.trim(),
        template_type: editTemplateType,
        content: editContent,
      });
      setDocs((prev) => prev.map((d) => (d.id === selectedDoc.id ? res.data : d)));
      setIsEditing(false);
    } catch (e) {
      alert("Failed to save document to backend.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDoc(id) {
    if (!window.confirm("Are you sure you want to delete this document?")) return;
    try {
      await api.delete(`/docs/${id}/`);
      const nextDocs = docs.filter((d) => d.id !== id);
      setDocs(nextDocs);
      if (nextDocs.length > 0) {
        setSelectedDocId(nextDocs[0].id);
      }
    } catch (e) {
      alert("Failed to delete document.");
    }
  }

  async function handleCreateFromTemplate(e) {
    e.preventDefault();
    if (!editTitle.trim() || !project?.id) return;
    setSaving(true);
    try {
      const chosenTmpl = TEMPLATES.find((t) => t.id === selectedTemplate);
      const res = await api.post("/docs/", {
        project: project.id,
        title: editTitle.trim(),
        template_type: selectedTemplate,
        content: editContent || chosenTmpl?.content || "",
      });
      setDocs((prev) => [res.data, ...prev]);
      setSelectedDocId(res.data.id);
      setShowNewModal(false);
      setEditTitle("");
      setEditContent("");
    } catch (e) {
      alert("Failed to create document.");
    } finally {
      setSaving(false);
    }
  }

  const filteredDocs = docs.filter(
    (d) =>
      d.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.content?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="jira-docs-workspace">
      {/* Sidebar: Navigation List of Docs */}
      <div className="jira-docs-sidebar">
        <div className="jira-docs-sidebar-header">
          <div className="jira-docs-header-title-row">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div>
                <h3 className="jira-docs-sidebar-title">Project Docs</h3>
                <span className="jira-docs-cloud-sync-badge">Synced to DB</span>
              </div>
            </div>
            <button
              className="jira-btn-primary-sm"
              onClick={() => {
                const tmpl = TEMPLATES.find((t) => t.id === selectedTemplate) || TEMPLATES[0];
                setEditTitle(`New ${tmpl.name.replace(/[^a-zA-Z ]/g, "").trim()}`);
                setEditContent(tmpl.content);
                setShowNewModal(true);
              }}
              title="Create new document"
            >
              + New Doc
            </button>
          </div>

          <div className="jira-docs-search-wrap">
            <input
              type="text"
              className="jira-input-sm"
              placeholder="Search documentation..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Pre-built Templates Quick Bar */}
        <div className="jira-docs-templates-section">
          <span className="jira-field-label" style={{ fontSize: 11, marginBottom: 6, display: "block" }}>
            PRE-BUILT TEMPLATES
          </span>
          <div className="jira-docs-template-chips">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                className="jira-tmpl-chip"
                onClick={() => {
                  setSelectedTemplate(tmpl.id);
                  setEditTitle(`${tmpl.name.replace(/[^a-zA-Z ]/g, "").trim()}`);
                  setEditContent(tmpl.content);
                  setShowNewModal(true);
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: "#0052CC", background: "#DEEBFF", borderRadius: 3, padding: "1px 5px" }}>{tmpl.icon}</span>
                <span>{tmpl.tag}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Document Items List */}
        <div className="jira-docs-tree-list">
          {loading && <div style={{ padding: 14, fontSize: 12.5, color: "var(--jira-text-muted)" }}>Loading documents...</div>}

          {!loading && filteredDocs.map((doc) => (
            <div
              key={doc.id}
              className={`jira-doc-tree-item ${selectedDocId === doc.id ? "active" : ""}`}
              onClick={() => {
                setSelectedDocId(doc.id);
                setIsEditing(false);
              }}
            >
              <div className="jira-doc-tree-icon">
                <span style={{ fontSize: 10, fontWeight: 700, color: "#0052CC" }}>
                  {doc.template_type === "PRD" ? "PRD" : doc.template_type === "ARCHITECTURE" ? "ARC" : doc.template_type === "RETRO" ? "RET" : doc.template_type === "MEETING" ? "MTG" : "DOC"}
                </span>
              </div>
              <div className="jira-doc-tree-info">
                <div className="jira-doc-tree-title">{doc.title}</div>
                <div className="jira-doc-tree-meta">
                  <span>{userLabel(doc.created_by) || currentUserName}</span> • <span>{new Date(doc.updated_at || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </div>
              </div>
            </div>
          ))}

          {!loading && filteredDocs.length === 0 && (
            <div className="jira-docs-empty-state">No documents match "{searchTerm}".</div>
          )}
        </div>
      </div>

      {/* Main Document Content Pane */}
      <div className="jira-docs-main-content">
        {selectedDoc ? (
          <div>
            {/* Top Document Header Toolbar */}
            <div className="jira-docs-article-header">
              <div>
                <div className="jira-docs-breadcrumb">
                  <span>Spaces</span> / <span>{project?.name}</span> / <span className="current">{selectedDoc.title}</span>
                </div>
                <h1 className="jira-docs-article-title">{selectedDoc.title}</h1>
                <div className="jira-docs-article-meta">
                  <div className="jira-avatar-circle" style={{ width: 22, height: 22, fontSize: 10 }}>
                    {(selectedDoc.created_by?.username || currentUserName).substring(0, 2).toUpperCase()}
                  </div>
                  <span>Created by <strong>{userLabel(selectedDoc.created_by) || currentUserName}</strong></span>
                  <span>•</span>
                  <span>Last updated: {new Date(selectedDoc.updated_at || Date.now()).toLocaleString()}</span>
                  <span className="jira-status-pill jira-status-done" style={{ fontSize: 10 }}>SAVED</span>
                </div>
              </div>

              <div className="jira-docs-article-actions">
                {!isEditing ? (
                  <>
                    <button className="jira-btn-primary-sm" onClick={handleStartEdit}>
                      Edit Document
                    </button>
                    <button
                      className="jira-btn-icon-danger"
                      onClick={() => handleDeleteDoc(selectedDoc.id)}
                      title="Delete document"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    <button className="jira-btn-primary-sm" onClick={handleSaveEdit} disabled={saving}>
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button className="jira-btn-secondary-sm" onClick={() => setIsEditing(false)}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Document Content View / Markdown Editor */}
            <div className="jira-docs-article-body">
              {isEditing ? (
                <div className="jira-docs-editor-container">
                  <div className="jira-form-field">
                    <label className="jira-field-label">Document Title</label>
                    <input
                      type="text"
                      className="jira-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </div>

                  <div className="jira-form-field" style={{ marginTop: 12 }}>
                    <label className="jira-field-label">Content (Markdown Supported)</label>
                    <textarea
                      className="jira-doc-textarea"
                      rows={18}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder="Write markdown documentation..."
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                    <button className="jira-btn-secondary" onClick={() => setIsEditing(false)}>
                      Cancel
                    </button>
                    <button className="jira-btn-primary" onClick={handleSaveEdit} disabled={saving}>
                      {saving ? "Saving to Database..." : "Save to Database"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="jira-markdown-renderer">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(selectedDoc.content),
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="jira-docs-no-selection">
            <span>Select or create a document to view.</span>
          </div>
        )}
      </div>

      {/* New Document Modal */}
      {showNewModal && (
        <div className="jira-modal-backdrop" onClick={() => setShowNewModal(false)}>
          <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="jira-modal-header">
              <h2 className="jira-modal-title">Create Documentation Page</h2>
              <button className="jira-btn-icon-close" onClick={() => setShowNewModal(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleCreateFromTemplate} className="jira-modal-body">
              <div className="jira-form-field">
                <label className="jira-field-label">Choose Engineering Template</label>
                <div className="jira-template-picker-grid">
                  {TEMPLATES.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      className={`jira-template-card ${selectedTemplate === tmpl.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedTemplate(tmpl.id);
                        setEditContent(tmpl.content);
                      }}
                    >
                      <span className="jira-tmpl-icon" style={{ fontSize: 10, fontWeight: 700, color: "#0052CC", background: "#DEEBFF", borderRadius: 3, padding: "1px 5px" }}>{tmpl.icon}</span>
                      <span className="jira-tmpl-name">{tmpl.name}</span>
                      <span className="jira-tmpl-tag">{tmpl.tag}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="jira-form-field" style={{ marginTop: 14 }}>
                <label className="jira-field-label">Page Title <span className="jira-req">*</span></label>
                <input
                  type="text"
                  className="jira-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="e.g. Q3 Sprint Retrospective"
                  required
                  autoFocus
                />
              </div>

              <div className="jira-form-field" style={{ marginTop: 14 }}>
                <label className="jira-field-label">Initial Content (Markdown)</label>
                <textarea
                  className="jira-doc-textarea"
                  rows={8}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              </div>

              <div className="jira-modal-footer" style={{ padding: "14px 0 0 0", marginTop: 14 }}>
                <button type="button" className="jira-btn-secondary" onClick={() => setShowNewModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="jira-btn-primary" disabled={saving}>
                  {saving ? "Creating in DB..." : "Create Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple Markdown parser for headers, lists, code blocks, bold, etc.
function renderMarkdown(md = "") {
  if (!md) return "<p>No content in this document.</p>";

  return md
    .replace(/^### (.*$)/gim, '<h3 class="jira-md-h3">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="jira-md-h2">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="jira-md-h1">$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>")
    .replace(/`([^`]+)`/gim, '<code class="jira-md-inline-code">$1</code>')
    .replace(/^- (.*$)/gim, '<li class="jira-md-li">$1</li>')
    .replace(/\[ \]/gim, '<input type="checkbox" disabled />')
    .replace(/\[x\]/gim, '<input type="checkbox" checked disabled />')
    .replace(/\n\n/gim, "<br/><br/>")
    .replace(/\n/gim, "<br/>");
}
