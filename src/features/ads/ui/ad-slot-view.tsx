"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { adapterFor, type AdAdapter } from "../adapters";
import type { ConsentCategories } from "../contracts";
import type { AdSlotSponsor, AdSlotModel } from "../slots";
import type { AdUnit } from "../resolver";

/**
 * Reserved ad geometry (T-B003, R1/R2): the server resolves the slot and this
 * view renders a fixed box that reserves the exact aspect ratio before any
 * content arrives — sponsor images carry width/height and object-contain, so
 * loading or failing never shifts the page (CLS guard). Failure paths all drop
 * back to the empty reserved box: image error, adapter error, not allowlisted
 * (ADR-008), isolation mode without content. Never overlaps adjacent actions —
 * pages place it as its own flex section with normal spacing tokens.
 */

export type AdSlotViewProps = {
  model: AdSlotModel;
  consent: ConsentCategories;
  className?: string;
  /** Test seam: inject reviewed script URLs without touching the ADR-008 default. */
  scriptAllowlist?: Readonly<Record<string, string>>;
};

const BOX_CLASS =
  "relative mx-auto aspect-[728/90] min-h-[72px] w-full overflow-hidden rounded-lg border border-dashed bg-muted/30";

export function AdSlotView({ model, consent, className, scriptAllowlist }: AdSlotViewProps) {
  const t = useTranslations("Ads");
  const [sponsorFailed, setSponsorFailed] = useState(false);
  const [networkMounted, setNetworkMounted] = useState(false);

  const sponsor = model.sponsor && !sponsorFailed ? model.sponsor : null;
  const filled = sponsor !== null || networkMounted;

  return (
    <aside
      data-testid="ad-slot"
      data-slot-key={model.slotKey}
      data-isolation={model.isolationMode}
      data-state={filled ? "filled" : "empty"}
      aria-label={t("slotLabel")}
      className={className ? `${BOX_CLASS} ${className}` : BOX_CLASS}
    >
      {sponsor ? (
        <SponsorCreative sponsor={sponsor} onImageError={() => setSponsorFailed(true)} />
      ) : null}
      {!sponsor && model.unit ? (
        <NetworkUnit
          unit={model.unit}
          isolationMode={model.isolationMode}
          consent={consent}
          allowlist={scriptAllowlist}
          onStateChange={setNetworkMounted}
        />
      ) : null}
    </aside>
  );
}

function SponsorCreative({
  sponsor,
  onImageError,
}: {
  sponsor: AdSlotSponsor;
  onImageError: () => void;
}) {
  const t = useTranslations("Ads");
  return (
    <a
      href={sponsor.targetUrl}
      target="_blank"
      rel="sponsored nofollow noopener noreferrer"
      aria-label={t("sponsoredLinkLabel")}
      data-testid="ad-sponsor-link"
      className="absolute inset-0 block"
    >
      <span
        data-testid="ad-sponsor-badge"
        className="absolute left-1.5 top-1.5 z-10 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground shadow-sm"
      >
        {t("sponsored")}
      </span>
      {/* unoptimized: sponsor URLs are admin-managed external/relative paths —
          no remotePatterns wildcard (ADR-008 stays strict), fixed 728x90 box. */}
      <Image
        src={sponsor.imageUrl}
        alt=""
        width={728}
        height={90}
        unoptimized
        data-testid="ad-sponsor"
        onError={onImageError}
        className="block h-full w-full object-contain"
      />
    </a>
  );
}

function NetworkUnit({
  unit,
  isolationMode,
  consent,
  allowlist,
  onStateChange,
}: {
  unit: AdUnit;
  isolationMode: string;
  consent: ConsentCategories;
  allowlist?: Readonly<Record<string, string>>;
  onStateChange: (mounted: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let adapter: AdAdapter | null = null;
    let observer: IntersectionObserver | null = null;
    let stopped = false;

    const tryMount = () => {
      if (stopped || adapter) return;
      const host = hostRef.current;
      if (!host) return;
      adapter = adapterFor(unit, isolationMode, {
        allowlist,
        onError: () => {
          if (stopped) return;
          setFailed(true);
          onStateChange(false);
        },
      });
      if (!adapter) return;
      if (!adapter.resolve(unit, { consent, isolationMode })) {
        adapter = null;
        return;
      }
      if (!adapter.mount(host, consent)) {
        adapter = null;
        setFailed(true);
        onStateChange(false);
        return;
      }
      onStateChange(true);
    };

    const host = hostRef.current;
    if (host && typeof IntersectionObserver === "undefined") {
      // Test environments (jsdom) have no IO — mount immediately, still gated.
      tryMount();
    } else if (host) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            observer = null;
            tryMount();
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(host);
    }

    return () => {
      stopped = true;
      observer?.disconnect();
      adapter?.destroy();
      onStateChange(false);
    };
  }, [unit, isolationMode, consent, allowlist, onStateChange]);

  if (failed) return null;
  return (
    <div ref={hostRef} data-testid="ad-network" className="absolute inset-0 overflow-hidden" />
  );
}
