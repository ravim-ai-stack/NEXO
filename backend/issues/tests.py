from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from issues.models import Issue
from projects.models import Project, ProjectMembership
from users.models import Notification, User

LOCMEM = override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")


@LOCMEM
class IssueCreateAndNotifyTests(TestCase):
    def setUp(self):
        mk = lambda name, utype="MEMBER": User.objects.create_user(  # noqa: E731
            name, f"{name}@example.com", "Passw0rd!x", user_type=utype
        )
        self.maker = mk("maker", "MANAGER")
        self.alice = mk("alice")
        self.bob = mk("bob")
        self.rita = mk("rita")
        self.outsider = mk("outsider")
        self.project = Project.objects.create(name="Proj", key="PRJ", created_by=self.maker)
        for u in (self.maker, self.alice, self.bob, self.rita):
            ProjectMembership.objects.create(project=self.project, user=u, role="MEMBER")
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=self.maker).key}")

    def create(self, **extra):
        body = {"project": self.project.pk, "title": "Fix the login page", **extra}
        return self.api.post("/api/issues/", body, format="json")

    def test_create_with_every_field_in_one_request(self):
        r = self.create(
            issue_type="BUG", priority="HIGH", status="IN_PROGRESS", resolution="Unresolved",
            assignee_id=self.alice.pk, reporter_id=self.rita.pk, due_date="2026-12-31",
        )
        self.assertEqual(r.status_code, 201, r.content)
        issue = Issue.objects.get(pk=r.data["id"])
        self.assertEqual(
            (issue.issue_type, issue.priority, issue.status, issue.resolution, str(issue.due_date)),
            ("BUG", "HIGH", "IN_PROGRESS", "Unresolved", "2026-12-31"),
        )
        self.assertEqual(issue.assignee, self.alice)
        self.assertEqual(issue.reporter, self.rita)  # chosen reporter, not the creator
        self.assertIsNotNone(r.data["created_at"])  # "created" is filled in automatically

    def test_reporter_defaults_to_creator_and_must_be_a_member(self):
        self.assertEqual(Issue.objects.get(pk=self.create().data["id"]).reporter, self.maker)
        r = self.create(reporter_id=self.outsider.pk)
        self.assertEqual(r.status_code, 400)

    def test_assignment_sends_notification_and_email(self):
        r = self.create(assignee_id=self.alice.pk)
        self.assertEqual(r.status_code, 201, r.content)
        note = Notification.objects.get(recipient=self.alice)
        self.assertIn("assigned you to", note.action)
        self.assertEqual(note.actor, self.maker)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])
        self.assertIn("assigned you", mail.outbox[0].subject)

    def test_assigning_to_yourself_does_not_notify(self):
        self.create(assignee_id=self.maker.pk)
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_mention_in_summary_notifies_and_emails_the_mentioned_user(self):
        r = self.create(title="Please review @bob and @outsider and @maker")
        self.assertEqual(r.status_code, 201, r.content)
        # bob: member -> notified. outsider: not in the project -> not. maker: wrote it -> not.
        self.assertEqual(list(Notification.objects.values_list("recipient__username", flat=True)), ["bob"])
        note = Notification.objects.get()
        self.assertIn("mentioned you in", note.action)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["bob@example.com"])
        self.assertIn("mentioned you", mail.outbox[0].subject)
        self.assertIn("@bob", mail.outbox[0].alternatives[0][0])  # the text is quoted in the email

    def test_assignee_who_is_also_mentioned_gets_one_email(self):
        self.create(title="@alice please take this", assignee_id=self.alice.pk)
        self.assertEqual(Notification.objects.filter(recipient=self.alice).count(), 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_mention_in_description(self):
        self.create(description="cc @rita")
        self.assertEqual(Notification.objects.get().recipient, self.rita)

    def test_editing_summary_notifies_only_new_mentions(self):
        issue_id = self.create(title="Look @bob").data["id"]
        mail.outbox.clear()
        Notification.objects.all().delete()
        r = self.api.patch(f"/api/issues/{issue_id}/", {"title": "Look @bob and @rita"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(list(Notification.objects.values_list("recipient__username", flat=True)), ["rita"])
        self.assertEqual([m.to for m in mail.outbox], [["rita@example.com"]])

    def test_reporter_cannot_be_changed_after_creation(self):
        issue_id = self.create().data["id"]
        self.api.patch(f"/api/issues/{issue_id}/", {"reporter_id": self.rita.pk}, format="json")
        self.assertEqual(Issue.objects.get(pk=issue_id).reporter, self.maker)

    def test_mention_markup_is_escaped_in_the_email(self):
        self.create(title="@bob <script>alert(1)</script>")
        html = mail.outbox[0].alternatives[0][0]
        self.assertNotIn("<script>alert(1)</script>", html)


@LOCMEM
class IssueListFilterTests(TestCase):
    """The Tasks page filters across every project the user can see."""

    def setUp(self):
        mk = lambda name, utype="MEMBER": User.objects.create_user(  # noqa: E731
            name, f"{name}@example.com", "Passw0rd!x", user_type=utype
        )
        self.me, self.ann, self.bob = mk("me", "MANAGER"), mk("ann"), mk("bob")
        self.p1 = Project.objects.create(name="Alpha", key="ALP", created_by=self.me)
        self.p2 = Project.objects.create(name="Beta", key="BET", created_by=self.me)
        self.hidden = Project.objects.create(name="Hidden", key="HID", created_by=self.ann)
        for p in (self.p1, self.p2):
            for u in (self.me, self.ann, self.bob):
                ProjectMembership.objects.create(project=p, user=u, role="MEMBER")
        ProjectMembership.objects.create(project=self.hidden, user=self.ann, role="MEMBER")
        mkissue = lambda **kw: Issue.objects.create(reporter=kw.pop("reporter", self.me), **kw)  # noqa: E731
        self.a = mkissue(project=self.p1, title="Fix login", status="TODO", priority="HIGH", assignee=self.ann)
        self.b = mkissue(project=self.p1, title="Write docs", status="IN_PROGRESS", assignee=self.bob, reporter=self.ann)
        self.c = mkissue(project=self.p2, title="Fix payment", status="DONE", priority="HIGH")
        self.d = mkissue(project=self.p2, title="Plan sprint", status="TODO", assignee=self.ann)
        mkissue(project=self.hidden, title="Secret", status="TODO")
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=self.me).key}")

    def ids(self, query=""):
        r = self.api.get(f"/api/issues/?{query}")
        self.assertEqual(r.status_code, 200)
        return sorted(i["id"] for i in r.data)

    def test_rows_carry_project_name_and_key(self):
        row = next(i for i in self.api.get("/api/issues/").data if i["id"] == self.a.pk)
        self.assertEqual((row["project_key"], row["project_name"]), ("ALP", "Alpha"))

    def test_only_visible_projects(self):
        self.assertEqual(self.ids(), sorted([self.a.pk, self.b.pk, self.c.pk, self.d.pk]))

    def test_multiple_statuses(self):
        self.assertEqual(self.ids("status=TODO,IN_PROGRESS"), sorted([self.a.pk, self.b.pk, self.d.pk]))
        self.assertEqual(self.ids("status=DONE"), [self.c.pk])

    def test_filters_combine(self):
        self.assertEqual(self.ids(f"status=TODO&assignee={self.ann.pk}"), sorted([self.a.pk, self.d.pk]))
        self.assertEqual(self.ids(f"status=TODO&assignee={self.ann.pk}&project={self.p2.pk}"), [self.d.pk])
        self.assertEqual(self.ids("priority=HIGH&status=TODO,IN_PROGRESS"), [self.a.pk])
        self.assertEqual(self.ids(f"reporter={self.ann.pk}"), [self.b.pk])

    def test_unassigned_and_search_and_multiple_values(self):
        self.assertEqual(self.ids("assignee=none"), [self.c.pk])
        self.assertEqual(self.ids(f"assignee=none,{self.bob.pk}"), sorted([self.b.pk, self.c.pk]))
        self.assertEqual(self.ids("q=fix"), sorted([self.a.pk, self.c.pk]))
        self.assertEqual(self.ids("q=fix&status=TODO"), [self.a.pk])
        self.assertEqual(self.ids(f"project={self.p1.pk},{self.p2.pk}&q=plan"), [self.d.pk])

    def test_cannot_filter_into_a_hidden_project(self):
        self.assertEqual(self.ids(f"project={self.hidden.pk}"), [])
