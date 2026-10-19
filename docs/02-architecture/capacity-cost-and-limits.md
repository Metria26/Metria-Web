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
| Web hosting | Local dev server | Free self-hostable deployment target (implementation-agnostic, chosen at deployment) | Sustained resource/egress limits; optimize before any change |
| Supabase | Local CLI and isolated staging | Free-tier project within its limits | Before DB size/egress/connection limits or inactivity pauses; optimize and archive first |
| Email | Sandbox | Resend free tier with verified domain | Quota or bounce threshold |
| Error monitoring | Developer tier | Free tier within quota | Quota or retention pressure |
| Ad providers | Test placement | Approved business account and category controls | Before ad scripts in production |

Track DB size, egress, connection saturation, p95 query latency, queue age, retries, ad RPM, consent rate, CWV and cost per 1,000 sessions weekly. Act before sustained 70% storage/egress/connection budget, p95 DB >300 ms for critical RPCs, or queue oldest age >5 minutes. Configure pooling, indexes, retention/purge jobs and aggregates before considering any capacity change. Verify current provider free-tier limits, terms, privacy terms, payout rules and ad-network terms at execution time; they change.

Backups: daily backups enabled where the plan allows; restore drill before launch and quarterly. **Staging-as-prod (ADR-010, D18 amended 2026-10-19):** local + one cloud project serve as staging and production, so take a snapshot/backup before schema changes and never run destructive performance fixtures against the cloud project. Never use production student data in performance fixtures.

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
