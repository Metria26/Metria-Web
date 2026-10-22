"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ADSTERRA_UNITS, BANNER_468_MESSAGE_SOURCE, buildBanner468SrcDoc } from "./config";

/**
 * Adsterra Banner 468x60 (unit 31803284, SS11).
 *
 * This unit uses `document.write`, which browsers ignore when a script is
 * injected into an already-parsed document — the standard fix is a `srcDoc`
 * iframe (task §4.1). The iframe is sandboxed, referrer-less and fixed to
 * 468x60 so it reserves its own geometry (no CLS). `max-width: 100%` keeps the
 * 360px viewport free of horizontal scroll.
 *
 * Adsterra leaves the iframe blank when it has no fill or the request is
 * blocked. The watchdog inside the srcdoc posts `filled`/`empty`; on `empty`
 * the whole slot (label included) unmounts instead of leaving an empty box.
 */

const UNIT = ADSTERRA_UNITS.banner_468;
const SRC_DOC = buildBanner468SrcDoc();

type FillState = "loading" | "filled" | "empty";

function isBannerMessage(value: unknown): value is { source: string; status: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.source === BANNER_468_MESSAGE_SOURCE &&
    (record.status === "filled" || record.status === "empty")
  );
}

export function AdsterraBanner468({ className }: { className?: string }) {
  const t = useTranslations("Ads");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [state, setState] = useState<FillState>("loading");

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only trust messages from our own frame, not any other window on the page.
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isBannerMessage(event.data)) return;
      setState(event.data.status as FillState);
    };

    window.addEventListener("message", onMessage);

    // Parent-side safety net in case the srcdoc script itself never runs
    // (CSP, blocked frame, ancient browser) — still collapse the empty box.
    const fallback = window.setTimeout(() => {
      setState((current) => (current === "loading" ? "empty" : current));
    }, 12000);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(fallback);
    };
  }, []);

  if (state === "empty") return null;

  return (
    <aside
      data-testid="adsterra-banner-468"
      data-state={state}
      data-ad-unit-id={UNIT.unitId}
      aria-label={t("slotLabel")}
      className={className ? `mx-auto ${className}` : "mx-auto"}
    >
      <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("slotLabel")}
      </p>
      <div
        className="mx-auto overflow-hidden rounded-md border border-dashed border-muted-foreground/30 bg-transparent"
        style={{ width: UNIT.width, height: UNIT.height, maxWidth: "100%" }}
      >
        <iframe
          ref={frameRef}
          title={t("slotLabel")}
          srcDoc={SRC_DOC}
          width={UNIT.width}
          height={UNIT.height}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          scrolling="no"
          data-ad-network-frame="adsterra-banner-468"
          data-ad-unit-id={UNIT.unitId}
          className="block h-full w-full border-0 bg-transparent"
          style={{ maxWidth: "100%", background: "transparent" }}
        />
      </div>
    </aside>
  );
}
