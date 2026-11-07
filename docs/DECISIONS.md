> Purpose: Decision source and rationale
> Audience: founders and implementation agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Decision Log v1

## Authority and locked decisions
Supabase/Postgres/Auth/Realtime/Storage only when unavoidable; Next.js App Router, TypeScript strict, Tailwind, shadcn/ui; no ORM; migrations via Supabase CLI only; modular monolith; Google sign-in with server-enforced allowed domains; RLS on every table; integer minor units and ISO currency; UTC timestamps and Asia/Karachi display default; business-owned service accounts; Vitest, Playwright, pgTAP, CI per PR; English UI scaffolded with next-intl. Deployment and all services are free-tier only; no Vercel; no paid plans.

## Applied defaults
| ID | Decision | Application |
|---|---|---|
| D1 | pnpm, Node LTS, strict TS, ESLint/Prettier, Husky/lint-staged | Root tooling baseline; pin exact supported versions during Phase 0 and commit lockfile. |
| D2 | Server Components and server mutations; TanStack Query for realtime | No client fetch for private data without RLS. |
| D3 | Zod | Validate every server boundary and share schemas. |
| D4 | Resend adapter | Provider behind interface; configure SPF/DKIM/DMARC. |
| D5 | Sentry + external uptime | Frontend and Edge Functions; redact PII. |
| D6 | first-party visit count + GA4 + Search Console | Consent and privacy controls apply. |
| D7 | Recharts lazy | Never on public critical path. |
| D8 | Tiptap sanitized HTML + JSON | Sanitize on write and render. |
| D9 | Papaparse preview, server-authoritative CSV | Preview then explicit idempotent confirm. |
| D10 | k=5, review k=5 | Suppress aggregates below threshold. |
| D11 | 6-hour booking cutoff | TA may choose stricter cutoff per period. |
| D12 | 180-day message retention | University setting may shorten/extend under approved policy. |
| D13 | Popunder cap four opens/user/24h (ADR-013), one pop format/page | First-party random browser ID; counts successful popunder opens, not page loads; Adsterra dashboard cap is the impression limiter; no fingerprinting. |
| D14 | 90-day raw visits | Aggregate retained subject to policy. |
| D15 | 50% attributable TA pool | Must be stated in terms before revenue activation. |
| D16 | PKR 2,000 payout minimum | Configurable by platform admin. |
| D17 | Postgres counters and Edge limits | Apply to writes, auth-adjacent, chat, link uploads and AI. |
| D18 | local/staging/production | **Amended 2026-10-19 (ADR-010): staging-as-prod accepted** — local + one cloud project (`tixpnfbfordadffhqsqs`) serve as staging and production; no separate prod project. Backups/snapshots + migration-only changes are mandatory because destructive cloud operations hit production. |
| D19 | Realtime with polling fallback | RLS-correct channels. |
| D20 | One-time SQL bootstrap using BOOTSTRAP_ADMIN_EMAIL | Idempotent, audited, run once by authorized operator. |
| D21 | WCAG 2.1 AA | Core flows release gate. |
| D22 | Last two Chrome/Edge/Safari/Firefox; Android Chrome priority | E2E/browser matrix. |

