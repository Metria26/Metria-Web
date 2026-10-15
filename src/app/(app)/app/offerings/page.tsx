import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/states/empty-state";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Offerings",
};

// Per-user, RLS-scoped data behind auth: this route is allowed to block
// (same rationale as the (app) layout's instant=false).
export const instant = false;

type OfferingRow = {
  id: string;
  offering_code: string;
  term_id: string;
  courses: { code: string; title: string } | null;
};

export default async function OfferingsPage() {
  // Per-user dynamic data behind auth — request-time only (blocking-prerender
  // current-time insight: supabase session math runs Date.now()).
  await connection();
  const t = await getTranslations("Offerings");
  const supabase = await createClient();

  // RLS scopes rows to the caller's tenant (member read) — no client-side filter.
  // terms is joined in JS: the doc schema has no course_offerings→terms FK, so
  // PostgREST cannot embed it.
  const [offeringsRes, termsRes] = await Promise.all([
    supabase
      .from("course_offerings")
      .select("id, offering_code, term_id, courses ( code, title )")
      .order("created_at", { ascending: false }),
    supabase.from("terms").select("id, name"),
  ]);

  const termsById = new Map(
    ((termsRes.data ?? []) as { id: string; name: string }[]).map((term) => [term.id, term.name]),
  );
  const offerings = ((offeringsRes.data ?? []) as unknown as OfferingRow[]).map((offering) => ({
    ...offering,
    termName: offering.term_id ? (termsById.get(offering.term_id) ?? null) : null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link
          href="/app/offerings/new"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="new-offering-link"
        >
          {t("newOffering")}
        </Link>
      </div>

      {offerings.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.body")}
          action={{ href: "/app/offerings/new", label: t("newOffering") }}
        />
      ) : (
        <ul className="grid gap-3" data-testid="offerings-list">
          {offerings.map((offering) => (
            <li key={offering.id}>
              <Link
                href={`/app/offerings/${offering.id}`}
                className="flex items-center justify-between rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                data-testid="offering-item"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">
                    {offering.courses
                      ? `${offering.courses.code} — ${offering.courses.title}`
                      : offering.offering_code}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {offering.offering_code}
                    {offering.termName ? ` · ${offering.termName}` : ""}
                  </span>
                </span>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
