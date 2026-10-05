import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Landing page for the emailed invitation link: signs the user in and opens NEXO.
export default function InviteAccept() {
  const { token } = useParams();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const started = useRef(false); // links are single-use, so never fire twice (StrictMode)

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    acceptInvite(token)
      .then(() => navigate("/dashboard", { replace: true }))
      .catch((err) =>
        setError(err?.response?.data?.detail || "This invitation link could not be used. Ask an admin to resend it.")
      );
  }, [token]);

  return (
    <div className="jira-auth-page">
      <div className="jira-auth-container jira-auth-single-card">
        <div className="jira-auth-card">
          <div className="jira-auth-card-inner" style={{ textAlign: "center" }}>
            <img src="/dp-logo.png" alt="DataPattern Logo" style={{ height: 40, width: "auto", objectFit: "contain" }} />
            <h2 className="jira-auth-main-title" style={{ marginTop: 16 }}>NEXO</h2>
            {!error ? (
              <p className="jira-auth-main-subtitle">Accepting your invitation…</p>
            ) : (
              <>
                <div className="jira-auth-alert-error" style={{ margin: "16px 0" }}>
                  <div className="jira-auth-alert-msg">{error}</div>
                </div>
                <Link to="/login" className="jira-auth-link">Go to log in</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