## ADRs and safe defaults
- ADR-001: UUIDs use `gen_random_uuid()`; canonical tenant parent/child references use `(university_id,id)` composite keys.
- ADR-002: CSV maximum 10 MiB and 10,000 rows; reject larger files before parsing. Tune from measured memory/load.
- ADR-003: calendar subscriptions use high-entropy revocable bearer tokens stored as hashes; response contains only the owner's calendar.
- ADR-004: private pages initially allow configurable ads but sensitive-value reveal and per-page `isolation_mode` support `iframe_only` and `no_script_ads`; platform may disable scripts immediately. Follow legal/provider terms.
- ADR-005: consent defaults are region-aware and conservative; obtain qualified legal review before production.
- ADR-006: Hosting and database run on free tiers only (no Vercel, no paid plans); backups enabled where the free plan allows; monitor free-tier limits and verify current limits/terms at execution.
- ADR-007: schema support tables explicitly registered include `course_meetings`, `consent_records`, `objection_rate_limits`, and `ad_impressions`; each has tenant and RLS treatment.
- ADR-008: placement IDs and provider script identifiers are data; trusted script URL allowlists remain code-controlled to prevent arbitrary script injection.
- ADR-009 (amended 2026-10-18; superseded by ADR-011 2026-11-05): DEP-1 deployment target is **Netlify Free** (credit-based plan, no credit card): GitHub-connected builds from `Metria26/Metria-Web` (`main` = production), free `metria-web.netlify.app` HTTPS subdomain, staging via free branch deploys, secrets as Netlify env vars (staging-as-prod per D18/ADR-010; no production-context project override). Credit limits are hard (300/month; 15 per production deploy, 20/GB bandwidth, 2/10k requests; previews/branch deploys free; sites pause when exhausted and no card means no top-ups) — batch merges, test on branch deploys, keep pages light. The original Oracle VM plan (Always Free + Caddy + DuckDNS + rsync CI) was rejected at signup — Oracle requires a credit card for non-Academy users (FAQ + 2026 signup flow), as did every other candidate: Render (card), Hugging Face Docker Spaces (PRO-only), Vercel Hobby (non-commercial only; ads explicitly listed as commercial), OpenShift Developer Sandbox (trial terms forbid production), Zeabur/Back4App/Railway/SnapDeploy (unusable free tiers, demo-only, or card). Cloudflare Workers is the named fallback but stays rejected until its Next-16 `cacheComponents`/`proxy.ts` adapter gaps close (opennextjs-cloudflare #1318) — the free 10 ms CPU/invocation limit is a standing error-1102 risk. Runbook: README "Hosting — Render (DEP-1)" (Netlify fallback notes). **Historical:** superseded for the current target by ADR-011 (2026-11-05); retained for the decision trail.
- ADR-010 (2026-10-19): **Staging-as-prod + production ads activated.** The single free Supabase cloud project `tixpnfbfordadffhqsqs` is production (D18 amended); no second project. This trades staging/production data isolation for cost/simplicity — take a backup/snapshot before schema changes and use migrations + CLI only. **Ads MUST be ON in production**: `ads.enabled=true`, `ads.public.enabled=true`, `ads.private.enabled=true`, `ads.global_kill=false`, and the `adsterra` network enabled; the seed mirrors this so resets/fresh deploys never go dark. Supersedes any prior "ads flags OFF in production" deployment rule. The kill switches (master, per-network, `/admin/ads`) remain the emergency darkening control and are the only approved way to pause ads during an incident. The formal kill-switch rehearsal + 1-week post-activation monitoring are a blocked owner/time target, not a code blocker. ADR-004/ADR-005 still govern consent, isolation and sensitive-value reveal.
- ADR-011 (2026-11-05): **DEP-1 hosting target moved to Render Free.** Primary web service `metria-web` at `https://metria-web.onrender.com`, GitHub-connected to `Metria26/Metria-Web` with `main` as production. Netlify Free (`metria-web.netlify.app`, `netlify.toml`) is retained as an emergency fallback, not a second production target; if used, it needs its own `NEXT_PUBLIC_SITE_URL` and both host URLs in the Supabase Auth/Google OAuth allowlists, and Adsterra must be re-verified for the fallback domain (it is currently verified against Render only). Render Free limits are hard constraints: 15-minute idle spin-down (~1-minute cold start), 750 instance hours/month, 0.1 CPU / 512 MB, no edge caching or persistent disk, and `/robots.txt` disallows while asleep — verify current terms. The free-tier-only rule (ADR-006) and staging-as-prod (ADR-010) remain in force. Supersedes ADR-009 for the current hosting target. Runbook: README "Hosting — Render (DEP-1)".
- ADR-012 (2026-11-05): **Render Free keep-alive + uptime monitoring.** Render Free remains the production target (ADR-011); an external uptime monitor checks `https://metria-web.onrender.com/api/health` every 3-5 minutes so the 15-minute idle spin-down does not occur. The health route is shallow (no DB/auth/ads) and is excluded from the Supabase session proxy. This is a best-effort workaround, not a 24/7 SLA: the workspace has 750 free instance hours/month (a 31-day month uses 744), so only one free web service can be kept awake 24/7; monitors are a single point of failure; Render may restart free services at any time. Keep the separate Supabase inactivity keep-alive task distinct because the shallow health route does not touch Supabase. If instance hours approach 750, pause the pinger for the remaining hours (accepting a cold start) or fall back/upgrade; hitting the cap suspends all free services until the next month. Review this ADR if ad/SEO uptime becomes revenue-critical; the supported fix is a paid Render instance. Runbook: README "Hosting - Render (DEP-1)".
- ADR-013 (2026-11-06; revised 2026-11-07): **Adsterra popunder approved with an open-based frequency cap.** Scope is the landing page, legal/trust pages and every authenticated `/app` page; `/auth/*`, `/admin/*` and error routes stay ad-free. The unit requires the independent `ads.popunder.enabled` switch and is served from the reviewed host `https://abscloud.org`. Frequency is at most four successful popunder opens per browser per rolling 24 hours, stored in the first-party `metria_ad_visitor` cookie (random id + recent open timestamps; no fingerprinting). The first-party tracker wraps `window.open` so only actual `_blank` opens consume slots; page loads and reloads do not. After four opens the script is no longer injected. Adsterra's dashboard/support cap is the authoritative impression limiter and should be set to four impressions per user per 24 hours. The earlier 4-per-2h and 2-per-24h script-load caps were superseded because load-based counting blocked popunders for the rest of the day after two visits, including visits that never produced a popunder. Focus/background behavior is controlled by the Adsterra script; request a network variant before adding any focus monkey-patch. The script is not removed on unmount; sign-out and public "Open app" transitions hard-reload so a listener cannot follow a user into `/auth/*`.

## Rollback rule
Never rename/drop a field in one release. Add nullable replacement, dual-write/read, backfill, verify, switch consumers, then remove in a later release with a documented restore path. Money/history rows are append-only; corrections are compensating entries.

## Self-check
- [x] Purpose, audience, prerequisites, owner lane, and registry version are stated.
- [x] Scope and implementation constraints are explicit.
