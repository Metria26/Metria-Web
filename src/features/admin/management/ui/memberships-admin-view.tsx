export function MembershipsAdminView({ data }: { data: Record<string, unknown>[] }) {
  return (
    <div className="space-y-6" data-testid="memberships-admin-view">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Memberships</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          View and manage university memberships. Click on a member to see details and
          approve/reject their membership.
        </p>
        <div className="mt-4 space-y-2">
          {data.map((member) => {
            const m = member as { id: string; email: string; status: string };
            return (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex-1">
                  <h3 className="font-medium">{m.email}</h3>
                  <p className="text-sm text-muted-foreground">
                    Status:{" "}
                    <span
                      className={`font-medium ${m.status === "active" ? "text-green-600" : "text-yellow-600"}`}
                    >
                      {m.status}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  {m.status !== "active" && (
                    <button
                      className="inline-flex h-9 items-center rounded-lg bg-green-600 px-3 text-sm font-medium text-white transition-colors hover:bg-green-700 focus-visible:outline-2 focus-visible:outline-ring"
                      data-testid="approve-member-button"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    className="inline-flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-all hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    data-testid="view-member-details-button"
                  >
                    View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
