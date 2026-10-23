export function RolesAdminView({ data }: { data: Record<string, unknown>[] }) {
  return (
    <div className="space-y-6" data-testid="roles-admin-view">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Role Assignments</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage role assignments for users in the university. Assign or revoke TA, teacher, and
          student roles.
        </p>
        <div className="mt-4 space-y-2">
          {data.map((assignment) => {
            const a = assignment as {
              id: string;
              email: string;
              role_display_name: string;
              revoked_at: string | null;
            };
            return (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex-1">
                  <h3 className="font-medium">{a.email}</h3>
                  <p className="text-sm text-muted-foreground">
                    Role: <span className="font-medium text-blue-600">{a.role_display_name}</span>
                  </p>
                  {a.revoked_at && (
                    <p className="text-xs text-red-600">
                      Revoked at: {new Date(a.revoked_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {a.revoked_at && (
                    <button
                      className="inline-flex h-9 items-center rounded-lg bg-green-600 px-3 text-sm font-medium text-white transition-colors hover:bg-green-700 focus-visible:outline-2 focus-visible:outline-ring"
                      data-testid="assign-role-button"
                    >
                      Assign
                    </button>
                  )}
                  {!a.revoked_at && (
                    <button
                      className="inline-flex h-9 items-center rounded-lg border border-destructive/40 bg-background px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
                      data-testid="revoke-role-button"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
