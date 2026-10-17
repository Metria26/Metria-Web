"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Tap-to-reveal for sensitive values (T-B003, R1 + design-system "sensitive
 * mark values may be hidden until user taps reveal"). `active` comes from the
 * server resolver: it is true only while the ad surface for this page is
 * actually open (flags on, no kill, page type enabled). With ads dark the
 * component renders children directly — zero DOM change for existing pages and
 * tests. When active, children are NOT in the document until the user reveals
 * them, so third-party code (if any is ever mounted) cannot read marks from
 * the hidden state. Toggle button exposes aria-expanded + aria-controls.
 */

export type TapToRevealProps = {
  active: boolean;
  /** Layout of the active wrapper — pass the surrounding flex/grid gap so
   * revealing values does not reflow the page sections. */
  className?: string;
  children: React.ReactNode;
};

export function TapToReveal({ active, className, children }: TapToRevealProps) {
  const t = useTranslations("Ads.reveal");
  const [revealed, setRevealed] = useState(false);

  if (!active) return <>{children}</>;

  return (
    <div
      className={className ?? "grid gap-4"}
      data-testid="sensitive-gate"
      data-state={revealed ? "revealed" : "hidden"}
    >
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        aria-expanded={revealed}
        aria-controls="sensitive-values"
        data-testid="reveal-button"
        className="self-start justify-self-start rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        {revealed ? t("hide") : t("reveal")}
      </button>
      <div
        id="sensitive-values"
        data-testid="sensitive-values"
        data-state={revealed ? "visible" : "hidden"}
      >
        {revealed ? (
          children
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="sensitive-placeholder">
            {t("hiddenNote")}
          </p>
        )}
      </div>
    </div>
  );
}
