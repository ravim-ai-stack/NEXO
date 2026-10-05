import { Link } from "react-router-dom";

export default function ProjectCard({ project: p, to }) {
  return (
    <Link to={to} className="jira-project-card">
      <div className="jira-project-card-top">
        <div className="jira-project-icon-box">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="4" fill="#0052cc"/>
            <circle cx="7" cy="7" r="3" fill="#ffab00"/>
            <circle cx="17" cy="7" r="3" fill="#36b37e"/>
            <circle cx="7" cy="17" r="3" fill="#ff5630"/>
            <circle cx="17" cy="17" r="3" fill="#6554c0"/>
          </svg>
        </div>
        <span className="jira-project-key-tag">{p.key}</span>
      </div>

      <h2 className="jira-project-card-name">{p.name}</h2>
      <p className="jira-project-card-sub">
        {p.description || "Software workspace • Kanban & List tracking"}
      </p>

      <div className="jira-project-card-bottom">
        <span className="jira-members-badge-num">
          👥 {p.members?.length || 1} {p.members?.length === 1 ? "member" : "members"}
        </span>
        <span className="jira-project-open-link">
          Open Project →
        </span>
      </div>
    </Link>
  );
}
