"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ADSTERRA_UNITS } from "./config";

const UNIT = ADSTERRA_UNITS.native_banner;

export function AdsterraNativeBanner({ className }: { className?: string }) {
  const t = useTranslations("Ads");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (host.querySelector(`script[src="${UNIT.scriptUrl}"]`)) return;

    const script = document.createElement("script");
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    script.src = UNIT.scriptUrl;
    script.setAttribute("data-ad-network-script", "adsterra-native");
    script.setAttribute("data-ad-unit-id", UNIT.unitId);
    host.appendChild(script);

    // Observe if Adsterra populates content into the container
    const observer = new MutationObserver(() => {
      if (host.children.length > 1 || host.innerHTML.trim() !== "") {
        setFilled(true);
      }
    });
    observer.observe(host, { childList: true, subtree: true });

    return () => {
      script.remove();
      observer.disconnect();
    };
  }, []);

  // If not filled, render without visible placeholder box/border
  const containerClass = filled
    ? "min-h-[120px] w-full overflow-hidden rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30"
    : "w-full overflow-hidden min-h-[0px]";

  return (
    <aside
      data-testid="adsterra-native"
      data-ad-unit-id={UNIT.unitId}
      aria-label={t("slotLabel")}
      className={className ? `mx-auto w-full max-w-3xl ${className}` : "mx-auto w-full max-w-3xl"}
    >
      {filled ? (
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("slotLabel")}
        </p>
      ) : null}
      <div
        ref={hostRef}
        id={UNIT.containerId}
        data-testid="adsterra-native-container"
        className={containerClass}
      />
    </aside>
  );
}
