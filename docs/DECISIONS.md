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
| D13 | Pop cap one/user/24h, one pop format/page | First-party random browser ID; no fingerprinting. |
| D14 | 90-day raw visits | Aggregate retained subject to policy. |
| D15 | 50% attributable TA pool | Must be stated in terms before revenue activation. |
| D16 | PKR 2,000 payout minimum | Configurable by platform admin. |
| D17 | Postgres counters and Edge limits | Apply to writes, auth-adjacent, chat, link uploads and AI. |
| D18 | local/staging/production | Separate Supabase projects; staging preview deployment on the chosen free hosting target. |
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
- ADR-009 (amended 2026-10-18): DEP-1 deployment target is **Netlify Free** (credit-based plan, no credit card): GitHub-connected builds from `Metria26/Metria-Web` (`main` = production), free `metria-web.netlify.app` HTTPS subdomain, staging via free branch deploys, secrets as Netlify env vars scoped per deploy context against separate Supabase projects (D18). Credit limits are hard (300/month; 15 per production deploy, 20/GB bandwidth, 2/10k requests; previews/branch deploys free; sites pause when exhausted and no card means no top-ups) — batch merges, test on branch deploys, keep pages light. The original Oracle VM plan (Always Free + Caddy + DuckDNS + rsync CI) was rejected at signup — Oracle requires a credit card for non-Academy users (FAQ + 2026 signup flow), as did every other candidate: Render (card), Hugging Face Docker Spaces (PRO-only), Vercel Hobby (non-commercial only; ads explicitly listed as commercial), OpenShift Developer Sandbox (trial terms forbid production), Zeabur/Back4App/Railway/SnapDeploy (unusable free tiers, demo-only, or card). Cloudflare Workers is the named fallback but stays rejected until its Next-16 `cacheComponents`/`proxy.ts` adapter gaps close (opennextjs-cloudflare #1318) — the free 10 ms CPU/invocation limit is a standing error-1102 risk. Runbook: README "Hosting — Netlify (DEP-1)".

## Rollback rule
Never rename/drop a field in one release. Add nullable replacement, dual-write/read, backfill, verify, switch consumers, then remove in a later release with a documented restore path. Money/history rows are append-only; corrections are compensating entries.

## Self-check
- [x] Purpose, audience, prerequisites, owner lane, and registry version are stated.
- [x] Scope and implementation constraints are explicit.
