# Adsterra Popunder Implementation Plan

Status: implemented 2026-11-06; revised 2026-11-07 (open-based 4-per-24-hour
cap). Code, copy, docs and targeted tests complete; deployment and Adsterra
dashboard/support follow-up are pending.

## Objective

Add the Adsterra Popunder unit alongside the existing Adsterra Native Banner and
Social Bar so public pages and every authenticated `/app` page can serve
popunder traffic, while `/auth/*`, `/admin/*` and error routes stay ad-free.

Popunder has no visual layout. The revenue levers are page scope, load timing,
frequency, and avoiding stacked formats. The implementation therefore focuses
on a single script per document, a first-party 4-per-24-hour cap counting real
popunder opens, consent, and the existing kill switches.

## 2026-11-07 revision (current)

The 2026-11-06 build capped **script loads** at 2 per 24 hours and recorded a
load on every full page view. Two visits (or reloads) exhausted the day's
allowance even when no popunder appeared, which blocked popunders for the rest
of the day and contradicted the owner's 4-per-day requirement. This revision:

- Allows **4 popunder opens per rolling 24 hours per browser**, matching the
  owner preference and the site copy.
- Counts a slot only when Adsterra's script actually calls
  `window.open(url, "_blank")` and receives a window. Page loads, reloads, and
  non-ad interactions no longer consume slots.
- Stops injecting the popunder script after 4 opens in the 24-hour window.
- Leaves focus behavior to Adsterra support for now; no `window.open` focus
  monkey-patch in this revision.
- Keeps Adsterra's dashboard/support cap as the authoritative impression
  limiter: configure **4 impressions per user per 24 hours** there.
- Requires no database change; production already has the popunder flag and
  `private.ad_kill_state` field applied (the local migration is idempotent and
  remains the source of truth for clean environments).

### Owner/support request (Adsterra, website 6133098)

Write to Adsterra support with:

1. Confirm the popunder unit is active for `https://metria-web.onrender.com`
   and set the frequency cap to **4 impressions per user per 24 hours**.
   Confirm whether the cap counts impressions or opened tabs, and whether it is
   per browser cookie or per IP.
2. Ask for a setting or updated script that opens the popunder in a background
   tab without taking focus. The current reviewed script is
   `https://abscloud.org/1/d5d5a4efeec12f60a2b9db7ddf75914b`; the site loads it
   in the page head after consent.
3. If native/social ads serve but the dashboard shows zero popunder
   impressions, ask them to check unit moderation/fill for this domain.

Do not add a `window.open` focus monkey-patch until support answers.

## Owner decisions

- Public scope: landing page plus `/privacy`, `/terms`, `/about`, `/contact`.
- Authenticated scope: every `/app` page.
- Frequency: four popunder opens per 24 hours per browser; also configure the Adsterra dashboard/support cap to 4 impressions per user per 24 hours.
- Independent kill switch: `ads.popunder.enabled`, toggleable from `/admin/ads`.
- The 468x60 unit stays registered but unmounted (removed 2026-10-25 because it
  rendered empty boxes). Stale e2e expectations for it will be fixed.
- Auth transitions that could otherwise leave popunder listeners alive use hard
  reloads (sign out and the public "Open app" link).
- Tracked docs and privacy/terms copy will be updated.

## Popunder code

```html
<script data-cfasync="false" src="https://abscloud.org/1/d5d5a4efeec12f60a2b9db7ddf75914b"></script>
```

- Host: `https://abscloud.org`
- Smartlink remains forbidden.

## Implementation

### 1. Database and flag

- New migration `supabase/migrations/20261106120000_b_ads_popunder_flag.sql`.
  - Idempotently insert `ads.popunder.enabled=true` for every university.
  - Replace `private.ad_kill_state` so its `flags` object includes
    `popunder_enabled` (absent flag fails closed as `false`).
- Add the flag to `supabase/seed.sql` Section 6.
- Add a pgTAP assertion in `supabase/tests/monetization-ads.rls.test.sql`.
- Update `docs/SYMBOL_REGISTRY.md`.

### 2. Contracts and admin

- `src/features/ads/contracts.ts`: add
  `popunder_enabled: z.boolean().default(false)`.
- `src/features/ads/admin/contracts.ts`: add `ads.popunder.enabled` to
  `ADS_FLAG_KEYS`.
- `messages/en.json`: add the AdminAds label and disclose popunder/frequency
  behavior in privacy/terms.

### 3. Config, visitor state, component

- `src/features/ads/adsterra/config.ts`: add `popunder` to `AdsterraUnitKey` and
  `ADSTERRA_UNITS`; add `ADSTERRA_POPUNDER_HOST`; allow `/`, `/privacy`,
  `/terms`, `/about`, `/contact`; keep Smartlink absent.
- `src/features/ads/visitor.ts`: extend the first-party state with
  `popunderShownAt: number[]`; add 4-per-24-hour prune/check/record helpers.
  `POPUNDER_MAX_OPENS = 4`, `POPUNDER_WINDOW_MS = 24h`. Keep backward
  compatibility with the old cookie shape.
- New `src/features/ads/popunder-cookie.ts`: client-side cookie read/write and
  `popunderAllowedNow()` / `recordPopunderOpen()` helpers.
- New `src/features/ads/popunder-open-tracker.ts`:
  - Installs once per document before the popunder script.
  - Wraps `window.open`; when a `_blank` call returns a window, records one
    popunder open in the first-party cookie.
  - Does not change focus and does not block opens. Adsterra's dashboard cap is
    the impression limiter; blocking in-page would affect unrelated `_blank`
    calls.
