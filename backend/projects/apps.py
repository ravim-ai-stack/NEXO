import os
import sys

from django.apps import AppConfig


class ProjectsConfig(AppConfig):
    name = 'projects'

    def ready(self):
        from django.conf import settings

        if not getattr(settings, "REMINDER_SCHEDULER", False):
            return
        argv = " ".join(sys.argv)
        # Never during tests / migrations / one-off commands.
        if any(cmd in argv for cmd in ("test", "migrate", "makemigrations", "shell", "collectstatic",
                                       "check", "createsuperuser", "send_due_reminders", "dbshell")):
            return
        # runserver's autoreloader runs two processes — only the child that serves requests starts it.
        if "runserver" in argv and os.environ.get("RUN_MAIN") != "true" and "--noreload" not in argv:
            return
        from . import scheduler
        scheduler.start()
