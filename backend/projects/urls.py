from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AutomationRuleViewSet,
    CalendarEntryViewSet,
    ProjectDocViewSet,
    ProjectSignalViewSet,
    ProjectViewSet,
    SavedFilterViewSet,
    SprintViewSet,
    WorkflowStateViewSet,
    WorkflowTransitionViewSet,
    cron_reminders,
)

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("docs", ProjectDocViewSet, basename="doc")
router.register("signals", ProjectSignalViewSet, basename="signal")
router.register("automation-rules", AutomationRuleViewSet, basename="automation-rule")
router.register("sprints", SprintViewSet, basename="sprint")
router.register("workflow-states", WorkflowStateViewSet, basename="workflow-state")
router.register("workflow-transitions", WorkflowTransitionViewSet, basename="workflow-transition")
router.register("saved-filters", SavedFilterViewSet, basename="saved-filter")
router.register("calendar-entries", CalendarEntryViewSet, basename="calendar-entry")

urlpatterns = [path("cron/reminders/", cron_reminders, name="cron-reminders")] + router.urls
