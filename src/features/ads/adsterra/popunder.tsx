"use client";

import { useEffect } from "react";
import { popunderAllowedNow, recordPopunderLoad } from "../popunder-cookie";
import { ADSTERRA_UNITS } from "./config";

/**
 * Adsterra Popunder (ADR-013).
 *
 * A body/head-level script with no DOM target. It is injected once per document
 * after the consent and ads gates have mounted this component. A first-party
 * cap allows at most four script loads per two hours.
 *
 * The script is intentionally NOT removed on unmount or on error. Adsterra's
 * listeners may outlive the script element, so removing it gives false
 * confidence while adding churn. Instead the marker prevents duplicate copies
 * during client navigation, and sign-out/public "Open app" transitions do a
 * hard reload so a popunder cannot follow a user into `/auth/*`.
 */

const UNIT = ADSTERRA_UNITS.popunder;
const MARKER = "data-ad-network-script";
const MARKER_VALUE = "adsterra-popunder";

export function AdsterraPopunder() {
  useEffect(() => {
    if (document.querySelector(`script[${MARKER}="${MARKER_VALUE}"]`)) return;
    if (!popunderAllowedNow()) return;

    const script = document.createElement("script");
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    script.src = UNIT.scriptUrl;
    script.setAttribute(MARKER, MARKER_VALUE);
    script.setAttribute("data-ad-unit-id", UNIT.unitId);
    script.addEventListener("load", () => recordPopunderLoad());
    document.head.appendChild(script);
  }, []);

  return null;
}
