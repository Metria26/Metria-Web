import { connection } from "next/server";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarCheck,
  ChartColumn,
  Check,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicFooter, PublicHeader } from "@/components/public/public-shell";
import { CONSENT_COOKIE, policyVersionFromEnv } from "@/features/ads/consent";
import { loadPublicAdSurface } from "@/features/ads/public-surface";
import {
  publicPopunderAllowed,
  publicSurfaceAllows,
  publicUnitAllowed,
} from "@/features/ads/public-surface-rules";
import { ConsentBanner } from "@/features/ads/ui/consent-banner";
import { isHilltopVastPathAllowed } from "@/features/ads/hilltop/config";
import { HilltopVastPlayer } from "@/features/ads/hilltop/vast-player";
import { AdsterraPopunder } from "@/features/ads/adsterra/popunder";
import { AdsterraSocialBar } from "@/features/ads/adsterra/social-bar";
import { isAdsterraPathAllowed } from "@/features/ads/adsterra/config";

/**
 * Public landing page (SS11). Ads are opt-in: every unit mounts only when the
 * public surface is open (master flag + no kill + public layer + adsterra
 * network enabled), the visitor consented, and the unit's reviewed path
 * allowlist matches. The HilltopAds video unit replaces the Adsterra native
 * banner here; the Social Bar and the popunder (which also needs its own
 * `ads.popunder.enabled` switch, ADR-013) are unchanged. With the shipped
 * defaults (`ads.enabled=false`, `ads.global_kill=true`) the page renders zero
 * ad markup.
 *
 * `connection()` keeps this route request-time: the tenant lookup uses the
 * service role and must never run during `next build`. `instant = false`
 * documents that the dynamic ad/consent shell blocks navigation (Next 16
 * cacheComponents).
 */
export const instant = false;

