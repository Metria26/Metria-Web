import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AdConfigSnapshot, AdKillState, ConsentCategories } from "./contracts";
import { clearAdCaches, loadSponsorCreatives, type RpcCaller } from "./config";
import { resolveAdSlots } from "./slots";
import { adapterFor, createScriptAdapter, scriptUrlForNetwork } from "./adapters";
import type { AdUnit } from "./resolver";
import { extractCspReport } from "./csp";
import { AdSlotView } from "./ui/ad-slot-view";
import { TapToReveal } from "./ui/tap-to-reveal";

/**
 * T-B003 unit boundary: slot resolution (flags/kill/page-type/consent gates,
 * sponsor attach and fail-closed payloads), the ADR-008 adapter allowlist and
 * isolation modes, the reserved-geometry client view (including failure paths
 * that must fall back to an empty box), tap-to-reveal DOM gating (R1), and the
 * CSP report sanitizer (R2). The database side is covered by
 * monetization-sponsors.rls.test.sql.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const openKill: AdKillState = {
  flags: { enabled: true, public_enabled: true, private_enabled: true, global_kill: false },
  global: false,
  killed_networks: [],
};

const fixtureConfig: AdConfigSnapshot = {
  source: "live",
  version: 0,
  page_types: [
    { key: "dashboard", is_auth: false, enabled: true },
    { key: "login", is_auth: true, enabled: false },
  ],
  formats: [
    { key: "banner", is_pop_style: false, needs_consent: true, injection_mode: "script_async" },
    {
      key: "direct_sponsor",
      is_pop_style: false,
      needs_consent: false,
      injection_mode: "first_party",
    },
  ],
  networks: [{ key: "adsterra", name: "Adsterra", enabled: true }],
  placements: [
    {
      slot_key: "dashboard-top",
      page_type: "dashboard",
      network: "adsterra",
      format: "banner",
      enabled: true,
      priority: 10,
      frequency_cap: null,
      isolation_mode: "no_script_ads",
    },
  ],
};

const consent: ConsentCategories = { analytics: false, ads: true };

type FakeCaller = RpcCaller & { calls: Array<{ fn: string; args: Record<string, unknown> }> };

function fakeCaller(
  handlers: {
    snapshot?: unknown;
    kill?: unknown;
    sponsor?: unknown;
    errors?: Record<string, { message: string }>;
  } = {},
): FakeCaller {
  const calls: FakeCaller["calls"] = [];
  return {
    calls,
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const error = handlers.errors?.[fn] ?? null;
      let data: unknown = null;
      if (!error) {
        if (fn === "ad_config_snapshot") data = handlers.snapshot ?? fixtureConfig;
        else if (fn === "ad_kill_state") data = handlers.kill ?? openKill;
        else if (fn === "page_sponsor_slots") data = handlers.sponsor ?? { creatives: [] };
      }
      return Promise.resolve({ data, error });
    },
  };
}

function resolve(
  overrides: {
    caller?: FakeCaller;
    pageType?: string;
    slotKeys?: string[];
    consent?: ConsentCategories;
    withSponsor?: boolean;
    sensitive?: boolean;
    authenticated?: boolean;
  } = {},
) {
  return resolveAdSlots({
    supabase: overrides.caller ?? fakeCaller(),
    universityId: "99999999-9999-4999-8999-999999999990",
    pageType: overrides.pageType ?? "dashboard",
    slotKeys: overrides.slotKeys ?? ["dashboard-top"],
    consent: overrides.consent ?? consent,
    withSponsor: overrides.withSponsor,
    sensitive: overrides.sensitive,
    authenticated: overrides.authenticated,
  });
}

beforeEach(() => {
  clearAdCaches();
});

afterEach(() => {
  cleanup();
});

describe("resolveAdSlots gates", () => {
  it("keeps pages dark while the platform flag is off and never fetches sponsors", async () => {
    const caller = fakeCaller({
      kill: { ...openKill, flags: { ...openKill.flags, enabled: false } },
    });
    const result = await resolve({ caller, withSponsor: true, sensitive: true });
    expect(result.active).toBe(false);
    expect(result.revealValues).toBe(false);
    expect(result.slots[0]).toMatchObject({ unit: null, sponsor: null });
    expect(caller.calls.some((call) => call.fn === "page_sponsor_slots")).toBe(false);
  });

  it("activates when every gate is open and resolves the placement unit", async () => {
    const result = await resolve();
    expect(result.active).toBe(true);
    expect(result.consent).toEqual(consent);
    expect(result.slots[0]?.unit).toMatchObject({
      slotKey: "dashboard-top",
      network: "adsterra",
      injectionMode: "script_async",
      isolationMode: "no_script_ads",
    });
  });

  it("fails closed on the master kill flag and on the university kill row", async () => {
    const masterKill = await resolve({
      caller: fakeCaller({
        kill: { ...openKill, flags: { ...openKill.flags, global_kill: true } },
      }),
    });
    expect(masterKill.active).toBe(false);

    clearAdCaches();
    const universityKill = await resolve({
      caller: fakeCaller({ kill: { ...openKill, global: true } }),
    });
    expect(universityKill.active).toBe(false);
  });

  it("never activates auth page types even if one is requested (R3)", async () => {
    const result = await resolve({ pageType: "login", slotKeys: ["login-banner"] });
    expect(result.active).toBe(false);
  });

  it("stays dark for unregistered page types", async () => {
    const result = await resolve({ pageType: "no_such_page" });
    expect(result.active).toBe(false);
  });

  it("honours the private layer switch for authenticated surfaces", async () => {
    const result = await resolve({
      caller: fakeCaller({
        kill: { ...openKill, flags: { ...openKill.flags, private_enabled: false } },
      }),
    });
    expect(result.active).toBe(false);
  });

  it("fails closed when the config payload is malformed", async () => {
    const result = await resolve({ caller: fakeCaller({ snapshot: { source: "weird" } }) });
    expect(result.active).toBe(false);
  });

  it("reserves the box without a unit when consent denies the format", async () => {
    const result = await resolve({ consent: { analytics: false, ads: false } });
    expect(result.active).toBe(true);
    expect(result.slots[0]?.unit).toBeNull();
    expect(result.slots[0]?.isolationMode).toBe("no_script_ads");
  });

  it("reveals sensitive values only while the surface is active", async () => {
    const active = await resolve({ sensitive: true });
    expect(active.revealValues).toBe(true);

    clearAdCaches();
    const dark = await resolve({
      caller: fakeCaller({
        kill: { ...openKill, flags: { ...openKill.flags, enabled: false } },
      }),
      sensitive: true,
    });
    expect(dark.revealValues).toBe(false);
  });
});

describe("resolveAdSlots sponsor attach", () => {
  it("attaches the sponsor creative to the first slot only", async () => {
    const caller = fakeCaller({
      sponsor: {
        creatives: [
          {
            image_url: "https://cdn.example.org/a.svg",
            target_url: "https://example.org/a",
            priority: 10,
          },
          {
            image_url: "https://cdn.example.org/b.svg",
            target_url: "https://example.org/b",
            priority: 5,
          },
        ],
      },
    });
    const result = await resolve({
      caller,
      slotKeys: ["dashboard-top", "dashboard-inline"],
      withSponsor: true,
    });
    expect(result.active).toBe(true);
    expect(result.slots[0]?.sponsor).toEqual({
      imageUrl: "https://cdn.example.org/a.svg",
      targetUrl: "https://example.org/a",
      priority: 10,
    });
    expect(result.slots[1]?.sponsor).toBeNull();
    expect(caller.calls.find((call) => call.fn === "page_sponsor_slots")?.args).toEqual({
      p_university_id: "99999999-9999-4999-8999-999999999990",
      p_page_type: "dashboard",
    });
  });

  it("fails closed on a malformed sponsor payload", async () => {
    const result = await resolve({
      caller: fakeCaller({ sponsor: { creatives: [{ image_url: "" }] } }),
      withSponsor: true,
    });
    expect(result.active).toBe(true);
    expect(result.slots[0]?.sponsor).toBeNull();
  });

  it("keeps the slot sponsor-free when the sponsor RPC errors", async () => {
    const result = await resolve({
      caller: fakeCaller({ errors: { page_sponsor_slots: { message: "boom" } } }),
      withSponsor: true,
    });
    expect(result.slots[0]?.sponsor).toBeNull();
  });

  it("skips sponsor loading unless requested", async () => {
    const caller = fakeCaller();
    await resolve({ caller, withSponsor: false });
    expect(caller.calls.some((call) => call.fn === "page_sponsor_slots")).toBe(false);
  });
});

describe("loadSponsorCreatives", () => {
  it("caches per university and page type", async () => {
    const caller = fakeCaller({
      sponsor: {
        creatives: [{ image_url: "/a.svg", target_url: "https://example.org/a", priority: 1 }],
      },
    });
    const first = await loadSponsorCreatives(caller, "uni-1", "dashboard");
    const second = await loadSponsorCreatives(caller, "uni-1", "dashboard");
    expect(first?.creatives).toHaveLength(1);
    expect(second).toEqual(first);
    expect(caller.calls.filter((call) => call.fn === "page_sponsor_slots")).toHaveLength(1);
  });

  it("returns null when the payload fails Zod", async () => {
    const caller = fakeCaller({ sponsor: { creatives: "not-an-array" } });
    expect(await loadSponsorCreatives(caller, "uni-1", "dashboard")).toBeNull();
  });
});

describe("adapter allowlist and isolation (ADR-008)", () => {
  const unit: AdUnit = {
    slotKey: "dashboard-top",
    pageType: "dashboard",
    network: "adsterra",
    networkName: "Adsterra",
    format: "banner",
    isPopStyle: false,
    injectionMode: "script_async",
    isolationMode: "iframe_only",
    priority: 10,
    frequencyCap: null,
  };
  const allowlist = { adsterra: "https://ads.example.net/unit.js" };

  it("resolves only https URLs from the allowlist", () => {
    expect(scriptUrlForNetwork("adsterra")).toBeNull();
    expect(scriptUrlForNetwork("adsterra", allowlist)).toBe("https://ads.example.net/unit.js");
    expect(scriptUrlForNetwork("adsterra", { adsterra: "http://ads.example.net/x.js" })).toBeNull();
    expect(scriptUrlForNetwork("adsterra", { adsterra: "not a url" })).toBeNull();
    expect(scriptUrlForNetwork("unknown", allowlist)).toBeNull();
  });

  it("never builds adapters for no_script_ads, first_party or unlisted networks", () => {
    expect(adapterFor(unit, "no_script_ads", { allowlist })).toBeNull();
    expect(
      adapterFor({ ...unit, injectionMode: "first_party" }, "iframe_only", { allowlist }),
    ).toBeNull();
    expect(adapterFor({ ...unit, network: "other" }, "iframe_only", { allowlist })).toBeNull();
    expect(adapterFor(unit, "iframe_only")).toBeNull(); // default empty allowlist
  });

  it("resolves only with consent and a script-format unit", () => {
    const adapter = createScriptAdapter("https://ads.example.net/unit.js");
    expect(adapter.resolve(unit, { consent, isolationMode: "iframe_only" })).toBe(true);
    expect(
      adapter.resolve(unit, {
        consent: { analytics: false, ads: false },
        isolationMode: "iframe_only",
      }),
    ).toBe(false);
    expect(
      adapter.resolve(
        { ...unit, injectionMode: "first_party" },
        { consent, isolationMode: "iframe_only" },
      ),
    ).toBe(false);
    expect(adapter.resolve(unit, { consent, isolationMode: "no_script_ads" })).toBe(false);
    adapter.destroy();
  });

  it("mounts an async script, reports load errors and destroys cleanly", () => {
    const onError = vi.fn();
    const adapter = createScriptAdapter("https://ads.example.net/unit.js", onError);
    const host = document.createElement("div");
    document.body.appendChild(host);

    expect(adapter.resolve(unit, { consent, isolationMode: "iframe_only" })).toBe(true);
    expect(adapter.mount(host, consent)).toBe(true);
    const script = host.querySelector("script[data-ad-network-script]") as HTMLScriptElement | null;
    expect(script).toBeTruthy();
    expect(script?.async).toBe(true);
    expect(script?.src).toBe("https://ads.example.net/unit.js");

    fireEvent.error(script as Element);
    expect(onError).toHaveBeenCalledTimes(1);

    adapter.destroy();
    expect(host.querySelector("script")).toBeNull();
    host.remove();
  });

  it("refuses to mount without ads consent even if resolve was pre-checked", () => {
    const adapter = createScriptAdapter("https://ads.example.net/unit.js");
    const host = document.createElement("div");
    expect(adapter.mount(host, { analytics: false, ads: false })).toBe(false);
    expect(host.querySelector("script")).toBeNull();
    adapter.destroy();
  });
});

describe("AdSlotView reserved geometry", () => {
  const unit: AdUnit = {
    slotKey: "dashboard-top",
    pageType: "dashboard",
    network: "adsterra",
    networkName: "Adsterra",
    format: "banner",
    isPopStyle: false,
    injectionMode: "script_async",
    isolationMode: "iframe_only",
    priority: 10,
    frequencyCap: null,
  };

  it("renders the reserved box in its empty state", () => {
    render(
      <AdSlotView
        model={{
          slotKey: "dashboard-top",
          unit: null,
          sponsor: null,
          isolationMode: "no_script_ads",
        }}
        consent={consent}
      />,
    );
    const slot = screen.getByTestId("ad-slot");
    expect(slot.getAttribute("data-state")).toBe("empty");
    expect(slot.getAttribute("data-isolation")).toBe("no_script_ads");
    expect(slot.getAttribute("data-slot-key")).toBe("dashboard-top");
    expect(slot.getAttribute("aria-label")).toBe("slotLabel");
    expect(slot.className).toContain("min-h-[72px]");
    expect(slot.className).toContain("aspect-[728/90]");
  });

  it("renders the direct sponsor with disclosure and a sponsored link", () => {
    render(
      <AdSlotView
        model={{
          slotKey: "dashboard-top",
          unit: null,
          sponsor: { imageUrl: "/creative.svg", targetUrl: "https://example.org/x", priority: 10 },
          isolationMode: "no_script_ads",
        }}
        consent={consent}
      />,
    );
    expect(screen.getByTestId("ad-slot").getAttribute("data-state")).toBe("filled");
    expect(screen.getByTestId("ad-sponsor")).toBeTruthy();
    expect(screen.getByTestId("ad-sponsor-badge").textContent).toBe("sponsored");
    const link = screen.getByTestId("ad-sponsor-link");
    expect(link.getAttribute("href")).toBe("https://example.org/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("sponsored");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("drops a failed sponsor image back to the empty reserved box", () => {
    render(
      <AdSlotView
        model={{
          slotKey: "dashboard-top",
          unit: null,
          sponsor: { imageUrl: "/broken.svg", targetUrl: "https://example.org/x", priority: 10 },
          isolationMode: "no_script_ads",
        }}
        consent={consent}
      />,
    );
    fireEvent.error(screen.getByTestId("ad-sponsor"));
    expect(screen.getByTestId("ad-slot").getAttribute("data-state")).toBe("empty");
    expect(screen.queryByTestId("ad-sponsor")).toBeNull();
    expect(screen.getByTestId("ad-slot")).toBeTruthy(); // geometry still reserved
  });

  it("mounts nothing for no_script_ads isolation even with an approved URL", () => {
    const { container } = render(
      <AdSlotView
        model={{ slotKey: "dashboard-top", unit, sponsor: null, isolationMode: "no_script_ads" }}
        consent={consent}
        scriptAllowlist={{ adsterra: "https://ads.example.net/unit.js" }}
      />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("ad-slot").getAttribute("data-state")).toBe("empty");
  });

  it("mounts a sandboxed iframe for iframe_only with an approved URL", () => {
    const { container } = render(
      <AdSlotView
        model={{ slotKey: "dashboard-top", unit, sponsor: null, isolationMode: "iframe_only" }}
        consent={consent}
        scriptAllowlist={{ adsterra: "https://ads.example.net/unit.js" }}
      />,
    );
    const frame = container.querySelector("iframe[data-ad-network-frame]") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(screen.getByTestId("ad-slot").getAttribute("data-state")).toBe("filled");
  });

  it("stays empty when consent denies the network format", () => {
    const { container } = render(
      <AdSlotView
        model={{ slotKey: "dashboard-top", unit, sponsor: null, isolationMode: "iframe_only" }}
        consent={{ analytics: false, ads: false }}
        scriptAllowlist={{ adsterra: "https://ads.example.net/unit.js" }}
      />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByTestId("ad-slot").getAttribute("data-state")).toBe("empty");
  });

  it("falls back to the empty reserved box when the network mount fails", () => {
    const { container } = render(
      <AdSlotView
        model={{ slotKey: "dashboard-top", unit, sponsor: null, isolationMode: "iframe_only" }}
        consent={consent}
        scriptAllowlist={{ adsterra: "https://ads.example.net/unit.js" }}
      />,
    );
    const frame = container.querySelector("iframe[data-ad-network-frame]") as HTMLIFrameElement;
    fireEvent.error(frame);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByTestId("ad-slot").getAttribute("data-state")).toBe("empty");
    expect(screen.getByTestId("ad-slot")).toBeTruthy();
  });
});

describe("TapToReveal sensitive gate (R1)", () => {
  const marks = <span data-testid="marks-child">97 / 100</span>;

  it("passes children through untouched while inactive", () => {
    render(<TapToReveal active={false}>{marks}</TapToReveal>);
    expect(screen.getByTestId("marks-child")).toBeTruthy();
    expect(screen.queryByTestId("reveal-button")).toBeNull();
    expect(screen.queryByTestId("sensitive-gate")).toBeNull();
  });

  it("keeps children out of the DOM until the user reveals them", () => {
    render(
      <TapToReveal active={true} className="flex flex-col gap-10">
        {marks}
      </TapToReveal>,
    );
    const button = screen.getByTestId("reveal-button");
    expect(screen.queryByTestId("marks-child")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("sensitive-gate").getAttribute("data-state")).toBe("hidden");

    fireEvent.click(button);
    expect(screen.getByTestId("marks-child")).toBeTruthy();
    expect(screen.getByTestId("reveal-button").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("sensitive-gate").getAttribute("data-state")).toBe("revealed");

    fireEvent.click(screen.getByTestId("reveal-button"));
    expect(screen.queryByTestId("marks-child")).toBeNull();
    expect(screen.getByTestId("reveal-button").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("CSP report sanitizer (R2)", () => {
  it("extracts only allowlisted fields from a legacy csp-report body", () => {
    const report = extractCspReport({
      "csp-report": {
        "document-uri": "https://app.example.com/app/offerings/abc123?secret=1#frag",
        "blocked-uri": "https://tracker.example.net/pixel.js?user=42",
        "effective-directive": "script-src",
        "violated-directive": "script-src-elem",
        "original-policy": "should be dropped",
        referrer: "should be dropped",
      },
    });
    expect(report).toEqual({
      documentPath: "/app/offerings/abc123",
      blockedUri: "tracker.example.net",
      effectiveDirective: "script-src",
      violatedDirective: "script-src-elem",
    });
  });

  it("handles array reports and inline blocked URIs", () => {
    const report = extractCspReport([
      { "document-uri": "/app", "blocked-uri": "inline", "effective-directive": "script-src" },
    ]);
    expect(report).toMatchObject({ documentPath: "/app", blockedUri: "inline" });
  });

  it("drops malformed or partial payloads", () => {
    expect(extractCspReport(null)).toBeNull();
    expect(extractCspReport("nope")).toBeNull();
    expect(extractCspReport({})).toBeNull();
    expect(extractCspReport({ "blocked-uri": "https://x" })).toBeNull();
    expect(
      extractCspReport({ "document-uri": "/a", "effective-directive": "x".repeat(500) })
        ?.effectiveDirective,
    ).toHaveLength(200);
  });
});
