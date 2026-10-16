# Metria

Multi-tenant academic evaluation/coursework platform (launch tenant: FAST-NUCES Lahore, `lhr.nu.edu.pk`) with a public SEO/ad-monetized layer and an authenticated student/TA layer (marks, evaluation-slot booking, announcements). Investment-free: free tiers only, no Vercel, no paid plans.

> **Documentation authority:** `docs/` is the permanent source of truth. `plan.md` is an *ephemeral* execution plan — it is replaced when a plan cycle completes. **This README is the living compacted record** of environment decisions, operational notes, and progress.
>
> **README maintenance contract — run at the end of every card/phase:** ① update *Current status*; ② append a *Phase log* entry (never rewrite past entries); ③ update *Parked / deferred work* and *Known issues / watch list* if anything changed; ④ update *Toolchain notes* / *Local Supabase* / *Commands* / *Project structure* whenever the environment or workflow changes; ⑤ keep it compact — link `docs/` instead of duplicating. `plan.md` gets replaced between plan cycles; **anything a future session needs to know must live here or in `docs/`, never only in chat history or memory.**

| Document | Role |
|---|---|
| `docs/00-INDEX.md` | Entry point, reading order, product boundary |
| `docs/DECISIONS.md` | Locked decisions (D1–D22), ADRs, rollback rule |
| `docs/SYMBOL_REGISTRY.md` | Canonical table/function/permission/flag/env names (v1) |
| `docs/TRACEABILITY.md` | Feature ID → module → card → test matrix |
| `docs/09-ai-agent-setup/AGENTS.md` | Master rules for coding agents (12 rules) |
| `plan.md` | Current MVP execution plan (Marks + Booking + Ads) — replace when done |
| **`README.md` (this file)** | Living operational record: machine setup, env vars, commands, phase log |

## Current status

- **Done:** Step 0 tooling · **Phase 0 init** (scaffold, libs, shadcn, folder structure, test harness, local Supabase, CI, pre-commit) · **Foundation Gate F1+F2+F3+F4** (foundation migration + seeds + generated types, pgTAP 16/16, auth domain allowlist + bootstrap admin + `/auth/*` + proxy gating (pgTAP 13/13, e2e 10/10), app shell + design tokens + next-intl) — verified 2026-10-14 · **F5 agent-side pre-signoff verification** — all local gates re-run green 2026-10-15 (see below) · **Phase 1 T-A003 core-academics** (migration `a_core_academics` + helpers, seed fixtures, pgTAP 58/58, `/app/offerings/*` CRUD UI, e2e 12/12) — 2026-10-15 · **Phase 1 T-A004 marks + CSV importer + marksheet** (migration `a_marks_import` + D-g…D-k, pgTAP 127/127, `/app/marks*` + importer + marksheet UI, e2e 14/14) — 2026-10-16 · **Phase 1 T-A005 dashboard + announcements + TA analytics** (migration `a_announcements_dashboard`, one bounded dashboard RPC, Tiptap + sanitize on write/render, k≥5 analytics, pgTAP 148/148, vitest 58/58, e2e dashboard journey 2/2 standalone) — 2026-10-16 · **T-A005 independently re-verified 2026-10-16** (vitest 58/58 · db reset clean · pgTAP 148/148 · e2e 2/2 `--workers=1`; README test-count typo fixed — announcements vitest file = 11 tests) · **Phase 1 T-A006 booking base** (migration `a_evaluation_booking`: capacity trigger + row-lock `book_slot`/`cancel_booking` + privacy-gated `period_booking_overview` RPCs + public wrappers, `/app/bookings/*` book/cancel UI + dashboard bookings section, seed section 10, pgTAP 212/212 total (new file 64/64), vitest 76/76, e2e booking journey 2/2 + **concurrency race 2/2** standalone) — 2026-10-16
- **F5 sign-off status:** ALL agent-side items are done and re-verified (2026-10-15). The **only** remaining gate item is the founder Google OAuth smoke (Console redirect URI + real-login check + gate sign-off) — see **"F5 sign-off status — READ FIRST in a new session"** below. The OAuth Console step cannot be automated from this repo and is expected to stay open for a while; it does NOT block code work except the formal Phase 1 start rule in plan.md §3.
- **CI:** green on `MetriaAdmin123/Metria-Web` — latest verified run `38946301916` (commit `fc96ba2`, T-A006): `ci` ✅ `e2e` ✅ 19 passed (e2e job boots Supabase itself with public demo keys; 1 known cold-stack flake retried green). Earlier: run `38619640718` (commit `e9cb77f`, F3). Actions had to be enabled on the new repo first (Settings → Actions → General).
- **Founder Step 0:** secrets filled into `.env.local` (bootstrap admin email, Google OAuth client ID/secret); cloud Supabase keys in gitignored `.env.cloud`. `Metria_Env.txt` deleted (was committed with secrets — history rewrite deliberately avoided). **Still open:** Google Console redirect URI (the OAuth smoke below).
- See `plan.md` §10 for the full MVP checklist.

## F5 sign-off status — READ FIRST in a new session

