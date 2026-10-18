> Purpose: Ownership, interfaces and balancing protocol
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Lane Ownership and Parallel Work

Phase 0 is joint and sequential. Lane A owns auth/roles UI, academics, marks/imports, booking, objections, messaging, coursework, timetable, notifications, TA onboarding. Lane B owns public SEO, content, calculators/tools, ad system, analytics/revenue/payouts, admin, TA public/reviews, chatbot and sharing.

CODEOWNERS (real handles, derived from commit history 2026-10-18 — current practice crossed lanes for booking/ads, so this reflects actual authorship): `/src/features/auth/`, `/src/features/marks/` → `@HassanNawaz14`; `/src/features/booking/` → `@zohaib-mzg`; `/src/features/academics/`, `/src/features/ads/` → `@HassanNawaz14 @zohaib-mzg`; planned `/src/features/growth/`, `/src/features/admin/` → `@zohaib-mzg`; shared `/src/app/`, `/src/components/`, `/src/lib/`, `/src/i18n/`, `/supabase/migrations/`, `/supabase/functions/`, `/docs/` require both (cross-lane review).

Contract-first: generated DB types, zod RPC schema, route DTO and mock land before consumer. Earliest cross-lane interfaces: universities/membership for public tenant hub; courses/offering_staff for attribution; publication views for SEO; ad resolver for all layouts; audit/outbox for admin/notifications. Mock repositories allow parallel UI work.

Sizing ranges: S 2–4h, M 4–7h, L 7–8h; split anything larger. Balance each phase to ±15% by moving notifications UI, TA profile screens and moderation surfaces after estimating cards. Daily loop: choose DAG-ready card, load AGENTS.md and card context, implement, run tests, update registry/docs, submit PR.

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
