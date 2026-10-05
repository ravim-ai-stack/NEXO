from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from projects.models import Project, ProjectMembership
from users.models import EmailVerificationCode, User
from users.utils import make_invite_token

LOCMEM = override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")


def api_as(user):
    c = APIClient()
    token, _ = Token.objects.get_or_create(user=user)
    c.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return c


@LOCMEM
class LoginVerificationTests(TestCase):
    def test_unverified_user_cannot_log_in_until_code_entered(self):
        c = APIClient()
        r = c.post("/api/auth/register/", {"username": "newu", "email": "newu@example.com", "password": "Passw0rd!x"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        r = c.post("/api/auth/login/", {"username": "newu@example.com", "password": "Passw0rd!x"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("token", r.data)
        self.assertFalse(User.objects.get(username="newu").is_active)
        r = c.post("/api/auth/verify-code/", {"email": "newu@example.com", "code": "000000"}, format="json")
        self.assertEqual(r.status_code, 400)
        code = EmailVerificationCode.objects.filter(email="newu@example.com", is_used=False).latest("created_at").code
        r = c.post("/api/auth/verify-code/", {"email": "newu@example.com", "code": code}, format="json")
        self.assertEqual(r.status_code, 200)
        r = c.post("/api/auth/login/", {"username": "newu@example.com", "password": "Passw0rd!x"}, format="json")
        self.assertEqual(r.status_code, 200)


@LOCMEM
class TeamManagementTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("boss", "boss@example.com", "Passw0rd!x", user_type="ADMIN")
        project = Project.objects.create(name="P", key="PX", created_by=self.admin)
        ProjectMembership.objects.create(project=project, user=self.admin, role="ADMIN")
        self.member = User.objects.create_user("worker", "worker@example.com", "Passw0rd!x")
        ProjectMembership.objects.create(project=project, user=self.member, role="MEMBER")
        self.admin_api = api_as(self.admin)
        self.member_api = api_as(self.member)

    def invite(self, **extra):
        body = {"name": "Jane Doe", "email": "jane@example.com", "designation": "Designer", **extra}
        return self.admin_api.post("/api/auth/users/", body, format="json")

    def test_only_admins_can_add_users(self):
        r = self.member_api.post("/api/auth/users/", {"name": "X Y", "email": "x@example.com"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.invite().status_code, 201)

    def test_invite_sends_email_and_link_logs_in_without_verification(self):
        r = self.invite(reporting_manager=self.admin.pk)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(r.data["email_sent"])
        self.assertEqual(r.data["designation"], "Designer")
        self.assertEqual(r.data["reporting_manager"], self.admin.pk)
        self.assertTrue(r.data["invite_pending"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["jane@example.com"])
        self.assertIn("/invite/", mail.outbox[0].body)

        jane = User.objects.get(email="jane@example.com")
        token = make_invite_token(jane)
        c = APIClient()
        r = c.post("/api/auth/accept-invite/", {"token": token}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("token", r.data)
        self.assertEqual(EmailVerificationCode.objects.filter(email="jane@example.com").count(), 0)
        # single use
        self.assertEqual(c.post("/api/auth/accept-invite/", {"token": token}, format="json").status_code, 400)
        self.assertEqual(c.post("/api/auth/accept-invite/", {"token": "garbage"}, format="json").status_code, 400)

    def test_duplicate_email_and_manager_rules(self):
        self.assertEqual(self.invite().status_code, 201)
        self.assertEqual(self.invite().status_code, 400)
        self.member.is_active = False
        self.member.is_deactivated = True
        self.member.save()
        r = self.invite(email="other@example.com", reporting_manager=self.member.pk)
        self.assertEqual(r.status_code, 400)  # manager must be active

    def test_no_reporting_cycles(self):
        self.member.reporting_manager = self.admin
        self.member.save()
        r = self.admin_api.patch(f"/api/auth/users/{self.admin.pk}/", {"reporting_manager": self.member.pk}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.admin_api.patch(f"/api/auth/users/{self.admin.pk}/", {"reporting_manager": self.admin.pk}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_deactivate_blocks_everything_and_reactivate_restores(self):
        r = self.admin_api.patch(f"/api/auth/users/{self.member.pk}/", {"is_deactivated": True}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["is_deactivated"])
        # live session dead, login blocked, registration-code route can't revive the account
        self.assertEqual(self.member_api.get("/api/auth/me/").status_code, 401)
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": "worker@example.com", "password": "Passw0rd!x"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("token", r.data)
        r = c.post("/api/auth/resend-code/", {"email": "worker@example.com", "purpose": "REGISTRATION"}, format="json")
        self.assertEqual(r.status_code, 403)
        # still listed, flagged inactive, so the name keeps showing across the app
        listing = self.admin_api.get("/api/auth/users/").data
        rows = listing["results"] if isinstance(listing, dict) else listing
        users = {u["username"]: u for u in rows}
        self.assertTrue(users["worker"]["is_deactivated"])

        r = self.admin_api.patch(f"/api/auth/users/{self.member.pk}/", {"is_deactivated": False}, format="json")
        self.assertFalse(r.data["is_deactivated"])
        r = c.post("/api/auth/login/", {"username": "worker@example.com", "password": "Passw0rd!x"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_cannot_deactivate_self_or_without_admin_rights(self):
        r = self.admin_api.patch(f"/api/auth/users/{self.admin.pk}/", {"is_deactivated": True}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.member_api.patch(f"/api/auth/users/{self.admin.pk}/", {"is_deactivated": True}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_me_reports_manage_permission(self):
        self.assertTrue(self.admin_api.get("/api/auth/me/").data["can_manage_users"])
        self.assertFalse(self.member_api.get("/api/auth/me/").data["can_manage_users"])

    def test_admin_can_edit_name_and_details(self):
        r = self.admin_api.patch(
            f"/api/auth/users/{self.member.pk}/",
            {"name": "Wendy Worker", "designation": "Lead", "reporting_manager": self.admin.pk},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.member.refresh_from_db()
        self.assertEqual((self.member.first_name, self.member.last_name), ("Wendy", "Worker"))
        self.assertEqual(self.member.designation, "Lead")
        self.assertEqual(self.member.reporting_manager, self.admin)
        r = self.admin_api.patch(f"/api/auth/users/{self.member.pk}/", {"name": "  "}, format="json")
        self.assertEqual(r.status_code, 400)
