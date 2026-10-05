from datetime import datetime, time, timedelta

from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from projects.models import CalendarEntry, Project, ProjectMembership
from projects.reminders import due_at, local_today, process_due, reminder_tz
from users.models import Notification, User

LOCMEM = override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")


def api_as(user):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.get_or_create(user=user)[0].key}")
    return c


def at(day, hh, mm=0):
    return datetime.combine(day, time(hh, mm), tzinfo=reminder_tz())


@LOCMEM
class CalendarEntryTests(TestCase):
    def setUp(self):
        mk = lambda name, utype="MEMBER": User.objects.create_user(  # noqa: E731
            name, f"{name}@example.com", "Passw0rd!x", user_type=utype
        )
        self.owner, self.ann, self.bea = mk("owner", "MANAGER"), mk("ann"), mk("bea")
        self.viewer, self.outsider = mk("viewer"), mk("outsider")
        self.project = Project.objects.create(name="Proj", key="PRJ", created_by=self.owner)
        for u, role in ((self.owner, "ADMIN"), (self.ann, "MEMBER"), (self.bea, "MEMBER"), (self.viewer, "VIEWER")):
            ProjectMembership.objects.create(project=self.project, user=u, role=role)
        self.today = local_today()
        self.api = api_as(self.owner)

    def add(self, api=None, **extra):
        body = {"project": self.project.pk, "kind": "REMINDER", "title": "Send report", "date": str(self.today), **extra}
        return (api or self.api).post("/api/calendar-entries/", body, format="json")

    # ── who can add ──────────────────────────────────────────────────────
    def test_every_account_type_can_add_but_not_viewers_or_outsiders(self):
        self.assertEqual(self.add().status_code, 201)  # manager
        self.assertEqual(self.add(api_as(self.ann)).status_code, 201)  # plain member: calendar is open to all
        self.assertEqual(self.add(api_as(self.viewer)).status_code, 403)
        self.assertIn(self.add(api_as(self.outsider)).status_code, (400, 403))

    def test_past_dates_are_refused(self):
        self.assertEqual(self.add(date=str(self.today - timedelta(days=1))).status_code, 400)

    # ── "the day of assigned" ────────────────────────────────────────────
    def test_assignees_and_mentions_are_told_straight_away(self):
        r = self.add(title="Review with @bea", participant_ids=[self.ann.pk], date=str(self.today + timedelta(days=3)))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(sorted(p["username"] for p in r.data["participants"]), ["ann", "bea"])
        self.assertEqual(sorted(Notification.objects.values_list("recipient__username", flat=True)), ["ann", "bea"])
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["ann@example.com", "bea@example.com"])
        self.assertIn("added you to", Notification.objects.first().action)

    def test_the_creator_is_never_notified_about_their_own_entry(self):
        self.add(title="note to self @owner", date=str(self.today + timedelta(days=1)))
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_only_project_members_can_be_picked_or_mentioned(self):
        r = self.add(participant_ids=[self.outsider.pk])
        self.assertEqual(r.status_code, 400)  # picking someone outside the project is refused
        r = self.add(title="cc @outsider and @ann", date=str(self.today + timedelta(days=1)))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual([p["username"] for p in r.data["participants"]], ["ann"])  # the outsider mention is ignored
        self.assertEqual([m.to[0] for m in mail.outbox], ["ann@example.com"])
        self.assertIn("/board?tab=calendar", mail.outbox[0].body)

    # ── "the day of the task" ────────────────────────────────────────────
    def test_due_notifications_go_to_creator_and_everyone_involved_exactly_once(self):
        self.add(participant_ids=[self.ann.pk], time="09:30")
        mail.outbox.clear()
        Notification.objects.all().delete()

        self.assertEqual(process_due(now=at(self.today, 9, 0)), 0)  # not yet
        self.assertEqual(len(mail.outbox), 0)

        self.assertEqual(process_due(now=at(self.today, 9, 31)), 1)  # now
        self.assertEqual(sorted(Notification.objects.values_list("recipient__username", flat=True)), ["ann", "owner"])
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["ann@example.com", "owner@example.com"])
        self.assertIn("today", mail.outbox[0].subject)

        self.assertEqual(process_due(now=at(self.today, 18, 0)), 0)  # never twice
        self.assertEqual(len(mail.outbox), 2)

    def test_untimed_entry_goes_out_at_the_default_hour(self):
        self.add()
        self.assertEqual(process_due(now=at(self.today, 8, 59)), 0)
        self.assertEqual(process_due(now=at(self.today, 9, 0)), 1)

    def test_future_entries_wait_for_their_day(self):
        self.add(date=str(self.today + timedelta(days=2)))
        self.assertEqual(process_due(now=at(self.today, 23, 59)), 0)
        self.assertEqual(process_due(now=at(self.today + timedelta(days=2), 9, 5)), 1)

    def test_missed_entries_are_caught_up_but_not_ancient_ones(self):
        recent = CalendarEntry.objects.create(project=self.project, created_by=self.owner, title="r", date=self.today - timedelta(days=1))
        old = CalendarEntry.objects.create(project=self.project, created_by=self.owner, title="o", date=self.today - timedelta(days=5))
        process_due(now=at(self.today, 12))
        recent.refresh_from_db()
        old.refresh_from_db()
        self.assertIsNotNone(recent.due_notified_at)
        self.assertIsNone(old.due_notified_at)

    def test_rescheduling_rearms_the_reminder(self):
        entry_id = self.add().data["id"]
        process_due(now=at(self.today, 10))
        later = self.today + timedelta(days=4)
        r = self.api.patch(f"/api/calendar-entries/{entry_id}/", {"date": str(later), "time": "08:00"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        entry = CalendarEntry.objects.get(pk=entry_id)
        self.assertIsNone(entry.due_notified_at)
        self.assertEqual(due_at(entry), at(later, 8))
        mail.outbox.clear()
        self.assertEqual(process_due(now=at(later, 8, 1)), 1)

    def test_adding_someone_while_editing_notifies_only_the_new_person(self):
        entry_id = self.add(participant_ids=[self.ann.pk], date=str(self.today + timedelta(days=1))).data["id"]
        mail.outbox.clear()
        self.api.patch(f"/api/calendar-entries/{entry_id}/", {"description": "cc @bea"}, format="json")
        self.assertEqual([m.to[0] for m in mail.outbox], ["bea@example.com"])
        self.assertEqual(sorted(CalendarEntry.objects.get(pk=entry_id).participants.values_list("username", flat=True)), ["ann", "bea"])

    # ── edit / delete ────────────────────────────────────────────────────
    def test_only_the_creator_or_a_project_admin_can_change_or_delete(self):
        entry_id = self.add(api_as(self.ann)).data["id"]
        url = f"/api/calendar-entries/{entry_id}/"
        self.assertEqual(api_as(self.bea).patch(url, {"title": "x"}, format="json").status_code, 403)
        self.assertEqual(api_as(self.bea).delete(url).status_code, 403)
        self.assertEqual(self.api.patch(url, {"title": "by admin"}, format="json").status_code, 200)  # project admin
        self.assertEqual(api_as(self.ann).delete(url).status_code, 204)

    def test_entries_of_other_projects_are_invisible(self):
        self.add()
        self.assertEqual(len(api_as(self.outsider).get("/api/calendar-entries/").data), 0)

    # ── cron endpoint ────────────────────────────────────────────────────
    @override_settings(CRON_SECRET="s3cret")
    def test_cron_endpoint_needs_the_secret(self):
        self.add(time="00:00")
        c = APIClient()
        self.assertEqual(c.get("/api/cron/reminders/").status_code, 403)
        self.assertEqual(c.get("/api/cron/reminders/?secret=nope").status_code, 403)
        r = c.get("/api/cron/reminders/", HTTP_AUTHORIZATION="Bearer s3cret")
        self.assertEqual(r.status_code, 200)

    @override_settings(CRON_SECRET="")
    def test_cron_endpoint_is_off_without_a_configured_secret(self):
        self.assertEqual(APIClient().get("/api/cron/reminders/?secret=").status_code, 403)
