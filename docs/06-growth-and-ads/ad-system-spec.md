> Purpose: Ad configuration, safety and rendering contract
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: B
> Last verified against SYMBOL_REGISTRY version: v1

# Ad System Specification

Resolver input is university, page type, slot, consent state, authenticated context and device class. Resolver returns ordered eligible units from active immutable `ad_config_versions`, after global/network kill switches, public/private layer switches, auth exclusion, isolation mode, frequency cap, placement enablement and consent requirements. Cache config at edge with documented maximum 60-second TTL; kill state has separate short TTL and client rechecks on next page load. Emergency direct SQL procedure is in runbook.

Formats: banner, native, social bar, in-page push, pop-under, smartlink, direct sponsor. Each registry record declares pop-style, consent requirement, injection mode, allowed pages and minimum dimensions. At most one pop-style unit per page; default one/user/24 hours using random first-party browser storage ID, no fingerprinting. Owner-approved exception (ADR-013): the Adsterra popunder is capped at four successful opens per user per 24 hours, with Adsterra's dashboard impression cap as the authoritative limiter. Admin can turn off public or private aggressive formats independently. Login/auth page type is constrained in database to disabled and checked in code before importing ad bundle.

Every slot has reserved geometry; below-fold lazy loads; scripts async/deferred; isolated adapter/error boundary; failure leaves empty slot. Never overlay/adjacent to Book, Submit or Raise Objection. CLS budget ≤0.1. Add Playwright checks for auth script absence, slot/button spacing, no layout shift and kill switch. Direct sponsor creatives have visible Sponsored label, approved image/link, schedule, target pages/tenant, expiry and first-party bot-filtered impression/click counts. Never incentivize clicks.

Consent categories and regional defaults gate scripts. Privacy page renders network names from active `ad_networks`, avoiding drift. CSP Report-Only first, then enforced allowlists; Permissions-Policy, referrer policy and iframe sandbox apply. Adapter interface: `resolve(config, context)`, `mount(slot, consent)`, `destroy()`, `report(error)`; network-specific code stays behind adapter. New network requires data, adapter, setup checklist and QA signoff, never page edits.

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
