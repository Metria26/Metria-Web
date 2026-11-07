"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Cookie } from "lucide-react";
import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  chosenCategories,
  hasCurrentConsent,
  serializeConsentState,
} from "../consent";

/**
 * Consent banner (T-B002): gates ad scripts by category through first-party
 * cookie state. Mounted by the layout that renders ad slots (T-B003 / public
 * pages); unmounted while the ads flags are off. Accept is the prominent
 * action; non-essential rejection is kept as a quiet secondary link.
 */

export type ConsentBannerProps = {
  policyVersion: string;
  /** Raw cookie value read on the server — avoids a hydration flicker. */
  initialConsentCookie?: string | null;
};

export function ConsentBanner({ policyVersion, initialConsentCookie = null }: ConsentBannerProps) {
  const t = useTranslations("Ads.consent");
  const router = useRouter();
  const [decided, setDecided] = useState(() =>
    hasCurrentConsent(initialConsentCookie, policyVersion),
  );

  if (decided) return null;

  const decide = (accept: boolean) => {
    const state = { policyVersion, categories: chosenCategories(accept) };
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
      serializeConsentState(state),
    )}; Path=/; Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
    setDecided(true);
    // The ad surface is resolved on the server from this cookie; refresh so an
    // accepted choice mounts ads immediately without requiring navigation.
    router.refresh();
  };

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-6"
    >
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border bg-background/95 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:gap-6 sm:p-8">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Cookie className="size-6" aria-hidden />
          </span>

          <div className="flex-1 space-y-2">
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{t("title")}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              {t("body")}
            </p>
            <Link
              href="/privacy"
              className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("privacyLink")}
            </Link>
          </div>

          <div className="shrink-0 sm:pt-1">
            <button
              type="button"
              onClick={() => decide(true)}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto"
              data-testid="consent-accept"
            >
              {t("accept")}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1 border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>{t("footnote")}</span>
          <button
            type="button"
            onClick={() => decide(false)}
            className="self-start text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground sm:self-auto"
            data-testid="consent-reject"
          >
            {t("reject")}
          </button>
        </div>
      </div>
    </div>
  );
}