export default async function Home() {
  await connection();
  const t = await getTranslations("Home");
  const surface = await loadPublicAdSurface();
  const cookieStore = await cookies();
  const initialConsentCookie = cookieStore.get(CONSENT_COOKIE)?.value ?? null;

  const showVast = publicSurfaceAllows(surface, "/", isHilltopVastPathAllowed);
  const showSocialBar = publicUnitAllowed(surface, "/", (path) =>
    isAdsterraPathAllowed("social_bar", path),
  );
  const showPopunder = publicPopunderAllowed(surface, "/", (path) =>
    isAdsterraPathAllowed("popunder", path),
  );
  // Shown before consent too: warning visitors about the background tabs up
  // front is friendlier than surprising them after they accept.
  const showPopunderNotice = surface.open && surface.popunderEnabled;

  const features = [
    { icon: ClipboardList, title: t("featureMarksTitle"), body: t("featureMarks") },
    { icon: CalendarCheck, title: t("featureBookingTitle"), body: t("featureBooking") },
    { icon: Bell, title: t("featureAnnouncementsTitle"), body: t("featureAnnouncements") },
    { icon: ChartColumn, title: t("featureAnalyticsTitle"), body: t("featureAnalytics") },
  ];

  const steps = [
    { title: t("stepOneTitle"), body: t("stepOneBody") },
    { title: t("stepTwoTitle"), body: t("stepTwoBody") },
    { title: t("stepThreeTitle"), body: t("stepThreeBody") },
  ];

  const audiences = [
    { icon: GraduationCap, title: t("audienceStudent"), body: t("audienceStudentBody") },
    { icon: Users, title: t("audienceTa"), body: t("audienceTaBody") },
    { icon: BookOpen, title: t("audienceStaff"), body: t("audienceStaffBody") },
  ];

  const strip = [t("stripOne"), t("stripTwo"), t("stripThree"), t("stripFour")];
  const trustPoints = [t("trustPointOne"), t("trustPointTwo"), t("trustPointThree")];

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="flex flex-1 flex-col">
        <section className="relative isolate overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-accent/60 via-background to-background"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 right-0 -z-10 size-72 rounded-full bg-primary/15 blur-3xl md:size-96"
          />

          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-24">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                {t("heroBadge")}
              </span>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                {t("heroTitle")}
              </h1>
              <p className="mt-5 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
                {t("heroBody")}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {/* Plain anchor: /app may redirect to /auth, so start a fresh document. */}
                <Button
                  render={<a href="/app" />}
                  nativeButton={false}
                  size="lg"
                  className="h-11 px-6 text-base"
                >
                  {t("ctaOpenApp")}
                  <ArrowRight aria-hidden />
                </Button>
                <Button
                  render={<a href="#features" />}
                  nativeButton={false}
                  size="lg"
                  variant="outline"
                  className="h-11 px-6 text-base"
                >
                  {t("ctaExplore")}
                </Button>
              </div>
              <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="size-4 shrink-0 text-primary" aria-hidden />
                {t("heroNote")}
              </p>

              {showPopunderNotice ? (
                <div className="mt-8 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
                  <div className="flex items-start gap-3.5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
                      <Lightbulb className="size-5" aria-hidden />
                    </span>
                    <div className="space-y-2.5">
                      <h2 className="text-base font-semibold tracking-tight sm:text-lg">
                        {t("adsNoteTitle")}
                      </h2>
                      <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
                        {t("adsNoteBody")}
                      </p>
                      <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                        {t("adsNoteTipBefore")}{" "}
                        <kbd className="rounded border bg-background px-2 py-0.5 font-mono text-xs font-semibold sm:text-sm">
                          Ctrl
                        </kbd>
                        {" + "}
                        <kbd className="rounded border bg-background px-2 py-0.5 font-mono text-xs font-semibold sm:text-sm">
                          W
                        </kbd>{" "}
                        {t("adsNoteTipAfter")}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div aria-hidden className="relative mx-auto w-full max-w-md lg:max-w-none">
              <div className="absolute -inset-3 rounded-3xl bg-primary/10 blur-2xl" />
              <div className="relative rounded-2xl border bg-card p-4 shadow-xl sm:p-5">
                <div className="flex items-center justify-between border-b pb-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <LayoutDashboard className="size-4 text-primary" />
                    {t("previewTitle")}
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {t("previewSubtitle")}
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{t("previewMarksLabel")}</span>
                      <span>{t("previewMarksCaption")}</span>
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <p className="text-sm font-medium">{t("previewMarksCourse")}</p>
                      <p className="text-xl font-semibold text-primary">{t("previewMarksValue")}</p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-[90%] rounded-full bg-primary" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border bg-background/60 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarCheck className="size-3.5 text-primary" />
                        {t("previewBookingLabel")}
                      </div>
                      <p className="mt-2 text-sm font-medium">{t("previewBookingCourse")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("previewBookingValue")}
                      </p>
                      <p className="text-xs text-muted-foreground">{t("previewBookingCaption")}</p>
                    </div>
                    <div className="rounded-xl border bg-background/60 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Megaphone className="size-3.5 text-primary" />
                        {t("previewAnnouncementLabel")}
                      </div>
                      <p className="mt-2 text-sm leading-snug">{t("previewAnnouncementBody")}</p>
                    </div>
                  </div>
                </div>

                <p className="mt-4 border-t pt-3 text-center text-xs text-muted-foreground">
                  {t("previewFooter")}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y bg-muted/30">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-3 px-4 py-5 text-sm sm:px-6 lg:grid-cols-4">
            {strip.map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Check className="size-3" aria-hidden />
                </span>
                <span className="text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section
          id="features"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24"
        >
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">{t("featuresEyebrow")}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {t("featuresTitle")}
            </h2>
            <p className="mt-3 text-pretty text-muted-foreground">{t("featuresBody")}</p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-semibold tracking-tight">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {feature.body}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-y bg-muted/30">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16 lg:py-24">
            <div>
              <p className="text-sm font-medium text-primary">{t("stepsEyebrow")}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {t("stepsTitle")}
              </h2>
              <p className="mt-3 text-pretty text-muted-foreground">{t("stepsBody")}</p>
            </div>

            <ol className="space-y-6">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold tracking-tight">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium text-primary">{t("audienceEyebrow")}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {t("audienceTitle")}
            </h2>
            <p className="mt-3 text-pretty text-muted-foreground">{t("audienceBody")}</p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {audiences.map((audience) => {
              const Icon = audience.icon;
              return (
                <div key={audience.title} className="rounded-2xl border bg-card p-6 shadow-sm">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-semibold tracking-tight">{audience.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {audience.body}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:pb-24">
          <div className="overflow-hidden rounded-3xl border bg-linear-to-br from-primary/10 via-card to-card px-6 py-8 shadow-sm sm:px-10 sm:py-12">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-16">
              <div>
                <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ShieldCheck className="size-5" aria-hidden />
                </span>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                  {t("trustTitle")}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {t("trustBody")}
                </p>
              </div>
              <ul className="space-y-3">
                {trustPoints.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-3 rounded-xl border bg-background/70 px-4 py-3 text-sm"
                  >
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {showVast ? (
          <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
            <HilltopVastPlayer policyVersion={policyVersionFromEnv()} />
          </div>
        ) : null}

        <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:pb-24">
          <div className="rounded-3xl border bg-linear-to-br from-accent/60 via-card to-card px-6 py-10 text-center shadow-sm sm:px-10 sm:py-14">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {t("finalTitle")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground">
              {t("finalBody")}
            </p>
            <div className="mt-7 flex justify-center">
              <Button
                render={<a href="/app" />}
                nativeButton={false}
                size="lg"
                className="h-11 px-6 text-base"
              >
                {t("finalCta")}
                <ArrowRight aria-hidden />
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{t("finalNote")}</p>
          </div>
        </section>
      </main>
      <PublicFooter />
      {surface.open ? (
        <ConsentBanner
          policyVersion={policyVersionFromEnv()}
          initialConsentCookie={initialConsentCookie}
        />
      ) : null}
      {showSocialBar ? <AdsterraSocialBar /> : null}
      {showPopunder ? <AdsterraPopunder /> : null}
    </div>
  );
}
