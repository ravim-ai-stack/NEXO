import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api/client";
import NotificationsModal from "./NotificationsModal";
import DashboardModal from "./DashboardModal";
import SettingsModal from "./SettingsModal";

export default function Navbar({
  searchVal = "",
  onSearchChange = null,
  currentProjectId = null,
  onRefresh = null,
  onApplyFilter = null,
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [projects, setProjects] = useState([]);
  const [activeMenu, setActiveMenu] = useState(null); // 'projects', 'filters', 'dashboards', 'teams', 'apps', 'user', 'notifications'
  
  // Modals state
  const [showDashboardModal, setShowDashboardModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);


  const menuRef = useRef(null);

  function loadProjects() {
    api.get("/projects/").then((res) => setProjects(res.data)).catch(() => {});
  }

  useEffect(() => {
    loadProjects();
  }, []);

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setActiveMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleMenu(name) {
    setActiveMenu((prev) => (prev === name ? null : name));
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  function handleSelectFilter(filterType) {
    setActiveMenu(null);
    if (onApplyFilter) {
      onApplyFilter(filterType);
    }
  }

  const userInitials = user?.username ? user.username.substring(0, 2).toUpperCase() : "U";
  const userFullName = user?.username || "Workspace User";

  return (
    <>
      <header className="jira-global-topbar" ref={menuRef}>
        <div className="jira-topbar-left">
          {/* NEXO Brand Logo */}
          <Link to="/dashboard" className="jira-topbar-brand">
            <img
              src="/dp-logo.png"
              alt="DataPattern Logo"
              style={{
                height: 32,
                width: "auto",
                objectFit: "contain",
                background: "#FFFFFF",
                borderRadius: 6,
                padding: "2px 6px",
              }}
            />
            <div className="jira-brand-title-wrap">
              <span className="jira-brand-title">NEXO</span>
              <span className="jira-brand-agent-badge">Powered by DataPattern</span>
            </div>
          </Link>

          {/* Navigation Dropdown Menus */}
          <nav className="jira-topbar-nav">
            {/* Navigation order: Dashboard, Projects, Tasks, Teams */}
            <Link
              to="/dashboard"
              className={`jira-nav-link ${location.pathname === "/dashboard" ? "active" : ""}`}
              onClick={() => setActiveMenu(null)}
              style={{ textDecoration: "none" }}
            >
              <span>Dashboard</span>
            </Link>

            <Link
              to="/projects"
              className={`jira-nav-link ${location.pathname === "/projects" ? "active" : ""}`}
              onClick={() => setActiveMenu(null)}
              style={{ textDecoration: "none" }}
            >
              <span>Projects</span>
            </Link>

            <Link
              to="/tasks"
              className={`jira-nav-link ${location.pathname === "/tasks" ? "active" : ""}`}
              onClick={() => setActiveMenu(null)}
              style={{ textDecoration: "none" }}
            >
              <span>Tasks</span>
            </Link>

            <Link
              to="/teams"
              className={`jira-nav-link ${location.pathname === "/teams" ? "active" : ""}`}
              onClick={() => setActiveMenu(null)}
              style={{ textDecoration: "none" }}
            >
              <span>Teams</span>
            </Link>
          </nav>
        </div>

        {/* Topbar Right Icons & Profile */}
        <div className="jira-topbar-right">
          {/* Search Box */}
          <div className="jira-topbar-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search"
              value={searchVal}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
              className="jira-topbar-search-input"
            />
          </div>

          {/* Notifications Bell */}
          <div className="jira-nav-dropdown-wrap">
            <button
              className={`jira-btn-top-icon ${activeMenu === "notifications" ? "active" : ""}`}
              title="Notifications"
              onClick={() => toggleMenu("notifications")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span className="jira-notif-indicator-dot"></span>
            </button>

            <NotificationsModal
              isOpen={activeMenu === "notifications"}
              onClose={() => setActiveMenu(null)}
            />
          </div>

          {/* Help icon */}
          <button
            className="jira-btn-top-icon"
            title="Help & Shortcuts"
            onClick={() => setShowHelpModal(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </button>

          {/* Settings Gear */}
          <button
            className="jira-btn-top-icon"
            title="Settings"
            onClick={() => setShowSettingsModal(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          {/* User Profile Avatar with dropdown */}
          <div className="jira-user-menu-wrap">
            <button
              className="jira-avatar-badge-ar topbar"
              onClick={() => toggleMenu("user")}
              title={userFullName}
            >
              {userInitials}
            </button>

            {activeMenu === "user" && (
              <div className="jira-user-dropdown-popover">
                <div className="jira-user-popover-info">
                  <div className="jira-avatar-badge-ar large">{userInitials}</div>
                  <div>
                    <div className="jira-user-popover-name">{userFullName}</div>
                    <div className="jira-user-popover-email">{user?.email || "Workspace User"}</div>
                  </div>
                </div>
                <div className="jira-popover-divider"></div>
                <Link to="/projects" className="jira-user-popover-action" onClick={() => setActiveMenu(null)}>
                  All projects
                </Link>
                <button
                  className="jira-user-popover-action"
                  onClick={() => { setActiveMenu(null); setShowSettingsModal(true); }}
                >
                  Preferences & Settings
                </button>
                <div className="jira-popover-divider"></div>
                <button className="jira-user-popover-action danger" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Interactive Modals */}
      <DashboardModal
        isOpen={showDashboardModal}
        onClose={() => setShowDashboardModal(false)}
      />



      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />

      {/* Help Modal */}
      {showHelpModal && (
        <div className="jira-modal-backdrop" onClick={() => setShowHelpModal(false)}>
          <div className="jira-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="jira-modal-header">
              <h2 className="jira-modal-title">Keyboard Shortcuts & Help</h2>
              <button className="jira-btn-icon-close" onClick={() => setShowHelpModal(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="jira-modal-body">
              <div className="jira-shortcuts-grid">
                <div className="jira-shortcut-row"><kbd>C</kbd><span>Create new issue</span></div>
                <div className="jira-shortcut-row"><kbd>/</kbd><span>Quick search work</span></div>
                <div className="jira-shortcut-row"><kbd>Esc</kbd><span>Close modals and drawers</span></div>
                <div className="jira-shortcut-row"><kbd>Enter</kbd><span>Submit inline task creation</span></div>
              </div>
            </div>
            <div className="jira-modal-footer">
              <button className="jira-btn-primary" onClick={() => setShowHelpModal(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

