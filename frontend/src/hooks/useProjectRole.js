/**
 * useProjectRole
 * Derives the current user's effective role for a specific project
 * (computed by the backend as `my_role`) and exposes a bound can() function.
 *
 * Returns:
 *   role      — "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER" | null
 *   isAdmin   — admin-level inside the project (ADMIN or MANAGER): members, sprints, settings...
 *   isViewer  — true if role === "VIEWER"
 *   isLimited — true if role === "MEMBER" (read-only, except status/resolution)
 *   canEdit   — can edit issue fields (ADMIN or MANAGER)
 *   can(action, context?) — bound to the current role; delegates to permissions.js
 */
import { can as _can } from "../permissions";

export function useProjectRole(projectDetails) {
  const role = projectDetails?.my_role || null;

  const isAdmin = role === "ADMIN" || role === "MANAGER";
  const isViewer = role === "VIEWER";
  const isLimited = role === "MEMBER";
  const canEdit = isAdmin;

  function can(action, context = {}) {
    return _can(role, action, context);
  }

  return { role, isAdmin, isViewer, isLimited, isMember: canEdit, canEdit, can };
}
