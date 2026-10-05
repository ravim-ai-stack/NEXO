"""
NEXO access rules — one place that decides who may do what.

Organisation-wide user types (User.user_type):
  ADMIN    sees every project and user; creates/deletes projects; adds, edits,
           activates and deactivates users; sets user types.
  MANAGER  sees only the projects they are assigned to; creates projects (cannot
           delete them); creates Members in their own team and edits only people
           in their own reporting line (not activate/deactivate).
  MEMBER   sees only the projects they are allocated to; read-only everywhere
           except changing an issue's status and resolution. Cannot create or
           delete anything.

Effective role inside one project (what the UI calls `my_role`):
  ADMIN | MANAGER | MEMBER | VIEWER  (VIEWER = a project membership marked Viewer)
"""
from django.db.models import Q
from rest_framework import permissions

ADMIN = "ADMIN"
MANAGER = "MANAGER"
MEMBER = "MEMBER"
VIEWER = "VIEWER"

# Issue fields a Member may change.
MEMBER_EDITABLE_ISSUE_FIELDS = {"status", "resolution"}


def org_role(user):
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return ADMIN
    return user.user_type


def is_org_admin(user):
    return org_role(user) == ADMIN


def can_create_project(user):
    return org_role(user) in (ADMIN, MANAGER)


def can_delete_project(user):
    return is_org_admin(user)


def can_create_users(user):
    return org_role(user) in (ADMIN, MANAGER)


def can_toggle_users(user):
    return is_org_admin(user)


def visible_projects_q(user, prefix=""):
    """Q for 'projects this user can see'. `prefix` is the path to the project (e.g. 'project__')."""
    if is_org_admin(user):
        return Q()
    return Q(**{f"{prefix}memberships__user": user})


def effective_project_role(user, project):
    """The user's role inside `project`, or None when they have no access to it."""
    if is_org_admin(user):
        return ADMIN
    membership = project.memberships.filter(user=user).first()
    if membership is None:
        return None
    if membership.role == "VIEWER":
        return VIEWER
    return MANAGER if org_role(user) == MANAGER else MEMBER


def has_project_access(user, project):
    return effective_project_role(user, project) is not None


def is_project_admin(user, project):
    """Admin-level actions inside a project (members, sprints, workflow, settings...)."""
    return effective_project_role(user, project) in (ADMIN, MANAGER)


def team_user_ids(manager):
    """Everyone who reports to `manager`, directly or through other people."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    found, frontier = set(), {manager.pk}
    while frontier:
        children = set(
            User.objects.filter(reporting_manager_id__in=frontier).values_list("id", flat=True)
        ) - found
        found |= children
        frontier = children
    return found


class LimitedMemberReadOnly(permissions.BasePermission):
    """
    Members are read-only. A view opts in to the single exception — editing an
    issue's status/resolution — by setting `limited_member_write = True`
    (the view then restricts which fields may change).
    """

    message = "Your account type (Member) cannot create, edit or delete this."

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        if org_role(request.user) != MEMBER:
            return True
        return bool(getattr(view, "limited_member_write", False)) and request.method in ("PATCH", "PUT")
