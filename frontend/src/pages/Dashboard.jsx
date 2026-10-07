import { useEffect, useState, useMemo } from "react";
import { userLabel } from "../utils/userLabel";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";

// ── SVG Donut Pie Chart ──
function PieChart({ data }) {
  const total = Object.values(data).reduce((s, v) => s + v, 0);
  if (!total) return <div className="db-pie-empty">No issues yet</div>;

  const COLORS = { TASK: "#0052CC", BUG: "#DE350B", STORY: "#00875A", EPIC: "#6554C0" };

  let cumAngle = -90;
  const slices = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([type, count]) => {
      const pct = count / total;
      const start = cumAngle;
      cumAngle += pct * 360;
      return { type, count, pct, start, end: cumAngle };
    });

  function toXY(deg, r = 80) {
    const rad = (deg * Math.PI) / 180;
    return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
  }

  function arc(start, end) {
    if (end - start >= 359.99)
      return `M ${100 + 80} 100 A 80 80 0 1 1 ${100 + 79.99} 100 Z`;
    const [sx, sy] = toXY(start);
    const [ex, ey] = toXY(end);
    return `M 100 100 L ${sx} ${sy} A 80 80 0 ${end - start > 180 ? 1 : 0} 1 ${ex} ${ey} Z`;
  }

  return (
    <div className="db-pie-wrap">
      <svg viewBox="0 0 200 200" className="db-pie-svg">
        {slices.map((s) => (
          <path key={s.type} d={arc(s.start, s.end)} fill={COLORS[s.type] || "#42526E"} opacity="0.92" />
        ))}
        <circle cx="100" cy="100" r="50" fill="#FFFFFF" />
        <text x="100" y="96" textAnchor="middle" fontSize="24" fontWeight="800" fill="#172B4D">{total}</text>
        <text x="100" y="114" textAnchor="middle" fontSize="11" fill="#6B778C">total issues</text>
      </svg>
      <div className="db-pie-legend">
        {slices.map((s) => (
          <div key={s.type} className="db-pie-legend-row">
            <span className="db-pie-dot" style={{ background: COLORS[s.type] || "#42526E" }} />
            <span className="db-pie-legend-label">{s.type}</span>
            <span className="db-pie-legend-count">{s.count}</span>
            <span className="db-pie-legend-pct">{Math.round(s.pct * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Circular Progress Gauge ──
function CircularProgressGauge({ percent = 0, color = "#00875A" }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div className="pmo-gauge-wrap">
      <svg viewBox="0 0 140 140" className="pmo-gauge-svg">
        <circle cx="70" cy="70" r={radius} className="pmo-gauge-bg" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          className="pmo-gauge-fill"
          style={{
            stroke: color,
            strokeDasharray: circumference,
            strokeDashoffset,
          }}
        />
        <text
          x="70"
          y="70"
          textAnchor="middle"
          dominantBaseline="central"
          className="pmo-gauge-text"
          style={{ transform: "rotate(90deg)", transformOrigin: "center" }}
        >
          {percent}%
        </text>
      </svg>
    </div>
  );
}

const PRI_COLOR = { CRITICAL: "#DE350B", HIGH: "#FF5630", MEDIUM: "#FFAB00", LOW: "#36B37E" };
function PriBadge({ p }) {
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: PRI_COLOR[p] || "#97A0AF", flexShrink: 0 }} title={p} />;
}

function Card({ title, icon, count, badge, actionBtn, children, style }) {
  return (
    <div className="db-card" style={style}>
      <div className="db-card-header">
        <span className="db-card-icon">{icon}</span>
        <h3 className="db-card-title">{title}</h3>
        {badge && <span className="db-card-proj-badge">{badge}</span>}
        {count !== undefined && <span className="db-card-badge">{count}</span>}
        {actionBtn && <div style={{ marginLeft: "auto" }}>{actionBtn}</div>}
      </div>
      <div className="db-card-body">{children}</div>
    </div>
  );
}

// ── Upload Document Modal Component ──
function UploadDocModal({ isOpen, onClose, projectId, onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [templateType, setTemplateType] = useState("STATUS");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState("file"); // 'file' or 'text'

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file && !content.trim()) {
      alert("Please choose a file or enter document content.");
      return;
    }
    setUploading(true);
    const formData = new FormData();
    if (file) formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());
    formData.append("template_type", templateType);
    if (content.trim()) formData.append("content", content.trim());

    try {
      const res = await api.post(`/projects/${projectId}/upload_doc/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded(res.data);
      onClose();
    } catch (err) {
      alert("Failed to upload and analyze document. " + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="jira-modal-backdrop" onClick={onClose}>
      <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="jira-modal-header">
          <div className="jira-modal-title-group">
            <h2 className="jira-modal-title">Upload Project Document or Report</h2>
            <span className="jira-sub-key">Auto-extracts risks, milestones, updates, and decisions for the Dashboard</span>
          </div>
          <button className="jira-btn-icon-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="jira-modal-body" style={{ gap: 14 }}>
            {/* Input Mode Toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <button
                type="button"
                className={`jira-btn-secondary-sm ${mode === "file" ? "active" : ""}`}
                style={{ fontWeight: mode === "file" ? 700 : 500, borderColor: mode === "file" ? "#0052CC" : undefined }}
                onClick={() => setMode("file")}
              >
                Upload File (Excel, Word, PDF, MD)
              </button>
              <button
                type="button"
                className={`jira-btn-secondary-sm ${mode === "text" ? "active" : ""}`}
                style={{ fontWeight: mode === "text" ? 700 : 500, borderColor: mode === "text" ? "#0052CC" : undefined }}
                onClick={() => setMode("text")}
              >
                Direct Text / Markdown
              </button>
            </div>

            {mode === "file" ? (
              <div style={{ border: "2px dashed #DFE1E6", borderRadius: 8, padding: "24px 16px", textAlign: "center", background: "#FAFBFC" }}>
                <input
                  type="file"
                  id="pmo-doc-upload-file"
                  accept=".xlsx,.xls,.docx,.pdf,.md,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      if (!title) setTitle(f.name.rsplit ? f.name.rsplit(".", 1)[0] : f.name.replace(/\.[^/.]+$/, ""));
                    }
                  }}
                />
                <label htmlFor="pmo-doc-upload-file" style={{ cursor: "pointer", display: "block" }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="1.8" style={{ margin: "0 auto 8px" }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#172B4D" }}>
                    {file ? file.name : "Click to select a project document"}
                  </div>
                  <div style={{ fontSize: 12, color: "#6B778C", marginTop: 4 }}>
                    Supports <strong>Excel (.xlsx)</strong>, <strong>Word (.docx)</strong>, <strong>PDF</strong>, and <strong>Markdown (.md)</strong>
                  </div>
                </label>
              </div>
            ) : (
              <div>
                <label className="jira-field-label">Document Content (Markdown)</label>
                <textarea
                  className="jira-textarea"
                  rows={8}
                  placeholder="Paste meeting notes, status reports, or project specs..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  style={{ fontFamily: "monospace", fontSize: 13 }}
                />
              </div>
            )}

            <div>
              <label className="jira-field-label">Document Title (Optional)</label>
              <input
                type="text"
                className="jira-input"
                placeholder="e.g. Q4 Sprint Plan, Weekly Status Report Oct 6"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="jira-field-label">Document Purpose / Type</label>
              <select
                className="jira-select"
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value)}
              >
                <option value="STATUS">Project Status / Weekly Report</option>
                <option value="TIMELINE">Timeline & Project Plan / Milestones</option>
                <option value="RESOURCE">Resource / Team Allocation Document</option>
                <option value="PRD">Product Requirements Document (PRD)</option>
                <option value="ARCHITECTURE">Architecture & System Design</option>
                <option value="MEETING">Meeting Notes & Decisions</option>
                <option value="RETRO">Sprint Retrospective</option>
                <option value="CUSTOM">Custom Project Document (Auto-classify)</option>
              </select>
            </div>
          </div>

          <div className="jira-modal-footer">
            <button type="button" className="jira-btn-secondary" onClick={onClose} disabled={uploading}>
              Cancel
            </button>
            <button type="submit" className="jira-btn-primary" disabled={uploading}>
              {uploading ? "Analyzing Document…" : "Upload & Analyze Document"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD PAGE COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("ALL");

  // Project PMO Intelligence Data
  const [intelligenceData, setIntelligenceData] = useState(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [refreshingIntel, setRefreshingIntel] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [riskFilter, setRiskFilter] = useState("ALL"); // ALL, BLOCKER, RISK, CHALLENGE, DEPENDENCY
  const [updatesTab, setUpdatesTab] = useState("DELIVERIES"); // DELIVERIES, DECISIONS, ACTIVITY

  // Load global dashboard overview
  function loadGlobalData() {
    api.get("/auth/dashboard/")
      .then((res) => {
        setData(res.data);
        const urlProjectId = searchParams.get("project");
        if (urlProjectId) {
          setSelectedProjectId(urlProjectId);
        } else if (res.data.my_projects?.length === 1) {
          setSelectedProjectId(String(res.data.my_projects[0].id));
        }
      })
      .catch(() => setError("Could not load dashboard data."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadGlobalData();
  }, []);

  // Sync selected project with URL query param
  useEffect(() => {
    const urlProjectId = searchParams.get("project");
    if (urlProjectId && urlProjectId !== selectedProjectId) {
      setSelectedProjectId(urlProjectId);
    }
  }, [searchParams]);

  // Load Project PMO Intelligence when specific project is selected
  function loadProjectIntelligence(projId) {
    if (!projId || projId === "ALL") {
      setIntelligenceData(null);
      return;
    }
    setIntelLoading(true);
    api.get(`/projects/${projId}/intelligence/`)
      .then((res) => setIntelligenceData(res.data))
      .catch((err) => console.error("Error loading project intelligence", err))
      .finally(() => setIntelLoading(false));
  }

  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== "ALL") {
      loadProjectIntelligence(selectedProjectId);
    } else {
      setIntelligenceData(null);
    }
  }, [selectedProjectId]);

  // Manual Re-sync action
  async function handleRefreshIntelligence() {
    if (!selectedProjectId || selectedProjectId === "ALL") return;
    setRefreshingIntel(true);
    try {
      const res = await api.post(`/projects/${selectedProjectId}/refresh_intelligence/`);
      setIntelligenceData(res.data);
      loadGlobalData();
    } catch {
      alert("Failed to refresh project intelligence.");
    } finally {
      setRefreshingIntel(false);
    }
  }

  function handleCopyBrief() {
    if (!intelligenceData?.executive_summary) return;
    navigator.clipboard?.writeText(intelligenceData.executive_summary);
    setCopiedBrief(true);
    setTimeout(() => setCopiedBrief(false), 2000);
  }

  const selectedProject = useMemo(() => {
    if (!data || selectedProjectId === "ALL") return null;
    return data.my_projects.find((p) => String(p.id) === selectedProjectId) || null;
  }, [data, selectedProjectId]);

  // Filtered Risks & Blockers
  const filteredRisks = useMemo(() => {
    if (!intelligenceData?.challenges_and_risks) return [];
    if (riskFilter === "ALL") return intelligenceData.challenges_and_risks;
    return intelligenceData.challenges_and_risks.filter((r) => r.type === riskFilter);
  }, [intelligenceData, riskFilter]);

  // Count by Type for pie chart
  const pieData = useMemo(() => {
    if (selectedProjectId !== "ALL" && intelligenceData?.workstreams) {
      const counts = { TASK: 0, BUG: 0, STORY: 0, EPIC: 0 };
      intelligenceData.workstreams.forEach((w) => {
        if (counts[w.type] !== undefined) counts[w.type] = w.total;
      });
      return counts;
    }
    return data?.issue_type_counts || {};
  }, [selectedProjectId, intelligenceData, data]);

  const projBadge = selectedProject ? `${selectedProject.key} · ${selectedProject.name}` : "Portfolio Overview";

  return (
    <div className="jira-app-shell">
      <Navbar />
      <main className="jira-workspace-main" style={{ background: "#F4F5F7", minHeight: "100vh" }}>

        {/* ── Top Bar & Controls ── */}
        <div className="pmo-top-banner">
          <div className="pmo-top-left">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: "#172B4D", margin: 0 }}>
                  {selectedProject ? selectedProject.name : "Portfolio Intelligence Dashboard"}
                </h1>
                {selectedProject && (
                  <span className="jira-summary-key-pill">{selectedProject.key}</span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "#6B778C", margin: "3px 0 0" }}>
                {selectedProject
                  ? `Lead: ${intelligenceData?.project?.created_by || "Admin"} • Created: ${new Date(selectedProject.created_at || Date.now()).toLocaleDateString()}`
                  : `Executive overview across ${data?.my_projects?.length || 0} active workspace projects`}
              </p>
            </div>

            {/* Project Quick Selector Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                className="jira-select-sm"
                style={{ fontWeight: 600, padding: "6px 12px", background: "#FFFFFF", cursor: "pointer" }}
                value={selectedProjectId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedProjectId(val);
                  setSearchParams(val === "ALL" ? {} : { project: val });
                }}
              >
                <option value="ALL">🌐 All Projects (Portfolio View)</option>
                {data?.my_projects?.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.key} - {p.name}
                  </option>
                ))}
              </select>

              {/* RAG Status Pill if Project View */}
              {selectedProjectId !== "ALL" && intelligenceData?.health && (
                <div
                  className={`pmo-rag-pill ${intelligenceData.health.status.toLowerCase()}`}
                  title={intelligenceData.health.rationale}
                >
                  <span className="pmo-rag-dot" />
                  <span>{intelligenceData.health.label}</span>
                </div>
              )}

              {/* Current Phase Pill */}
              {selectedProjectId !== "ALL" && intelligenceData?.current_phase && (
                <div className="pmo-phase-pill" title="Current Active Workstream / Phase">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  <span>{intelligenceData.current_phase}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {selectedProjectId !== "ALL" && (
              <>
                <button
                  className="jira-btn-secondary-sm"
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px" }}
                  onClick={handleRefreshIntelligence}
                  disabled={refreshingIntel}
                  title="Re-scan documents and synchronize intelligence"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    style={{ animation: refreshingIntel ? "db-spin 1s linear infinite" : "none" }}
                  >
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  <span>{refreshingIntel ? "Syncing…" : "Sync Intelligence"}</span>
                </button>

                <button
                  className="jira-btn-secondary-sm"
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#0052CC", color: "#FFFFFF", borderColor: "#0052CC" }}
                  onClick={() => setShowUploadModal(true)}
                  title="Upload Excel, Word, PDF or Markdown documents"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span>+ Upload Document</span>
                </button>

                <button
                  className="jira-btn-secondary-sm"
                  style={{ padding: "7px 14px" }}
                  onClick={() => {
                    setSelectedProjectId("ALL");
                    setSearchParams({});
                  }}
                >
                  All Projects
                </button>

                <button
                  className="jira-btn-secondary-sm"
                  style={{ padding: "7px 14px" }}
                  onClick={() => navigate(`/projects/${selectedProjectId}/board`)}
                >
                  Open Board →
                </button>
              </>
            )}
          </div>
        </div>

        {/* Global Loading Spinner */}
        {(loading || (intelLoading && !intelligenceData)) && (
          <div className="db-loading">
            <div className="db-spinner" />
            Loading project intelligence overview…
          </div>
        )}

        {error && (
          <div className="jira-auth-alert-error" style={{ margin: "24px" }}>
            <div className="jira-auth-alert-msg">{error}</div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            MODE A: SPECIFIC PROJECT INTELLIGENCE DASHBOARD
            ══════════════════════════════════════════════════════════════════════ */}
        {selectedProjectId !== "ALL" && intelligenceData && (
          <div className="db-grid" style={{ paddingTop: 20 }}>

            {/* ── 1. AI Executive Project Summary ── */}
            <Card
              title="Executive Project Briefing (AI Synthesized)"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>}
              badge="Cross-Source Synthesis"
              actionBtn={
                <button
                  className="jira-btn-secondary-sm"
                  style={{ fontSize: 11, padding: "3px 10px" }}
                  onClick={handleCopyBrief}
                  title="Copy executive brief to clipboard"
                >
                  {copiedBrief ? "Copied!" : "Copy Brief"}
                </button>
              }
              style={{ gridColumn: "span 2" }}
            >
              <div className="pmo-brief-box">
                {intelligenceData.executive_summary ? (
                  intelligenceData.executive_summary.split("\n\n").map((para, idx) => (
                    <div key={idx} className="pmo-brief-bullet">
                      <span style={{ color: "#0052CC", fontWeight: "bold" }}>•</span>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: para.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                        }}
                      />
                    </div>
                  ))
                ) : (
                  <p style={{ color: "#6B778C", margin: 0 }}>No summary generated yet. Click 'Sync Intelligence' to analyze.</p>
                )}

                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #DFE1E6", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "#6B778C" }}>
                  <span>Synthesized from {intelligenceData.progress_metrics.total_issues} issues & {intelligenceData.recent_documents.length} project documents</span>
                  <span>Last synced: {new Date(intelligenceData.last_synced_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            </Card>

            {/* ── 2. Overall Status & Completion Gauge ── */}
            <Card
              title="Overall Status & Health"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>}
              badge={intelligenceData.health.label}
            >
              <CircularProgressGauge
                percent={intelligenceData.completion_percent}
                color={intelligenceData.health.badge_color}
              />

              <div style={{ textAlign: "center", fontSize: 12, color: "#5E6C84", marginTop: 4 }}>
                <strong>{intelligenceData.progress_metrics.done_issues}</strong> of <strong>{intelligenceData.progress_metrics.total_issues}</strong> total work items resolved
              </div>

              <div className="pmo-kpi-subgrid">
                <div className="pmo-kpi-minibox">
                  <span className="val" style={{ color: "#00875A" }}>{intelligenceData.progress_metrics.done_issues}</span>
                  <span className="lbl">Done</span>
                </div>
                <div className="pmo-kpi-minibox">
                  <span className="val" style={{ color: "#0052CC" }}>{intelligenceData.progress_metrics.in_progress_issues}</span>
                  <span className="lbl">In Dev</span>
                </div>
                <div className="pmo-kpi-minibox">
                  <span className="val" style={{ color: "#42526E" }}>{intelligenceData.progress_metrics.todo_issues}</span>
                  <span className="lbl">To Do</span>
                </div>
              </div>
            </Card>

            {/* ── 3. Timeline & Upcoming Milestones ── */}
            <Card
              title="Project Timeline & Milestones"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              badge={intelligenceData.timeline.has_delays ? "Has Delays" : "On Schedule"}
              count={intelligenceData.timeline.milestones?.length || 0}
              style={{ gridColumn: "span 2" }}
            >
              {intelligenceData.timeline.milestones?.length === 0 ? (
                <p className="db-empty">No milestones defined yet. Upload a Timeline doc or set issue due dates.</p>
              ) : (
                <div className="pmo-timeline-track">
                  {intelligenceData.timeline.milestones.map((m, idx) => (
                    <div key={idx} className="pmo-timeline-item">
                      <div className={`pmo-timeline-dot ${m.status?.toLowerCase()}`} />
                      <div className="pmo-timeline-content">
                        <div className="pmo-timeline-title">
                          <span>{m.title}</span>
                          <span
                            className="pmo-sev-badge"
                            style={{
                              background: m.status === "COMPLETED" ? "#E3FCEF" : (m.status === "DELAYED" ? "#FFEBE6" : "#DEEBFF"),
                              color: m.status === "COMPLETED" ? "#006644" : (m.status === "DELAYED" ? "#BF2600" : "#0052CC"),
                            }}
                          >
                            {m.status}
                          </span>
                          {m.days_away !== null && m.days_away !== undefined && (
                            <span style={{ fontSize: 11, color: m.days_away < 0 ? "#DE350B" : "#6B778C" }}>
                              {m.days_away < 0 ? `${Math.abs(m.days_away)}d overdue` : `${m.days_away}d away`}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 3 }}>
                          {m.target_date && <span className="pmo-timeline-date">Target: {new Date(m.target_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
                          <span className="pmo-source-tag">Source: {m.source} ({m.source_location})</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── 4. Active Workstreams & Type Distribution ── */}
            <Card
              title="Workstreams & Issue Types"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>}
            >
              {/* Workstream Progress Bars */}
              <div style={{ marginBottom: 16 }}>
                {intelligenceData.workstreams.map((ws) => (
                  <div key={ws.type} className="pmo-ws-row">
                    <div className="pmo-ws-header">
                      <span>{ws.type}</span>
                      <span style={{ color: "#6B778C" }}>{ws.done}/{ws.total} ({ws.percent}%)</span>
                    </div>
                    <div className="pmo-ws-bar-track">
                      <div
                        className="pmo-ws-bar-fill"
                        style={{
                          width: `${ws.percent}%`,
                          background: ws.type === "BUG" ? "#DE350B" : (ws.type === "STORY" ? "#00875A" : "#0052CC"),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Issues By Type Donut */}
              <PieChart data={pieData} />
            </Card>

            {/* ── 5. Challenges, Risks & Blockers Radar ── */}
            <Card
              title="Challenges, Risks & Blockers Radar"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DE350B" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
              count={filteredRisks.length}
              style={{ gridColumn: "span 2" }}
            >
              {/* Filter Chips */}
              <div className="pmo-filter-chips">
                {["ALL", "BLOCKER", "RISK", "CHALLENGE", "DEPENDENCY"].map((type) => (
                  <button
                    key={type}
                    className={`pmo-chip ${riskFilter === type ? "active" : ""}`}
                    onClick={() => setRiskFilter(type)}
                  >
                    {type === "ALL" ? "All Items" : type.charAt(0) + type.slice(1).toLowerCase() + "s"}
                  </button>
                ))}
              </div>

              {filteredRisks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#00875A" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00875A" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>No active {riskFilter.toLowerCase()} items identified</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {filteredRisks.map((item, idx) => (
                    <div key={idx} className="pmo-radar-item">
                      <div className="pmo-radar-header">
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className={`pmo-sev-badge ${item.severity?.toLowerCase()}`}>
                            {item.severity}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C" }}>
                            {item.type}
                          </span>
                        </div>
                        <span className="pmo-source-tag">
                          {item.source_type === "TICKET" ? "Ticket: " : "Doc: "}
                          {item.source_title} ({item.source_location})
                        </span>
                      </div>
                      <div className="pmo-radar-title">{item.title}</div>
                      {item.description && <div className="pmo-radar-desc">{item.description}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── 6. Team & Resource Allocation ── */}
            <Card
              title="Team & Resource Allocation"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              count={intelligenceData.team_resources.members.length}
            >
              {intelligenceData.team_resources.unassigned_count > 0 && (
                <div style={{ background: "#FFEBE6", border: "1px solid #FFBDAD", borderRadius: 6, padding: "8px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#BF2600" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span><strong>{intelligenceData.team_resources.unassigned_count}</strong> unassigned task(s) needing triage</span>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {intelligenceData.team_resources.members.map((m) => (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="jira-avatar-circle" style={{ width: 26, height: 26, fontSize: 11 }}>
                          {m.username.substring(0, 2).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#172B4D" }}>{m.username}</span>
                        <span className="jira-member-role-tag" style={{ fontSize: 10, padding: "1px 6px" }}>{m.role}</span>
                      </div>
                      <span style={{ fontSize: 11, color: "#6B778C" }}>
                        {m.active_count} active · {m.done_count} done
                      </span>
                    </div>
                    <div className="pmo-ws-bar-track" style={{ height: 6 }}>
                      <div className="pmo-ws-bar-fill" style={{ width: `${m.completion_pct}%`, background: "#00875A" }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Resource Notes from Docs */}
              {intelligenceData.team_resources.notes?.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #EBECF0" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B778C", textTransform: "uppercase" }}>Document Resource Notes</span>
                  {intelligenceData.team_resources.notes.map((n, idx) => (
                    <div key={idx} style={{ fontSize: 12, color: "#42526E", marginTop: 4, display: "flex", gap: 6 }}>
                      <span>•</span>
                      <span>{n}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── 7. Recent Updates & Decisions ── */}
            <Card
              title="Recent Deliveries & Key Decisions"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
              style={{ gridColumn: "span 2" }}
            >
              {/* Sub-tabs */}
              <div className="pmo-filter-chips">
                <button
                  className={`pmo-chip ${updatesTab === "DELIVERIES" ? "active" : ""}`}
                  onClick={() => setUpdatesTab("DELIVERIES")}
                >
                  Completed Deliverables ({intelligenceData.recent_updates.completed_work.length})
                </button>
                <button
                  className={`pmo-chip ${updatesTab === "DECISIONS" ? "active" : ""}`}
                  onClick={() => setUpdatesTab("DECISIONS")}
                >
                  Document Decisions ({intelligenceData.recent_updates.decisions.length})
                </button>
                <button
                  className={`pmo-chip ${updatesTab === "ACTIVITY" ? "active" : ""}`}
                  onClick={() => setUpdatesTab("ACTIVITY")}
                >
                  Audit Activity ({intelligenceData.recent_updates.activity_feed.length})
                </button>
              </div>

              {/* Sub-tab 1: Completed work */}
              {updatesTab === "DELIVERIES" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {intelligenceData.recent_updates.completed_work.length === 0 ? (
                    <p className="db-empty">No work items resolved in the last sprint cycle.</p>
                  ) : (
                    intelligenceData.recent_updates.completed_work.map((i) => (
                      <div
                        key={i.id}
                        className="db-issue-row"
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/projects/${selectedProjectId}/board?issue=${i.id}`)}
                      >
                        <span style={{ color: "#00875A", fontWeight: "bold" }}>✓</span>
                        <span className="db-issue-key">{i.key}</span>
                        <span className="db-issue-title">{i.title}</span>
                        <span style={{ fontSize: 11, color: "#6B778C" }}>
                          Resolved {new Date(i.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Sub-tab 2: Key decisions */}
              {updatesTab === "DECISIONS" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {intelligenceData.recent_updates.decisions.length === 0 ? (
                    <p className="db-empty">No key decisions extracted yet. Meeting notes & specs will appear here.</p>
                  ) : (
                    intelligenceData.recent_updates.decisions.map((d, idx) => (
                      <div key={idx} className="pmo-radar-item">
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#172B4D" }}>{d.title}</div>
                        <span className="pmo-source-tag" style={{ marginTop: 4 }}>
                          Source: {d.source} ({d.location})
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Sub-tab 3: Activity feed */}
              {updatesTab === "ACTIVITY" && (
                <div className="db-activity-list">
                  {intelligenceData.recent_updates.activity_feed.map((a) => (
                    <div
                      key={a.id}
                      className="db-activity-row"
                      onClick={() => navigate(`/projects/${selectedProjectId}/board?issue=${a.issue_id}`)}
                    >
                      <div className="db-activity-avatar">{a.actor.substring(0, 2).toUpperCase()}</div>
                      <div className="db-activity-content">
                        <span className="db-activity-text">
                          <strong>{a.actor}</strong> changed <em>{a.field_changed}</em> to <code className="db-code">{a.new_value || "—"}</code> on <span className="db-activity-issue">{a.project_key}-{a.issue_id}</span>
                        </span>
                        <span className="db-activity-title">{a.issue_title}</span>
                      </div>
                      <span className="db-activity-time">
                        {new Date(a.created_at).toLocaleString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── 8. Project Documentation Hub ── */}
            <Card
              title="Documentation Hub & Governance"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
              badge={intelligenceData.documentation_governance.label}
              actionBtn={
                <button
                  className="jira-btn-primary-sm"
                  style={{ fontSize: 11, padding: "3px 8px" }}
                  onClick={() => setShowUploadModal(true)}
                >
                  + Upload
                </button>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {intelligenceData.recent_documents.map((d) => (
                  <div
                    key={d.id}
                    className="pmo-doc-card"
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/projects/${selectedProjectId}/board?tab=docs`)}
                    title="Click to open document in Docs Workspace"
                  >
                    <span className={`pmo-doc-badge ${d.file_type.toLowerCase()}`}>
                      {d.file_type === "MARKDOWN" ? "MD" : d.file_type}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#172B4D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {d.title}
                      </div>
                      <div style={{ fontSize: 11, color: "#6B778C" }}>
                        {d.template_label} • {d.signals_count} signals extracted
                      </div>
                    </div>
                  </div>
                ))}

                {intelligenceData.recent_documents.length === 0 && (
                  <p className="db-empty">No documents uploaded yet. Upload a status report or project plan.</p>
                )}
              </div>
            </Card>

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            MODE B: GLOBAL PORTFOLIO VIEW (selectedProjectId === "ALL")
            ══════════════════════════════════════════════════════════════════════ */}
        {selectedProjectId === "ALL" && data && (
          <div className="db-grid">

            {/* 1. Projects Portfolio Overview Card */}
            <Card
              title="Portfolio Projects Overview"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>}
              count={data.my_projects.length}
              style={{ gridColumn: "span 2" }}
            >
              <div className="db-project-list">
                {data.my_projects.map((p) => {
                  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                  const hStatus = p.health_status || "ON_TRACK";
                  return (
                    <div
                      key={p.id}
                      className="db-project-row"
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setSelectedProjectId(String(p.id));
                        setSearchParams({ project: String(p.id) });
                      }}
                    >
                      <div className="db-project-avatar">
                        {p.key.substring(0, 2)}
                      </div>
                      <div className="db-project-info">
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="db-project-name">{p.name}</span>
                          <span className={`pmo-rag-pill ${hStatus.toLowerCase()}`} style={{ fontSize: 10, padding: "2px 8px" }}>
                            <span className="pmo-rag-dot" style={{ width: 6, height: 6 }} />
                            {hStatus.replace("_", " ")}
                          </span>
                          {p.current_phase && (
                            <span style={{ fontSize: 11, color: "#6B778C" }}>• {p.current_phase}</span>
                          )}
                        </div>
                        <div className="db-project-bar-wrap">
                          <div className="db-project-bar">
                            <div className="db-project-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="db-project-bar-label">{pct}%</span>
                        </div>
                      </div>
                      <div className="db-project-counts">
                        <span className="db-count-open">{p.open} open</span>
                        <span className="db-count-done">{p.done} done</span>
                      </div>
                      <button
                        className="jira-btn-secondary-sm"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProjectId(String(p.id));
                          setSearchParams({ project: String(p.id) });
                        }}
                      >
                        PMO View →
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* 2. Portfolio Issue Types Donut */}
            <Card
              title="Portfolio Issues by Type"
              badge="Cross-Project"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>}
            >
              <PieChart data={data.issue_type_counts || {}} />
            </Card>

            {/* 3. Active Sprints Across Projects */}
            <Card
              title="Active Sprints Across Projects"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>}
              count={data.active_sprints?.length || 0}
              style={{ gridColumn: "span 2" }}
            >
              {data.active_sprints?.length === 0 ? (
                <p className="db-empty">No active sprints across projects.</p>
              ) : (
                <div className="db-sprint-list">
                  {data.active_sprints.map((s) => (
                    <div
                      key={s.id}
                      className="db-sprint-row"
                      onClick={() => navigate(`/projects/${s.project_id}/board`)}
                    >
                      <div className="db-sprint-header-row">
                        <span className="db-sprint-name">{s.name}</span>
                        <span className="db-sprint-project">{s.project_name}</span>
                        <span className="db-sprint-pct">{s.percent}%</span>
                      </div>
                      {s.goal && <p className="db-sprint-goal">{s.goal}</p>}
                      <div className="db-sprint-bar">
                        <div className="db-sprint-bar-fill" style={{ width: `${s.percent}%` }} />
                      </div>
                      <div className="db-sprint-counts">
                        <span className="db-sc todo">{s.todo} to do</span>
                        <span className="db-sc inprogress">{s.in_progress} in progress</span>
                        <span className="db-sc done">{s.done} done</span>
                        <span className="db-sc total">{s.total} total</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 4. Unread Notifications Card */}
            <Card
              title="Notifications"
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>}
              count={data.unread_notifications?.count || 0}
            >
              {data.unread_notifications?.count === 0 ? (
                <div className="db-notif-empty">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#36B37E" strokeWidth="1.8"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>All caught up!</span>
                </div>
              ) : (
                <div className="db-notif-list">
                  {data.unread_notifications?.items.map((n) => (
                    <div key={n.id} className="db-notif-row">
                      <div className="db-notif-avatar">{n.actor.substring(0, 2).toUpperCase()}</div>
                      <div className="db-notif-content">
                        <span className="db-notif-text"><strong>{n.actor}</strong> {n.action}</span>
                        {n.target && <span className="db-notif-target">{n.target}</span>}
                        {n.created_at && (
                          <span className="db-notif-time">
                            {new Date(n.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                      <span className="db-notif-dot" />
                    </div>
                  ))}
                </div>
              )}
            </Card>

          </div>
        )}

      </main>

      {/* Upload Document Modal */}
      {selectedProjectId !== "ALL" && (
        <UploadDocModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          projectId={selectedProjectId}
          onUploaded={(res) => {
            if (res.intelligence) {
              setIntelligenceData(res.intelligence);
            } else {
              loadProjectIntelligence(selectedProjectId);
            }
            loadGlobalData();
          }}
        />
      )}
    </div>
  );
}
