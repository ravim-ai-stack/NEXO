import { useState, useEffect, useMemo } from "react";
import { userLabel } from "../utils/userLabel";
import api from "../api/client";

const TEMPLATES = [
  {
    id: "STATUS",
    name: "Project Status & Weekly Report",
    tag: "Weekly Status",
    icon: "RPT",
    content: `## Weekly Project Status Report\n**Period**: Week ending October 10, 2026\n**Status**: ON TRACK\n\n### Accomplishments & Completed Work\n- Finalized authentication microservice and user database schema\n- Deployed initial staging pipeline with CI/CD passing\n\n### In-Progress Focus Areas\n- Integrating real-time telemetry events\n- Drafting API documentation and swagger contracts\n\n### Blockers & Critical Risks\n- Critical Blocker: Upstream third-party payment webhook latency exceeding 1.2s\n- Risk: Potential delay on security audit sign-off if reports are not submitted by Friday\n\n### Upcoming Milestones\n- Milestone: Beta Release Candidate v1.0 on October 24, 2026`,
  },
  {
    id: "TIMELINE",
    name: "Timeline & Project Plan",
    tag: "Timeline Plan",
    icon: "PLN",
    content: `## Project Timeline & Work Breakdown\nHigh-level release roadmap, phases, and key deliverables.\n\n### Project Phases\n- Phase 1: Architectural Foundation (COMPLETED)\n- Phase 2: Core Feature Implementation (ACTIVE)\n- Phase 3: QA & Security Audit (PLANNED)\n- Phase 4: Production Rollout & Go-Live (PLANNED)\n\n### Target Milestones & Deliverables\n- Milestone: Alpha Test Build (Target: 2026-10-18)\n- Milestone: Security Compliance Sign-off (Target: 2026-10-28)\n- Milestone: Production Launch v1.0 (Target: 2026-11-15)\n\n### Technical Dependencies\n- Depends on Cloud Infrastructure provisioning ticket INFRA-102`,
  },
  {
    id: "RESOURCE",
    name: "Resource & Team Allocation",
    tag: "Resource Plan",
    icon: "RES",
    content: `## Resource & Team Allocation Plan\nTeam capacity, key roles, and workstream allocations.\n\n### Key Roles & Responsibilities\n- Tech Lead: Architecture, code reviews, and API contracts (100% allocation)\n- Frontend Engineer: Component design, Atlassian UI tokens, and board interactions (100% allocation)\n- Backend Engineer: Database indexing, ORM optimization, and unit tests (80% allocation)\n- DevOps Specialist: Docker containers, deployment, and monitoring (shared 50% with Core Platform)\n\n### Capacity Constraints\n- Bottleneck: DevOps bandwidth limited to 20 hours/week during active sprint deployment`,
  },
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
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Active view tab in document pane: "content" or "signals"
  const [activeDocTab, setActiveDocTab] = useState("content");
  const [docSignals, setDocSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  const [signalCategoryFilter, setSignalCategoryFilter] = useState("ALL");

  // Editor form state
  const [editTitle, setEditTitle] = useState("");
  const [editTemplateType, setEditTemplateType] = useState("PRD");
  const [editContent, setEditContent] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("PRD");

  // Upload modal state
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadTemplateType, setUploadTemplateType] = useState("STATUS");
  const [uploading, setUploading] = useState(false);

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

  // Fetch signals for the selected document
  useEffect(() => {
    if (!selectedDoc?.id) {
      setDocSignals([]);
      return;
    }
    setSignalsLoading(true);
    api.get(`/docs/${selectedDoc.id}/signals/`)
      .then((res) => {
        setDocSignals(res.data || []);
      })
      .catch(() => {
        // Fallback to filtering signals viewset
        api.get(`/signals/?source_doc=${selectedDoc.id}`)
          .then((res) => setDocSignals(res.data || []))
          .catch(() => setDocSignals([]));
      })
      .finally(() => setSignalsLoading(false));
  }, [selectedDoc?.id]);

  function handleStartEdit() {
    if (!selectedDoc) return;
    setEditTitle(selectedDoc.title);
    setEditTemplateType(selectedDoc.template_type || "CUSTOM");
    setEditContent(selectedDoc.content);
    setIsEditing(true);
    setActiveDocTab("content");
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
      // Reload signals as content edit may trigger re-extraction
      api.get(`/docs/${selectedDoc.id}/signals/`).then((s) => setDocSignals(s.data || []));
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
      setActiveDocTab("content");
    } catch (e) {
      alert("Failed to create document.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadDoc(e) {
    e.preventDefault();
    if (!uploadFile) {
      alert("Please select a file to upload.");
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append("file", uploadFile);
    if (uploadTitle.trim()) {
      formData.append("title", uploadTitle.trim());
    }
    formData.append("template_type", uploadTemplateType);

    try {
      const res = await api.post(`/projects/${project.id}/upload_doc/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const newDoc = res.data?.doc;
      if (newDoc) {
        setDocs((prev) => [newDoc, ...prev]);
        setSelectedDocId(newDoc.id);
        setActiveDocTab("signals"); // Auto-switch to signals tab to view extracted insights
      }
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadTitle("");
    } catch (err) {
      alert("Failed to upload document. " + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  }

  async function handleReextractSignals() {
    if (!selectedDoc?.id) return;
    setReextracting(true);
    try {
      const res = await api.post(`/docs/${selectedDoc.id}/reextract/`);
      const sigs = await api.get(`/docs/${selectedDoc.id}/signals/`);
      setDocSignals(sigs.data || []);
      if (res.data?.doc) {
        setDocs((prev) => prev.map((d) => (d.id === selectedDoc.id ? res.data.doc : d)));
      }
    } catch (err) {
      alert("Failed to re-extract signals.");
    } finally {
      setReextracting(false);
    }
  }

  const filteredDocs = docs.filter(
    (d) =>
      d.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.content?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredSignals = useMemo(() => {
    if (signalCategoryFilter === "ALL") return docSignals;
    return docSignals.filter((s) => s.category === signalCategoryFilter);
  }, [docSignals, signalCategoryFilter]);

  function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getDocBadgeInfo(doc) {
    if (doc.file_type === "XLSX") return { label: "XLS", color: "#217346", bg: "#E3FCEF" };
    if (doc.file_type === "DOCX") return { label: "DOC", color: "#2B579A", bg: "#DEEBFF" };
    if (doc.file_type === "PDF") return { label: "PDF", color: "#D9381E", bg: "#FFEBE6" };
    if (doc.template_type === "PRD") return { label: "PRD", color: "#0052CC", bg: "#DEEBFF" };
    if (doc.template_type === "STATUS") return { label: "RPT", color: "#00875A", bg: "#E3FCEF" };
    if (doc.template_type === "TIMELINE") return { label: "PLN", color: "#6554C0", bg: "#EAE6FF" };
    if (doc.template_type === "RESOURCE") return { label: "RES", color: "#FF8B00", bg: "#FFF0B3" };
    if (doc.template_type === "ARCHITECTURE") return { label: "ARC", color: "#0052CC", bg: "#DEEBFF" };
    if (doc.template_type === "RETRO") return { label: "RET", color: "#403294", bg: "#EAE6FF" };
    if (doc.template_type === "MEETING") return { label: "MTG", color: "#36B37E", bg: "#E3FCEF" };
    return { label: "DOC", color: "#42526E", bg: "#EBECF0" };
  }

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
                <span className="jira-docs-cloud-sync-badge">PMO Intelligence</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="jira-btn-secondary-sm"
                onClick={() => setShowUploadModal(true)}
                title="Upload Excel, Word, PDF, or Markdown file"
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Upload</span>
              </button>
              <button
                className="jira-btn-primary-sm"
                onClick={() => {
                  const tmpl = TEMPLATES.find((t) => t.id === selectedTemplate) || TEMPLATES[0];
                  setEditTitle(`New ${tmpl.name.replace(/[^a-zA-Z ]/g, "").trim()}`);
                  setEditContent(tmpl.content);
                  setShowNewModal(true);
                }}
                title="Create new markdown document"
                style={{ padding: "3px 8px", fontSize: 11 }}
              >
                + New
              </button>
            </div>
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
            {TEMPLATES.slice(0, 5).map((tmpl) => (
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

          {!loading && filteredDocs.map((doc) => {
            const badge = getDocBadgeInfo(doc);
            return (
              <div
                key={doc.id}
                className={`jira-doc-tree-item ${selectedDocId === doc.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedDocId(doc.id);
                  setIsEditing(false);
                }}
              >
                <div className="jira-doc-tree-icon">
                  <span style={{ fontSize: 9, fontWeight: 800, color: badge.color, background: badge.bg, padding: "2px 4px", borderRadius: 3 }}>
                    {badge.label}
                  </span>
                </div>
                <div className="jira-doc-tree-info">
                  <div className="jira-doc-tree-title">{doc.title}</div>
                  <div className="jira-doc-tree-meta">
                    <span>{userLabel(doc.created_by) || currentUserName}</span>
                    {doc.signals_count > 0 && (
                      <>
                        <span>•</span>
                        <span style={{ color: "#0052CC", fontWeight: 700 }}>⚡ {doc.signals_count} signals</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

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
                <div className="jira-docs-article-meta" style={{ flexWrap: "wrap", gap: 10 }}>
                  <div className="jira-avatar-circle" style={{ width: 22, height: 22, fontSize: 10 }}>
                    {(userLabel(selectedDoc.created_by) || currentUserName).substring(0, 2).toUpperCase()}
                  </div>
                  <span>Created by <strong>{userLabel(selectedDoc.created_by) || currentUserName}</strong></span>
                  <span>•</span>
                  <span>Updated: {new Date(selectedDoc.updated_at || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  
                  {/* Attached File Indicator */}
                  {selectedDoc.file_url && (
                    <span className="pmo-doc-badge" style={{ background: "#0052CC", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                      {selectedDoc.file_type || "FILE"} ({formatFileSize(selectedDoc.file_size)})
                    </span>
                  )}

                  {/* Signals Count Indicator */}
                  <span
                    className="jira-status-pill jira-status-inprogress"
                    style={{ fontSize: 10, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}
                    onClick={() => setActiveDocTab("signals")}
                    title="View extracted PMO intelligence signals"
                  >
                    <span>⚡</span>
                    <span>{docSignals.length} Extracted Signals</span>
                  </span>
                </div>
              </div>

              <div className="jira-docs-article-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Download File Button */}
                {selectedDoc.file_url && (
                  <a
                    href={selectedDoc.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="jira-btn-secondary-sm"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}
                    title="Download original file attachment"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download File
                  </a>
                )}

                {/* Re-extract PMO Signals */}
                <button
                  className="jira-btn-secondary-sm"
                  onClick={handleReextractSignals}
                  disabled={reextracting}
                  title="Re-run semantic extraction on this document"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ animation: reextracting ? "jira-spin 0.6s linear infinite" : "none" }}
                  >
                    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  <span>{reextracting ? "Analyzing…" : "Re-analyze"}</span>
                </button>

                {!isEditing ? (
                  <>
                    <button className="jira-btn-primary-sm" onClick={handleStartEdit}>
                      Edit Doc
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

            {/* Navigation Tabs Bar inside Document View */}
            {!isEditing && (
              <div style={{ display: "flex", gap: 16, borderBottom: "1px solid #DFE1E6", marginBottom: 18, marginTop: 4 }}>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: activeDocTab === "content" ? "2px solid #0052CC" : "2px solid transparent",
                    padding: "8px 4px",
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeDocTab === "content" ? "#0052CC" : "#5E6C84",
                    cursor: "pointer",
                  }}
                  onClick={() => setActiveDocTab("content")}
                >
                  📄 Document Content
                </button>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: activeDocTab === "signals" ? "2px solid #0052CC" : "2px solid transparent",
                    padding: "8px 4px",
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeDocTab === "signals" ? "#0052CC" : "#5E6C84",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onClick={() => setActiveDocTab("signals")}
                >
                  <span>⚡ Extracted PMO Signals</span>
                  <span style={{ background: "#DEEBFF", color: "#0052CC", padding: "1px 6px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                    {docSignals.length}
                  </span>
                </button>
              </div>
            )}

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
              ) : activeDocTab === "content" ? (
                <div>
                  {selectedDoc.file_url && (
                    <div style={{ background: "#F4F5F7", border: "1px solid #DFE1E6", borderRadius: 6, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span style={{ fontSize: 13, color: "#172B4D" }}>
                          Parsed from uploaded file <strong>{selectedDoc.title}</strong> ({formatFileSize(selectedDoc.file_size)})
                        </span>
                      </div>
                      <a href={selectedDoc.file_url} target="_blank" rel="noreferrer" className="jira-btn-secondary-sm">
                        Download Original
                      </a>
                    </div>
                  )}
                  <div className="jira-markdown-renderer">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(selectedDoc.content),
                      }}
                    />
                  </div>
                </div>
              ) : (
                /* Extracted PMO Intelligence Signals Tab */
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#172B4D" }}>
                        Signals Extracted from {selectedDoc.title}
                      </h3>
                      <span style={{ fontSize: 12, color: "#6B778C" }}>
                        These structured signals directly feed the executive PMO Dashboard, Risk Radar, and Timeline.
                      </span>
                    </div>

                    {/* Category Filter Chips */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {["ALL", "BLOCKER", "RISK", "MILESTONE", "DECISION", "UPDATE", "RESOURCE_NOTE", "DEPENDENCY"].map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          className={`pmo-chip ${signalCategoryFilter === cat ? "active" : ""}`}
                          onClick={() => setSignalCategoryFilter(cat)}
                          style={{ fontSize: 11, padding: "2px 8px" }}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {signalsLoading && (
                    <div style={{ padding: 20, textAlign: "center", color: "#6B778C", fontSize: 13 }}>
                      Loading document intelligence signals…
                    </div>
                  )}

                  {!signalsLoading && filteredSignals.length === 0 && (
                    <div className="pmo-empty" style={{ padding: "30px 10px", background: "#FAFBFC", border: "1px dashed #DFE1E6", borderRadius: 8 }}>
                      No {signalCategoryFilter === "ALL" ? "" : signalCategoryFilter.toLowerCase()} signals extracted from this document. Click <strong>Re-analyze</strong> to refresh parsing.
                    </div>
                  )}

                  {!signalsLoading && filteredSignals.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {filteredSignals.map((sig) => {
                        const sevClass = (sig.severity || "medium").toLowerCase();
                        return (
                          <div
                            key={sig.id}
                            className="pmo-radar-card"
                            style={{
                              borderLeft:
                                sig.category === "BLOCKER"
                                  ? "4px solid #DE350B"
                                  : sig.category === "RISK"
                                  ? "4px solid #FF8B00"
                                  : sig.category === "MILESTONE"
                                  ? "4px solid #6554C0"
                                  : sig.category === "DECISION"
                                  ? "4px solid #00875A"
                                  : "4px solid #0052CC",
                            }}
                          >
                            <div className="pmo-radar-top">
                              <span className={`pmo-sev-badge ${sevClass}`}>{sig.category}</span>
                              {sig.status && (
                                <span className="jira-status-pill jira-status-todo" style={{ fontSize: 10 }}>
                                  {sig.status}
                                </span>
                              )}
                              {sig.target_date && (
                                <span style={{ fontSize: 11, color: "#6B778C", fontWeight: 600 }}>
                                  Target: {sig.target_date}
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: "#6B778C", marginLeft: "auto" }}>
                                {Math.round((sig.confidence || 0.85) * 100)}% confidence
                              </span>
                            </div>
                            <div className="pmo-radar-title">{sig.title}</div>
                            {sig.description && sig.description !== sig.title && (
                              <div className="pmo-radar-desc">{sig.description}</div>
                            )}
                            <div className="pmo-radar-src">
                              <span>Source: <strong>{sig.source_location || selectedDoc.title}</strong></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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

      {/* New Document Markdown Modal */}
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

      {/* Upload File Modal */}
      {showUploadModal && (
        <div className="jira-modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="jira-modal-header">
              <div className="jira-modal-title-group">
                <h2 className="jira-modal-title">Upload Project Document</h2>
                <span className="jira-sub-key">Excel (.xlsx), Word (.docx), PDF (.pdf), or Markdown (.md)</span>
              </div>
              <button className="jira-btn-icon-close" onClick={() => setShowUploadModal(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleUploadDoc} className="jira-modal-body" style={{ gap: 14 }}>
              <div className="jira-form-field">
                <label className="jira-field-label">Select File <span className="jira-req">*</span></label>
                <div style={{ border: "2px dashed #DFE1E6", borderRadius: 8, padding: "20px 14px", textAlign: "center", background: "#FAFBFC" }}>
                  <input
                    type="file"
                    id="doc-file-input"
                    accept=".xlsx,.xls,.docx,.pdf,.md,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setUploadFile(f);
                        if (!uploadTitle.trim()) {
                          setUploadTitle(f.name.replace(/\.[^/.]+$/, ""));
                        }
                      }
                    }}
                    style={{ display: "none" }}
                  />
                  <label htmlFor="doc-file-input" style={{ cursor: "pointer", display: "inline-block" }}>
                    <div style={{ color: "#0052CC", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      {uploadFile ? uploadFile.name : "Click to select a document from your computer"}
                    </div>
                    <span style={{ fontSize: 12, color: "#6B778C" }}>
                      Supports Excel spreadsheets, Word documents, PDF reports, and Markdown
                    </span>
                  </label>
                </div>
              </div>

              <div className="jira-form-field">
                <label className="jira-field-label">Document Title</label>
                <input
                  type="text"
                  className="jira-input"
                  placeholder="e.g. Q4 Release Plan & Milestones"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                />
              </div>

              <div className="jira-form-field">
                <label className="jira-field-label">Document Classification</label>
                <select
                  className="jira-select"
                  value={uploadTemplateType}
                  onChange={(e) => setUploadTemplateType(e.target.value)}
                >
                  <option value="STATUS">Weekly / Project Status Report</option>
                  <option value="TIMELINE">Project Plan & Milestones Schedule</option>
                  <option value="RESOURCE">Resource & Team Allocation</option>
                  <option value="PRD">Product Requirements Document (PRD)</option>
                  <option value="ARCHITECTURE">Architecture & Technical Design</option>
                  <option value="MEETING">Meeting Notes & Decisions</option>
                  <option value="RETRO">Sprint Retrospective</option>
                  <option value="CUSTOM">Auto-classify Document</option>
                </select>
              </div>

              <div className="jira-modal-footer" style={{ padding: "14px 0 0 0", marginTop: 10 }}>
                <button type="button" className="jira-btn-secondary" onClick={() => setShowUploadModal(false)} disabled={uploading}>
                  Cancel
                </button>
                <button type="submit" className="jira-btn-primary" disabled={uploading || !uploadFile}>
                  {uploading ? "Analyzing Document…" : "Upload & Analyze Document"}
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
