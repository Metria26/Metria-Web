# Adsterra Popunder Implementation Plan

Status: approved 2026-11-06. Build in progress.

## Objective

Add the Adsterra Popunder unit alongside the existing Adsterra Native Banner and
Social Bar so public pages and every authenticated `/app` page can serve
popunder traffic, while `/auth/*`, `/admin/*` and error routes stay ad-free.

Popunder has no visual layout. The revenue levers are page scope, load timing,
frequency, and avoiding stacked formats. The implementation therefore focuses
on a single script per document, a first-party 2-per-24-hour load cap, consent,
and the existing kill switches.

## Owner decisions

- Public scope: landing page plus `/privacy`, `/terms`, `/about`, `/contact`.
- Authenticated scope: every `/app` page.
- Frequency: twice per day (2 per 24 hours); also configure the Adsterra dashboard/support cap accordingly.
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
  `popunderShownAt: number[]`; add 2-per-24-hour prune/check/record helpers.
  Keep backward compatibility with the old cookie shape.
- New `src/features/ads/popunder-cookie.ts`: client-side cookie read/write and
  `popunderAllowedNow()` / `recordPopunderLoad()` helpers.
- New `src/features/ads/adsterra/popunder.tsx`:
  - Client component, renders nothing.
  - Injects once into `document.head` with
    `data-ad-network-script="adsterra-popunder"`.
  - `async`, `data-cfasync="false"`, the reviewed script URL and a unit marker.
  - Records a load only on the script `load` event.
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
  no duplicate after re-mount, cookie write on load.
- `private-surface-rules.test.ts`: private popunder gate.
- `ads.validation.test.ts` and `adslot.validation.test.tsx`: updated kill-state
  fixtures and visitor state.
- `admin-ads.validation.test.ts`: new flag key.
- New `popunder-frequency.test.ts`: 24h window, expiry, malformed cookies,
  backward compatibility.
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

- Targeted vitest for the changed ads files.
- ESLint on changed files.
- TypeScript check once after the contract changes.
- Database snapshot before applying the migration (staging-as-prod, ADR-010).
- Verify `public.ad_kill_state` returns `popunder_enabled=true`.
- Owner QA:
  - consent granted: popunder script appears on public and `/app` pages;
  - consent denied: no script;
  - `/auth/*`, `/admin/*`, 404: no script;
  - master, public/private, popunder and network kills all stop it;
  - `/admin/ads` toggle applies within the kill-state cache TTL;
  - sign out and public "Open app" land on a fresh document.
- Monitor Adsterra impressions/RPM and site bounce/retention for 1-2 weeks.
- Rollback: turn off `ads.popunder.enabled` in `/admin/ads`; no deploy needed.

## Risks

- 2 per 24h is much friendlier for repeat students and protects retention.
- The first-party cap limits script loads, not confirmed impressions; Adsterra's
  dashboard cap is the impression limiter.
- A popunder script that has already executed cannot be fully torn down by
  removing its script tag. Hard reloads are the reliable auth-boundary control.
- The host must stay in the reviewed CSP allowlist; report-only violations must
  be monitored.
- Production is the staging database: migration changes need a snapshot.
