"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ADSTERRA_UNITS } from "./config";

/**
 * Adsterra Native Banner (unit 31803282, SS11).
 *
 * Adsterra's native loader expects its container div to exist BEFORE the async
 * script runs, and it fills that div in place. React must own the container, so
 * the script is appended once after mount (never during render) and the div
 * keeps Adsterra's exact id. Reserved min-height prevents layout shift.
 *
 * Rendering is already gated server-side (`public-surface.ts`); this component
 * is only mounted when `surface.open && consentGranted && path allowed`. The
 * `data-ad-network-script` marker is what the Playwright safety tests key on.
 */

const UNIT = ADSTERRA_UNITS.native_banner;

export function AdsterraNativeBanner({ className }: { className?: string }) {
  const t = useTranslations("Ads");
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Idempotent under StrictMode double-mount: one script per container.
    if (host.querySelector(`script[src="${UNIT.scriptUrl}"]`)) return;

    const script = document.createElement("script");
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    script.src = UNIT.scriptUrl;
    script.setAttribute("data-ad-network-script", "adsterra-native");
    script.setAttribute("data-ad-unit-id", UNIT.unitId);
    host.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return (
    <aside
      data-testid="adsterra-native"
      data-ad-unit-id={UNIT.unitId}
      aria-label={t("slotLabel")}
      className={className ? `mx-auto w-full max-w-3xl ${className}` : "mx-auto w-full max-w-3xl"}
    >
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("slotLabel")}
      </p>
      {/* Adsterra fills this node; min-height reserves space before it loads. */}
      <div
        ref={hostRef}
        id={UNIT.containerId}
        data-testid="adsterra-native-container"
        className="min-h-[120px] w-full overflow-hidden rounded-lg border border-dashed bg-muted/30"
      />
    </aside>
  );
}
