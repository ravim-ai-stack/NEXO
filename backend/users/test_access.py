"""The Admin / Manager / Member rules, end to end through the API."""
from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from issues.models import Issue
from projects.models import Project, ProjectMembership
from users.models import User

LOCMEM = override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")


def api_as(user):
    c = APIClient()
    token, _ = Token.objects.get_or_create(user=user)
    c.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return c


def results(response):
    data = response.data
    return data["results"] if isinstance(data, dict) and "results" in data else data


@LOCMEM
class AccessMatrixTests(TestCase):
    def setUp(self):
        mk = lambda name, utype, mgr=None: User.objects.create_user(  # noqa: E731
            name, f"{name}@example.com", "Passw0rd!x", user_type=utype, reporting_manager=mgr
        )
        self.admin = mk("admin", "ADMIN")
        self.m1 = mk("mgr1", "MANAGER")
        self.m2 = mk("mgr2", "MANAGER")
        self.x = mk("memx", "MEMBER", self.m1)  # on m1's team
        self.y = mk("memy", "MEMBER", self.m2)  # on m2's team

        self.p1 = Project.objects.create(name="One", key="ONE", created_by=self.m1)
        self.p2 = Project.objects.create(name="Two", key="TWO", created_by=self.m2)
        self.p3 = Project.objects.create(name="Three", key="THR", created_by=self.m2)
        for project, users in ((self.p1, (self.m1, self.x)), (self.p2, (self.m2, self.y)), (self.p3, (self.m2,))):
            for u in users:
                ProjectMembership.objects.create(project=project, user=u, role="MEMBER")

        self.i1 = Issue.objects.create(project=self.p1, title="in one", reporter=self.m1)
        self.i2 = Issue.objects.create(project=self.p2, title="in two", reporter=self.m2)

        self.a_api, self.m1_api, self.x_api = api_as(self.admin), api_as(self.m1), api_as(self.x)

    # ── project visibility ────────────────────────────────────────────────
    def test_who_sees_which_projects(self):
        keys = lambda api: sorted(p["key"] for p in results(api.get("/api/projects/")))  # noqa: E731
        self.assertEqual(keys(self.a_api), ["ONE", "THR", "TWO"])  # admin: everything
        self.assertEqual(keys(self.m1_api), ["ONE"])  # manager: assigned only
        self.assertEqual(keys(self.x_api), ["ONE"])  # member: allocated only

    def test_my_role_is_the_effective_role(self):
        role = lambda api, pid: api.get(f"/api/projects/{pid}/").data["my_role"]  # noqa: E731
        self.assertEqual(role(self.a_api, self.p2.pk), "ADMIN")  # even in projects they aren't assigned to
        self.assertEqual(role(self.m1_api, self.p1.pk), "MANAGER")
        self.assertEqual(role(self.x_api, self.p1.pk), "MEMBER")

    def test_no_access_to_unassigned_projects_or_their_issues(self):
        self.assertEqual(self.m1_api.get(f"/api/projects/{self.p2.pk}/").status_code, 404)
        self.assertEqual(self.x_api.get(f"/api/issues/{self.i2.pk}/").status_code, 404)
        self.assertEqual(results(self.x_api.get("/api/issues/")), [r for r in results(self.x_api.get("/api/issues/")) if r["id"] == self.i1.pk])
        self.assertEqual(self.m1_api.post("/api/issues/", {"project": self.p2.pk, "title": "x"}, format="json").status_code, 403)

    # ── projects: create / delete ─────────────────────────────────────────
    def test_create_and_delete_project(self):
        body = {"name": "New", "key": "NEW", "description": ""}
        self.assertEqual(self.a_api.post("/api/projects/", body, format="json").status_code, 201)
        r = self.m1_api.post("/api/projects/", {**body, "key": "NW2"}, format="json")
        self.assertEqual(r.status_code, 201)  # managers can create
        self.assertEqual(self.x_api.post("/api/projects/", {**body, "key": "NW3"}, format="json").status_code, 403)

        mine = Project.objects.get(key="NW2")
        self.assertEqual(self.m1_api.delete(f"/api/projects/{mine.pk}/").status_code, 403)  # even their own
        self.assertEqual(self.x_api.delete(f"/api/projects/{self.p1.pk}/").status_code, 403)
        self.assertEqual(self.a_api.delete(f"/api/projects/{mine.pk}/").status_code, 204)

    # ── issues ────────────────────────────────────────────────────────────
    def test_manager_can_work_in_assigned_project(self):
        r = self.m1_api.post("/api/issues/", {"project": self.p1.pk, "title": "from manager"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        r = self.m1_api.patch(f"/api/issues/{self.i1.pk}/", {"title": "renamed"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_member_can_only_change_status_and_resolution(self):
        url = f"/api/issues/{self.i1.pk}/"
        self.assertEqual(self.x_api.get(url).status_code, 200)  # read
        r = self.x_api.patch(url, {"status": "IN_PROGRESS", "resolution": "Done"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.i1.refresh_from_db()
        self.assertEqual((self.i1.status, self.i1.resolution), ("IN_PROGRESS", "Done"))

        for forbidden in ({"title": "hack"}, {"priority": "HIGH"}, {"assignee_id": self.x.pk}, {"status": "DONE", "title": "x"}):
            self.assertEqual(self.x_api.patch(url, forbidden, format="json").status_code, 403, forbidden)

        self.assertEqual(self.x_api.post("/api/issues/", {"project": self.p1.pk, "title": "new"}, format="json").status_code, 403)
        self.assertEqual(self.x_api.delete(url).status_code, 403)

    def test_member_cannot_create_anything_else(self):
        self.assertEqual(self.x_api.post("/api/comments/", {"issue": self.i1.pk, "body": "hi"}, format="json").status_code, 403)
        self.assertEqual(self.x_api.post("/api/sprints/", {"project": self.p1.pk, "name": "S"}, format="json").status_code, 403)
        self.assertEqual(self.x_api.post("/api/labels/", {"name": "l", "color": "#111111"}, format="json").status_code, 403)
        self.assertEqual(self.x_api.post(f"/api/projects/{self.p1.pk}/add_member/", {"user_id": self.y.pk}, format="json").status_code, 403)

    def test_only_admins_delete_tasks(self):
        url = f"/api/issues/{self.i1.pk}/"
        self.assertEqual(self.x_api.delete(url).status_code, 403)  # member
        self.assertEqual(self.m1_api.delete(url).status_code, 403)  # manager, even for their own project
        self.assertTrue(Issue.objects.filter(pk=self.i1.pk).exists())
        self.assertEqual(self.a_api.delete(url).status_code, 204)  # admin
        self.assertFalse(Issue.objects.filter(pk=self.i1.pk).exists())

    def test_manager_runs_sprints_in_their_project_only(self):
        self.assertEqual(self.m1_api.post("/api/sprints/", {"project": self.p1.pk, "name": "S1"}, format="json").status_code, 201)
        self.assertEqual(self.m1_api.post("/api/sprints/", {"project": self.p2.pk, "name": "S2"}, format="json").status_code, 403)

    # ── users ─────────────────────────────────────────────────────────────
    def invite(self, api, **extra):
        return api.post("/api/auth/users/", {"name": "Nia Newhire", "email": f"nia{len(mail.outbox)}@example.com", **extra}, format="json")

    def test_admin_adds_any_type(self):
        r = self.invite(self.a_api, user_type="MANAGER")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["user_type"], "MANAGER")

    def test_manager_adds_members_to_their_own_team_only(self):
        r = self.invite(self.m1_api)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["user_type"], "MEMBER")
        self.assertEqual(r.data["reporting_manager"], self.m1.pk)  # defaults to themselves
        self.assertEqual(self.invite(self.m1_api, user_type="MANAGER").status_code, 403)
        self.assertEqual(self.invite(self.m1_api, user_type="ADMIN").status_code, 403)
        self.assertEqual(self.invite(self.m1_api, reporting_manager=self.m2.pk).status_code, 403)  # someone else's team
        self.assertEqual(self.invite(self.m1_api, reporting_manager=self.x.pk).status_code, 201)  # inside their team

    def test_member_cannot_add_users(self):
        self.assertEqual(self.invite(self.x_api).status_code, 403)

    def test_manager_edits_own_team_only(self):
        r = self.m1_api.patch(f"/api/auth/users/{self.x.pk}/", {"designation": "QA", "name": "Xavier Ex"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.m1_api.patch(f"/api/auth/users/{self.y.pk}/", {"designation": "QA"}, format="json").status_code, 403)
        self.assertEqual(self.m1_api.patch(f"/api/auth/users/{self.m2.pk}/", {"designation": "QA"}, format="json").status_code, 403)
        # cannot move a teammate under another manager's team
        r = self.m1_api.patch(f"/api/auth/users/{self.x.pk}/", {"reporting_manager": self.m2.pk}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_manager_cannot_toggle_active_or_change_type(self):
        r = self.m1_api.patch(f"/api/auth/users/{self.x.pk}/", {"is_deactivated": True}, format="json")
        self.assertEqual(r.status_code, 403)
        r = self.m1_api.patch(f"/api/auth/users/{self.x.pk}/", {"user_type": "ADMIN"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.x.refresh_from_db()
        self.assertTrue(self.x.is_active)
        self.assertEqual(self.x.user_type, "MEMBER")

    def test_admin_toggles_active_and_changes_type_but_keeps_one_admin(self):
        self.assertEqual(self.a_api.patch(f"/api/auth/users/{self.y.pk}/", {"is_deactivated": True}, format="json").status_code, 200)
        r = self.a_api.patch(f"/api/auth/users/{self.x.pk}/", {"user_type": "MANAGER"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user_type"], "MANAGER")
        # the only admin cannot be demoted
        r = self.a_api.patch(f"/api/auth/users/{self.admin.pk}/", {"user_type": "MEMBER"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_session_flags(self):
        flags = lambda api: {k: v for k, v in api.get("/api/auth/me/").data.items() if k.startswith("can_") or k == "user_type"}  # noqa: E731
        self.assertEqual(flags(self.a_api), {"user_type": "ADMIN", "can_manage_users": True, "can_toggle_users": True, "can_create_project": True, "can_delete_project": True})
        self.assertEqual(flags(self.m1_api), {"user_type": "MANAGER", "can_manage_users": True, "can_toggle_users": False, "can_create_project": True, "can_delete_project": False})
        self.assertEqual(flags(self.x_api), {"user_type": "MEMBER", "can_manage_users": False, "can_toggle_users": False, "can_create_project": False, "can_delete_project": False})

    def test_first_registration_becomes_admin_then_members(self):
        User.objects.all().delete()
        c = APIClient()
        for name, expected in (("firstone", "ADMIN"), ("secondone", "MEMBER")):
            r = c.post("/api/auth/register/", {"username": name, "email": f"{name}@example.com", "password": "Passw0rd!x"}, format="json")
            self.assertEqual(r.status_code, 201, r.content)
            self.assertEqual(User.objects.get(username=name).user_type, expected)
