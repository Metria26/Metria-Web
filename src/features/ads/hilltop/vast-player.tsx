"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CONSENT_CHANGED_EVENT, CONSENT_COOKIE, parseConsentCookie } from "../consent";
import { HILLTOP_VAST_TAG_URL, isHilltopVastPathAllowed } from "./config";
import { parseVastXml, type VastAd } from "./vast";

/**
 * HilltopAds Video VAST player (2026-11-11).
 *
 * An in-page outstream player that replaces the Adsterra native banner at its
 * three reviewed mounts. The VAST tag is fetched directly from the visitor's
 * browser (the reviewed host allows CORS) so Hilltop sees the real viewer IP
 * for geo-targeting and impression caps. The creative is muted-autoplay to
 * satisfy browser policies, with explicit unmute/skip controls.
 *
 * Gates: the server components only mount this player when the public/private
 * surface allows it and consent was granted; the component re-reads the consent
 * cookie on mount and reacts to `CONSENT_CHANGED_EVENT`, and its path gate keeps
 * auth/admin/error routes ad-free even if a mount is ever misplaced. Fetch
 * failures, empty VAST and unplayable media all collapse the slot (fail closed).
 *
 * The creative lives in a keyed child component so every new ad starts with
 * fresh playback/tracking state without resetting state inside an effect.
 * Impression/tracking URLs are fired at most once per creative, and skipping,
 * ending or failing removes the video element so playback cannot continue
 * off-screen.
 */

type CreativeState = { pathname: string; ad: VastAd | null };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return null;
}

function consentGrantedNow(policyVersion: string): boolean {
  const raw = readCookie(CONSENT_COOKIE);
  if (!raw) return false;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // Keep the raw value; parseConsentCookie fails closed on malformed input.
  }
  return parseConsentCookie(value, policyVersion).categories.ads;
}

function firePixel(url: string): void {
  if (!url || typeof document === "undefined") return;
  try {
    const image = document.createElement("img");
    image.src = url;
  } catch {
    // Tracking must never break playback.
  }
}

export function HilltopVastPlayer({
  policyVersion,
  className,
}: {
  policyVersion: string;
  className?: string;
}) {
  const t = useTranslations("Ads");
  const pathname = usePathname();
  const [consentGranted, setConsentGranted] = useState(() => consentGrantedNow(policyVersion));
  const [creative, setCreative] = useState<CreativeState | null>(null);

  useEffect(() => {
    const syncConsent = () => setConsentGranted(consentGrantedNow(policyVersion));
    syncConsent();
    window.addEventListener(CONSENT_CHANGED_EVENT, syncConsent);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, syncConsent);
  }, [policyVersion]);

  const allowed = consentGranted && isHilltopVastPathAllowed(pathname);

  useEffect(() => {
    if (!allowed) return;

    const controller = new AbortController();
    let active = true;

    fetch(HILLTOP_VAST_TAG_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.text() : ""))
      .then((xml) => {
        if (!active) return;
        setCreative({ pathname, ad: parseVastXml(xml) });
      })
      .catch(() => {
        if (!active) return;
        setCreative({ pathname, ad: null });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [allowed, pathname]);

  const current = allowed && creative && creative.pathname === pathname ? creative : null;
  const phase = !allowed ? "idle" : current ? (current.ad ? "ready" : "empty") : "loading";

  return (
    <aside
      data-testid="hilltop-vast"
      data-state={phase}
      aria-label={t("slotLabel")}
      className={className ? `mx-auto w-full max-w-3xl ${className}` : "mx-auto w-full max-w-3xl"}
    >
      {current?.ad ? (
        <VastCreative
          key={current.ad.id ?? current.ad.mediaFile.url}
          ad={current.ad}
          onDismiss={() => setCreative({ pathname, ad: null })}
        />
      ) : null}
    </aside>
  );
}

function VastCreative({ ad, onDismiss }: { ad: VastAd; onDismiss: () => void }) {
  const t = useTranslations("Ads");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const firedRef = useRef<Set<string>>(new Set());
  const quartilesRef = useRef({ first: false, midpoint: false, third: false });
  const [muted, setMuted] = useState(true);
  const [skippable, setSkippable] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    const attempt = video.play();
    if (attempt) attempt.catch(() => setNeedsTap(true));
  }, []);

  const fire = (url: string) => {
    if (!url || firedRef.current.has(url)) return;
    firedRef.current.add(url);
    firePixel(url);
  };

  const track = (event: string) => {
    for (const entry of ad.trackingEvents) {
      if (entry.event === event) fire(entry.url);
    }
  };

  const handlePlaying = () => {
    for (const url of ad.impressionUrls) fire(url);
    track("creativeView");
    track("start");
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    if (ad.skipOffsetSeconds !== null && video.currentTime >= ad.skipOffsetSeconds) {
      setSkippable(true);
    }

    const duration = ad.durationSeconds ?? video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    const progress = video.currentTime / duration;
    const quartiles = quartilesRef.current;
    if (progress >= 0.25 && !quartiles.first) {
      quartiles.first = true;
      track("firstQuartile");
    }
    if (progress >= 0.5 && !quartiles.midpoint) {
      quartiles.midpoint = true;
      track("midpoint");
    }
    if (progress >= 0.75 && !quartiles.third) {
      quartiles.third = true;
      track("thirdQuartile");
    }
  };

  const stopPlayback = () => {
    videoRef.current?.pause();
    onDismiss();
  };

  const handleEnded = () => {
    track("complete");
    stopPlayback();
  };

  const handleError = () => {
    if (ad.errorUrl) fire(ad.errorUrl.replace("[ERRORCODE]", "405"));
    stopPlayback();
  };

  const handleSkip = () => {
    track("skip");
    stopPlayback();
  };

  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    track(video.muted ? "mute" : "unmute");
  };

  const handlePlayRequest = () => {
    const video = videoRef.current;
    if (!video) return;
    setNeedsTap(false);
    video.play().catch(() => setNeedsTap(true));
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-black">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("slotLabel")}
      </p>
      <div className="relative aspect-video w-full">
        <video
          ref={videoRef}
          data-testid="hilltop-vast-video"
          className="h-full w-full object-contain"
          src={ad.mediaFile.url}
          playsInline
          muted
          autoPlay
          preload="auto"
          onPlaying={handlePlaying}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onError={handleError}
        />
        {ad.clickThroughUrl ? (
          <a
            href={ad.clickThroughUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            aria-label={t("sponsoredLinkLabel")}
            className="absolute inset-0 z-10"
            onClick={() => ad.clickTrackingUrls.forEach(fire)}
          />
        ) : null}
        <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMuted}
            className="rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white"
          >
            {muted ? t("video.unmute") : t("video.mute")}
          </button>
          {skippable ? (
            <button
              type="button"
              data-testid="hilltop-vast-skip"
              onClick={handleSkip}
              className="rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white"
            >
              {t("video.skip")}
            </button>
          ) : null}
        </div>
        {needsTap ? (
          <button
            type="button"
            onClick={handlePlayRequest}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 text-sm font-medium text-white"
          >
            {t("video.play")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
