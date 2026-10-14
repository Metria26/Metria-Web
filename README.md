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

- **Done:** Step 0 tooling · **Phase 0 init** (scaffold, libs, shadcn, folder structure, test harness, local Supabase, CI, pre-commit) — verified 2026-10-14.
- **Next:** Foundation Gate (`plan.md` §3 / T-S001 + T-A002): foundation migration, pgTAP green, Google OAuth + domain allowlist, bootstrap admin, app shell/design tokens.
- **Founder Step 0 still pending:** Google Cloud OAuth client, `BOOTSTRAP_ADMIN_EMAIL`, GitHub org secrets inventory — fill into `.env.local` when created.
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
- Runtime validation: `src/lib/env.ts` (zod; throws fast when imported). Full registry env list: `SYMBOL_REGISTRY.md`.

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
- `db reset` with zero migrations is a clean no-op schema init (skips `.gitkeep` files correctly).
- pgTAP tests in `supabase/tests/` exist but **only run green after the Foundation migration** (they assert on real schema). CI skips `supabase test db` until `supabase/migrations/*.sql` exist.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Dev server on :3000 (Turbopack, loads `.env.local`) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (flat config; Next 16 removed `next lint`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest run (`src/**/*.test.ts(x)`) |
| `pnpm test:e2e` | Playwright (`e2e/`, auto-starts dev server) |
| `pnpm test:db` | pgTAP via Supabase CLI (run from WSL, see above) |
| `pnpm db:reset` | Reset local DB (WSL) |
| `pnpm db:types` | Generate `src/lib/supabase/database.types.ts` (run after migrations; WSL) |
| `pnpm format` | Prettier write |

Pre-commit: husky + lint-staged (eslint --fix + prettier on staged `ts/tsx/mjs`; prettier on `json/css/yml`).

## Project structure

```
/
├─ docs/                      # source of truth (rigid — never edited without review)
├─ plan.md                    # current execution plan (ephemeral)
├─ README.md                  # this living record
├─ src/
│  ├─ app/                    # route composition only
│  │  ├─ (public)/ (auth)/ (private)/app/ (admin)/admin/   # planned route groups
│  ├─ features/               # {auth,academics,booking,ads} — lane-owned
│  ├─ lib/                    # supabase clients, env.ts, contracts/, utils.ts
│  └─ components/ui/          # shadcn primitives
├─ supabase/
│  ├─ config.toml             # local stack config
│  ├─ migrations/             # ONLY schema authority (CLI, lane-prefixed)
│  ├─ tests/                  # pgTAP (4 MVP modules copied)
│  └─ functions/              # edge functions (later)
├─ e2e/                       # Playwright specs
├─ .github/workflows/ci.yml   # PR pipeline
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

### Next: Foundation Gate (plan §3 / T-S001 + T-A002)
Foundation migration (`s_foundation_auth`), seeds (FAST tenant, roles, flags-off), pgTAP allow/deny/cross-tenant, Google OAuth + server domain allowlist, bootstrap admin (D20), app shell + design tokens + next-intl. **No feature cards until the F5 checklist passes.**

## Git workflow

- Trunk-based: short-lived branches, PRs, cross-lane review on shared paths (`CODEOWNERS`).
- Branch: `hassan-dev` (active dev branch, default on remote) → merge to `main` for stable integration.
- Never commit: `.env*` (except `.env.example`), secrets, student data.
- `CODEOWNERS` currently has placeholder `@founder-a` / `@founder-b` — replace with real GitHub handles.

## Known issues / watch list

- WSL keep-alive is manual (no systemd task yet). If containers cycle every ~30s, re-run the keep-alive command.
- Vitest warns `vitest.config.ts` is ESM-in-CJS (cosmetic; rename to `.mts` if it becomes noisy).
- Supabase services bind `0.0.0.0` in local dev with shared default JWT secrets — fine for local, never reuse in production.
- `eslint@9` is deprecated upstream; `eslint-config-next` 16.4 still targets it — upgrade both together later.
