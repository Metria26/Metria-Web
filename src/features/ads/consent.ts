import { consentStateSchema, type ConsentCategories, type ConsentState } from "./contracts";

/**
 * Consent state (T-B002, ADR-004/005): first-party cookie only, no persistence
 * to consent_records yet (that table stays platform-admin-only until the
 * privacy/consent card). Defaults are conservative — every non-necessary
 * category is denied until the visitor opts in, in every region; region class
 * is exposed so jurisdiction-specific copy can hook in without changing the
 * stored state shape. A stale policy version invalidates stored consent.
 */

export const CONSENT_COOKIE = "metria_consent";
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const DEFAULT_CONSENT_POLICY_VERSION = "v1";

export function policyVersionFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.CONSENT_POLICY_VERSION?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_CONSENT_POLICY_VERSION;
}

export const EEA_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
]);

export type RegionClass = "eea" | "uk" | "ch" | "other";

export function regionClass(countryCode: string | null | undefined): RegionClass {
  const code = (countryCode ?? "").trim().toUpperCase();
  if (code === "GB" || code === "UK") return "uk";
  if (code === "CH") return "ch";
  if (EEA_COUNTRY_CODES.has(code)) return "eea";
  return "other";
}

export function defaultConsent(policyVersion: string): ConsentState {
  return { policyVersion, categories: { analytics: false, ads: false } };
}

/** True when the cookie holds valid consent for the current policy version. */
export function hasCurrentConsent(
  value: string | null | undefined,
  expectedPolicyVersion: string,
): boolean {
  if (!value) return false;
  try {
    const parsed = consentStateSchema.safeParse(JSON.parse(value));
    return parsed.success && parsed.data.policyVersion === expectedPolicyVersion;
  } catch {
    return false;
  }
}

/** Missing, malformed or stale cookies resolve to the conservative defaults. */
export function parseConsentCookie(
  value: string | null | undefined,
  expectedPolicyVersion: string,
): ConsentState {
  if (!value) return defaultConsent(expectedPolicyVersion);
  try {
    const parsed = consentStateSchema.safeParse(JSON.parse(value));
    if (!parsed.success || parsed.data.policyVersion !== expectedPolicyVersion) {
      return defaultConsent(expectedPolicyVersion);
    }
    return parsed.data;
  } catch {
    return defaultConsent(expectedPolicyVersion);
  }
}

export function serializeConsentState(state: ConsentState): string {
  return JSON.stringify({
    policyVersion: state.policyVersion,
    categories: state.categories,
  });
}

/** Categories granted by a choice; "necessary" is always implicit. */
export function chosenCategories(accept: boolean): ConsentCategories {
  return { analytics: accept, ads: accept };
}
