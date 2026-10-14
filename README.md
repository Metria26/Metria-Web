# Metria

Multi-tenant academic evaluation/coursework platform (launch tenant: FAST-NUCES Lahore, `lhr.nu.edu.pk`) with a public SEO/ad-monetized layer and an authenticated student/TA layer (marks, evaluation-slot booking, announcements). Investment-free: free tiers only, no Vercel, no paid plans.

> **Documentation authority:** `docs/` is the permanent source of truth. `plan.md` is an *ephemeral* execution plan — it is replaced when a plan cycle completes. **This README is the living compacted record** of environment decisions, operational notes, and progress. Update it at the end of every phase/major task.

| Document | Role |
|---|---|
| `docs/00-INDEX.md` | Entry point, reading order, product boundary |
| `docs/DECISIONS.md` | Locked decisions (D1–D22), ADRs, rollback rule |
| `docs/SYMBOL_REGISTRY.md` | Canonical table/function/permission/flag/env names (v1) |
| `docs/TRACEABILITY.md` | Feature ID → module → card → test matrix |
| `docs/09-ai-agent-setup/AGENTS.md` | Master rules for coding agents (12 rules) |
| `plan.md` | Current MVP execution plan (Marks + Booking + Ads) — replace when done |
| **`README.md` (this file)** | Living operational record: env, WSL2, commands, phase log |

## Current status

- **Done:** Step 0 tooling · **Phase 0 init** (scaffold, libs, shadcn, folder structure, test harness, local Supabase, CI, pre-commit) · **Foundation Gate F1+F2+F3+F4** (foundation migration + seeds + generated types, pgTAP 16/16, auth domain allowlist + bootstrap admin + `/auth/*` + proxy gating (pgTAP 13/13, e2e 10/10), app shell + design tokens + next-intl) — verified 2026-10-14.
- **Remaining before F5 sign-off:** founder adds `http://127.0.0.1:54321/auth/v1/callback` to the Google Console OAuth client (real-login smoke), then reviews/signs the F5 checklist.
- **CI:** green on `MetriaAdmin123/Metria-Web` — run `38619640718` (commit `e9cb77f`, F3): `ci` ✅ `e2e` ✅ (e2e job boots Supabase itself with public demo keys). Actions had to be enabled on the new repo first (Settings → Actions → General).
- **Founder Step 0:** secrets filled into `.env.local` (bootstrap admin email, Google OAuth client ID/secret); cloud Supabase keys in gitignored `.env.cloud`. `Metria_Env.txt` deleted (was committed with secrets — history rewrite deliberately avoided).
- See `plan.md` §10 for the full MVP checklist.

## Tech stack (pinned via lockfile)

| Layer | Choice |
|---|---|
| Runtime | Node.js ≥ 22 (installed: v22.17.1), pnpm 10.34.7 |
| Framework | Next.js 16.4.0 App Router, React 19.3.0, TypeScript 5.9.3 (`strict` + `noUncheckedIndexedAccess`) |
| Styling | Tailwind CSS 4, shadcn/ui (15 components) |
| Data | Supabase (Postgres/Auth/Realtime/Storage), `@supabase/supabase-js` + `@supabase/ssr`, **no ORM** — logic in Postgres RPCs |
| Validation | zod 4 at every server boundary |
| i18n | next-intl (English scaffold, no hard-coded strings) |
| Client data | TanStack Query (interactive/realtime screens only) |
| Misc | Papaparse (CSV), Recharts (lazy), Tiptap + sanitize-html (rich text), Satori + resvg (OG images) |
| Tests | Vitest (unit), Playwright (e2e), pgTAP (DB/RLS) |
| Hosting | Free self-hostable target (decided at deploy time; NOT Vercel) |

Deferred installs (add when their features ship): `resend` (notifications), `@sentry/nextjs` (pre-deploy), shadcn `form` component (needs `react-hook-form`, not on the approved library list — use zod + server actions instead).

## Toolchain notes (Windows + WSL2 machine)

- **pnpm** installed via `corepack enable --install-directory %LOCALAPPDATA%\pnpm` (no admin; Node is in `C:\Program Files\nodejs`). Added to **user PATH** — new terminals pick it up; current shells may need `$env:Path = "$env:LOCALAPPDATA\pnpm;$env:Path"`.
  - **pnpm 12 is incompatible** with the bundled corepack 0.33.0 (bin layout mismatch). Stay on **pnpm 10** until corepack/Node is upgraded.
