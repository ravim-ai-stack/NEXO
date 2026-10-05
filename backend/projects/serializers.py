from rest_framework import serializers

from users.serializers import UserSerializer

from .models import AutomationRule, CalendarEntry, Project, ProjectDoc, ProjectMembership, Sprint, WorkflowState, WorkflowTransition, SavedFilter


class ProjectMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    user_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = ProjectMembership
        fields = ["id", "user", "user_id", "role", "joined_at"]


class ProjectDocSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)

    class Meta:
        model = ProjectDoc
        fields = [
            "id", "project", "title", "content", "template_type",
            "created_by", "created_at", "updated_at"
        ]
        read_only_fields = ["created_by"]


class AutomationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationRule
        fields = [
            "id", "project", "name", "trigger", "action",
            "enabled", "execution_count", "created_at"
        ]


class WorkflowStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowState
        fields = ["id", "project", "name", "color", "category", "position", "is_default"]


class WorkflowTransitionSerializer(serializers.ModelSerializer):
    from_state_name = serializers.ReadOnlyField(source="from_state.name")
    to_state_name = serializers.ReadOnlyField(source="to_state.name")

    class Meta:
        model = WorkflowTransition
        fields = ["id", "project", "from_state", "from_state_name", "to_state", "to_state_name"]


class SprintSerializer(serializers.ModelSerializer):
    issues_count = serializers.SerializerMethodField()
    completed_count = serializers.SerializerMethodField()

    class Meta:
        model = Sprint
        fields = [
            "id", "project", "name", "goal", "status",
            "start_date", "end_date", "created_at", "completed_at",
            "issues_count", "completed_count",
        ]
        read_only_fields = ["status", "created_at", "completed_at"]

    def get_issues_count(self, obj):
        return obj.issues.count()

    def get_completed_count(self, obj):
        return obj.issues.filter(status="DONE").count()


class ProjectSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    members = ProjectMembershipSerializer(source="memberships", many=True, read_only=True)
    docs_count = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    workflow_states = WorkflowStateSerializer(many=True, read_only=True)

    class Meta:
        model = Project
        fields = [
            "id", "name", "key", "description", "created_by", "created_at",
            "members", "docs_count", "my_role", "workflow_states",
        ]

    def get_docs_count(self, obj):
        return obj.docs.count()

    def get_my_role(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        from users.access import effective_project_role
        return effective_project_role(request.user, obj)


class SavedFilterSerializer(serializers.ModelSerializer):
    assignee_username = serializers.ReadOnlyField(source="assignee.username")

    class Meta:
        model = SavedFilter
        fields = [
            "id", "project", "name",
            "status", "priority",
            "assignee", "assignee_username",
            "created_at",
        ]
        read_only_fields = ["created_at"]


class CalendarEntrySerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    participants = UserSerializer(many=True, read_only=True)
    # People picked as assignees. Anyone @mentioned in the title/notes is added automatically.
    participant_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = CalendarEntry
        fields = [
            "id", "project", "kind", "kind_label", "title", "description", "date", "time",
            "created_by", "participants", "participant_ids", "created_at", "updated_at",
        ]
        read_only_fields = ["created_by"]