> Purpose: single source of truth for where the Foundation Gate (plan.md §3 F5) stands.
> Status as of 2026-10-15: **every agent-side item verified green; sign-off blocked ONLY on the founder Google OAuth smoke.** Nothing in code remains to build for F5.

### Checklist status

| # | F5 checklist item | Status | Evidence / note |
|---|---|---|---|
| 1 | Repo/tooling/CI green on clean clone | ✅ | CI run `38619640718` on `e9cb77f` — `ci` ✅ `e2e` ✅ (e2e job boots its own Supabase) |
| 2 | Local Supabase up; migrations apply clean; `db:types` generated | ✅ | 2026-10-15: full `db reset` from empty re-applied both migrations + seed cleanly; `src/lib/supabase/database.types.ts` committed (2026-10-16: `pnpm db:types` now works from PowerShell too, byte-identical rerun) |
| 3 | Auth tenant skeleton: Google login + domain denial + bootstrap admin | ⏳ **code complete; live Google roundtrip blocked (founder)** | All automatable paths verified: pgTAP 13/13 (allowlist triggers via admin-API fixture user) + e2e 10/10. The real Google sign-in flow (button → Google → PKCE callback → profile/membership provisioning) is built but **untested against a real Google account** until the Console step below is done |
| 4 | RLS helpers present (`current_university_ids`, `has_role`, `is_offering_staff`, `is_enrolled`, `is_platform_admin`) | ✅ 5/5 (as of T-A003, 2026-10-15) | Present in `20261014140937_s_foundation_auth.sql`, all `search_path=''`: `private.current_university_ids()`, `private.has_role()`, `private.is_platform_admin()`. `private.is_offering_staff()`/`private.is_enrolled()` shipped with the T-A003 core-academics migration (their tables arrived there). **All three F1 helpers were re-defined in T-A003 to resolve the caller via `profiles.auth_user_id = auth.uid()`** — the F1 originals compared `profile_id` (profiles.id) directly to `auth.uid()` (auth.users.id), which is always empty for real users |
| 5 | Seeds applied (university, domains, roles, permissions, flags-off) | ✅ | 2026-10-15 post-reset counts: 1 university, 1 domain, 3 roles, 20 permissions, 23 role↔permission mappings, 22 flags with exactly 1 enabled (`ads.global_kill=true`) |
| 6 | pgTAP harness running (foundation tests pass) | ✅ | 29/29 PASS 2026-10-15 (post-reset): `foundation-auth.test.sql` 16/16 + `auth-domain-allowlist.test.sql` 13/13 |
| 7 | Design tokens + app shell render on mobile viewport | ✅ | e2e app-shell suite green (360px: no horizontal scroll, bottom nav visible, sidebar hidden) |
| 8 | Secrets inventory recorded; `.env.example` matches reality | ✅ agent-side | `.env.local` (local stack + founder secrets) and `.env.cloud` (cloud keys) populated; `.env.example` placeholders current (incl. deferred `RESEND_API_KEY`). Password-manager inventory is founder-owned and not verifiable from the repo |

### BLOCKED on founder — Google OAuth smoke (the ONLY open F5 item)

**What is missing:** a real Google sign-in roundtrip. The entire auth code path exists and is tested, but only against a fixture password user (the admin API fires the same DB triggers). Google's side must allow the local Supabase Auth callback, which only the founder can configure.

