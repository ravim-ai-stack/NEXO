import hmac

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from users.access import (
    LimitedMemberReadOnly,
    can_create_project,
    can_delete_project,
    effective_project_role,
    has_project_access,
    is_project_admin,
    visible_projects_q,
)
from users.models import Notification
from users.utils import send_project_invite_email

from .intelligence import generate_project_intelligence, process_and_extract_document
from .models import (
    AutomationRule,
    CalendarEntry,
    Project,
    ProjectDoc,
    ProjectIntelligenceSummary,
    ProjectMembership,
    ProjectSignal,
    SavedFilter,
    Sprint,
    WorkflowState,
    WorkflowTransition,
    create_default_workflow,
)
from .permissions import IsProjectMember, IsProjectMemberOrAbove
from .reminders import local_today, mentioned_users, notify_added, process_due
from .serializers import (
    AutomationRuleSerializer,
    CalendarEntrySerializer,
    ProjectDocSerializer,
    ProjectMembershipSerializer,
    ProjectSerializer,
    ProjectSignalSerializer,
    SavedFilterSerializer,
    SprintSerializer,
    WorkflowStateSerializer,
    WorkflowTransitionSerializer,
)

User = get_user_model()


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly, IsProjectMemberOrAbove]

    def get_queryset(self):
        # Admins see every project; everyone else only the projects they're assigned to.
        return Project.objects.filter(visible_projects_q(self.request.user)).distinct()

    def perform_create(self, serializer):
        if not can_create_project(self.request.user):
            raise PermissionDenied("Only Admins and Managers can create projects.")
        project = serializer.save(created_by=self.request.user)
        ProjectMembership.objects.create(
            project=project, user=self.request.user, role=ProjectMembership.Role.ADMIN
        )
        # Seed the default 3-column workflow for this project
        create_default_workflow(project)

    def perform_update(self, serializer):
        if not is_project_admin(self.request.user, serializer.instance):
            raise PermissionDenied("Only project admins can change project settings.")
        serializer.save()

    def perform_destroy(self, instance):
        if not can_delete_project(self.request.user):
            raise PermissionDenied("Only Admins can delete projects.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def add_member(self, request, pk=None):
        """POST {user_id or username/email, role} -> adds or updates user role in this project."""
        project = self.get_object()
        if not is_project_admin(request.user, project):
            raise PermissionDenied("Only project admins can add members.")
        user_id = request.data.get("user_id")
        username = request.data.get("username")
        email = request.data.get("email")
        role = request.data.get("role", ProjectMembership.Role.MEMBER)

        target_user = None
        if user_id:
            target_user = User.objects.filter(id=user_id).first()
        elif username:
            target_user = User.objects.filter(username__iexact=username.strip()).first()
        elif email:
            target_user = User.objects.filter(email__iexact=email.strip()).first()

        if not target_user:
            return Response({"error": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        if target_user.is_deactivated:
            return Response({"error": "This user is inactive and cannot be added to a project."}, status=status.HTTP_400_BAD_REQUEST)

        if role not in [ProjectMembership.Role.ADMIN, ProjectMembership.Role.MEMBER, ProjectMembership.Role.VIEWER]:
            role = ProjectMembership.Role.MEMBER

        membership, _ = ProjectMembership.objects.update_or_create(
            project=project,
            user=target_user,
            defaults={"role": role},
        )

        Notification.objects.create(
            recipient=target_user,
            actor=request.user,
            action=f"added you to project {project.name}",
            target=project.name,
        )

        if target_user.email:
            send_project_invite_email(
                project_name=project.name,
                invited_email=target_user.email,
                invited_user=target_user.username,
                invited_by=request.user.get_full_name() or request.user.username,
            )

        return Response(ProjectSerializer(project, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def remove_member(self, request, pk=None):
        """POST {user_id} -> removes user from this project."""
        project = self.get_object()
        if not is_project_admin(request.user, project):
            raise PermissionDenied("Only project admins can remove members.")
        user_id = request.data.get("user_id")
        if not user_id:
            return Response({"error": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        ProjectMembership.objects.filter(project=project, user_id=user_id).delete()
        return Response(ProjectSerializer(project, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def intelligence(self, request, pk=None):
        """
        GET /api/projects/<id>/intelligence/
        Returns comprehensive PMO project overview combining structured data and document signals.
        """
        project = self.get_object()
        data = generate_project_intelligence(project)
        return Response(data)

    @action(detail=True, methods=["post"])
    def refresh_intelligence(self, request, pk=None):
        """
        POST /api/projects/<id>/refresh_intelligence/
        Re-scans all project documents, extracts signals, and updates executive intelligence cache.
        """
        project = self.get_object()
        for doc in project.docs.all():
            try:
                process_and_extract_document(doc)
            except Exception as e:
                print(f"[Error processing doc {doc.id}]: {e}")
        data = generate_project_intelligence(project)
        return Response(data)

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload_doc(self, request, pk=None):
        """
        POST /api/projects/<id>/upload_doc/
        Upload an Excel (XLSX), Word (DOCX), PDF, or Markdown file to the project.
        Parses text, classifies document context, extracts signals, and updates intelligence.
        """
        project = self.get_object()
        file_obj = request.FILES.get("file")
        title = request.data.get("title")
        content = request.data.get("content", "")
        template_type = request.data.get("template_type", ProjectDoc.TemplateType.CUSTOM)

        if not file_obj and not content:
            return Response({"error": "Either file or content is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not title:
            if file_obj:
                title = file_obj.name.rsplit(".", 1)[0].replace("_", " ").title()
            else:
                title = "Uploaded Project Document"

        doc = ProjectDoc.objects.create(
            project=project,
            title=title,
            content=content,
            file=file_obj,
            template_type=template_type,
            created_by=request.user,
        )

        try:
            intel = process_and_extract_document(doc)
        except Exception as e:
            print(f"[Extraction error on upload]: {e}")
            intel = generate_project_intelligence(project)

        doc_data = ProjectDocSerializer(doc, context={"request": request}).data
        return Response({"doc": doc_data, "intelligence": intel}, status=status.HTTP_201_CREATED)


class ProjectDocViewSet(viewsets.ModelViewSet):
    """CRUD API for project documentation pages with auto-extraction."""
    serializer_class = ProjectDocSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        project_id = self.request.query_params.get("project")
        qs = ProjectDoc.objects.filter(visible_projects_q(self.request.user, "project__")).distinct()
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        if not is_project_admin(self.request.user, serializer.validated_data["project"]):
            raise PermissionDenied("You cannot create documents in this project.")
        doc = serializer.save(created_by=self.request.user)
        try:
            process_and_extract_document(doc)
        except Exception as e:
            print(f"[Doc extraction error on create]: {e}")

    def perform_update(self, serializer):
        doc = serializer.save()
        try:
            process_and_extract_document(doc)
        except Exception as e:
            print(f"[Doc extraction error on update]: {e}")

    @action(detail=True, methods=["get"])
    def signals(self, request, pk=None):
        """Returns all structured signals extracted from this specific document."""
        doc = self.get_object()
        signals = doc.signals.all().order_by("-confidence", "-id")
        return Response(ProjectSignalSerializer(signals, many=True).data)

    @action(detail=True, methods=["post"])
    def reextract(self, request, pk=None):
        """Forces re-parsing and signal extraction on this document."""
        doc = self.get_object()
        try:
            intel = process_and_extract_document(doc)
            return Response({
                "message": "Signals extracted successfully",
                "doc": ProjectDocSerializer(doc, context={"request": request}).data,
                "intelligence": intel,
            })
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ProjectSignalViewSet(viewsets.ModelViewSet):
    """
    CRUD for extracted project signals (risks, blockers, decisions, milestones, updates).
    """
    serializer_class = ProjectSignalSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = ProjectSignal.objects.filter(visible_projects_q(self.request.user, "project__")).distinct()
        project_id = self.request.query_params.get("project")
        doc_id = self.request.query_params.get("source_doc") or self.request.query_params.get("doc")
        category = self.request.query_params.get("category")
        status_val = self.request.query_params.get("status")
        if project_id:
            qs = qs.filter(project_id=project_id)
        if doc_id:
            qs = qs.filter(source_doc_id=doc_id)
        if category:
            qs = qs.filter(category=category)
        if status_val:
            qs = qs.filter(status=status_val)
        return qs



class AutomationRuleViewSet(viewsets.ModelViewSet):
    """CRUD API for project automation rules."""
    serializer_class = AutomationRuleSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]

    def get_queryset(self):
        project_id = self.request.query_params.get("project")
        qs = AutomationRule.objects.filter(visible_projects_q(self.request.user, "project__")).distinct()
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        if not is_project_admin(self.request.user, serializer.validated_data["project"]):
            raise PermissionDenied("Only project admins can create automation rules.")
        serializer.save()


class SprintViewSet(viewsets.ModelViewSet):
    """
    CRUD + start/complete actions for sprints.
    GET    /api/sprints/?project=<id>  — list sprints for a project
    POST   /api/sprints/               — create a planned sprint
    PATCH  /api/sprints/<id>/          — edit name/goal/dates
    POST   /api/sprints/<id>/start/    — activate sprint (only one active per project)
    POST   /api/sprints/<id>/complete/ — complete sprint, optionally move unfinished issues to backlog
    DELETE /api/sprints/<id>/          — delete a PLANNED sprint
    """
    serializer_class = SprintSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]

    def get_queryset(self):
        qs = Sprint.objects.filter(
            visible_projects_q(self.request.user, "project__")
        ).distinct()
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not is_project_admin(self.request.user, project):
            raise PermissionDenied("Only project admins can create sprints.")
        serializer.save()

    def perform_update(self, serializer):
        if not is_project_admin(self.request.user, serializer.instance.project):
            raise PermissionDenied("Only project admins can edit sprints.")
        serializer.save()

    def perform_destroy(self, instance):
        if not is_project_admin(self.request.user, instance.project):
            raise PermissionDenied("Only project admins can delete sprints.")
        if instance.status != Sprint.Status.PLANNED:
            raise ValidationError("Only planned sprints can be deleted.")
        # Move issues back to backlog
        instance.issues.all().update(sprint=None)
        instance.delete()

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """Activate this sprint. Fails if another sprint is already active in the project."""
        sprint = self.get_object()
        if not is_project_admin(request.user, sprint.project):
            raise PermissionDenied("Only project admins can start sprints.")
        if sprint.status != Sprint.Status.PLANNED:
            return Response(
                {"detail": f"Only PLANNED sprints can be started. This sprint is {sprint.status}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        already_active = Sprint.objects.filter(
            project=sprint.project, status=Sprint.Status.ACTIVE
        ).exclude(pk=sprint.pk).exists()
        if already_active:
            return Response(
                {"detail": "Another sprint is already active in this project. Complete it before starting a new one."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        sprint.status = Sprint.Status.ACTIVE
        if not sprint.start_date:
            sprint.start_date = timezone.now().date()
        sprint.save()
        return Response(SprintSerializer(sprint).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """
        Complete this sprint.
        Unfinished issues (not DONE) are moved back to backlog (sprint=None)
        unless move_to_sprint_id is provided to re-assign them to another sprint.
        """
        sprint = self.get_object()
        if not is_project_admin(request.user, sprint.project):
            raise PermissionDenied("Only project admins can complete sprints.")
        if sprint.status != Sprint.Status.ACTIVE:
            return Response(
                {"detail": "Only ACTIVE sprints can be completed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        move_to_sprint_id = request.data.get("move_to_sprint_id")
        unfinished = sprint.issues.exclude(status="DONE")

        if move_to_sprint_id:
            target = Sprint.objects.filter(
                pk=move_to_sprint_id, project=sprint.project
            ).first()
            if not target:
                return Response(
                    {"detail": "Target sprint not found in this project."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            unfinished.update(sprint=target)
        else:
            unfinished.update(sprint=None)

        sprint.status = Sprint.Status.COMPLETED
        sprint.completed_at = timezone.now()
        if not sprint.end_date:
            sprint.end_date = timezone.now().date()
        sprint.save()

        return Response({
            **SprintSerializer(sprint).data,
            "moved_to_backlog": unfinished.count() if not move_to_sprint_id else 0,
        })


class WorkflowStateViewSet(viewsets.ModelViewSet):
    """
    CRUD for per-project workflow states (custom Kanban columns).
    GET  /api/workflow-states/?project=<id>  — list states for a project
    POST /api/workflow-states/               — create a new state
    PATCH/PUT /api/workflow-states/<id>/     — rename, recolor, reorder
    DELETE /api/workflow-states/<id>/        — delete (blocked if issues use it)
    POST /api/workflow-states/seed/?project=<id> — reset to default 3-column workflow
    """
    serializer_class = WorkflowStateSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]

    def get_queryset(self):
        qs = WorkflowState.objects.filter(
            visible_projects_q(self.request.user, "project__")
        ).distinct()
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not is_project_admin(self.request.user, project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        # Auto-assign next position
        max_pos = WorkflowState.objects.filter(project=project).count()
        serializer.save(position=max_pos)

    def perform_update(self, serializer):
        if not is_project_admin(self.request.user, serializer.instance.project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        serializer.save()

    def perform_destroy(self, instance):
        if not is_project_admin(self.request.user, instance.project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        # Block deletion if any issues still reference this status name
        from issues.models import Issue
        count = Issue.objects.filter(project=instance.project, status=instance.name).count()
        if count > 0:
            raise ValidationError(
                f"Cannot delete '{instance.name}' — {count} issue(s) are currently in this status. "
                "Move them to another status first."
            )
        instance.delete()

    @action(detail=False, methods=["post"])
    def seed(self, request):
        """Reset a project's workflow to the default 3-column layout."""
        project_id = request.query_params.get("project") or request.data.get("project")
        if not project_id:
            return Response({"detail": "project is required."}, status=status.HTTP_400_BAD_REQUEST)
        project = Project.objects.filter(
            visible_projects_q(request.user), id=project_id
        ).first()
        if not project:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not is_project_admin(request.user, project):
            raise PermissionDenied("Only project admins can reset the workflow.")
        states = create_default_workflow(project)
        return Response(WorkflowStateSerializer(states, many=True).data)


class WorkflowTransitionViewSet(viewsets.ModelViewSet):
    """
    Allowed moves between workflow states for a project.
    GET  /api/workflow-transitions/?project=<id>
    POST /api/workflow-transitions/  {project, from_state, to_state}
    DELETE /api/workflow-transitions/<id>/
    """
    serializer_class = WorkflowTransitionSerializer
    permission_classes = [permissions.IsAuthenticated, LimitedMemberReadOnly]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = WorkflowTransition.objects.filter(
            visible_projects_q(self.request.user, "project__")
        ).distinct()
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not is_project_admin(self.request.user, project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        serializer.save()

    def perform_destroy(self, instance):
        if not is_project_admin(self.request.user, instance.project):
            raise PermissionDenied("Only project admins can edit the workflow.")
        instance.delete()


class SavedFilterViewSet(viewsets.ModelViewSet):
    """
    GET    /api/saved-filters/?project=<id>  — list saved filters for a project (owner only)
    POST   /api/saved-filters/               — create a saved filter
    DELETE /api/saved-filters/<id>/          — delete a saved filter
    """
    serializer_class = SavedFilterSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = SavedFilter.objects.filter(owner=self.request.user)
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not has_project_access(self.request.user, project):
            raise PermissionDenied("You are not a member of this project.")
        serializer.save(owner=self.request.user)


class CalendarEntryViewSet(viewsets.ModelViewSet):
    """
    Things added to a project's calendar by clicking a day (reminder / task / event / meeting).
    GET  /api/calendar-entries/?project=<id>[&from=YYYY-MM-DD&to=YYYY-MM-DD]
    POST /api/calendar-entries/  {project, kind, title, description, date, time?, participant_ids?}

    Open to every account type that can see the project, except read-only Viewers.
    Creating or editing tells the people involved right away; the date arriving tells everyone again
    (see projects/reminders.py).
    """
    serializer_class = CalendarEntrySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = (
            CalendarEntry.objects.filter(visible_projects_q(self.request.user, "project__"))
            .distinct()
            .select_related("project", "created_by")
            .prefetch_related("participants")
        )
        params = self.request.query_params
        if params.get("project"):
            qs = qs.filter(project_id=params["project"])
        if params.get("from"):
            qs = qs.filter(date__gte=params["from"])
        if params.get("to"):
            qs = qs.filter(date__lte=params["to"])
        return qs

    # -- helpers ---------------------------------------------------------
    def _require_writer(self, project):
        if effective_project_role(self.request.user, project) in (None, "VIEWER"):
            raise PermissionDenied("You can view this calendar but not add to it.")

    def _require_owner_or_admin(self, entry):
        if entry.created_by_id != self.request.user.id and not is_project_admin(self.request.user, entry.project):
            raise PermissionDenied("Only the person who added this (or a project admin) can change it.")

    @staticmethod
    def _check_date(value):
        if value < local_today():
            raise ValidationError({"date": ["Pick today or a future date."]})

    def _people(self, entry, explicit_ids):
        """Assignees picked in the form + anyone @mentioned in the title / notes (never the creator)."""
        User = get_user_model()
        people = {}
        for user in User.objects.filter(pk__in=explicit_ids, is_active=True):
            if not has_project_access(user, entry.project):
                raise ValidationError({"participant_ids": [f"{user.username} is not a member of this project."]})
            people[user.pk] = user
        for user in mentioned_users(f"{entry.title}\n{entry.description}", entry.project):
            people[user.pk] = user
        people.pop(entry.created_by_id, None)
        return list(people.values())

    # -- writes ----------------------------------------------------------
    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        self._require_writer(project)
        self._check_date(serializer.validated_data["date"])
        ids = serializer.validated_data.pop("participant_ids", [])
        entry = serializer.save(created_by=self.request.user)
        people = self._people(entry, ids)
        entry.participants.set(people)
        notify_added(entry, self.request.user, people)  # "the day of assigned"

    def perform_update(self, serializer):
        entry = serializer.instance
        self._require_owner_or_admin(entry)
        data = serializer.validated_data
        if "date" in data and data["date"] != entry.date:
            self._check_date(data["date"])
        before = set(entry.participants.values_list("pk", flat=True))
        ids = data.pop("participant_ids", None)
        explicit = list(before) if ids is None else ids
        rescheduled = ("date" in data and data["date"] != entry.date) or ("time" in data and data["time"] != entry.time)
        entry = serializer.save(**({"due_notified_at": None} if rescheduled else {}))
        people = self._people(entry, explicit)
        entry.participants.set(people)
        notify_added(entry, self.request.user, [u for u in people if u.pk not in before])

    def perform_destroy(self, instance):
        self._require_owner_or_admin(instance)
        instance.delete()


@api_view(["GET", "POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def cron_reminders(request):
    """
    Hit this on a schedule (every minute or so) where there is no long-running server, e.g. Vercel Cron.
    Send the secret as `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`.
    """
    secret = getattr(settings, "CRON_SECRET", "")
    supplied = request.query_params.get("secret") or request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not secret or not hmac.compare_digest(supplied.encode(), secret.encode()):
        return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
    return Response({"sent": process_due()})
