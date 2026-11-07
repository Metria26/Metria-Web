import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdsterraBanner468 } from "./banner-468";
import { AdsterraNativeBanner } from "./native-banner";
import { AdsterraPopunder } from "./popunder";
import { AdsterraSocialBar } from "./social-bar";
import { ADSTERRA_UNITS } from "./config";
import { POPUNDER_OPEN_TRACKER_KEY } from "../popunder-open-tracker";
import { parseVisitorCookie, serializeVisitorState } from "../visitor";

/**
 * SS11 component boundary: the exact Adsterra markup (script URLs, container
 * id, 468x60 iframe) is produced only after mount, labelled, and cleaned up on
 * unmount. Server-side gating is covered by public-surface tests; these assert
 * the client injection contract the e2e suite then verifies end to end.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const POPUNDER_SCRIPT_SELECTOR = `script[src="${ADSTERRA_UNITS.popunder.scriptUrl}"]`;
const nativeWindowOpen = window.open;

function resetPopunderOpenTracker() {
  window.open = nativeWindowOpen;
  delete (window as Window & { __metria_popunder_open_tracker?: boolean })[
    POPUNDER_OPEN_TRACKER_KEY
  ];
}

function clearAdVisitorCookie() {
  document.cookie = "metria_ad_visitor=; Path=/; Max-Age=0; SameSite=Lax";
}

function readAdVisitorCookie() {
  const prefix = "metria_ad_visitor=";
  const raw = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return parseVisitorCookie(raw ?? null);
}

beforeEach(() => {
  clearAdVisitorCookie();
  resetPopunderOpenTracker();
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("script[data-ad-unit-id]").forEach((el) => el.remove());
  clearAdVisitorCookie();
  resetPopunderOpenTracker();
});

describe("AdsterraNativeBanner", () => {
  it("keeps Adsterra's container id and injects the script once", () => {
    render(<AdsterraNativeBanner />);
    const container = screen.getByTestId("adsterra-native-container");
    expect(container.id).toBe(ADSTERRA_UNITS.native_banner.containerId);

    const script = container.querySelector("script");
    expect(script).not.toBeNull();
    expect(script?.src).toBe(ADSTERRA_UNITS.native_banner.scriptUrl);
    expect(script?.async).toBe(true);
    expect(script?.getAttribute("data-cfasync")).toBe("false");
    expect(script?.getAttribute("data-ad-unit-id")).toBe("31803282");
  });

  it("removes the script on unmount", () => {
    const { unmount } = render(<AdsterraNativeBanner />);
    unmount();
    expect(
      document.querySelector(`script[src="${ADSTERRA_UNITS.native_banner.scriptUrl}"]`),
    ).toBeNull();
  });
});

describe("AdsterraBanner468", () => {
  it("renders a fixed 468x60 sandboxed iframe with the srcDoc unit", () => {
    render(<AdsterraBanner468 />);
    const frame = screen.getByTitle("slotLabel") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("width")).toBe("468");
    expect(frame.getAttribute("height")).toBe("60");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("data-ad-unit-id")).toBe("31803284");
    expect(frame.getAttribute("srcdoc")).toContain(ADSTERRA_UNITS.banner_468.scriptUrl);
    expect(frame.getAttribute("srcdoc")).toContain("atOptions");
    expect(frame.getAttribute("srcdoc")).toContain("adsterra-banner-468");
    expect(screen.getByTestId("adsterra-banner-468").getAttribute("data-state")).toBe("loading");
  });
});

describe("AdsterraSocialBar", () => {
  it("appends exactly one body script and removes it on unmount", () => {
    const { unmount } = render(<AdsterraSocialBar />);
    const scripts = document.body.querySelectorAll(
      `script[src="${ADSTERRA_UNITS.social_bar.scriptUrl}"]`,
    );
    expect(scripts.length).toBe(1);
    expect(scripts[0]?.getAttribute("data-cfasync")).toBe("false");
    expect(scripts[0]?.getAttribute("data-ad-unit-id")).toBe("31803283");
    unmount();
    expect(
      document.body.querySelectorAll(`script[src="${ADSTERRA_UNITS.social_bar.scriptUrl}"]`).length,
    ).toBe(0);
  });
});

describe("AdsterraPopunder", () => {
  it("injects one head script with the reviewed attributes and survives unmount", () => {
    const { unmount } = render(<AdsterraPopunder />);
    const scripts = document.head.querySelectorAll(POPUNDER_SCRIPT_SELECTOR);
    expect(scripts.length).toBe(1);
    expect((scripts[0] as HTMLScriptElement)?.async).toBe(true);
    expect(scripts[0]?.getAttribute("data-cfasync")).toBe("false");
    expect(scripts[0]?.getAttribute("data-ad-network-script")).toBe("adsterra-popunder");
    expect(scripts[0]?.getAttribute("data-ad-unit-id")).toBe("popunder");
    expect(scripts[0]?.getAttribute("src")).toBe(ADSTERRA_UNITS.popunder.scriptUrl);

    unmount();
    expect(document.head.querySelector(POPUNDER_SCRIPT_SELECTOR)).not.toBeNull();
  });

  it("does not inject a duplicate script across remounts", () => {
    const first = render(<AdsterraPopunder />);
    first.unmount();
    render(<AdsterraPopunder />);
    expect(document.head.querySelectorAll(POPUNDER_SCRIPT_SELECTOR).length).toBe(1);
  });

  it("does not record a script load in the first-party cookie", () => {
    render(<AdsterraPopunder />);
    const script = document.head.querySelector(POPUNDER_SCRIPT_SELECTOR);
    script?.dispatchEvent(new Event("load"));

    const state = readAdVisitorCookie();
    expect(state).toBeNull();
  });

  it("records one open for a successful _blank window", () => {
    window.open = vi.fn(() => ({}) as Window);
    render(<AdsterraPopunder />);

    window.open("https://ad.example", "_blank");

    const state = readAdVisitorCookie();
    expect(state?.popunderShownAt).toHaveLength(1);
  });

  it("does not count blocked or non-_blank opens", () => {
    window.open = vi.fn(() => null);
    render(<AdsterraPopunder />);

    window.open("https://ad.example", "_blank");
    window.open("https://ad.example", "_self");

    expect(readAdVisitorCookie()).toBeNull();
  });

  it("does not inject when four opens are already inside the 24-hour window", () => {
    const now = Date.now();
    document.cookie = `metria_ad_visitor=${encodeURIComponent(
      serializeVisitorState({
        id: "test-visitor",
        popStyleShownAt: null,
        popunderShownAt: [now, now - 1, now - 2, now - 3],
      }),
    )}; Path=/; SameSite=Lax`;

    render(<AdsterraPopunder />);
    expect(document.head.querySelector(POPUNDER_SCRIPT_SELECTOR)).toBeNull();
  });

  it("still injects with three opens inside the 24-hour window", () => {
    const now = Date.now();
    document.cookie = `metria_ad_visitor=${encodeURIComponent(
      serializeVisitorState({
        id: "test-visitor",
        popStyleShownAt: null,
        popunderShownAt: [now, now - 1, now - 2],
      }),
    )}; Path=/; SameSite=Lax`;

    render(<AdsterraPopunder />);
    expect(document.head.querySelector(POPUNDER_SCRIPT_SELECTOR)).not.toBeNull();
  });
});
