"use client";

import { useEffect } from "react";
import { ADSTERRA_UNITS } from "./config";

/**
 * Adsterra Social Bar (unit 31803283, SS11).
 *
 * The Social Bar is a body-level script with no DOM target. It is appended
 * after mount and removed on unmount so client navigations never accumulate
 * copies. It renders nothing itself.
 *
 * Safety: this is the only unit that injects outside a reserved box. It is
 * mounted exactly once per ad surface: on the landing page by the public gate
 * and in the app shell by AppAdsterraUnits (private gate). Both require
 * consent; /auth/* and /admin/* never mount it.
 */

const UNIT = ADSTERRA_UNITS.social_bar;
const MARKER = "data-ad-network-script";
const MARKER_VALUE = "adsterra-social-bar";

export function AdsterraSocialBar() {
  useEffect(() => {
    const existing = document.querySelector(`script[${MARKER}="${MARKER_VALUE}"]`);
    if (existing) return;

    const script = document.createElement("script");
    script.setAttribute("data-cfasync", "false");
    script.src = UNIT.scriptUrl;
    script.setAttribute(MARKER, MARKER_VALUE);
    script.setAttribute("data-ad-unit-id", UNIT.unitId);
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return null;
}
