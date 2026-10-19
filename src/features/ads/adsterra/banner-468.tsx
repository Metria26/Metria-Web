"use client";

import { useTranslations } from "next-intl";
import { ADSTERRA_UNITS, buildBanner468SrcDoc } from "./config";

/**
 * Adsterra Banner 468x60 (unit 31803284, SS11).
 *
 * This unit uses `document.write`, which browsers ignore when a script is
 * injected into an already-parsed document — the standard fix is a `srcDoc`
 * iframe (task §4.1). The iframe is sandboxed, referrer-less and fixed to
 * 468x60 so it reserves its own geometry (no CLS). `max-width: 100%` keeps the
 * 360px viewport free of horizontal scroll.
 */

const UNIT = ADSTERRA_UNITS.banner_468;
const SRC_DOC = buildBanner468SrcDoc();

export function AdsterraBanner468({ className }: { className?: string }) {
  const t = useTranslations("Ads");

  return (
    <aside
      data-testid="adsterra-banner-468"
      data-ad-unit-id={UNIT.unitId}
      aria-label={t("slotLabel")}
      className={className ? `mx-auto ${className}` : "mx-auto"}
    >
      <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("slotLabel")}
      </p>
      <div
        className="mx-auto overflow-hidden rounded-md border border-dashed bg-muted/30"
        style={{ width: UNIT.width, height: UNIT.height, maxWidth: "100%" }}
      >
        <iframe
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
          className="block h-full w-full border-0"
          style={{ maxWidth: "100%" }}
        />
      </div>
    </aside>
  );
}
