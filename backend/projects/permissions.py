from rest_framework import permissions

from users.access import ADMIN, MANAGER, MEMBER, effective_project_role

from .models import Project


def _project_of(obj):
    if hasattr(obj, "memberships"):
        return obj
    if hasattr(obj, "issue"):  # Comment / attachment
        return obj.issue.project
    return obj.project


class IsProjectMember(permissions.BasePermission):
    """
    Visibility rule: you must have access to the project (assigned to it, or an
    org Admin) to see it or anything inside it.
    """

    def has_object_permission(self, request, view, obj):
        return effective_project_role(request.user, _project_of(obj)) is not None


class IsProjectMemberOrAbove(permissions.BasePermission):
    """
    Action rule: writing needs a non-Viewer role in the project. Whether a Member
    may actually write is decided by LimitedMemberReadOnly + the view itself.
    """

    WRITERS = (ADMIN, MANAGER, MEMBER)

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        project_id = request.data.get("project") or view.kwargs.get("project_pk")
        if not project_id:
            return True  # fall back to object-level check
        project = Project.objects.filter(pk=project_id).first()
        if project is None:
            return True  # let the serializer report the bad id
        return effective_project_role(request.user, project) in self.WRITERS

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return effective_project_role(request.user, _project_of(obj)) in self.WRITERS
