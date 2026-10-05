from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import EmailVerificationCode, Notification
from .utils import (
    generate_otp_code,
    send_verification_email,
    validate_email_deliverability,
    validate_password_strength,
)

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name", "avatar_url",
            "designation", "is_deactivated", "user_type",
        ]


class SessionUserSerializer(UserSerializer):
    """The logged-in user (login / me): also tells the UI what they are allowed to do."""
    can_manage_users = serializers.SerializerMethodField()
    can_toggle_users = serializers.SerializerMethodField()
    can_create_project = serializers.SerializerMethodField()
    can_delete_project = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + [
            "can_manage_users", "can_toggle_users", "can_create_project", "can_delete_project",
        ]

    # `user_type` is reported as the effective org role (superusers count as Admin).
    def to_representation(self, instance):
        from .access import org_role
        data = super().to_representation(instance)
        data["user_type"] = org_role(instance)
        return data

    def get_can_manage_users(self, obj):
        from .access import can_create_users
        return can_create_users(obj)

    def get_can_toggle_users(self, obj):
        from .access import can_toggle_users
        return can_toggle_users(obj)

    def get_can_create_project(self, obj):
        from .access import can_create_project
        return can_create_project(obj)

    def get_can_delete_project(self, obj):
        from .access import can_delete_project
        return can_delete_project(obj)


class UserWithProjectsSerializer(serializers.ModelSerializer):
    projects_count = serializers.SerializerMethodField()
    assigned_issues_count = serializers.SerializerMethodField()
    reporting_manager = serializers.PrimaryKeyRelatedField(read_only=True)
    reporting_manager_name = serializers.SerializerMethodField()
    invite_pending = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name", "avatar_url",
            "projects_count", "assigned_issues_count", "date_joined",
            "designation", "reporting_manager", "reporting_manager_name",
            "is_active", "is_deactivated", "invite_pending",
            "user_type", "can_edit",
        ]

    def get_can_edit(self, obj):
        """Whether the requesting user may edit this person (Admin: anyone; Manager: their own team)."""
        from .access import ADMIN, MANAGER, org_role, team_user_ids
        request = self.context.get("request")
        if not request:
            return False
        role = org_role(request.user)
        if role == ADMIN:
            return True
        if role == MANAGER:
            cache = self.context.setdefault("_team_ids", team_user_ids(request.user))
            return obj.pk in cache
        return False

    def get_reporting_manager_name(self, obj):
        m = obj.reporting_manager
        return (m.get_full_name() or m.username) if m else None

    def get_invite_pending(self, obj):
        # Invited by an admin but hasn't opened the invitation yet.
        return obj.last_login is None and not obj.has_usable_password() and not obj.is_deactivated

    def get_projects_count(self, obj):
        return obj.project_memberships.count()

    def get_assigned_issues_count(self, obj):
        return getattr(obj, "assigned_issues", []).count() if hasattr(obj, "assigned_issues") else 0


class RegisterSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(required=True, allow_blank=False)
    password = serializers.CharField(write_only=True, min_length=8)
    username = serializers.CharField(required=True, allow_blank=False, min_length=3, max_length=20)

    class Meta:
        model = User
        fields = ["id", "username", "email", "password", "first_name", "last_name"]

    def validate_username(self, value):
        import re
        value = value.strip()
        if not re.match(r'^[a-zA-Z0-9_]+$', value):
            raise serializers.ValidationError(
                "Username may only contain letters, numbers, and underscores."
            )
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError(
                "This username is already taken. Please choose a different one."
            )
        return value

    def validate_email(self, value):
        email = value.strip().lower()
        if not email:
            raise serializers.ValidationError("Email address is required.")

        # 1. Format & Deliverability / Disposable domain validation
        is_valid, err_msg = validate_email_deliverability(email)
        if not is_valid:
            raise serializers.ValidationError(err_msg)

        # 2. Check duplicate email in database
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError(
                "An account with this email address already exists. Please log in or use a different email."
            )
        return email

    def validate_password(self, value):
        is_valid, err_msg = validate_password_strength(value)
        if not is_valid:
            raise serializers.ValidationError(err_msg)
        return value

    def create(self, validated_data):
        email = validated_data["email"]
        username = validated_data["username"]

        # The very first account bootstraps the workspace as Admin; everyone after is a Member
        # (admins/managers then add or re-classify people from the Teams page).
        first_type = "MEMBER" if User.objects.filter(user_type="ADMIN").exists() else "ADMIN"

        # Create user in pending/inactive state until email is verified
        user = User.objects.create_user(
            username=username,
            email=email,
            password=validated_data["password"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
            user_type=first_type,
            is_active=False,
        )

        # Generate 6-digit OTP code & dispatch email
        code = generate_otp_code(6)
        EmailVerificationCode.objects.create(
            email=user.email,
            user=user,
            code=code,
            purpose="REGISTRATION",
        )
        send_verification_email(
            email=user.email,
            code=code,
            purpose="REGISTRATION",
            username=user.username,
        )

        return user




class NotificationSerializer(serializers.ModelSerializer):
    actor = UserSerializer(read_only=True)

    class Meta:
        model = Notification
        fields = ["id", "recipient", "actor", "action", "target", "read", "created_at"]
        read_only_fields = ["recipient"]
