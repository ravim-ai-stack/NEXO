from django.db import migrations, models


def seed_user_types(apps, schema_editor):
    """
    Keep today's powers: staff/superusers and anyone who already administers a
    project become org ADMINs (so nobody is locked out). Everyone else is a MEMBER.
    Admins can then re-classify people from the Teams page.
    """
    User = apps.get_model("users", "User")
    ProjectMembership = apps.get_model("projects", "ProjectMembership")
    admin_ids = set(
        ProjectMembership.objects.filter(role="ADMIN").values_list("user_id", flat=True)
    )
    admin_ids |= set(User.objects.filter(models.Q(is_superuser=True) | models.Q(is_staff=True)).values_list("id", flat=True))
    User.objects.filter(id__in=admin_ids).update(user_type="ADMIN")


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0004_user_designation_manager_deactivated"),
        ("projects", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="user_type",
            field=models.CharField(
                choices=[("ADMIN", "Admin"), ("MANAGER", "Manager"), ("MEMBER", "Member")],
                default="MEMBER",
                max_length=10,
            ),
        ),
        migrations.RunPython(seed_user_types, migrations.RunPython.noop),
    ]
