> Purpose: Executable development plan for the MVP scope (Foundation + Marks + Booking + Ads)
> Audience: the coding agent executing this plan, and the founder performing setup steps
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`, `docs/09-ai-agent-setup/AGENTS.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Metria — MVP Development Plan (Marks + Booking + Ads)

## 0. What this plan is

This is the single working document the coding agent follows to build the MVP. It sequences the
existing rigid task cards in `docs/08-delivery/` and adds project initialization (repo, libraries,
tooling) which the cards assume but do not spell out.

**Authority:** `docs/` remains the source of truth. Where this plan and a doc conflict, the doc
wins. This plan never invents requirements — it only sequences, initializes, and scopes.

### MVP scope (in)
| Feature area | Feature IDs | Cards |
|---|---|---|
| Foundation & auth (Google login, tenancy, RLS) | G1–G9, 1.1–1.4 | T-S001, T-A002 |
| Marks module (catalog, assessments, marks, CSV importer, marksheet, announcements, dashboard, TA analytics) | 2.1–2.6 | T-A003, T-A004, T-A005 |
| Booking module — base only (evaluation periods, slots, capacity, cancel/cutoff) | 3.1–3.2 | T-A006 |
| Ads module (schema, resolver, consent, kill switches, isolation, admin config) — built in parallel, deployed later | 10.1–10.6, R1, R2, R3 | T-B002, T-B003 |

### Out of scope for MVP (deferred, unchanged in docs)
- Social booking 3.3–3.6 (T-A007), objections 4.x (T-A008), messaging, coursework, calendar,
  notifications, PWA push.
- Revenue/visit payouts activation 10.7–10.9 (T-B005, T-B006) — schema may exist but stays dark.
- Public SEO/content layer (T-B001, T-B004) — **strongly recommended immediately after MVP**
  (see §9), because ads earn nothing without traffic.
- Admin moderation extras, reviews, chatbot, TA tools.

### Deployment strategy (locked with founder)
1. Build **Marks + Booking + Ads code** with ads fully flag-gated: `ads.enabled=false`,
   `ads.public.enabled=false`, `ads.private.enabled=false`, `ads.global_kill=true` at seed.
2. Deploy **Marks + Booking** to production first. Verify stability.
3. **Only then** configure the ad network, set placement config, and flip flags on in production
   (admin action or audited SQL). Kill switch tested before flip.

### Investment-free constraint
No Vercel, no paid plans anywhere. Hosting = free self-hostable target chosen at deploy time
(§7). All SaaS on free tiers. R9 monitoring applies: stay within free-tier DB size/egress/
connections; optimize/archive before any capacity change.

---

## 1. Step 0 — Founder setup (do this BEFORE any code is written)

**Owner: founder. Not delegated to the agent.** One-time, all free.

### 1.1 Tooling (local machine)
| Tool | Why | Check |
|---|---|---|
| Node.js LTS (current LTS, major pinned later in `package.json` `engines`) | runtime | `node -v` |
| pnpm (via `corepack enable`) | package manager (D1) | `pnpm -v` |
| Git | version control | `git -v` |
| WSL2 | local Supabase requires containers | `wsl` |
| Supabase CLI (installed as repo dev dep, see §3) | migrations only (L4) | `pnpm exec supabase --version` |
| VS Code (or chosen editor) + ESLint/Prettier extensions | editing | — |

### 1.2 Business-owned free accounts (per `docs/10-ops/day0-accounts-and-secrets.md`)
1. **Google account** (business-owned) → Google Cloud Console: create OAuth 2.0 Client ID
   (Web). Authorized redirect URI for dev: `http://localhost:3000/auth/callback`. Keep the
   client secret — it is a Day 0 secret.
2. **GitHub account/org** for the repository.
3. **Supabase** free-tier organization + project (create now or after local setup; local dev
   works fully offline, hosted project is needed for staging/production).
4. **Resend** free tier (email) — can wait until notifications ship; note as pending.
5. **Sentry** free tier (error tracking) — optional at MVP, add when deploying.
6. **Password manager** → record secrets inventory (Day 0 checklist in docs): OAuth client id/
   secret, Supabase anon key, service-role key, `BOOTSTRAP_ADMIN_EMAIL`, later Resend/Sentry/
   VAPID/CRON secrets. Never commit secrets.
