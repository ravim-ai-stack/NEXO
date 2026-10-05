import { useEffect, useState } from "react";
import api from "../api/client";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import ProjectCard from "../components/ProjectCard";
import CreateProjectModal from "../components/CreateProjectModal";

export default function ProjectList() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [searchVal, setSearchVal] = useState("");
  const [showModal, setShowModal] = useState(false);

  // Only org Admins and Managers can create projects
  const canCreateProject = !!user?.can_create_project;

  function loadProjects() {
    api.get("/projects/").then((res) => setProjects(res.data)).catch(() => {});
  }

  useEffect(() => {
    loadProjects();
  }, []);

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchVal.toLowerCase()) ||
      p.key.toLowerCase().includes(searchVal.toLowerCase())
  );

  return (
    <div className="jira-app-shell">
      <Navbar searchVal={searchVal} onSearchChange={setSearchVal} onRefresh={loadProjects} />

      <main className="jira-workspace-main" style={{ background: "#F0F2F5", minHeight: "100vh" }}>
        {/* Page Header — same layout as the dashboard */}
        <div className="db-page-header">
          <div>
            <h1 className="db-page-title">Projects</h1>
            <p className="db-page-subtitle">
              Manage your teams, view sprint boards, issues, and lists.
            </p>
          </div>
          {canCreateProject && (
            <button className="jira-btn-primary" onClick={() => setShowModal(true)}>
              + Create project
            </button>
          )}
        </div>

        {/* Projects Cards Grid */}
        <div className="jira-projects-grid" style={{ padding: "0 24px 32px" }}>
          {filteredProjects.map((p) => (
            <ProjectCard key={p.id} project={p} to={`/projects/${p.id}/board`} />
          ))}

          {filteredProjects.length === 0 && (
            <div className="jira-empty-projects-card">
              <div className="jira-project-icon-large">📂</div>
              <h3>No projects found</h3>
              <p>{searchVal ? "No project matching your search query." : canCreateProject ? "Get started by creating your first project workspace." : "You haven't been assigned to any project yet."}</p>
              {!searchVal && canCreateProject && (
                <button className="jira-btn-primary" onClick={() => setShowModal(true)} style={{ marginTop: 16 }}>
                  + Create your first project
                </button>
              )}
            </div>
          )}
        </div>

        <CreateProjectModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onProjectCreated={loadProjects}
        />
      </main>
    </div>
  );
}
