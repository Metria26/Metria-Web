"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ADSTERRA_UNITS, BANNER_468_MESSAGE_SOURCE, buildBanner468SrcDoc } from "./config";

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
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isBannerMessage(event.data)) return;
      setState(event.data.status as FillState);
    };

    window.addEventListener("message", onMessage);

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