- New `src/features/ads/adsterra/popunder.tsx`:
  - Client component, renders nothing.
  - Injects once into `document.head` with
    `data-ad-network-script="adsterra-popunder"`.
  - `async`, `data-cfasync="false"`, the reviewed script URL and a unit marker.
  - Installs the open tracker before injection and no longer records script
    loads.
  - Does not remove the script on unmount and does not retry in the same
    document; third-party listener teardown is not reliable. The hard reloads
    below protect the auth boundary, and the marker prevents duplicates across
    client navigation.

### 4. Gates and mounts

- `public-surface-rules.ts`: expose `popunderEnabled` on the surface and add
  `publicPopunderAllowed`.
- `private-surface-rules.ts`: expose `popunderEnabled` and add
  `privatePopunderAllowed`.
- Mount conditionally:
  - `src/app/page.tsx`
  - `src/components/public/public-page.tsx`
  - `src/features/ads/adsterra/app-units.tsx`
- Update stale "three units" comments in the ads surface files.

### 5. CSP and auth boundary

- `next.config.ts`: add `https://abscloud.org` to `script-src`, `connect-src`
  and `frame-src` in the existing Report-Only CSP.
- `src/components/shell/sign-out-button.tsx`: replace `router.push` with a hard
  `window.location.replace("/auth/sign-in")`.
- `src/components/public/public-shell.tsx` and the landing CTA: use a plain
  `<a href="/app">` so anonymous redirects to `/auth/sign-in` start a fresh
  document.

### 6. Tests

- `adsterra.validation.test.ts`: four registered units, popunder host/URL,
  Smartlink still absent, public popunder gate behavior.
- `adsterra-components.test.tsx`: popunder injection, marker, cap blocking,
  no duplicate after re-mount, no cookie write on script load, one cookie entry
  per successful `_blank` open, no entry for blocked or non-`_blank` opens.
- `private-surface-rules.test.ts`: private popunder gate.
- `ads.validation.test.ts` and `adslot.validation.test.tsx`: updated kill-state
  fixtures and visitor state.
- `admin-ads.validation.test.ts`: new flag key.
- New `popunder-frequency.test.ts`: 24h window, expiry, malformed cookies,
  backward compatibility, four opens allowed and the fifth blocked, only the
  newest four retained.
- E2E:
  - `e2e/helpers/test.ts`: abort `abscloud.org` by default.
  - `e2e/landing.ads.spec.ts`: add the popunder flag to on/off lists, assert the
    popunder script, remove stale 468 assertions, cover legal pages.
  - `e2e/ads.safety.spec.ts`: assert popunder on app pages and no ad markup on
    auth pages; update the stale 468 expectations.
  - Keep all live ad-network requests blocked in tests.

### 7. Docs

- `plan.md` section 11.
- `README.md` ads status, migration/flag/test counts.
- `docs/DECISIONS.md`: amend D13 and add ADR-013.
- `docs/06-growth-and-ads/ad-system-spec.md`: scoped 24h exception.
- `docs/06-growth-and-ads/ad-network-setup-checklists.md`: host list and
  popunder QA.
- `adsterra-integration.md` (gitignored): move popunder into scope, keep
  Smartlink forbidden, record the current code.

## Verification

- Targeted vitest for the changed ads files:
  `popunder-frequency.test.ts` and `adsterra-components.test.tsx`.
- ESLint on changed files. No full build/typecheck/E2E on the low-RAM machine.
- No database change required for this revision. Verify
  `public.ad_kill_state` still returns `popunder_enabled=true` (already true in
  production).
- Owner QA (incognito, consent granted, Render URL):
  - popunder script appears on public and `/app` pages;
  - each actual popunder tab increments `popunderShownAt` in
    `metria_ad_visitor`;
  - after four opens in 24 hours, a full reload does not inject the script
    (the network cap handles any extra in-page open);
  - clear the cookie or use incognito for repeat QA (existing load timestamps
    count toward the new open cap);
  - consent denied: no script; `/auth/*`, `/admin/*`, 404: no script;
  - master, public/private, popunder and network kills all stop it;
  - sign out and public "Open app" land on a fresh document.
- Adsterra dashboard/support:
  - confirm the popunder unit is active and set the cap to 4 impressions per
    user per 24 hours;
  - check today's popunder impressions when native/social serve but no popunder
    appears;
  - ask support for a background-tab/non-focus variant; only consider a
    `window.open` focus wrapper if support cannot help.
- Monitor Adsterra impressions/RPM and site bounce/retention for 1-2 weeks.
- Rollback: turn off `ads.popunder.enabled` in `/admin/ads`; no deploy needed.

## Risks

- Four opens per 24 hours matches the owner preference and site copy. The cap
  is per browser; clearing cookies resets it (same as the existing D13 design).
- The first-party cap counts successful `window.open` calls, not confirmed
  impressions; Adsterra's dashboard cap is the impression limiter.
- The tracker wraps `window.open` for the document lifetime. The app currently
  makes no JS `window.open` calls; scope the wrapper to `_blank` and revisit if
  first-party code adds any.
- If Adsterra changes its open path away from `window.open`, the tracker will
  under-count and Adsterra's cap remains the only limiter.
- A popunder script that has already executed cannot be fully torn down by
  removing its script tag. Hard reloads are the reliable auth-boundary control.
- The host must stay in the reviewed CSP allowlist; report-only violations must
  be monitored.
- Production is the staging database: future migration changes need a snapshot.
