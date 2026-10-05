// Display name used anywhere a person is shown. Deactivated users keep appearing
// (on old issues, comments, assignments...) but are clearly marked as inactive.
export function userLabel(user) {
  if (!user) return "";
  const name = user.username || "";
  return user.is_deactivated ? `${name} (Inactive)` : name;
}