- **Docker:** NOT Docker Desktop. **Docker Engine 29.1.3 + compose v2 run inside WSL2 Ubuntu 24.04**, installed as root (`wsl -d Ubuntu -u root`).
  - Daemon listens on `unix:///var/run/docker.sock` **and** `tcp://127.0.0.1:2375` (override at `/etc/systemd/system/docker.service.d/override.conf`).
  - User `hp` is in the `docker` group.
- **Supabase CLI:** repo dev-dep `supabase@2.120.0` (Windows) for version/CI parity, but **day-to-day commands run the WSL binary** (`/usr/local/bin/supabase`, same version) because Windows paths cannot bind-mount into the WSL daemon.
- **WSL keep-alive:** the WSL VM auto-terminates when the last `wsl.exe` exits, which bounces all containers. A detached keep-alive must run:
  ```powershell
  Start-Process -FilePath "wsl.exe" -ArgumentList "-d","Ubuntu","--","sleep","infinity" -WindowStyle Hidden
  ```
  Re-run this **after every reboot** (or whenever containers keep restarting every ~30s). Verify with `wsl -d Ubuntu -- bash -lc "uptime"`.

## Environment variables

- `.env.example` — committed placeholders only (plan §1.3 contract).
- `.env.local` — real local values (gitignored). Created from `supabase status` output:
  - `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — JWTs from `supabase status -o env` (never commit; service-role is **server-only**, never `NEXT_PUBLIC_`)
  - `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
  - `BOOTSTRAP_ADMIN_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — empty until founder Step 0 completes
- Runtime validation: `src/lib/env.ts` (zod). `clientEnv` parses eagerly (build fails fast if public env is missing); **`getServerEnv()` parses lazily** so builds/client bundles don't throw while founder secrets are still empty. Full registry env list: `SYMBOL_REGISTRY.md`.
- CI provides **placeholder env** (workflow-level `env:` in `ci.yml`, no secrets) so clean-clone `build`/`dev`/e2e pass; real local values stay in `.env.local`.

## Local Supabase (WSL2)

```bash
# From Windows — all supabase commands go through WSL:
wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/HP/OneDrive/Desktop/Metria-Web && supabase start"
wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/HP/OneDrive/Desktop/Metria-Web && supabase status"   # URLs + keys
wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/HP/OneDrive/Desktop/Metria-Web && supabase db reset" # apply migrations (slow ~2min, realtime restarts)
wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/HP/OneDrive/Desktop/Metria-Web && supabase test db"  # pgTAP
```

- Stack published on `127.0.0.1:54321` (API/Kong), `:54322` (DB), `:54323` (Studio), `:54324` (Mailpit) — reachable from Windows via WSL2 localhost forwarding.
- First `supabase start` pulls ~10 images (takes >15 min on slow links; resumable — cached layers persist).
- `db reset` with zero migrations is a clean no-op schema init (skips `.gitkeep` files correctly). With the foundation migration it applies schema + `supabase/seed.sql` (verified 2026-10-14: 1 university, 1 domain, 3 roles, 20 permissions, 23 role↔permission mappings, 22 flags with only `ads.global_kill=true`).
- pgTAP: **`foundation-auth.test.sql` (16/16) + `auth-domain-allowlist.test.sql` (13/13)** live here (both green). The other 3 module test files were removed from `supabase/tests/` because they assert on tables that don't exist yet — each module card re-copies its own file when its migration lands (docs copies remain authoritative in `docs/03-database/tests/`). CI runs `supabase test db` once `supabase/migrations/*.sql` exist.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Dev server on :3000 (Turbopack, loads `.env.local`) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (flat config; Next 16 removed `next lint`) |
| `pnpm typecheck` | `next typegen` (generates `LayoutProps`/route types) then `tsc --noEmit` — needed on clean clones where `.next/` doesn't exist yet |
| `pnpm test` | Vitest run (`src/**/*.test.ts(x)`) |
| `pnpm test:e2e` | Playwright (`e2e/`, auto-starts dev server) |
| `pnpm test:db` | pgTAP via Supabase CLI (run from WSL, see above) |
| `pnpm db:reset` | Reset local DB (WSL) |
| `pnpm db:types` | Generate `src/lib/supabase/database.types.ts`. **Windows script fails (needs Docker on PATH)** — run the equivalent from WSL: `wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/HP/OneDrive/Desktop/Metria-Web && supabase gen types typescript --local > src/lib/supabase/database.types.ts"` then `pnpm exec prettier --write src/lib/supabase/database.types.ts` |
| `pnpm format` | Prettier write |

Pre-commit: husky + lint-staged (eslint --fix + prettier on staged `ts/tsx/mjs`; prettier on `json/css/yml`).

## Project structure

