from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from users.models import Notification
from .models import Project, ProjectMembership

User = get_user_model()


class ProjectMemberInviteEmailTests(TestCase):
    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_add_member_sends_invite_email(self):
        admin = User.objects.create_user(username='admin', email='admin@example.com', password='StrongPass!1', user_type='ADMIN')
        target_user = User.objects.create_user(username='member', email='member@example.com', password='StrongPass!2')
        project = Project.objects.create(name='Website', key='WEB', created_by=admin)
        ProjectMembership.objects.create(project=project, user=admin, role=ProjectMembership.Role.ADMIN)

        client = APIClient()
        client.force_authenticate(user=admin)

        response = client.post(
            f'/api/projects/{project.id}/add_member/',
            {'email': target_user.email, 'role': ProjectMembership.Role.MEMBER},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(target_user.email, mail.outbox[0].to)
        self.assertIn('Website', mail.outbox[0].subject)

        notification = Notification.objects.filter(recipient=target_user, actor=admin).first()
        self.assertIsNotNone(notification)
        self.assertIn('project Website', notification.action)
