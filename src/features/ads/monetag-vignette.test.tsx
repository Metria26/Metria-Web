import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { CONSENT_CHANGED_EVENT, CONSENT_COOKIE, serializeConsentState } from "./consent";
import {
  MONETAG_VIGNETTE_SCRIPT_MARKER,
  MonetagVignette,
  clearMonetagVignetteState,
} from "./monetag-vignette";
import {
  isMonetagVignettePathAllowed,
  monetagVignetteAllowed,
  monetagVignetteSurface,
} from "./monetag-vignette-rules";

/**
 * Monetag Vignette: the loader must stay behind the existing consent,
 * kill-switch and private-route boundaries. These tests pin the browser-side
 * path gate, the per-document singleton and the fail-closed gate response.
 */

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

const fetchMock = vi.fn();

function setConsent(ads: boolean): void {
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
    serializeConsentState({
      policyVersion: "v1",
      categories: { analytics: ads, ads },
    }),
  )}; Path=/; SameSite=Lax`;
}

function allowResponse(allowed = true): void {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ allowed }),
  });
}

function vignetteScripts(): NodeListOf<HTMLScriptElement> {
  return document.querySelectorAll<HTMLScriptElement>(
    `script[data-ad-network-script="${MONETAG_VIGNETTE_SCRIPT_MARKER}"]`,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  clearMonetagVignetteState();
  navigation.pathname = "/";
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearMonetagVignetteState();
});

describe("Monetag Vignette path rules", () => {
  it("allows public pages and non-sensitive app pages", () => {
    for (const path of [
      "/",
      "/about",
      "/privacy",
      "/app",
      "/app/calendar",
      "/app/offerings/offering-1",
      "/app/offerings/offering-1/edit",
    ]) {
      expect(isMonetagVignettePathAllowed(path), path).toBe(true);
    }
  });

  it("blocks auth, admin, marks, marksheet and booking routes", () => {
    for (const path of [
      "/auth",
      "/auth/sign-in",
      "/auth/callback",
      "/admin",
      "/admin/ads",
      "/app/marks",
      "/app/marks/assessment-1",
      "/app/offerings/offering-1/marksheet",
      "/app/offerings/offering-1/marksheet/",
      "/app/bookings",
      "/app/bookings/new",
      "/app/bookings/period-1",
    ]) {
      expect(isMonetagVignettePathAllowed(path), path).toBe(false);
    }
  });

  it("uses the private surface only for /app paths", () => {
    expect(monetagVignetteSurface("/")).toBe("public");
    expect(monetagVignetteSurface("/about")).toBe("public");
    expect(monetagVignetteSurface("/app")).toBe("private");
    expect(monetagVignetteSurface("/app/calendar")).toBe("private");
  });

  it("fails closed when the surface or consent is closed", () => {
    expect(
      monetagVignetteAllowed({
        pathname: "/",
        surfaceOpen: true,
        consentGranted: true,
      }),
    ).toBe(true);
    expect(
      monetagVignetteAllowed({
        pathname: "/",
        surfaceOpen: false,
        consentGranted: true,
      }),
    ).toBe(false);
    expect(
      monetagVignetteAllowed({
        pathname: "/",
        surfaceOpen: true,
        consentGranted: false,
      }),
    ).toBe(false);
    expect(
      monetagVignetteAllowed({
        pathname: "/app/marks",
        surfaceOpen: true,
        consentGranted: true,
      }),
    ).toBe(false);
  });
});

describe("Monetag Vignette loader", () => {
  it("loads once on a public path after ads consent", async () => {
    setConsent(true);
    allowResponse(true);

    render(<MonetagVignette policyVersion="v1" />);

    await waitFor(() => expect(vignetteScripts()).toHaveLength(1));
    const script = vignetteScripts()[0]!;
    expect(script.src).toBe("https://n6wxm.com/vignette.min.js");
    expect(script.dataset.zone).toBe("12211513");
    expect(script.async).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/ads/monetag-vignette?path=%2F");
  });

  it("does not load without ads consent", async () => {
    allowResponse(true);

    render(<MonetagVignette policyVersion="v1" />);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(vignetteScripts()).toHaveLength(0);
  });

  it.each([
    "/auth/sign-in",
    "/admin/ads",
    "/app/marks",
    "/app/marks/assessment-1",
    "/app/offerings/offering-1/marksheet",
    "/app/bookings",
    "/app/bookings/new",
  ])("does not load on excluded path %s", async (pathname) => {
    navigation.pathname = pathname;
    setConsent(true);
    allowResponse(true);

    render(<MonetagVignette policyVersion="v1" />);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(vignetteScripts()).toHaveLength(0);
  });

  it("does not load when the kill switch or ads flags close the surface", async () => {
    setConsent(true);
    allowResponse(false);

    render(<MonetagVignette policyVersion="v1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await settle();
    expect(vignetteScripts()).toHaveLength(0);
  });

  it("loads only once across strict-mode mounts and client navigation", async () => {
    setConsent(true);
    allowResponse(true);

    const { rerender } = render(
      <StrictMode>
        <MonetagVignette policyVersion="v1" />
      </StrictMode>,
    );

    await waitFor(() => expect(vignetteScripts()).toHaveLength(1));

    navigation.pathname = "/about";
    rerender(
      <StrictMode>
        <MonetagVignette policyVersion="v1" />
      </StrictMode>,
    );
    await settle();

    expect(vignetteScripts()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes the script on an excluded route and never re-adds it", async () => {
    setConsent(true);
    allowResponse(true);

    const { rerender } = render(<MonetagVignette policyVersion="v1" />);
    await waitFor(() => expect(vignetteScripts()).toHaveLength(1));

    navigation.pathname = "/app/marks";
    rerender(<MonetagVignette policyVersion="v1" />);
    await waitFor(() => expect(vignetteScripts()).toHaveLength(0));

    navigation.pathname = "/";
    rerender(<MonetagVignette policyVersion="v1" />);
    await settle();

    expect(vignetteScripts()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads after the consent banner dispatches acceptance", async () => {
    allowResponse(true);

    render(<MonetagVignette policyVersion="v1" />);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    setConsent(true);
    act(() => {
      window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
    });

    await waitFor(() => expect(vignetteScripts()).toHaveLength(1));
  });
});
