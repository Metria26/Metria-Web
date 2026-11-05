> Purpose: Production readiness checks
> Audience: founders and coding agents
> Prerequisites: `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Launch Checklist

## Product/security
- [ ] Two tenants and cross-tenant attack tests pass.
- [ ] Auth allowed-domain enforcement verified server-side.
- [ ] Marks/import/objection/booking concurrency tests pass.
- [ ] Public pages expose only approved data; private/auth noindex.
- [ ] Deletion, moderation, report, appeal, privacy and non-affiliation flows reviewed.

## Reliability
- [ ] Backups enabled (within free-tier plan) and restore drill recorded.
- [ ] Sentry, uptime, queue/DLQ, database capacity and CWV alerts routed to both founders.
- [ ] Render keep-alive monitor active on `https://metria-web.onrender.com/api/health` (3-5 minute interval, never `/robots.txt`), monitor green after 20+ minutes idle, and Render instance-hour usage recorded (750/month cap; one always-awake free service only).
- [ ] Login, ads, DB and email runbooks rehearsed.
- [ ] Render Free + Netlify fallback service limits and current provider terms verified (including idle spin-down and `/robots.txt` behavior).

## Ads and SEO
- [ ] Consent gating and network listing verified.
- [ ] Auth page contains zero ad scripts; private isolation defaults tested.
- [ ] Category blocks, frequency caps, CLS and action spacing pass.
- [ ] Kill switches tested under admin outage.
- [ ] Sitemap, canonicals, structured data, 404/410, Search Console and Safe Browsing checks pass.

## Business operations
- [ ] Company-owned accounts, MFA, recovery and secrets inventory verified.
- [ ] Terms state revenue share, payout timing/minimum, disputes, moderation, privacy and limitations.
- [ ] Founder lanes have on-call and account recovery coverage.

## Self-check
- [x] Header and required content are present.
- [x] Naming source and ownership are stated.
