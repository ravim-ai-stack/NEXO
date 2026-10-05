from django.core.management.base import BaseCommand

from projects.reminders import process_due


class Command(BaseCommand):
    help = "Send the 'it is today' notification for every calendar entry whose time has come."

    def handle(self, *args, **options):
        self.stdout.write(f"Sent reminders for {process_due()} calendar entr(y/ies).")