**Founder action (manual, once, ~10 min, in Google Cloud Console):**
1. Open the OAuth 2.0 Client ID whose secrets live in `.env.local` (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`).
2. Under **Authorized redirect URIs**, add exactly:
   `http://127.0.0.1:54321/auth/v1/callback`
   (Authorized JavaScript origin should already be `http://localhost:3000`.)
3. Smoke test in a browser (with `pnpm dev` running):
   - `http://localhost:3000/auth/sign-in` → **Continue with Google** → sign in with the `BOOTSTRAP_ADMIN_EMAIL` Google account → expect to land on `/app` with a profile + active membership + `platform_admins` row provisioned (check Studio if curious).
   - Optional negative check: sign in with a Google account **not** on `lhr.nu.edu.pk` → expect `/auth/access-denied` and no membership row.
4. Tick the F5 boxes in `plan.md` §3 and mark the Foundation Gate signed (both founders per T-S001).

**Until that is done:**
- Do not treat F3 as fully proven — the fixture-user e2e coverage is strong but the Google exchange itself (redirect handling, PKCE state, domain claims on a real verified Google email) is unverified.
- Everything else in the repo is ready; no other F5 item is waiting on anything.
- When the founder finishes the Console step, re-run `pnpm test:e2e` + `pnpm test:db` as a sanity check, complete the real-login smoke manually, and update this section + plan.md §3/§10.
- **Phase 1 has been explicitly green-lit by the founder (2026-10-15) despite the open OAuth item** — the only gate blocker is external, so feature cards proceed in parallel. When the OAuth smoke completes, sign F5 retroactively (evidence: this section's verification table).

## Tech stack (pinned via lockfile)

| Layer | Choice |
|---|---|
| Runtime | Node.js ≥ 22 (current machine v24.15.0 · original setup v22.17.1), pnpm 10.34.7 |
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

## Toolchain notes (Windows machines)

> Two dev environments exist. **This machine (current)** = Docker Desktop on Windows, everything from PowerShell, repo at `D:\Metria-Web`. **Legacy machine** (used through T-A004) = Docker Engine inside WSL2, repo at `C:\Users\HP\OneDrive\Desktop\Metria-Web`; its notes are compacted below in case that machine is used again.

### Current machine (verified 2026-10-16)

- Windows user `MZG` · Node **v24.15.0** · pnpm **10.34.7** (corepack) · Docker Desktop **29.8.2** (`docker` is on the Windows PATH) · repo at `D:\Metria-Web`.
- **Docker Desktop** at `C:\Program Files\Docker\Docker\Docker Desktop.exe` (WSL2 backend). Boot it and wait for the engine before any Supabase command:
  ```powershell
  Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  while ((Get-Date) -lt (Get-Date).AddSeconds(180)) { docker info *> $null; if ($LASTEXITCODE -eq 0) { "engine ready"; break }; Start-Sleep -Seconds 5 }
  ```
  Quit it when done to free RAM: `Get-Process "Docker Desktop","com.docker.backend","com.docker.build" -ErrorAction SilentlyContinue | Stop-Process -Force`
- **Supabase CLI runs directly from PowerShell on this machine** — `pnpm exec supabase …` exactly as in *Local Supabase* below. All commands verified 2026-10-16 (start, status, db reset, test db, db:types, stop); no WSL hop needed.
  - If `supabase start` exits with `container is not ready: starting` right after a Docker boot, wait ~30 s and re-run — it resumes where it left off.
  - `supabase stop` keeps data ("Starting database from backup…" on the next start).
  - PowerShell sometimes renders `pnpm exec supabase` stderr lines as red `NativeCommandError` noise (pnpm.ps1 wrapper) — cosmetic; judge by the actual output.
  - **Always use the repo-pinned CLI** — `pnpm exec supabase …` (v2.120.0 in devDependencies). The global `supabase` on PATH (v2.115.0) pins *different* container image tags: a bare `supabase start` silently re-pulls older multi-GB images (observed 2026-10-16 — looked like a 10-min hang because piped output buffers until exit). The pinned CLI starts in ~1 min from the cached image set.
- **Low RAM (8 GB) rules** (full list in `AGENTS.md`): one heavy process at a time; run heavy e2e specs individually with `--workers=1`; skip `build` / full `typecheck` / full lint unless a gate needs them; stop Supabase + Docker Desktop as soon as testing is done.

### Legacy machine notes (WSL2 Docker Engine — compacted, keep for that machine)

- Docker Engine 29.1.3 + compose v2 inside **WSL2 Ubuntu 24.04**, installed as root (`wsl -d Ubuntu -u root`); daemon at `unix:///var/run/docker.sock` **and** `tcp://127.0.0.1:2375` (override: `/etc/systemd/system/docker.service.d/override.conf`); user `hp` in the `docker` group.
- Supabase CLI must run through WSL there because Windows paths cannot bind-mount into the WSL daemon — wrap every command as `wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/HP/OneDrive/Desktop/Metria-Web && supabase <cmd>"`; `pnpm db:types` fails from Windows on that machine (use the WSL variant in *Commands*).
- **WSL keep-alive after every reboot** (else containers restart every ~30 s):
  ```powershell
  Start-Process -FilePath "wsl.exe" -ArgumentList "-d","Ubuntu","--","sleep","infinity" -WindowStyle Hidden
  ```
  Verify with `wsl -d Ubuntu -- bash -lc "uptime"`.
- pnpm installed via `corepack enable --install-directory %LOCALAPPDATA%\pnpm` (no admin; Node in `C:\Program Files\nodejs`), added to user PATH. **pnpm 12 is incompatible** with the bundled corepack 0.33.0 (bin layout mismatch) — stay on **pnpm 10** until corepack/Node is upgraded.

## Environment variables

- `.env.example` — committed placeholders only (plan §1.3 contract).
- `.env.local` — real local values (gitignored). Created from `supabase status` output:
  - `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — JWTs from `supabase status -o env` (never commit; service-role is **server-only**, never `NEXT_PUBLIC_`)
  - `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
  - `BOOTSTRAP_ADMIN_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — empty until founder Step 0 completes
- Runtime validation: `src/lib/env.ts` (zod). `clientEnv` parses eagerly (build fails fast if public env is missing); **`getServerEnv()` parses lazily** so builds/client bundles don't throw while founder secrets are still empty. Full registry env list: `SYMBOL_REGISTRY.md`.
- CI provides **placeholder env** (workflow-level `env:` in `ci.yml`, no secrets) so clean-clone `build`/`dev`/e2e pass; real local values stay in `.env.local`.

## Local Supabase (Docker Desktop)

```powershell
# From the repo root (D:\Metria-Web) — Docker Desktop must be running:
pnpm exec supabase start     # stack up (first-ever start pulls ~10 images, >15 min; resumable)
pnpm exec supabase status    # URLs + keys
pnpm exec supabase db reset  # clean apply: all migrations + supabase/seed.sql (~1 min)
pnpm exec supabase test db   # pgTAP suite
pnpm exec supabase stop      # free RAM when done (data preserved, restored on next start)
```

- Legacy WSL machine: wrap every command as `wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/HP/OneDrive/Desktop/Metria-Web && supabase <cmd>"`.
- Stack published on `127.0.0.1:54321` (API/Kong), `:54322` (DB), `:54323` (Studio), `:54324` (Mailpit).
- `db reset` applies `supabase/migrations/` in order — 6 as of 2026-10-16: `foundation_auth`, `auth_domain_allowlist`, `a_core_academics`, `a_marks_import`, `a_announcements_dashboard`, `a_evaluation_booking` — plus the seed. Seed counts (verified 2026-10-15/16): 1 university, 1 domain, 3 roles, 20 permissions, 23 role↔permission mappings, 22 flags with only `ads.global_kill=true` enabled.
- pgTAP files live in `supabase/tests/` per landed module — currently 6 files / **212 tests, all green** (2026-10-16): `foundation-auth` 16, `auth-domain-allowlist` 13, `core-academics` 29, `marks.rls` 69, `announcements-analytics.rls` 21, `evaluation-booking.rls` 64. Module cards re-copy their doc file when their migration lands; authoritative originals stay in `docs/03-database/tests/`. CI runs `supabase test db` once migrations exist.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Dev server on :3000 (Turbopack, loads `.env.local`) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (flat config; Next 16 removed `next lint`) |
| `pnpm typecheck` | `next typegen` (generates `LayoutProps`/route types) then `tsc --noEmit` — needed on clean clones where `.next/` doesn't exist yet |
| `pnpm test` | Vitest run (`src/**/*.test.ts(x)`) — full suite 76/76 (2026-10-16) |
| `pnpm test:e2e` | Playwright (`e2e/`, auto-starts dev server). On this 8 GB machine run heavy specs individually with `--workers=1` — verified 2026-10-16: `dashboard.journey` 2/2 (2.0 min), `booking.journey` 2/2, `booking.concurrency` 2/2 |
| `pnpm test:db` | pgTAP via Supabase CLI (from PowerShell on this machine — see *Local Supabase*) |
| `pnpm db:reset` | Reset local DB — migrations + seed from clean (stack must be up) |
| `pnpm db:types` | Generate `src/lib/supabase/database.types.ts` — **works from PowerShell now** (Docker Desktop; verified 2026-10-16, rerun byte-identical). Legacy WSL machine only: `wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/HP/OneDrive/Desktop/Metria-Web && supabase gen types typescript --local > src/lib/supabase/database.types.ts"` then `pnpm exec prettier --write src/lib/supabase/database.types.ts` |
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
│  │  ├─ (app)/app/           # authenticated shell: dashboard, offerings/*, marks/*, marksheet; layout = sidebar + bottom nav
│  │  ├─ (auth)/              # sign-in, callback, access-denied, e2e-session — noindex, zero ad scripts
│  │  ├─ api/                 # route handlers (CSV import preview/confirm)
│  │  └─ (public)/ (admin)/admin/   # planned route groups (T-B001 / T-B008)
│  ├─ i18n/request.ts         # next-intl request config (static 'en', no locale routing)
│  ├─ features/               # lane-owned: auth ✅ · academics ✅ (catalog, marks, importer, marksheet, dashboard/announcements/analytics) · booking + ads pending
│  ├─ components/
│  │  ├─ shell/               # app-sidebar, bottom-nav, app-header, offline-banner, nav-items
│  │  ├─ states/              # error-state (correlation ID + retry), empty-state
│  │  └─ ui/                  # shadcn primitives
│  └─ lib/                    # supabase clients, env.ts (lazy server env), brand.ts, contracts/, utils.ts
├─ supabase/
│  ├─ config.toml             # local stack config
│  ├─ migrations/             # ONLY schema authority (CLI, lane-prefixed) — 5 landed (see *Local Supabase*)
│  ├─ seed.sql                # idempotent tenant seed (FAST, roles, perms, flags, bootstrap admin email)
│  ├─ tests/                  # pgTAP — 5 files / 148 tests green
│  └─ functions/              # edge functions (later)
├─ e2e/                       # Playwright: smoke, app-shell @360px, auth, academics.journey, marks.import, dashboard.journey
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

### Foundation Gate F5 — agent-side pre-signoff verification (2026-10-15) ✅
- Re-verified every agent-side F5 item on `efc962e` (tree clean, `hassan-dev` = `main` = origin): lint ✅ · typecheck ✅ · vitest 2/2 ✅ · build ✅ (static `/`, `/auth/*`, `/app` partial-prerender) · **`db reset` from empty** clean (both migrations + seed) ✅ · pgTAP 29/29 post-reset ✅ · e2e 10/10 ✅ · seed counts exact (1/1/3/20/23/22 flags, only `ads.global_kill=true`) ✅.
- Helper inventory confirmed: `private.current_university_ids()`, `private.has_role()`, `private.is_platform_admin()` present (`search_path=''`); `private.is_offering_staff()`/`private.is_enrolled()` intentionally deferred to T-A003 — their tables arrive with the `a_core_academics` migration; they must be added there, not stubbed now.
- Two environmental flakes observed (both pass on re-run; logged in watch list): vitest forks-worker startup timeout under heavy parallel load; e2e "sign-in bounces authenticated users to /app" when the Supabase auth container is cold (`getUser()` network failure → treated as anonymous → no proxy bounce).
- **F5 remaining = founder only:** Google Console redirect URI + real-login smoke + gate sign-off. Full breakdown in "F5 sign-off status — READ FIRST in a new session" above. The OAuth Console step is expected to stay open for a while — future sessions must not treat it as forgotten, and must not attempt to automate it.

### T-A003 — core-academics catalog & enrollment (2026-10-15) ✅
- **Migration** `supabase/migrations/20261015141145_a_core_academics.sql`: schema + baseline RLS verbatim from `docs/03-database/{schema,rls}` with 6 documented deviations (D-a…D-f in header): `import_batches` duplicate `created_by` column removed (kept NOT NULL), `SET search_path=` typo fixed, **D-c critical fix** — F1 helpers compared `profile_id` to `auth.uid()` directly (always empty for real users); redefined `current_university_ids()`/`is_platform_admin()`/`has_role()` to resolve via `profiles.auth_user_id = auth.uid()` (same signatures), added registry-delta `private.has_permission(uuid,text)`, deferred `is_offering_staff(uuid)`/`is_enrolled(uuid)`, `GRANT USAGE ON SCHEMA private` + per-function EXECUTE for the six helpers (F1's `REVOKE ... FROM PUBLIC` blocked `authenticated`), narrow manage policies gated on `academic.manage_offering`, `profiles_manage_read` for TA enrollment lookups.
- **Seed** +117 lines (section 9): dept `cs`, term Fall 2026, course CS301, offering CS301-F26, sections A/B, grading scale, Quiz 1/Midterm, synthetic TA + student profiles (active membership, roles, enrollment).
- **pgTAP** `supabase/tests/core-academics.test.sql` plan(29): 17 structural + helper/anon checks + TA block (manage grant, own-tenant INSERT, cross-tenant SELECT=0, cross-tenant INSERT 42501, profiles lookup) + student block (denied INSERT, profiles deny). **Full suite 58/58 PASS.**
- **Types** regenerated from WSL (`database.types.ts`), `has_permission` + auth_user_id correction noted in `docs/SYMBOL_REGISTRY.md`.
- **App**: `src/features/academics/` (Zod contracts + 5 server actions with `callerProfile()` gate + i18n-safe error map), `src/features/academics/ui/forms.tsx` (5 client forms, `useActionState`, no hard-coded strings), pages `/app/offerings` (list), `/app/offerings/new` (course + offering), `/app/offerings/[offeringId]` (sections/assessments/enrollments). **PostgREST gotcha found:** `course_offerings` has no FK to `terms` (doc schema) — embeds fail with PGRST200; terms joined in JS (documented in both pages).
- **Next 16 fixes:** `await connection()` + `export const instant = false` on all 3 pages (prerender `Date.now()` from supabase session math; layout-level `instant=false` does not exempt child pages from instant-nav validation).
- **e2e** `e2e/academics.journey.spec.ts` 2 tests: TA journey (course→offering→section→assessment→enroll, 45s, `test.setTimeout(120_000)` for dev-mode server actions) + read-only member denied write (`notAuthorized` message). Fixture `ensureE2ETa()` in `helpers/auth.ts` (admin API create → service-role promote membership + assign `ta` role; GoTrue admin list returns `{users:[...]}` not a bare array). Dev overlay hidden via `addInitScript` (persists across `page.goto`). **e2e 12/12 PASS.**
- **Gates:** lint ✅ typecheck ✅ vitest 19/19 ✅ build ✅ (no prerender errors) db reset ✅ pgTAP 58/58 ✅ e2e 12/12 ✅.

### T-A004 — marks + CSV importer + marksheet (2026-10-16) ✅
- **Migration** `supabase/migrations/20261015190000_a_marks_import.sql`: narrow `marks`/`mark_history`/`import_*` policies (staff via `is_offering_staff`; student own+released rows — **nested-RLS fix**: enrollment checked through `sections` + definer `is_enrolled`, never a raw `enrollments` subquery which re-applies staff-only RLS as the student) + documented deviations D-g (`import_rows` CHECK + `UNIQUE(batch_id,row_hash)`), D-i (`overwrite_existing`), D-h (`profiles_self_read`), D-j (history via `record_mark_history` trigger, GUC `app.mark_source` manual/csv/objection), **D-k**: `config.toml [api].schemas` only routes `public`/`graphql_public` → thin `public.confirm_mark_import`/`public.offering_marksheet` wrappers forward to the private implementations (signatures stay canonical in `private`). Registry delta recorded (`docs/SYMBOL_REGISTRY.md:70`).
- **App**: `src/features/marks/` (Zod contracts, pure marksheet math, pure import classification, `http`/`rpc` bridges, server actions), API routes `/api/imports/preview` + `/api/imports/[batchId]/confirm` (nothing written before confirm, replay idempotent), UI `MarksEntry` + `ImportPanel`, pages `/app/marks` (hub), `/app/marks/[assessmentId]` (entry), `/app/offerings/[offeringId]/marksheet` (TS-side weighted total/grade + RPC stats, suppressed below cohort k=5); offering detail gains viewer-gated `marks-link`/`marksheet-link`; `createOfferingAction` now staffs the creator (`offering_staff`) — marks RLS keys on it. i18n: `Marks` namespace + `Offerings.enterMarks`/`viewMarksheet`.
- **Tests**: vitest `marks.validation.test.ts` 28 tests (suite 47/47); pgTAP `marks.rls.test.sql` plan(69) — trigger history + GUC source, import constraints, confirm apply/skip/overwrite/replay/expired/403/404/unauth, marksheet own-total + privacy + k=5 threshold + scale, `mark_history` append-only (full suite 127/127); Playwright `marks.import.spec.ts` — TA journey (preview counts → no-write → confirm "2 applied · 0 skipped" → replay) + student marksheet; **serial mode** inside the file (`fullyParallel` otherwise runs the student test before the TA test creates state) + 15s timeouts for first-compile of import routes under 2 workers.
- **Fixture fixes found via e2e debugging:** `ensureE2EUser` now promotes the F3-**pending** membership to `active` (plain member, no roles — tenant RLS `current_university_ids()` saw nothing for a pending member; the academics "read" test only asserted page structure, so it never caught this); race-tolerant `ensureAuthUser` (concurrent create → fall through to lookup), one-shot `signInE2E` retry for transient GoTrue failures under parallel workers.
- **Gates:** lint ✅ typecheck ✅ vitest 47/47 ✅ build ✅ db reset ✅ pgTAP 127/127 ✅ e2e 14/14 ✅ (2026-10-16).

### T-A005 — dashboard + announcements + TA analytics (2026-10-16) ✅
- **Migration** `supabase/migrations/20261016120000_a_announcements_dashboard.sql`: narrows `announcements` RLS (T-A003 left it platform-admin-only) → staff-of-offering write (requires `academic.manage_offering` + author = caller, spoofed author denied), author update/delete, enrolled-student read; adds `private.student_dashboard()` (one bounded RPC: latest own marks + enrolled-section announcements + upcoming released assessments; `evaluation_slots` stays `[]` for T-A006, expand-only) and `private.offering_analytics(uuid)` (per-assessment distribution buckets + per-section averages, **every aggregate k>=5-suppressed in SQL**, D10/P14; staff or `academic.view_offering_analytics` only). Public wrappers per D-k. Rollback note included; no table/column changes.
- **App**: `src/features/academics/` additions — `sanitize.ts` (D8 allowlist, sanitize on write in the server action **and** again at render in `AnnouncementList`), `dashboard.ts`/`analytics.ts` (Zod-parsed RPC contracts), `createAnnouncementAction` (callerProfile gate + error map), UI `AnnouncementForm` (Tiptap v3, `immediatelyRender:false`), `TaAnalytics` + `analytics-chart.tsx` (recharts behind `next/dynamic` ssr:false, D7). `/app` dashboard replaced (marks/announcements/upcoming + empty states), offering page gains announcements section (staff composer) + staff-only analytics section (RPC failure hides section, never breaks page, try/catch).
- **Tests**: vitest `announcements.validation.test.ts` 11 tests (XSS stripping, idempotent sanitize, RPC contract parse; suite 58/58); pgTAP `announcements-analytics.rls.test.sql` plan(21) — staff allow/deny/cross-tenant/spoofed-author, student read own-section only, dashboard payload keys, analytics 42501 for students + cross-tenant, **k-threshold both sides** (5 marks reported, 3 suppressed; section >=k vs empty suppressed); Playwright `dashboard.journey.spec.ts` 2/2 — TA posts Tiptap announcement + sees analytics section, enrolled student sees it on the dashboard (serial mode; 20s first-compile timeouts).
- **e2e infra**: `playwright.config.ts` expect timeout 5s → 10s (dev-mode server actions + heavier offering page on a loaded machine); suite verified green spec-by-spec — full-parallel run flakes on this 8GB machine under Docker+Chromium load (same for pre-existing specs incl. app-shell/auth), not a code regression. Found (pre-existing, not fixed here): `pattern="[A-Za-z0-9-]+"` in academics forms is an invalid regex under the `v`-flag attribute parsing (browser console error only; server Zod still validates).
- **Gates:** lint ✅ typecheck ✅ vitest 58/58 ✅ build ✅ db reset ✅ pgTAP 148/148 ✅ targeted e2e ✅ (2026-10-16).
- **Re-verified 2026-10-16 (independent pass, Windows PowerShell + Docker Desktop machine):** vitest 58/58 · `db reset` clean (5 migrations + seed) · pgTAP 148/148 · e2e `dashboard.journey.spec.ts` 2/2 with `--workers=1` (2.0 min) · `pnpm db:types` works from PowerShell (byte-identical rerun). Doc fix: `announcements.validation.test.ts` = 11 tests (19 + 28 + 11 = 58; the earlier "28" was copy-paste from the marks file).

### T-A006 — booking base: capacity + cancellation (2026-10-16) ✅
- **Migration** `supabase/migrations/20261016180000_a_evaluation_booking.sql`: tables `evaluation_periods`/`slots`/`bookings` (+ `waitlist_entries`/`swap_requests` dark behind `booking.waitlist.enabled=false`), composite tenant FKs, `enforce_slot_capacity` safety trigger, narrow RLS (staff via `booking.manage_period` manage periods/slots; enrolled read; offering staff read all bookings; students own rows; **writes only through RPCs** — no member write policies), 8 documented deviations D-A6-a…h incl. **partial unique index** on active bookings (rebook allowed after cancel), `bookings.status` CHECK, hardened `private.book_slot` (P19: period-row `FOR UPDATE` lock, P1/P2 validation, `is_enrolled` authorization — TAs who are also students still book), new `private.cancel_booking` (**D11 cutoff** = default 6 h before slot start, deny when `now() >= slot.starts_at - cutoff_hours`; reschedule = cancel + rebook), new `private.period_booking_overview` (participants get slot counts + own booking; offering staff additionally get booked student **names, never emails**; non-participants → `not_found`), `private.student_dashboard()` replaced expand-only to fill `evaluation_slots` (next 5 upcoming, counts, `my_booking_id`). Public wrappers + grants per D-k; RPC `RAISE` messages = canonical error codes (`slot_full`, `already_booked`, `cutoff_passed`, …).
- **Seed** section 10: idempotent 'Midterm evaluation (dev fixture)' period (+7 d) with two capacity-3 slots on CS301-F26 section A.
- **App**: `src/features/booking/` (Zod contracts, pure rules, server actions for period/slot/book/cancel, overview mapper, forms), pages `/app/bookings` (hub), `/app/bookings/new` (staff period form), `/app/bookings/[periodId]` (students: counts + book/cancel; staff: per-slot student lists + slot form); dashboard gains the bookings section (`dashboard.ts` slot schema tightened from unknown); `Booking` i18n namespace.
- **Tests**: vitest `booking.validation.test.ts` +18 (suite 76/76); pgTAP `evaluation-booking.rls.test.sql` plan(64) — structural, RLS allow/deny/cross-tenant/spoofed ids, capacity + `slot_full`/`slot_ended`/`not_found`, cancel/rebook/`not_active`/`cutoff_passed`, overview privacy (names for staff, never emails), dashboard payload, dark tables, anon — full suite **212/212 (6 files)**; Playwright `booking.journey.spec.ts` 2/2 (TA: course→offering→section→enroll→period→slot with student lists; student: book → dashboard card → cancel before cutoff → slot bookable again) + **`booking.concurrency.spec.ts` 2/2 — mandatory P19 race: two real user JWTs (password grant) fire `book_slot` in parallel at a capacity-1 slot → exactly one winner, loser `slot_full`, DB holds exactly 1 active booking; capacity-2 variant admits both**. e2e helpers: `ensureE2EStudent2`, `fixtureProfile`, `ensureEnrollment`, `passwordGrantToken`, `rpcAs`.
- **Gates:** vitest 76/76 ✅ db reset clean (6 migrations + seed) ✅ pgTAP 212/212 ✅ e2e booking 4/4 + dashboard journey re-run 2/2 (all `--workers=1`) ✅ types regenerated ✅ eslint on changed files ✅ (2026-10-16).
- **CI:** run #5 failed `typecheck` on two PostgREST embed-union errors (`bookings/page.tsx`, `bookings/new/page.tsx` — embeds typed as `relation | relation[]`); fixed in `fc96ba2` with the typed-cast pattern the offerings pages use → run #6 green: `ci` ✅ (lint · typecheck · unit · build · pgTAP) + `e2e` ✅ 19 passed (1 pre-existing cold-stack flake retried). **Lesson: run `pnpm typecheck` before pushing cards that add queries/pages — dev-mode e2e + vitest + eslint do not typecheck.**

## Next: T-A007 (booking social, deferred) / T-B002 (ads, parallel) · founder OAuth smoke still pending
**T-A006 completed 2026-10-16 and committed via `zohaib-dev` → `main`.** Booking base (3.1/3.2) is done; 3.3–3.6 stay deferred to T-A007 with flags OFF (`booking.waitlist.enabled=false`). Remaining plan.md §10 items: T-B002/T-B003 (ads, parallel track) + admin ads slice, then DEP-1/2; deferred backfills (T-A007/T-A008) follow. Standing patterns: D-k (public RPC wrappers for every private RPC), D11 (default 6 h cutoff), render-sanitization (D8). The founder OAuth smoke + retroactive F5 sign-off remains queued (see "F5 sign-off status").

## Git workflow

- Trunk-based: short-lived branches, PRs, cross-lane review on shared paths (`CODEOWNERS`).
- Branches: `hassan-dev` (Hassan) and `zohaib-dev` (Zohaib) are the per-founder dev branches → merged to `main` for stable integration. `main` is the remote default (`origin/HEAD`).
- History: F1–F5, T-A003 and T-A004 were committed straight to `main`; T-A005 landed via `zohaib-dev` → `main` (2026-10-16).
- Remote: `https://github.com/MetriaAdmin123/Metria-Web` (migrated 2026-10-14 from the old `metria1010` repo, abandoned; commit authorship preserved). Pushes from this Windows machine authenticate as Muhammad Zohaib `<zohaib.mzg158@gmail.com>`; Hassan pushes via HassanNawaz14 PAT. Owner = MetriaAdmin123.
- Never commit: `.env*` (except `.env.example`), secrets, student data.
- `CODEOWNERS` currently has placeholder `@founder-a` / `@founder-b` — replace with real GitHub handles.

## Parked / deferred work index (check here before inventing work)

Everything intentionally NOT being done right now, and where it resumes. If you are about to start something in this table, stop — it is parked for a reason.

| Item | Why parked | Where/when it resumes |
|---|---|---|
| Real Google OAuth smoke + formal F5 sign-off | Founder must add `http://127.0.0.1:54321/auth/v1/callback` in Google Console; cannot be automated | "F5 sign-off status" above; sign retroactively after smoke |
| `private.is_offering_staff()` / `private.is_enrolled()` | Their tables (`offering_staff`, `enrollments`) don't exist before core-academics | ✅ delivered in T-A003 migration (2026-10-15) |
| `resend` npm package | Notifications engine not built (adapter behind interface per D4) | Install when T-A012 notifications ship |
| `@sentry/nextjs` | Optional at MVP; needs PII-scrubbing config (D5) | Before first production deploy (plan.md §7 DEP-2) |
| shadcn `form` component | Needs `react-hook-form`, not on the approved library list | Use zod + server actions instead, always |
| Booking features 3.3–3.6 (public schedule, peer visibility, chat, swaps, reminders, waitlist) | Out of MVP scope (plan.md §5) | T-A007; `booking.waitlist.enabled=false` stays OFF |
| Objections 4.x | Out of MVP scope | T-A008 |
| Messaging, coursework, calendar, PWA push | Out of MVP scope (plan.md §0) | P2 expansion phase |
| Ads enablement (flipping `ads.*` flags on) | Deploy strategy: Marks + Booking must be live & stable in prod first | plan.md §7 GATE |
| Visit analytics / revenue payouts 10.7–10.9 | No ad revenue yet; terms must state revenue share first (D15) | T-B005 / T-B006, post-MVP |
| Public SEO/content layer (T-B001, T-B004) | After ads gate; traffic before monetization (plan.md §9) | Post-MVP priority #1–2 |
| `CODEOWNERS` placeholder handles (`@founder-a` / `@founder-b`) | Real GitHub handles unknown | Replace once founders decide |
| Cloud `private.runtime_config` dblink password | Cloud Postgres password ≠ local `postgres` seed value | Ops SQL when cloud project is provisioned (never commit) — F3 phase log |
| WSL keep-alive automation | Manual `Start-Process wsl.exe sleep infinity` works (legacy WSL machine) | Optional: systemd/user task later |
| `vitest.config.ts` → `.mts` rename | Cosmetic ESM-in-CJS warning only | Only if the warning becomes noisy |
| eslint@9 + eslint-config-next upgrade | Deprecated upstream but pinned pair works; upgrade both together | Routine maintenance window |
| Supabase CLI 2.121.0 (installed 2.120.0) | Version parity Windows/WSL/CI matters more than newest | Upgrade all three together when convenient |

## Known issues / watch list

- (Legacy WSL machine) WSL keep-alive is manual (no systemd task yet). If containers cycle every ~30s, re-run the keep-alive command. (Re-confirmed 2026-10-15: after a WSL restart the stack auto-started but containers cycled until the keep-alive `wsl.exe sleep infinity` process was launched.)
- (Current machine) `supabase start` may exit with `container is not ready: starting` on the first attempt right after a Docker Desktop boot — wait ~30 s and re-run (resumes; no data loss).
- (Current machine) Use the repo-pinned CLI (`pnpm exec supabase`, v2.120.0) — the global `supabase` (v2.115.0) pins different image tags and silently re-pulls older multi-GB images on `start` (observed 2026-10-16; piped output made it look like a hang).
- e2e flake (cold stack only): "sign-in bounces authenticated users to /app" fails if the Supabase auth container is still warming — proxy `getUser()` network failure is treated as anonymous, so no bounce. Passes on re-run and in CI (fresh stack, sequential health). Not a code bug; re-run the spec before investigating.
- e2e full-parallel flake: on this 8 GB machine the full parallel suite can flake under Docker + Chromium load (incl. pre-existing specs). Runs green spec-by-spec (`--workers=1`); not a code regression. (2026-10-16)
- vitest flake (heavy load only): forks-worker "Timeout waiting for worker to respond" when the machine is simultaneously booting WSL/Docker. Passes on re-run.
- Vitest warns `vitest.config.ts` is ESM-in-CJS (cosmetic; rename to `.mts` if it becomes noisy).
- `pattern="[A-Za-z0-9-]+"` in academics forms is an invalid regex under the `v`-flag attribute parsing (browser console error only; server Zod still validates). Pre-existing; fix opportunistically.
- Supabase services bind `0.0.0.0` in local dev with shared default JWT secrets — fine for local, never reuse in production.
- `eslint@9` is deprecated upstream; `eslint-config-next` 16.4 still targets it — upgrade both together later.
