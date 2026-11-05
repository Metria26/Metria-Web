> Purpose: Core architecture and execution specification
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Capacity, Cost, and Service Tiers

## Planning model
Estimate monthly active users (MAU), peak concurrent sessions, public page views, raw visit events, queue deliveries, database storage and egress independently. Initial launch envelope for sizing is a planning assumption, not a provider guarantee: 2,000 MAU, 100 concurrent users, 250,000 public page views/month, 50,000 private reads/month, 100,000 notification attempts/month. Load-test booking bursts and dashboard RPCs at 5× expected peak.

All services run on free tiers; the project must fit within free-tier limits with no paid upgrades planned.

| Service | Development | Production position | Limit trigger |
|---|---|---|---|
| Web hosting | Local dev server | **Render Free** web service (primary, ADR-011), kept warm by an external `/api/health` monitor (ADR-012); Netlify Free retained as fallback | 15-minute idle spin-down (~1-minute cold start) if the monitor fails, 750 instance hours/month, 0.1 CPU / 512 MB, no edge caching, and `/robots.txt` disallowed while asleep; verify current terms before any change |
| Supabase | Local CLI and isolated staging | Free-tier project within its limits | Before DB size/egress/connection limits or inactivity pauses; optimize and archive first |
| Email | Sandbox | Resend free tier with verified domain | Quota or bounce threshold |
| Error monitoring | Developer tier | Free tier within quota | Quota or retention pressure |
| Ad providers | Test placement | Approved business account and category controls | Before ad scripts in production |

**Render Free keep-alive (ADR-012):** an external monitor (Better Stack Free 3-minute primary; UptimeRobot Free 5-minute optional backup) requests `https://metria-web.onrender.com/api/health` so the service never reaches the 15-minute idle threshold. The endpoint is shallow (no DB/auth/ads) and excluded from the Supabase session proxy; it does not keep Supabase active. A 30-day month consumes ~720 hours and a 31-day month ~744 of the 750 free instance hours, leaving only ~6 hours of headroom in the worst case. Keep exactly one always-awake free web service in the workspace; a second would exceed the allowance. On the 1st of each month, record Render usage; if projected usage approaches 750, pause the pinger for the remaining hours (accepting a cold start) or use the fallback/paid route. Hitting 750 suspends all free services until the next month. This is best-effort, not a 24/7 SLA: monitor failure, Render restarts, or overlapping deploy instances can still cause cold starts.

Track DB size, egress, connection saturation, p95 query latency, queue age, retries, ad RPM, consent rate, CWV and cost per 1,000 sessions weekly. Act before sustained 70% storage/egress/connection budget, p95 DB >300 ms for critical RPCs, or queue oldest age >5 minutes. Configure pooling, indexes, retention/purge jobs and aggregates before considering any capacity change. Verify current provider free-tier limits, terms, privacy terms, payout rules and ad-network terms at execution time; they change.

Backups: daily backups enabled where the plan allows; restore drill before launch and quarterly. **Staging-as-prod (ADR-010, D18 amended 2026-10-19):** local + one cloud project serve as staging and production, so take a snapshot/backup before schema changes and never run destructive performance fixtures against the cloud project. Never use production student data in performance fixtures.

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
