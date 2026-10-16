"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";

export type DistributionDatum = { bucket: string; count: number };

/**
 * Isolated so recharts is code-split behind a dynamic import (D7: charts must
 * never be on a public critical path). Receives already-suppressed data — it
 * renders counts, never identities.
 */
export default function AnalyticsChart({ data }: { data: DistributionDatum[] }) {
  return (
    <div className="h-40 w-full" data-testid="analytics-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" fontSize={12} tickLine={false} />
          <YAxis fontSize={12} allowDecimals={false} tickLine={false} />
          <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