7. Domain registrar: optional for MVP (Google OAuth works with `localhost` in dev). Needed
   before production deploy — decide the domain then.

### 1.3 Environment contract
Create `.env.example` (placeholders only) with at minimum the MVP subset of the registry env
vars (registry `Environment variables` section is authoritative):

```
NEXT_PUBLIC_PRODUCT_NAME=Metria
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server only, never NEXT_PUBLIC_
SUPABASE_DB_URL=                    # pooled/direct URL from supabase start
BOOTSTRAP_ADMIN_EMAIL=              # your Google email for one-time admin seed
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
```

Runtime validation: a small zod env schema in `src/lib/env.ts` (server-side) that throws fast
on missing vars; service-role key importable only from server modules. `Sentry`, `Resend`,
`VAPID`, `CRON_SECRET`, `NEXT_PUBLIC_GA_ID` are added when their features ship — do not invent
values now.

**Exit criteria for Step 1:** all tools respond to version checks; accounts exist; secrets
recorded in the password manager; `.env.example` committed with placeholders.

---

## 2. Phase 0 — Project initialization (exact commands)

Repo currently contains only `docs/` + `plan.md` + `.git`. The app is scaffolded into the repo
root (modular monolith, single app — L5).

### 2.1 Scaffold
```powershell
# in C:\Users\HP\OneDrive\Desktop\Metria-Web
corepack enable
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
# If prompted about a non-empty directory (docs/, plan.md exist): confirm/continue.
# When asked about Turbopack: accept default (irrelevant to spec).
```
Then immediately pin versions via lockfile (never copy stale versions — `tech-stack-and-versions.md`):
commit `pnpm-lock.yaml`, add `"packageManager"` and `"engines"` fields to `package.json`.

TypeScript config: `strict: true` (L2), `noUncheckedIndexedAccess: true` recommended.

### 2.2 Libraries (full MVP list — install exactly these, nothing more)

**Runtime / app dependencies**
| Package | Purpose | Doc source |
|---|---|---|
| `next`, `react`, `react-dom` | App Router framework | L2 |
| `typescript` | strict TS | L2 |
| `tailwindcss` | styling | L2 |
| shadcn/ui (via `pnpm dlx shadcn@latest init` + add: `button`, `card`, `dialog`, `dropdown-menu`, `input`, `label`, `select`, `table`, `tabs`, `toast`, `sonner`, `skeleton`, `badge`, `separator`, `sheet`, `form` as needed) | UI primitives | L2 |
| `next-intl` | i18n scaffold, no hard-coded strings (L12) | L12 |
| `@supabase/supabase-js` | DB/Auth client | L1, L3 |
| `@supabase/ssr` | server/client session handling for App Router | L1 |
| `zod` | validation at every server boundary (D3) | D3 |
| `@tanstack/react-query` | client-side realtime/interactive screens only (D2) | D2 |
| `papaparse` (+ `@types/papaparse`) | CSV client-side pre-parse for importer UX (D9) | D9 |
| `recharts` | TA analytics charts, lazy-loaded (D7) | D7 |
| `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm` | rich text for announcements, sanitized HTML+JSON (D8) | D8 |
| `sanitize-html` (or isomorphic-dompurify) | server-side sanitization on write AND render (D8, XSS tests) | D8 |
| `resend` | email adapter (behind interface) — install when notifications ship, MVP may skip | D4 |
| `satori` + `@resvg/resvg-js` | OG image generation (free, self-hosted; replaces @vercel/og) | L2 (free-only edit) |
| `@sentry/nextjs` | error tracking, free tier — optional at MVP, add before deploy | D5 |

