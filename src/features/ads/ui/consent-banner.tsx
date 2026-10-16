"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  chosenCategories,
  hasCurrentConsent,
  serializeConsentState,
} from "../consent";

/**
 * Minimal consent banner (T-B002): gates ad scripts by category through
 * first-party cookie state. Mounted by the layout that renders ad slots
 * (T-B003 / public pages); unmounted while the ads flags are off. Granular
 * per-category toggles land with the privacy page.
 */

export type ConsentBannerProps = {
  policyVersion: string;
  /** Raw cookie value read on the server — avoids a hydration flicker. */
  initialConsentCookie?: string | null;
};

export function ConsentBanner({ policyVersion, initialConsentCookie = null }: ConsentBannerProps) {
  const t = useTranslations("Ads.consent");
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
  };

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1 text-sm">
          <p className="font-medium">{t("title")}</p>
          <p className="text-muted-foreground">{t("body")}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide(false)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            data-testid="consent-reject"
          >
            {t("reject")}
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
            data-testid="consent-accept"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
