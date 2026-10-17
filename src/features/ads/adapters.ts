import type { ConsentCategories } from "./contracts";
import type { AdUnit } from "./resolver";

/**
 * Ad adapter boundary (T-B003, ADR-008): the renderer never builds third-party
 * markup itself. An adapter resolves whether a unit may mount for the given
 * isolation mode and consent, mounts into the already-reserved slot element,
 * destroys itself on navigation, and reports failures so the view can drop
 * back to the empty reserved box.
 *
 * Script URL allowlist: ADR-008 keeps provider script URLs as reviewed code
 * constants, never database columns. The allowlist ships EMPTY — no third
 * party can inject a script until its URL is approved and added (provider
 * onboarding lands with the growth-lane card). Every adapter path is therefore
 * a no-op today; the direct sponsor (first_party) renders through React and is
 * unaffected by these adapters.
 *
 * Isolation modes (ADR-004): `no_script_ads` mounts nothing beyond the
 * first-party sponsor; `iframe_only` runs provider code sandboxed inside a
 * referrer-less iframe. Registry values outside those two documented modes are
 * treated as script-permitting but stay double-gated by the empty allowlist
 * plus consent, so an unexpected mode can never inject anything unreviewed.
 */

export type AdAdapterContext = {
  consent: ConsentCategories;
  isolationMode: string;
};

export type AdAdapter = {
  resolve(config: unknown, context: unknown): boolean;
  mount(slot: HTMLElement, consent: ConsentCategories): boolean;
  destroy(): void;
  report(error: unknown): void;
};

export type AdapterOptions = {
  allowlist?: Readonly<Record<string, string>>;
  onError?: (error: unknown) => void;
};

/** ADR-008: reviewed provider script URLs by network key. Empty on purpose. */
export const AD_SCRIPT_URL_ALLOWLIST: Readonly<Record<string, string>> = {};

export function scriptUrlForNetwork(
  network: string,
  allowlist: Readonly<Record<string, string>> = AD_SCRIPT_URL_ALLOWLIST,
): string | null {
  const raw = allowlist[network];
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function gateAllows(config: unknown, context: unknown): config is AdUnit {
  const unit = config as Partial<AdUnit> | null | undefined;
  const ctx = context as Partial<AdAdapterContext> | null | undefined;
  if (!unit || !ctx) return false;
  if (typeof unit.injectionMode !== "string" || !unit.injectionMode.startsWith("script")) {
    return false;
  }
  if (typeof ctx.isolationMode !== "string" || ctx.isolationMode === "no_script_ads") {
    return false;
  }
  if (ctx.consent?.ads !== true) return false;
  return true;
}

export function createScriptAdapter(url: string, onError?: (error: unknown) => void): AdAdapter {
  let scriptEl: HTMLScriptElement | null = null;
  const fail = (error: unknown) => onError?.(error);

  return {
    resolve(config, context) {
      return gateAllows(config, context);
    },
    mount(slot, consent) {
      if (scriptEl || !consent.ads) return false;
      const el = slot.ownerDocument.createElement("script");
      el.src = url;
      el.async = true;
      el.setAttribute("data-ad-network-script", "true");
      el.addEventListener("error", () => fail(new Error("ad script failed to load")));
      slot.appendChild(el);
      scriptEl = el;
      return true;
    },
    destroy() {
      scriptEl?.remove();
      scriptEl = null;
    },
    report(error) {
      fail(error);
    },
  };
}

export function createIframeAdapter(url: string, onError?: (error: unknown) => void): AdAdapter {
  let frameEl: HTMLIFrameElement | null = null;
  const fail = (error: unknown) => onError?.(error);

  return {
    resolve(config, context) {
      return gateAllows(config, context);
    },
    mount(slot, consent) {
      if (frameEl || !consent.ads) return false;
      const el = slot.ownerDocument.createElement("iframe");
      el.src = url;
      el.title = "Advertisement";
      el.setAttribute("loading", "lazy");
      el.setAttribute("referrerpolicy", "no-referrer");
      // Sandboxed: scripts only, no same-origin, no forms, no top navigation.
      el.setAttribute("sandbox", "allow-scripts allow-popups");
      el.setAttribute("data-ad-network-frame", "true");
      el.addEventListener("error", () => fail(new Error("ad iframe failed to load")));
      slot.appendChild(el);
      frameEl = el;
      return true;
    },
    destroy() {
      frameEl?.remove();
      frameEl = null;
    },
    report(error) {
      fail(error);
    },
  };
}

export function adapterFor(
  unit: AdUnit,
  isolationMode: string,
  options: AdapterOptions = {},
): AdAdapter | null {
  if (isolationMode === "no_script_ads") return null;
  if (typeof unit.injectionMode !== "string" || !unit.injectionMode.startsWith("script")) {
    return null;
  }
  const url = scriptUrlForNetwork(unit.network, options.allowlist ?? AD_SCRIPT_URL_ALLOWLIST);
  if (!url) return null; // ADR-008: nothing reviewed to load — fail empty.
  if (isolationMode === "iframe_only") return createIframeAdapter(url, options.onError);
  return createScriptAdapter(url, options.onError);
}