**Dev dependencies**
| Package | Purpose |
|---|---|
| `supabase` (Supabase CLI as dev dep) | `pnpm exec supabase ...` — local stack + migrations (L4) |
| `vitest`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react` | unit/component tests (L11) |
| `@playwright/test` | e2e (L11) |
| `eslint`, `eslint-config-next`, `prettier`, `eslint-config-prettier` | lint/format |
| `husky`, `lint-staged` | pre-commit hooks (D1) |
| `pgtap` | installed inside the local Supabase container by `supabase test db` (no npm install needed) |

**Do not add:** any ORM (L3), any paid SDK, axios (fetch is native), date libs (use `Intl`/
`Temporal`-free built-ins per docs — no doc-mandated date lib exists), state libraries beyond
what docs name.

### 2.3 Folder structure (from `docs/02-architecture/repo-structure-and-conventions.md`)
```
/
├─ docs/                      # source of truth (rigid)
├─ plan.md                    # this file
├─ package.json / pnpm-lock.yaml / tsconfig.json
├─ .env.example               # placeholders only
├─ .github/workflows/ci.yml   # CI
├─ CODEOWNERS
├─ src/
│  ├─ app/
│  │  ├─ (public)/            # /, /about, /legal/* … (B lane later)
│  │  ├─ (auth)/              # /auth/* — noindex, zero ad scripts
│  │  ├─ (private)/app/       # /app/* — noindex
│  │  └─ (admin)/admin/       # /admin/* — noindex
│  ├─ features/
│  │  ├─ auth/                # login, access-denied, membership
│  │  ├─ academics/           # catalog, assessments, marks, importer, marksheet, announcements
│  │  ├─ booking/             # periods, slots, bookings
│  │  └─ ads/                 # resolver client, AdSlot, consent, banners
│  ├─ lib/
│  │  ├─ supabase/            # browser/server clients, middleware
│  │  ├─ env.ts               # zod env validation
│  │  ├─ contracts/           # shared zod schemas
│  │  └─ utils.ts
│  └─ components/ui/          # shadcn components
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/             # only schema authority (L4)
│  ├─ tests/                  # pgTAP (copied from docs/03-database/tests/)
│  └─ functions/              # edge functions (later)
├─ e2e/                       # Playwright specs
└─ vitest.config.ts
```

### 2.4 Supabase local init
```powershell
# Docker must be running
pnpm add -D supabase
pnpm exec supabase init            # creates supabase/config.toml
pnpm exec supabase start           # local Postgres + Auth + Studio
pnpm exec supabase status          # record local URLs/keys → .env.local
```

### 2.5 Test harness
- **Vitest**: `vitest.config.ts`, test dir convention `src/**/*.test.ts(x)`.
- **Playwright**: `pnpm exec playwright init`, `e2e/` specs, `playwright.config.ts` runs
  against `pnpm dev` (later against preview build).
- **pgTAP**: copy the four MVP module test files into `supabase/tests/`:
  `foundation-auth.test.sql`, `core-academics.test.sql`, `evaluation-booking.test.sql`,
  `monetization.test.sql` (from `docs/03-database/tests/`). Run: `pnpm exec supabase test db`.

### 2.6 Scripts (`package.json`)
```jsonc
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "test:db": "supabase test db",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > src/lib/supabase/database.types.ts"
  }
}
```

### 2.7 CI (`.github/workflows/ci.yml`, free-tier minutes)
On every PR: install (frozen lockfile) → lint → typecheck → unit tests → build →
**migration lint** (filename must match `<UTC ts>_{s|a|b}_<module>_<slug>.sql` — migration-plan.md)
→ local stack up + `supabase db reset` (clean apply) + `supabase test db` → **secret guard**
(fail if `SUPABASE_SERVICE_ROLE_KEY`-like value appears outside `.env*`). Playwright e2e runs
on main/preview (keep PR fast).

### 2.8 Pre-commit
Husky + lint-staged: prettier + eslint on staged files.

**Exit criteria for Phase 0 init:** `pnpm dev` boots a Next.js app on :3000; `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build` all pass; `supabase start` healthy; CI green on the
initial PR.

---

## 3. Phase 0 — Foundation Gate (T-S001 + T-A002)

**Card:** `docs/08-delivery/shared/tasks/T-S001-foundation-gate.md` (read it fully before starting),
then `docs/08-delivery/lane-a/tasks/t-a002-auth-and-tenant-membership.md`.

### F1 — Foundation migration
- Source SQL (copy verbatim into one migration, preserving order): from
  `docs/03-database/schema/foundation-auth.sql` → `docs/03-database/rls/foundation-auth.sql`
  → `docs/03-database/functions/foundation-auth.sql`.
- Filename: `supabase/migrations/<UTCtimestamp>_s_foundation_auth.sql` (lane `s`, one file, one PR).
- Append a rollback note at the bottom (expand/contract rule, P7).
- Apply: `pnpm exec supabase db reset`. Then generate types: `pnpm run db:types`.
- Seed: `docs/03-database/seed/foundation-auth.sql` → FAST-NUCES Lahore tenant, allowed domain
  `lhr.nu.edu.pk`, role catalog (`student`, `ta`, `teacher`), permissions catalog
  (registry `Permissions` section), role_permissions mappings, and **feature flags seeded with
  `ads.enabled=false`, `ads.public.enabled=false`, `ads.private.enabled=false`,
  `ads.global_kill=true`** (verify actual flag rows in the seed SQL; adjust the seed if it
  ships different defaults — flag defaults must be OFF for MVP deploy strategy).

### F2 — pgTAP foundation tests
- Copy `docs/03-database/tests/foundation-auth.test.sql` → `supabase/tests/`, run
  `pnpm exec supabase test db`. Must include allowed / denied / **cross-tenant** cases (P11).

### F3 — Auth flow (T-A002, features 1.1–1.2)
- Supabase Google OAuth (dev: localhost redirect URI) via `@supabase/ssr` middleware session.
- **Server-side domain allowlist enforcement** (L6): Supabase Auth hook/trigger validating the
  verified email domain against `university_domains` — denied domain → `/auth/access-denied`
  page, no membership created, rate-limited security event. UI checks are cosmetic only.
- Routes: `/auth/*` = noindex + **zero ad scripts** (R3; enforced in code now, DB constraint
  comes with the ads module); `/app/*` = noindex, authenticated SSR.
- Bootstrap first platform admin: one-time audited SQL seed using `BOOTSTRAP_ADMIN_EMAIL` (D20)
  — run once locally, record actor/time.
- Profile + membership + invite/approval flow per `docs/01-product/modules/foundation-auth.md`.

### F4 — App shell & design system
- Tokens, layout, mobile-first nav, global error/empty/loading states per
  `docs/05-frontend/design-system.md`. Product name from `NEXT_PUBLIC_PRODUCT_NAME` only (L/R6).
- `next-intl` scaffold: no hard-coded UI strings (L12).

### F5 — Foundation Gate checklist (from `docs/08-delivery/milestones-and-gates.md` P0 row)
- [ ] Repo/tooling/CI green on clean clone
- [ ] Local Supabase up; migrations apply clean; `db:types` generated
- [ ] Auth tenant skeleton: Google login + domain denial + bootstrap admin
- [ ] RLS helpers present (`private.current_university_ids()`, `has_role()`,
      `is_offering_staff()`, `is_enrolled()`, `is_platform_admin()`) — `search_path=''`
- [ ] Seeds applied (university, domains, roles, permissions, flags-off)
- [ ] pgTAP harness running (foundation tests pass)
- [ ] Design tokens + app shell render on mobile viewport
- [ ] Secrets inventory recorded; `.env.example` matches reality

**Do not start feature cards until this checklist passes.**

---

## 4. Phase 1 — Track A: Marks module (sequential)

Execution order for each card: read the card file → load its `Context to load` files → implement
exactly card scope → run named tests → update registry/traceability if symbols changed → next.

### A1 — T-A003 Academic catalog and enrollment (features 1.3, 2.1)
Card: `docs/08-delivery/lane-a/tasks/t-a003-academic-catalog-and-enrollment.md`
- Migration `<ts>_a_core_academics.sql` from `docs/03-database/schema/core-academics.sql` +
  `rls/core-academics.sql` + `functions/core-academics.sql` (lane prefix `a`).
  Tables: departments, terms, courses, course_offerings, sections, enrollments, offering_staff,
  grading_scales, assessments, (+ supporting). Composite tenant FKs, updated_at triggers,
  indexes for every FK (verify with conventions doc).
- Seed: `docs/03-database/seed/core-academics.sql` (dev fixtures: term, department, course,
  offering, sections, staff + students for cross-tenant tests).
- pgTAP: `docs/03-database/tests/core-academics.test.sql` must pass (allow/deny/cross-tenant).
- UI: TA CRUD for students/courses/sections/assessments (2.1) under `/app/offerings/*` —
  server-side authorization via session + RLS, zod on every mutation.
- Registry check: no new symbols; if needed → registry delta first (P23).

### A2 — T-A004 Marks and CSV importer (features 2.2, 2.3)
Card: `docs/08-delivery/lane-a/tasks/t-a004-marks-and-csv-importer.md`
- `marks`, `mark_history`, `import_batches`, `import_rows` (schema/rls/functions already in the
  `core-academics` module files — if not applied in A1, extend migration per expand/contract;
  otherwise this card is app-layer only).
- **Manual marks entry** (TA only, RLS-tested: TA cannot edit marks of offerings they don't
  staff — R10).
- **CSV importer two-phase** (2.2): client pre-parse with Papaparse (row cap 10,000, 10 MiB —
  ADR-002) → server parse/validate → preview counts (ready/not_found/duplicate/invalid) stored
  server-side with expiry → **nothing written before confirm** → confirm is idempotent
  (import batch id + row hash, P9) → error CSV download.
- **Marksheet** (2.3): weighted total per `grading_scales`, missing/pending handling, class
  stats + anonymized rank via privacy-gated RPC (**k ≥ 5**, D10, P14). Rank without identities.
- Append-only `mark_history` on every mutation (P6); RPC writes history+audit atomically.
- Tests: importer idempotency + no-write-before-confirm (unit + DB uniqueness), marksheet
  math unit tests, pgTAP marks RLS (allowed/denied/cross-tenant), Playwright
  `marks.import.spec.ts` journey.

### A3 — T-A005 Dashboard and announcements (features 2.4, 2.5, 2.6)
Card: `docs/08-delivery/lane-a/tasks/t-a005-dashboard-and-announcements.md`
- Announcements per offering/section (Tiptap sanitized HTML+JSON, sanitize on write AND render,
  XSS tests — D8).
- Student dashboard: single RPC aggregating upcoming evaluations/booking slots/latest marks/
  announcements (per brief §4.2, keep it one call for speed).
- TA analytics (2.5): Recharts lazy-loaded (never on public critical path, D7) — distribution +
  per-section stats, all aggregates server-side with k ≥ 5.
- **Ad hooks:** `/app/dashboard` and marksheet layouts include the shared `<AdSlot>` component
  (from Track B, see B1) with reserved geometry — currently renders empty because flags are off.

---

## 5. Phase 1 — Track A: Booking module — base only (sequential, after A1)

### B1q — T-A006 Booking capacity and cancellation (features 3.1, 3.2)
Card: `docs/08-delivery/lane-a/tasks/t-a006-booking-capacity-and-cancellation.md`
- Migration `<ts>_a_evaluation_booking.sql` from `docs/03-database/schema/evaluation-booking.sql`
  + `rls/evaluation-booking.sql` + `functions/evaluation-booking.sql`.
  Tables: evaluation_periods, slots, bookings (+ waitlist/swap tables exist in schema but their
  features 3.4–3.6 stay dark behind flags — `booking.waitlist.enabled=false` default).
- **Correctness under concurrency (P19):** capacity + one-active-booking-per-period enforced by
  DB constraints (exclusion/unique) + transactional RPC `private.book_slot(...)` with row
  locking; `cancel_booking` RPC honors the per-period cutoff (default 6h — D11).
- **Mandatory concurrency test:** parallel Playwright/API test (two simultaneous bookings into
  the last slot → exactly one succeeds) + pgTAP capacity/unique cases.
- UI: period/slot browsing + booking + cancel under `/app/bookings/*`; typed conflict errors;
  mobile-first (book action must never be overlapped by an ad slot — spacing rule, P18/R1).
- Deferred: 3.3–3.6 (public schedule, peer visibility, chat, swaps, reminders, waitlist) =
  T-A007, flags stay off.

---

## 6. Phase 1 — Track B: Ads module (parallel with Track A after the Gate)

Track B runs **in parallel** (second session/agent) from the Foundation Gate onward. Its schema
cards do not touch Track A files (lane-prefixed migrations `b_`, feature dir `src/features/ads/`).

### AD1 — T-B002 Ad config, consent and kill switches (features 10.1–10.4, 10.6)
Card: `docs/08-delivery/lane-b/tasks/t-b002-ad-config-consent-and-kill-switches.md`
- Migration `<ts>_b_monetization_ads.sql` from `docs/03-database/schema/monetization.sql` +
  `rls/monetization.sql` + `functions/monetization.sql` + seed `docs/03-database/seed/monetization.sql`.
  (Module is one unit: includes page/ad registries + consent_records + visit/revenue tables —
  visit/revenue stay dark, flags off; that satisfies "schema ready at P1" without building 10.7–10.9.)
- Registries as **data**: `page_types` (incl. `login/auth` constrained to disabled — DB
  constraint, R3), `ad_formats` (is_pop_style, needs_consent, injection_mode, allowed pages),
  `ad_placements` (per page_type × network × format settings, priority/stack, slot ids, device
  targeting), `ad_networks`, `ad_config_versions` (immutable, rollback), `ad_kill_switches`
  (per-network + global).
- **Resolver** (contract from `docs/02-architecture/overview-and-diagrams.md` ad flow + ad-system
  spec): input (university, page_type, slot, consent, auth context, device) → ordered eligible
  units after kill switches, layer switches (public/private), auth exclusion, isolation mode,
  frequency cap, consent requirement. Edge config cache TTL ≤ 60s; kill state separate short TTL,
  client rechecks next page load; emergency direct-SQL kill documented in runbook.
- Frequency cap: 1 pop-style/user/24h, max 1 pop-style/page (D13) via random first-party storage
  ID (no fingerprinting).
- Consent: banner gating ad scripts by category, region-aware conservative defaults (ADR-004/005);
  privacy page lists networks generated from `ad_networks` data.
- Tests: resolver unit tests (all gates), pgTAP (auth page type constrained off, kill switch
  precedence, cross-tenant config isolation), flag defaults OFF assertions.

### AD2 — T-B003 Direct sponsors and ad isolation (feature 10.5, R1, R2, R3)
Card: `docs/08-delivery/lane-b/tasks/t-b003-direct-sponsors-and-ad-isolation.md`
- **`<AdSlot>` component** (`src/features/ads/`): reserved height (CLS ≤ 0.1, P18), lazy
  below-fold, async/deferred script load after consent, isolated adapter + error boundary,
  **failure/blocked → empty slot, never broken page**.
- Adapter interface: `resolve(config, context)`, `mount(slot, consent)`, `destroy()`,
  `report(error)` — network-specific code behind adapter; new network = data + adapter file.
- Isolation for private pages (R1): per-page-type `isolation_mode`
  (`iframe_only`/`no_script_ads`), tap-to-reveal on marks pages, CSP **Report-Only first** then
  enforced allowlists + Permissions-Policy + referrer policy.
- **Auth pages: zero ad scripts — enforced in code AND DB constraint (R3).**
- Layout rules: never over/adjacent to Book/Submit/Raise-objection actions; "Sponsored" label;
  never incentivize clicks.
- Direct sponsors: admin creatives (image URL, link, dates, label, page-type/university
  targeting), expiry automation; first-party bot-filtered counting deferred with 10.7.
- **Contract delivery for Track A:** export `resolveAdSlots(pageType, context)` + `<AdSlot>` as
  the shared layout contract so `/app/*` pages can mount slots from their first release.
- Tests: Playwright `ads.safety.spec.ts` — (a) zero ad scripts on `/auth/*`, (b) action-button
  spacing, (c) CLS < 0.1 with slots, (d) simulated network failure leaves empty slot, (e) kill
  switch removes units on next load.

### AD3 — Admin ads config (part of T-B002/T-B008 scope; MVP slice)
- Minimal `/admin/ads` screens: placements matrix, network on/off, **global + per-network kill
  switch buttons**, config version publish/rollback, feature-flag toggles.
- Access: `platform.manage_ads` permission, platform admin only; every change writes
  `audit_log` events `ad.config.changed` / `ad.kill_switch.changed` (registry event names).
- If admin module files (`docs/08-delivery/lane-b/tasks/t-b008-admin-moderation-and-flags.md`)
  are not yet built, this MVP slice lives in `src/features/ads/admin/` with the same permission
  checks; full admin console comes later.

---

## 7. Deployment (free) + ads gate

### DEP-1 — Choose and configure the free deployment target (founder decides, agent executes)
Candidates to verify at execution (free-tier terms change — check R9): a free-tier VM with
Docker (self-host `next start` standalone + hosted Supabase free project), or a free-tier PaaS
that runs Next.js. Requirements whichever is chosen: HTTPS domain, Docker or Node runtime,
persistent background process (ISR/revalidation + scheduled jobs via `pg_cron`/cron), fits
free egress/memory limits. Record the decision in `DECISIONS.md` as an ADR (docs are
implementation-agnostic here by design).

### DEP-2 — Production checklist (MVP subset of `docs/10-ops/launch-checklist.md`)
- [ ] Hosted Supabase production project; all migrations applied via CLI (never dashboard, L4)
- [ ] `BOOTSTRAP_ADMIN_EMAIL` admin bootstrapped once, audited (D20)
- [ ] Google OAuth production origins/redirects + domain hook configured
- [ ] Env secrets in hosting secret store; `.env.example` in sync; service role never in bundle
- [ ] CSP Report-Only on; robots/meta noindex on all `/app`, `/auth`, `/admin`
- [ ] Cross-tenant + booking concurrency + CSV idempotency tests green in staging
- [ ] Sentry (if added) scrubbing PII; uptime monitor on; backup + restore drill documented
- [ ] **Ads flags OFF** in production (`ads.enabled=false`, `ads.global_kill=true`)

### GATE — Ads enablement (only after Marks + Booking are live and stable in production)
1. Ad provider business account created (Adsterra first per brief), category blocks configured
   (adult/gambling/dating/VPN), per-network setup checklist from
   `docs/06-growth-and-ads/ad-network-setup-checklists.md`.
2. Insert network + placement config (admin UI or documented SQL), still behind `ads.enabled`.
3. Manual ad QA pass: auth pages clean, spacing/CLS checks green, kill switch rehearsed.
4. Flip `ads.enabled` + layer flags on for **public/safe page types first**; private marks-page
   formats last and only with isolation mode verified (R1).
5. Monitor: Search Console security issues, Safe Browsing, CWV, error rates (R2) for 1 week.

---

## 8. Working rules for the agent (per card, condensed from AGENTS.md)

1. Before any card: read `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`,
   `docs/09-ai-agent-setup/AGENTS.md`, then the card file — nothing else outside its
   `Context to load`.
2. Implement only card scope; keep every change deployable; one migration per PR, lane prefix,
   rollback note; registry names exactly; new name → registry delta first.
3. RLS default-deny; server-side tenant/role checks; zod at every server boundary; service role
   never in browser; no student data in logs.
4. Run the named tests before claiming done: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm exec supabase test db`, `pnpm exec playwright test`, `pnpm build`. Never claim a test
   passed without executing it.
5. Public reads only via `public_*` views; aggregates k ≥ 5; no student data public.
6. Stop and ask only for: missing secrets, legal decisions, or conflicts with locked decisions.
7. If this plan and a doc conflict → follow the doc, note the conflict, and record the fix as
   an ADR in `DECISIONS.md`.

---

## 9. Post-MVP priority (revenue reality, keep small)

Ads without traffic earn ~nothing. Immediately after the ads gate, take traffic cards next:
1. **T-B001** Public publication + legal pages (11.1, 11.2) — home, about, legal, university
   hub, course catalog pages (ISR, `public_*` views, canonical/structured data).
2. **T-B004** SEO calculators (11.3, 11.5) — GPA/CGPA, FAST absolute/relative, finals-needed,
   attendance per `docs/06-growth-and-ads/calculators-spec.md` (client-only, share links,
   WhatsApp). Highest organic potential, fully free.
3. **T-B005 → T-B006** visits/attribution → revenue share/payouts (10.7–10.9) when ad revenue
   starts landing; terms must state revenue share before activation (D15).
4. Then backfill deferred lanes: T-A008 objections, T-A007 social booking, T-A009+ etc.

---

## 10. Execution checklist (update as work completes)

- [ ] **Step 0** founder setup (tools, accounts, secrets, `.env.example`) — all done except Google Console redirect URI for the local Supabase OAuth callback (see README "F5 sign-off status")
- [x] **Phase 0 init** scaffold + libraries + folder structure + local Supabase + tests + CI (§2)
- [x] **Foundation migration** applied, types generated, seeds loaded, pgTAP green (§3 F1–F2)
- [x] **Auth** Google login + domain denial + bootstrap admin + app shell (§3 F3–F4) — done 2026-10-14; founder deviation: bootstrap admin email exempt from domain allowlist (D20); real Google roundtrip pending founder Console redirect URI; CI green on new repo (run 38619640718)
- [ ] **Foundation Gate** checklist signed (§3 F5) — agent-side items ALL verified green 2026-10-15 (lint/typecheck/vitest/build/db-reset/pgTAP 29/29/e2e 10/10); blocked ONLY on founder Google OAuth smoke + both-founders sign-off; RLS helpers `is_offering_staff()`/`is_enrolled()` shipped later in T-A003 (2026-10-15). Full status: README "F5 sign-off status — READ FIRST in a new session"
- [x] **T-A003** catalog/enrollment + migration `a_core_academics` (§4 A1) — done 2026-10-15: migration + 6 documented deviations (incl. F1 `auth_uid()` helper fix + `has_permission` registry delta), seed section 9, pgTAP 58/58, regenerated types, `/app/offerings/*` CRUD (contracts/actions/forms/i18n), e2e journey 12/12; gates all green (README phase log)
- [x] **T-A004** marks + CSV importer + marksheet (§4 A2) — done 2026-10-16: migration `a_marks_import` + 5 documented deviations (D-g…D-k incl. public RPC wrappers for PostgREST), registry delta, `/app/marks*` + importer + marksheet UI, vitest 47/47, pgTAP 127/127, e2e 14/14; gates all green (README phase log)
- [x] **T-A005** dashboard + announcements + TA analytics (§4 A3) — done 2026-10-16: migration `a_announcements_dashboard` (narrow announcements RLS + `private.student_dashboard()` + `private.offering_analytics()` with k>=5 suppression, public wrappers), `/app` dashboard (one bounded RPC), Tiptap announcement editor + sanitize on write AND render, section announcements list, staff-only lazy-Recharts analytics; vitest 58/58, pgTAP 148/148 (new file plan(21)), e2e dashboard journey 2/2 (standalone), build ✅; gates re-verified 2026-10-16 post-completion — vitest 58/58, db reset clean (5 migrations), pgTAP 148/148, e2e 2/2 (1 worker)
- [ ] **T-A006** booking base + concurrency test (§5)
- [ ] **T-B002** ads schema + resolver + consent + kill switches (parallel, §6 AD1)
- [ ] **T-B003** AdSlot + isolation + sponsors + Playwright ad safety (§6 AD2)
- [ ] **Admin ads slice** config + kill switch UI + audit (§6 AD3)
- [ ] **DEP-1/2** free deployment + staging verification + prod flags OFF (§7)
- [ ] **GATE** Marks + Booking stable in prod → ad QA → enable ads (§7)
- [ ] **Post-MVP** T-B001 → T-B004 traffic cards (§9)

## Self-check
- [x] Purpose, audience, prerequisites, owner lane and registry version are stated.
- [x] Scope, gates, tests and operational constraints are explicit.
- [x] No paid services and no Vercel; investment-free constraints honored.
- [x] Every MVP feature ID maps to its existing doc card; deferred IDs are listed as deferred.