```
/
├─ docs/                      # source of truth (rigid — never edited without review)
├─ plan.md                    # current execution plan (ephemeral)
├─ README.md                  # this living record
├─ messages/en.json           # next-intl message catalog (all UI strings)
├─ src/
│  ├─ app/                    # route composition only
│  │  ├─ error.tsx / global-error.tsx / not-found.tsx / loading.tsx   # global states
│  │  ├─ page.tsx             # public landing (product name from env)
│  │  ├─ (app)/app/           # authenticated shell: layout (sidebar+bottom nav), dashboard placeholder
│  │  ├─ (public)/ (auth)/ (admin)/admin/   # planned route groups
│  ├─ i18n/request.ts         # next-intl request config (static 'en', no locale routing)
│  ├─ features/               # {auth,academics,booking,ads} — lane-owned
│  ├─ components/
│  │  ├─ shell/               # app-sidebar, bottom-nav, app-header, offline-banner, nav-items
│  │  ├─ states/              # error-state (correlation ID + retry), empty-state
│  │  └─ ui/                  # shadcn primitives
│  └─ lib/                    # supabase clients, env.ts (lazy server env), brand.ts, contracts/, utils.ts
├─ supabase/
│  ├─ config.toml             # local stack config
│  ├─ migrations/             # ONLY schema authority (CLI, lane-prefixed) — foundation_auth + auth_domain_allowlist landed
│  ├─ seed.sql                # idempotent tenant seed (FAST, roles, perms, flags, bootstrap admin email)
│  ├─ tests/                  # pgTAP (foundation-auth + auth-domain-allowlist; module cards copy theirs on arrival)
│  └─ functions/              # edge functions (later)
├─ e2e/                       # Playwright specs (smoke + app-shell @360px + auth)
├─ .github/workflows/ci.yml   # PR pipeline (+ placeholder env)
└─ CODEOWNERS                 # lane ownership (placeholder GitHub handles!)
```

## Non-negotiable working rules (condensed — details in `docs/09-ai-agent-setup/AGENTS.md`)

