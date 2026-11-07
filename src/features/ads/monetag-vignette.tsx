"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_CHANGED_EVENT, CONSENT_COOKIE, parseConsentCookie } from "./consent";
import { isMonetagVignettePathAllowed } from "./monetag-vignette-rules";

/**
 * Monetag Vignette Banner.
 *
 * Mounted once in the root layout. The original Monetag snippet is never
 * pasted inline: a single `<script data-zone="12211513">` is appended after
 * the existing ad gates allow it. This loader deliberately follows the
 * dedicated Adsterra component pattern instead of the generic ADR-008 adapter
 * allowlist (that allowlist is for resolver-driven units; Adsterra and Monetag
 * are reviewed per-provider loaders).
 *
 * Gates:
 *   - route: `isMonetagVignettePathAllowed` (auth/admin/marks/marksheet/
 *     bookings stay free of ad scripts, R1/R3);
 *   - surface: `GET /api/ads/monetag-vignette` reuses the existing
 *     public/private surface helpers, so master flags, global kill, layer
 *     switches, network kill and consent all fail closed;
 *   - consent: read from the existing `metria_consent` cookie with
 *     `parseConsentCookie` (no new cookie).
 *
 * Dedupe: module state survives client navigation and React strict-mode
 * double mounts, so the document never receives a second script. If the
 * visitor navigates to an excluded route after a load, the element is removed
 * and the module stays in the loaded state (it will not be re-added in this
 * page session).
 */

export const MONETAG_VIGNETTE_ZONE = "12211513";
export const MONETAG_VIGNETTE_SCRIPT_URL = "https://n6wxm.com/vignette.min.js";
export const MONETAG_VIGNETTE_SCRIPT_MARKER = "monetag-vignette";

const MARKER_ATTRIBUTE = "data-ad-network-script";

type LoaderState = "idle" | "requested" | "loaded";
let loaderState: LoaderState = "idle";
let scriptElement: HTMLScriptElement | null = null;
let activePathname: string | null = null;

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

function removeLoadedScript(): void {
  scriptElement?.remove();
  scriptElement = null;
  document
    .querySelectorAll(`script[${MARKER_ATTRIBUTE}="${MONETAG_VIGNETTE_SCRIPT_MARKER}"]`)
    .forEach((node) => node.remove());
}

function appendScript(): void {
  if (loaderState === "loaded") return;
  if (document.querySelector(`script[${MARKER_ATTRIBUTE}="${MONETAG_VIGNETTE_SCRIPT_MARKER}"]`)) {
    loaderState = "loaded";
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = MONETAG_VIGNETTE_SCRIPT_URL;
  script.dataset.zone = MONETAG_VIGNETTE_ZONE;
  script.setAttribute(MARKER_ATTRIBUTE, MONETAG_VIGNETTE_SCRIPT_MARKER);
  (document.body ?? document.documentElement).appendChild(script);
  scriptElement = script;
  loaderState = "loaded";
}

/** Test seam: forget the per-document singleton and remove its script. */
export function clearMonetagVignetteState(): void {
  loaderState = "idle";
  activePathname = null;
  if (typeof document !== "undefined") {
    removeLoadedScript();
  } else {
    scriptElement = null;
  }
}

export function MonetagVignette({ policyVersion }: { policyVersion: string }) {
  const pathname = usePathname();
  const [consentGranted, setConsentGranted] = useState(() => consentGrantedNow(policyVersion));

  useEffect(() => {
    const syncConsent = () => setConsentGranted(consentGrantedNow(policyVersion));
    syncConsent();
    window.addEventListener(CONSENT_CHANGED_EVENT, syncConsent);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, syncConsent);
  }, [policyVersion]);

  useEffect(() => {
    activePathname = pathname;

    if (!consentGranted || !isMonetagVignettePathAllowed(pathname)) {
      removeLoadedScript();
      return;
    }
    if (loaderState !== "idle") return;

    loaderState = "requested";
    const query = new URLSearchParams({ path: pathname });
    void fetch(`/api/ads/monetag-vignette?${query.toString()}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (loaderState !== "requested") return;
        if (typeof payload !== "object" || payload === null) return;
        if ((payload as { allowed?: unknown }).allowed !== true) return;
        if (!activePathname || !isMonetagVignettePathAllowed(activePathname)) return;
        if (!consentGrantedNow(policyVersion)) return;
        appendScript();
      })
      .catch(() => {
        // Fail closed: no loader for this page session.
      });
  }, [consentGranted, pathname, policyVersion]);

  return null;
}
