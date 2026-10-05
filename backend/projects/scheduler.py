"""
A tiny background loop that checks for due calendar reminders every minute.
Fine for a normal server (runserver / gunicorn). On serverless hosting there is no long-lived
process, so call GET /api/cron/reminders/ (or `manage.py send_due_reminders`) on a schedule instead.
"""
import threading
import time

_started = False
_lock = threading.Lock()


def _loop(interval):
    from django.db import close_old_connections

    from .reminders import process_due

    while True:
        try:
            process_due()
        except Exception as e:  # noqa: BLE001 — keep the loop alive no matter what
            print(f"[Reminder scheduler error]: {e}")
        finally:
            close_old_connections()
        time.sleep(interval)


def start(interval=60):
    global _started
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, args=(interval,), name="nexo-reminders", daemon=True).start()