1. **Docs > plan.** New symbol → registry delta in `docs/SYMBOL_REGISTRY.md` *before* code.
2. **SQL migrations are the only schema authority** (L4): Supabase CLI only, never dashboard. One migration per PR, filename `<UTCts>_{s|a|b}_<module>_<slug>.sql`, rollback note required, expand/contract (never rename/drop in one release).
3. **RLS default-deny on every table**; tenant via composite `(university_id, id)` FKs; authz enforced server-side + DB (UI checks cosmetic); service role never in browser; zod at every server boundary.
4. **Public reads only via whitelisted `public_*` views**; aggregates suppressed below k≥5; no student data in logs/analytics; auth pages: zero ad scripts (code + DB).
5. Money = integer minor units + ISO currency. Times = UTC `timestamptz` storage, university timezone display (default Asia/Karachi).
6. Run named tests before claiming done: `lint`, `typecheck`, `test`, `test:db`, `test:e2e`, `build`. Policy tests need allowed/denied/**cross-tenant** cases.
7. Feature flags for all P2/P3 features, default OFF. Ads MVP ships with `ads.*=false`, `ads.global_kill=true`.
8. Stop only for: missing secrets, legal decisions, or conflicts with locked decisions.

## Phase log (append-only history)

### Phase 0 — Project initialization (2026-10-14) ✅
- Scaffolded Next.js 16.4.0 into repo root (via lowercase temp dir — `create-next-app` rejects capital-letter names; `metria-tmp` then moved; node_modules reinstalled after move).
- Installed exact §2.2 library set; approved pnpm build scripts (`@swc/core`, `@parcel/watcher`, `esbuild`) via `pnpm.onlyBuiltDependencies`.
- shadcn/ui init (defaults) + 15 components (`form` intentionally skipped — see deferred list).
- Folder structure + `.env.example` + `src/lib/env.ts`; scripts/engines/packageManager pinned; `tsconfig` gained `noUncheckedIndexedAccess`.
- Vitest (jsdom) + Playwright configs, placeholder `cn` test (2 passing); 4 pgTAP files copied to `supabase/tests/`.
- Docker Engine installed **inside WSL2** (no Docker Desktop, per founder instruction); Supabase local stack healthy; `.env.local` populated from `supabase status -o env`.
- husky + lint-staged; CI workflow (lint→typecheck→unit→build→migration-name lint→secret guard→supabase reset→pgTAP-with-migrations-guard; separate e2e job).
- Verified: lint ✅ typecheck ✅ test ✅ build ✅ `pnpm dev` HTTP 200 ✅ `db reset` ✅ stack healthy ✅.
- Deviations recorded: pnpm pinned to 10 (corepack 0.33 can't run pnpm 12); `lint` script uses `eslint` not `next lint` (removed in Next 16); supabase CLI executed from WSL; CI pgTAP step skips until migrations exist.

### Foundation Gate — F1 + F2 + F4 (2026-10-14) ✅ (F3/F5 pending secrets)
- **F1 migration** `supabase/migrations/20261014140937_s_foundation_auth.sql` = schema → RLS → functions verbatim from `docs/03-database/{schema,rls,functions}/foundation-auth.sql`, plus `private.has_role()` (SYMBOL_REGISTRY contract + F5 checklist; its tables exist now) and a rollback/expand-contract note. Fixed a **doc SQL typo**: RLS helpers wrote `SET search_path=` (invalid) → `SET search_path = ''`.
- **F1 seed** `supabase/seed.sql` (docs seed file is guidance-only, rows written per plan F1): FAST-NUCES Lahore tenant, `lhr.nu.edu.pk` domain, roles student/ta/teacher, 20 registry permissions, 23 derived role↔permission mappings (docs define no matrix — mapping documented in the seed header; `platform.*` intentionally unmapped, platform scope = `platform_admins` only), 22 feature flags all OFF except `ads.global_kill=true`. All idempotent (NOT EXISTS / ON CONFLICT).
- **F2 pgTAP** 16/16 PASS (`supabase test db` from WSL). Deviations: copied test got markdown boilerplate stripped (psql chokes on it) and the `anon cannot select marks` check made existence-safe (`to_regclass` guard) because `public.marks` arrives with core-academics; the other 3 module test files were **removed from `supabase/tests/`** (their tables don't exist yet — each module card re-copies its own; keeps CI pgTAP green).
- **db:types** generated from **WSL** (Windows `pnpm db:types` fails: no Docker on Windows PATH) → `src/lib/supabase/database.types.ts` committed.
- **F4 app shell**: root layout (skip link, offline banner, sonner toaster, next-themes provider) · route groups: public landing `/` (env product name + i18n) and authenticated shell `(app)/app/` (mobile header + **persistent 5-item bottom nav @360px baseline with safe-area**, compact desktop sidebar with active states, `robots:noindex`) · global states: `error.tsx` (correlation ID = `error.digest` + retry), `global-error.tsx` (own html/body, inline styles, messages imported directly), `not-found.tsx`, `loading.tsx` skeletons, shared `ErrorState`/`EmptyState`, `OfflineBanner` (`useSyncExternalStore`).
- **F4 i18n**: `messages/en.json` + `src/i18n/request.ts` (static `en`, no locale routing) + `createNextIntlPlugin` in `next.config.ts`; every UI string goes through the catalog (L12). Brand from `src/lib/brand.ts` (`NEXT_PUBLIC_PRODUCT_NAME` only, L/R6).
- **Design tokens**: status colors (`success`/`warning`/`info` + foreground), elevation `--shadow-*`, global `:focus-visible` ring, `prefers-reduced-motion` neutralization (WCAG 2.1 AA per design-system.md).
- **CI**: workflow-level placeholder `env:` added (clean-clone build/dev/e2e now work; no secrets). `src/lib/env.ts` **`serverEnv` became lazy `getServerEnv()`** — eager parse was crashing builds while OAuth secrets are empty.
- **Verified:** lint ✅ typecheck ✅ vitest ✅ build ✅ (static `/`, `/app`, `/_not-found`) e2e ✅ 4/4 (incl. 3 new 360px tests: no horizontal scroll, bottom nav visible, sidebar hidden, title from env) · local `db reset` + seed counts ✅ · pgTAP 16/16 ✅ · CI run 38581227630 `ci` job green (incl. pgTAP on clean runner).
- **Deviations/documented choices:** doc `SET search_path=` typo fixed inline; `has_role()` added beyond verbatim files (registry/F5 require it; `is_offering_staff()`/`is_enrolled()` deferred to core-academics where their tables exist); role↔permission matrix derived (no source matrix in docs); role_permissions mapping + seed rows are data, not schema; future-module pgTAP files live in docs only until their cards land; Base UI `nativeButton={false}` for Button-as-Link on the landing CTA; offline banner informs only — mutation blocking lands with forms/PWA (T-A012).

### Foundation Gate — F3 auth (2026-10-14) ✅
- **Migration** `20261014213000_s_auth_domain_allowlist.sql`: BEFORE INSERT trigger on `auth.users` enforces active `university_domains` + verified email (UI checks are cosmetic only). **Founder deviation (D20):** the single bootstrap platform-admin email (`platform_settings.bootstrap_admin_email`, seeded `metria.admin26@gmail.com`) is exempt — any domain, unverified OK; everyone else needs a verified allowed-domain email. AFTER INSERT trigger provisions `profiles` + `university_memberships` (students `pending`, bootstrap admin `active`) + `platform_admins` row. All functions SECURITY DEFINER owned by `service_role` (BYPASSRLS), `search_path = ''`.
- **Denial audit:** `private.auth_security_events`, rate-limited 5/email/10min, written through a **dblink autonomous connection** so events COMMIT despite the RAISE's transaction rollback; connection errors swallowed — enforcement never depends on audit persistence. **PG17 gotcha:** local `postgres` is NOT superuser and loopback/socket pg_hba is `trust`, which PG17 refuses for non-superusers even with a password in the conn string → dblink reconnects via the server's own TCP address (`inet_server_addr()`, scram) with the password from `private.runtime_config` (local seed `postgres`; **cloud ops must UPDATE that row** with the real password — ops SQL, never committed).
- **Config/secrets:** `supabase/config.toml` Google provider on (`env()`-interpolated from gitignored `.env`), `/auth/callback` in site_url + redirect allowlist; `.env.local` filled with founder secrets; cloud keys in `.env.cloud`; `.env.example` documents `RESEND_API_KEY` + bootstrap comment; `Metria_Env.txt` deleted.
- **App:** `@supabase/ssr` clients (`client.ts`/`server.ts`/`session.ts`); Next 16 **`proxy.ts`** (was middleware) refreshes session cookies and gates `/app/*` → `/auth/sign-in?next=…`; routes: `/auth/sign-in` (Google button, noindex), `/auth/callback` (PKCE exchange), `/auth/access-denied`, `/auth/e2e-session` (404 unless `E2E_MODE=1`); AppLayout does server-side `getUser()` + `await connection()`; sign-out in header + sidebar; `Auth` i18n namespace.
- **Tests:** pgTAP 13/13 (unknown-domain deny + event, unverified deny + event, student pending membership + profile, bootstrap admin active + platform_admins + zero events, rate-limit cap 5); e2e 10/10 via fixture password user (admin API fires the real triggers) + `/auth/e2e-session` — Google login itself can't be automated. Gates all green: lint · typecheck · vitest · build · pgTAP 29/29 · e2e 10/10.
- **Next 16 fixes en route:** `searchParams` awaited inside `<Suspense>` (instant-nav validation), `connection()` + `instant = false` on `/app` (supabase-js `getUser()` does `Date.now()` — unstable at prerender), `<Link>` over `<a>` in auth layout, e2e helper hides the `<nextjs-portal>` dev overlay (covers the sidebar in dev even with zero issues).
- **Remaining external (founder):** add `http://127.0.0.1:54321/auth/v1/callback` to the Google Console OAuth client (JS origin `http://localhost:3000`) for the real-login smoke. CI on the new repo: ✅ green (run `38619640718` on `e9cb77f`, both jobs).

### Next: F5 Foundation Gate sign-off → T-A003
CI is green on the new repo ✅. Sign the **F5 checklist** (`plan.md` §3) after the founder adds the Google Console redirect URI and completes a real-login smoke. Then Phase 1 feature cards start with **T-A003** core-academics (A1). `is_offering_staff()`/`is_enrolled()` helpers arrive with A1 (T-A003), noted as a gate deviation.

## Git workflow

- Trunk-based: short-lived branches, PRs, cross-lane review on shared paths (`CODEOWNERS`).
- Branch: `hassan-dev` (active dev branch, default on remote) → merge to `main` for stable integration.
- Remote: `https://github.com/MetriaAdmin123/Metria-Web` (migrated 2026-10-14 from the old `metria1010` repo, which was abandoned; commit authorship preserved). Collaborator pushes via HassanNawaz14 PAT; owner = MetriaAdmin123.
- Never commit: `.env*` (except `.env.example`), secrets, student data.
- `CODEOWNERS` currently has placeholder `@founder-a` / `@founder-b` — replace with real GitHub handles.

## Known issues / watch list

- WSL keep-alive is manual (no systemd task yet). If containers cycle every ~30s, re-run the keep-alive command.
- Vitest warns `vitest.config.ts` is ESM-in-CJS (cosmetic; rename to `.mts` if it becomes noisy).
- Supabase services bind `0.0.0.0` in local dev with shared default JWT secrets — fine for local, never reuse in production.
- `eslint@9` is deprecated upstream; `eslint-config-next` 16.4 still targets it — upgrade both together later.
