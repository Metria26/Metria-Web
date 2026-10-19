import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdsterraBanner468 } from "./banner-468";
import { AdsterraNativeBanner } from "./native-banner";
import { AdsterraSocialBar } from "./social-bar";
import { ADSTERRA_UNITS } from "./config";

/**
 * SS11 component boundary: the exact Adsterra markup (script URLs, container
 * id, 468x60 iframe) is produced only after mount, labelled, and cleaned up on
 * unmount. Server-side gating is covered by public-surface tests; these assert
 * the client injection contract the e2e suite then verifies end to end.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

afterEach(() => {
  cleanup();
  document.body.querySelectorAll("script[data-ad-unit-id]").forEach((el) => el.remove());
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
