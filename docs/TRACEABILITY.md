> Purpose: Feature-to-implementation and test matrix
> Audience: founders and coding agents
> Prerequisites: `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Feature Traceability Matrix

Feature IDs are sourced from the supplied sketch; §15 migration/cleanup is excluded by brief. Each row maps to module schema/RLS/function/pgTAP paths, route ownership, card and named module test file. Tests listed in the module SQL are schema/RLS smoke tests; the required detailed fixture, concurrency, and end-to-end invariants are explicit release gates in `07-quality/test-strategy.md` and task acceptance.

| Feature ID | Phase | Lane | Module/tables | Routes | Cards | Test file |
|---|---|---|---|---|---|---|
| G1 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| G2 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| G3 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| G4 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| G5 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| G6 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| G7 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| G8 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| G9 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| 1.1 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| 1.2 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| 1.3 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| 1.4 | P1 | A | `foundation-auth` | /auth/*; /app/profile | T-A002 | `foundation-auth.test.sql` |
| 2.1 | P1 | A | `core-academics` | /app/offerings/*; /app/marks/*; /app/dashboard | T-A003; T-A004; T-A005 | `core-academics.test.sql` |
| 2.2 | P1 | A | `core-academics` | /app/offerings/*; /app/marks/*; /app/dashboard | T-A003; T-A004; T-A005 | `core-academics.test.sql` |
| 2.3 | P1 | A | `core-academics` | /app/offerings/*; /app/marks/*; /app/dashboard | T-A003; T-A004; T-A005 | `core-academics.test.sql` |
| 2.4 | P1 | A | `core-academics` | /app/offerings/*; /app/marks/*; /app/dashboard | T-A003; T-A004; T-A005 | `core-academics.test.sql` |
| 2.5 | P1 | A | `core-academics` | /app/offerings/*; /app/marks/*; /app/dashboard | T-A003; T-A004; T-A005 | `core-academics.test.sql` |
| 2.6 | P1 | A | `core-academics` | /app/offerings/*; /app/marks/*; /app/dashboard | T-A003; T-A004; T-A005 | `core-academics.test.sql` |
| 3.1 | P2 | A | `evaluation-booking` | /app/bookings/* | T-A006; T-A007 | `evaluation-booking.test.sql` |
| 3.2 | P2 | A | `evaluation-booking` | /app/bookings/* | T-A006; T-A007 | `evaluation-booking.test.sql` |
| 3.3 | P2 | A | `evaluation-booking` | /app/bookings/* | T-A006; T-A007 | `evaluation-booking.test.sql` |
| 3.4 | P2 | A | `evaluation-booking` | /app/bookings/* | T-A006; T-A007 | `evaluation-booking.test.sql` |
| 3.5 | P2 | A | `evaluation-booking` | /app/bookings/* | T-A006; T-A007 | `evaluation-booking.test.sql` |
| 3.6 | P2 | A | `evaluation-booking` | /app/bookings/* | T-A006; T-A007 | `evaluation-booking.test.sql` |
| 4.1 | P2 | A | `marks-objections` | /app/objections/* | T-A008 | `marks-objections.test.sql` |
| 4.2 | P2 | A | `marks-objections` | /app/objections/* | T-A008 | `marks-objections.test.sql` |
| 4.3 | P2 | A | `marks-objections` | /app/objections/* | T-A008 | `marks-objections.test.sql` |
| 5.1 | P2 | A | `messaging` | /app/messages/* | T-A009 | `messaging.test.sql` |
| 5.2 | P2 | A | `messaging` | /app/messages/* | T-A009 | `messaging.test.sql` |
| 5.3 | P2 | A | `messaging` | /app/messages/* | T-A009 | `messaging.test.sql` |
| 6.1 | P2 | A | `coursework` | /app/coursework/*; /guides/* | T-A010 | `coursework.test.sql` |
| 6.2 | P2 | A | `coursework` | /app/coursework/*; /guides/* | T-A010 | `coursework.test.sql` |
| 6.3 | P2 | A | `coursework` | /app/coursework/*; /guides/* | T-A010 | `coursework.test.sql` |
| 6.4 | P2 | A | `coursework` | /app/coursework/*; /guides/* | T-A010 | `coursework.test.sql` |
| 7.1 | P2 | A | `timetable-calendar` | /app/calendar | T-A011; T-A013 | `timetable-calendar.test.sql` |
| 7.2 | P3 | A | `timetable-calendar` | /app/calendar | T-A011; T-A013 | `timetable-calendar.test.sql` |
| 8.1 | P2 | B | `ta-features` | /ta/* | T-B007; T-B011 | `ta-features.test.sql` |
| 8.2 | P2 | B | `ta-features` | /ta/* | T-B007; T-B011 | `ta-features.test.sql` |
| 8.3 | P3 | B | `ta-features` | /ta/* | T-B007; T-B011 | `ta-features.test.sql` |
| 8.4 | P3 | B | `ta-features` | /ta/* | T-B007; T-B011 | `ta-features.test.sql` |
| 8.5 | P3 | B | `ta-features` | /ta/* | T-B007; T-B011 | `ta-features.test.sql` |
| 8.6 | P2 | B | `ta-features` | /ta/* | T-B007; T-B011 | `ta-features.test.sql` |
| 9.1 | P3 | B | `teacher-reviews` | /admin/moderation/* | T-B012 | `teacher-reviews.test.sql` |
| 9.2 | P3 | B | `teacher-reviews` | /admin/moderation/* | T-B012 | `teacher-reviews.test.sql` |
| 10.1 | P1 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 10.2 | P1 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 10.3 | P1 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 10.4 | P1 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 10.5 | P1 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 10.6 | P1 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 10.7 | P2 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 10.8 | P2 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 10.9 | P2 | B | `monetization` | /app/*; public routes; /admin/ads/* | T-B002; T-B003; T-B005; T-B006 | `monetization.test.sql` |
| 11.1 | P1 | B | `public-seo-traffic` | /; /universities/*; /courses/*; /calculators/*; /tools/* | T-B001; T-B004; T-B009 | `public-seo-traffic.test.sql` |
| 11.2 | P1 | B | `public-seo-traffic` | /; /universities/*; /courses/*; /calculators/*; /tools/* | T-B001; T-B004; T-B009 | `public-seo-traffic.test.sql` |
| 11.3 | P1 | B | `public-seo-traffic` | /; /universities/*; /courses/*; /calculators/*; /tools/* | T-B001; T-B004; T-B009 | `public-seo-traffic.test.sql` |
| 11.4 | P2 | B | `public-seo-traffic` | /; /universities/*; /courses/*; /calculators/*; /tools/* | T-B001; T-B004; T-B009 | `public-seo-traffic.test.sql` |
| 11.5 | P1 | B | `public-seo-traffic` | /; /universities/*; /courses/*; /calculators/*; /tools/* | T-B001; T-B004; T-B009 | `public-seo-traffic.test.sql` |
| 11.6 | P2 | B | `public-seo-traffic` | /; /universities/*; /courses/*; /calculators/*; /tools/* | T-B001; T-B004; T-B009 | `public-seo-traffic.test.sql` |
| 12.1 | P2 | B | `chatbot` | /app/help/* | T-B010; T-B013 | `chatbot.test.sql` |
| 12.2 | P3 | B | `chatbot` | /app/help/* | T-B010; T-B013 | `chatbot.test.sql` |
| 13.1 | P2 | A | `notifications-mobile` | /app/notifications/* | T-A012 | `notifications-mobile.test.sql` |
| 13.2 | P2 | A | `notifications-mobile` | /app/notifications/* | T-A012 | `notifications-mobile.test.sql` |
| 13.3 | P2 | A | `notifications-mobile` | /app/notifications/* | T-A012 | `notifications-mobile.test.sql` |
| 14.1 | P1 | B | `admin` | /admin/* | T-B008 | `admin.test.sql` |
| 14.2 | P2 | B | `admin` | /admin/* | T-B008 | `admin.test.sql` |
| 14.3 | P2 | B | `admin` | /admin/* | T-B008 | `admin.test.sql` |
| 14.4 | P2 | B | `admin` | /admin/* | T-B008 | `admin.test.sql` |
| 15.1 | P2 | Shared | `projects` | /app/projects/* | owner request 2026-11-11 | `supabase/tests/projects.rls.test.sql` |
| 15.2 | P2 | Shared | `projects` | /app/projects/* | owner request 2026-11-11 | `supabase/tests/projects.rls.test.sql` |
| 15.3 | P2 | Shared | `projects` | /app/projects/* | owner request 2026-11-11 | `supabase/tests/projects.rls.test.sql` |
| 15.4 | P2 | Shared | `projects` | /app/projects/* | owner request 2026-11-11 | `supabase/tests/projects.rls.test.sql` |
| 15.5 | P2 | Shared | `projects` | /app/projects/*; /api/projects/export | owner request 2026-11-11 | `supabase/tests/projects.rls.test.sql` |
| 15.6 | P2 | Shared | `projects` | /app/projects/* | owner request 2026-11-11 | `supabase/tests/projects.rls.test.sql` |
| 15.7 | P2 | Shared | `projects` | /app/projects/*; /api/projects/export | owner request 2026-11-11 | `supabase/tests/projects.rls.test.sql` |
| 15.8 | P2 | Shared | `projects` | /app/projects/* | owner request 2026-11-11 | `supabase/tests/projects.rls.test.sql` |

## Route ownership
- `/auth/*` — see `05-frontend/route-map.md`; owned by A.
- `/app/dashboard` — see `05-frontend/route-map.md`; owned by A.
- `/app/profile` — see `05-frontend/route-map.md`; owned by A.
- `/app/offerings/*` — see `05-frontend/route-map.md`; owned by A.
- `/app/marks/*` — see `05-frontend/route-map.md`; owned by A.
- `/app/bookings/*` — see `05-frontend/route-map.md`; owned by A.
- `/app/objections/*` — see `05-frontend/route-map.md`; owned by A.
- `/app/messages/*` — see `05-frontend/route-map.md`; owned by A.
- `/app/projects/*` — see `05-frontend/route-map.md`; owner request 2026-11-11 (TA console + student project views); owned by Shared.
- `/api/projects/*` — see `05-frontend/route-map.md`; owner request 2026-11-11 (staff Excel export); owned by Shared.
- `/app/coursework/*` — see `05-frontend/route-map.md`; owned by A.
- `/app/calendar` — see `05-frontend/route-map.md`; owned by A.
- `/ta/*` — see `05-frontend/route-map.md`; owned by B.
- `/universities/*` — see `05-frontend/route-map.md`; owned by B.
- `/courses/*` — see `05-frontend/route-map.md`; owned by B.
- `/guides/*` — see `05-frontend/route-map.md`; owned by B.
- `/blog/*` — see `05-frontend/route-map.md`; owned by B.
- `/help/*` — see `05-frontend/route-map.md`; owned by B.
- `/calculators/*` — see `05-frontend/route-map.md`; owned by B.
- `/tools/*` — see `05-frontend/route-map.md`; owned by B.
- `/admin/*` — see `05-frontend/route-map.md`; owned by B.
- `/api/*` — see `05-frontend/route-map.md`; owned by B.

## Database coverage
Every registry module has a schema, RLS, functions and pgTAP file under `03-database/`. Table/RLS smoke assertions are generated per module. Release gate requires policy-level positive, negative and cross-tenant fixture tests for every table before production.

## Critical invariant coverage
- Concurrent capacity and one active booking/period: `T-A006`, evaluation-booking pgTAP + parallel Playwright/API test.
- Atomic swap and waitlist promotion: `T-A007`, booking transaction/concurrency tests.
- CSV preview no-write and confirm idempotency: `T-A004`, importer unit/integration + DB uniqueness test.
- Objection mark/history/audit atomicity: `T-A008`, transaction rollback and success pgTAP.
- Payout/revenue immutability and worked allocation vector: `T-B006`, SQL ledger test.
- Public/private boundary and k-threshold: `T-B001`, public view anonymous/cross-tenant tests.

## Traceability audit status
Feature IDs and route groups are enumerated. Before a release, replace any generic card references with the final split card IDs and complete fixture-level policy tests. Current plan has one principal implementation card per module area, not the final balanced one-day card decomposition.

## Self-check
- [x] Header and required content are present.
- [x] Naming source and ownership are stated.
