# Current Plan — Limitations & Solution Proposals

> Internal reference only (not part of the product docs). Written 2026-10-19 from a
> full frontend + database code read of the current build. Each item lists evidence,
> user impact, and proposed solutions (text only — nothing here is implemented yet).
> Ops items already tracked in README (DEP-2 hosted verification, kill-switch rehearsal,
> monitoring) are intentionally not duplicated here.

---

## L1. New users are stuck "pending" — no membership approval flow

- **What**: Signing in with a valid `@lhr.nu.edu.pk` Google account creates the profile but the
  university membership is inserted with `status = 'pending'`
  (`supabase/migrations/20261014213000_s_auth_domain_allowlist.sql:175`). Every tenant-scoped
  RLS check uses `private.current_university_ids()`, which only returns **active** memberships
  (`supabase/migrations/20261015141145_a_core_academics.sql:184`). No screen in `src/` reads or
  writes `university_memberships`.
- **Impact**: A real student or TA who signs up sees a completely empty product. Only the
  bootstrap admin account is active immediately. The product is effectively unusable in
  production for anyone but the admin.
- **Proposed solutions** (pick per appetite):
  1. *Small*: Admin console section "Memberships" — list pending profiles (name, email,
     created date) with Activate / Suspend buttons; server action + `audit_log` row.
  2. *Medium*: Auto-activation with a guard — e.g. a `membership.auto_activate` feature flag
     that activates domain-verified signups automatically, default OFF; keep manual approval
     as fallback.
  3. *Immediate stopgap (no code)*: documented SQL runbook for the operator
     (`UPDATE public.university_memberships SET status='active' WHERE profile_id = ...`)
     executed via the Supabase SQL editor, plus a short "approval queue" habit.

## L2. No role assignment UI (student / ta / teacher)

- **What**: `role_assignments` is only ever populated by `supabase/seed.sql`. Nothing in `src/`
  inserts or revokes role assignments. `private.has_permission()` depends on role assignments,
  so offering creation, announcements, booking period management, and enrollment all silently
  fail for anyone without a `ta`/`teacher` role.
- **Impact**: Cannot mint TAs/teachers in production; even an activated member gets "not
  authorized" errors on staff features with no explanation of why.
- **Proposed solutions**:
  1. Admin console "Roles" section: search profile by email → Assign / Revoke role
     (`student`, `ta`, `teacher`), with audit rows. Reuses the same `requireAdmin` gate.
  2. Add a guided empty state on staff pages: "Your account has no staff role yet — ask an
     administrator to assign one" instead of a generic error.
  3. Stopgap: SQL runbook mirroring the seed inserts.

## L3. Dead navigation links in sidebar and bottom nav

- **What**: `src/components/shell/nav-items.ts` links `/app/calendar`, `/app/messages`, and
  `/app/profile`, but no routes exist for them (verified: `src/app/(app)/app/` contains only
  dashboard, offerings, marks, bookings).
- **Impact**: Users tap Calendar / Messages / Profile in the nav and hit a not-found page.
  This is the most visible roughness for a first-time user.
- **Proposed solutions**:
  1. Hide nav entries whose feature flag is OFF / page doesn't exist yet (small, immediate).
  2. Build the cheapest useful real page next: **Profile** (display name, email, role,
     membership status) — data already readable; turns a dead link into trust.
  3. Calendar/messages stay hidden until their lanes ship (T-A011/T-A009).

## L4. Staff forms render for students on the offering page

- **What**: `src/app/(app)/app/offerings/[offeringId]/page.tsx` renders `SectionForm` (line
  234), `AssessmentForm` (line 274), and `EnrollmentForm` (line 333) unconditionally. Only the
  marks links, announcement composer, and analytics are gated by `viewerIsStaff`. Students can
  fill these forms; the writes then fail with a generic "not authorized".
- **Impact**: Confusing UX and an impression of brokenness; students may attempt (and reasonably
  expect to be able to) self-enroll or create sections.
- **Proposed solutions**: Gate the three forms with the existing `viewerIsStaff` check (same
  pattern as `AnnouncementComposer`); optionally wrap staff tools in a single "Manage" section
  that expands. Small change, no schema work.

## L5. Only the offering creator can be staff on an offering — no staff management

- **What**: On offering creation the app inserts exactly one `offering_staff` row for the
  creator (`src/features/academics/actions.ts:144-151`). No UI writes any other staff row.
  Marks/announcements/booking-management RLS all key on having an `offering_staff` row.
- **Impact**: Co-teachers and TAs can't be attached to a course; handover/coverage is
  impossible; only the creator can enter marks or post announcements.
- **Proposed solutions**:
  1. "Staff" section on the offering page: list current staff (name, role), Add by email with
     role select (teacher/ta), Remove (creator/admin only). Server actions gated by
     `academic.manage_offering`; audit.
  2. Interim: allow "add staff" from the Admin console as an emergency lever.

## L6. TA and teacher are enforcement-identical today

- **What**: Seed gives TA and teacher the same capabilities except `review.moderate`
  (feature currently OFF) — `supabase/seed.sql:88-106`. Every RLS helper branches on
  `is_offering_staff` + permission keys, never on role name.
- **Impact**: None functionally; it just means the two roles are a label + future placeholder
  right now. Worth recording so nobody promises differences that don't exist.
- **Proposed solutions**: Keep as-is for MVP; when objections/reviews ship (T-A008/T-B012),
  rebalance the permission matrix and document the differences in the guide.

## L7. Inconsistent permission checks across features

- **What**: Booking period management requires staff row **and** `booking.manage_period`
  (`20261016180000_a_evaluation_booking.sql:177`); announcement posting requires staff row
  **and** `academic.manage_offering` (`20261016120000_a_announcements_dashboard.sql:52-67`);
  but **marks** read/insert/update key only on `is_offering_staff`
  (`20261015190000_a_marks_import.sql:84-88`) — `marks.manage` is never checked.
- **Impact**: Anyone with a staff row (even a role-less "member" fallback row) can enter marks
  for that offering. Not exploitable by outsiders, but the matrix and the code disagree.
- **Proposed solutions**: Decide and align — either add
  `private.has_permission(university_id, 'marks.manage')` to the marks insert/update policies,
  or explicitly declare staff-row sufficiency as the intended rule and document it in the
  permission matrix.

## L8. Staff cannot book evaluation slots (must be enrolled to book)

- **What**: `private.book_slot` requires `private.is_enrolled(period.section_id)`
  (`20261016180000_a_evaluation_booking.sql:409`).
- **Impact**: Intended for students, but TAs cannot demo or sit their own course's bookings
  unless formally enrolled in a section.
- **Proposed solutions**: Accept + document; or, later, a staff "observer slot" concept if
  needed for demos/support.

## L9. Most flags are OFF — large parts are schema-only

- **What**: `supabase/seed.sql:124-147` seeds messaging, coursework, calendar, reviews,
  waitlist/swap, visit analytics, revenue, payouts, TA tools, sharing, chatbot, and push flags
  all OFF. Ads are the only live feature set.
- **Impact**: Tables and policies exist but no UI; combined with L3 dead links it looks like
  missing features rather than unshipped ones.
- **Proposed solutions**: Keep features behind flags; hide their nav entries (L3); when each
  lane ships, flip flags per environment and announce. No change needed structurally.

## L10. The only admin surface is the ads console

- **What**: `/admin/ads` (flags/kill switches/networks/placements/config versions/audit) is the
  only admin route; `platform.manage_universities`, `platform.manage_roles`,
  `platform.moderate_content`, `platform.view_audit`, `platform.manage_revenue` exist in the
  catalog but have no UI. `audit_log` rows are written but never displayed.
- **Impact**: Membership approvals (L1), role assignment (L2), flag management beyond ads, and
  audit review all require SQL today.
- **Proposed solutions**: Grow `/admin` into a small hub: tabs for Ads (existing), Memberships,
  Roles, Flags, Audit. Reuse `requireAdmin()` and the audit-writing helper; each tab can ship
  independently.

## L11. No in-app path to the admin console

- **What**: No link anywhere in the app shell points to `/admin/ads`; the admin must type the
  URL. Non-admins hitting it are redirected to `/app` (good).
- **Impact**: Minor discoverability issue for operators who don't memorize URLs.
- **Proposed solutions**: Show an "Admin" nav entry only when the viewer is a platform admin
  (the header can read `platform_admins` for the session profile, same as `requireAdmin`).

## L12. Announcements cannot be edited or deleted from the UI

- **What**: The database already allows authors/platform admins to update/delete announcements
  (`announcements_author_update`/`_delete` policies), but only `createAnnouncementAction`
  exists; the offering page renders an `AnnouncementComposer` and a read-only list.
- **Impact**: A typo in an announcement is permanent from the user's point of view.
- **Proposed solutions**: Add Edit / Delete affordances on announcement items for the author
  (and platform admin), calling small server actions; revalidate the offering page and
  `/app`.

## L13. The Marks hub shows a staff-flavored empty state to students

- **What**: `src/app/(app)/app/marks/page.tsx` has two sections: "Teaching" (assessments of
  staffed offerings) and "My marksheets" (the viewer's own released marksheets — this part
  works for students). A student with no staff rows still sees the "Teaching" section with the
  staff empty state ("No teaching assignments").
- **Impact**: Mild confusion for students landing on a staff-titled page; not misleading data,
  since their marksheets render correctly in the second section.
- **Proposed solutions**: Hide the "Teaching" section entirely for viewers with no staff rows
  (or reword it), and keep "My marksheets" as the student-facing half.

## L14. Landing page privacy copy contradicts the live in-app ads policy

- **What**: The landing page "Built around privacy" paragraph claims "Advertising only ever
  appears on public pages — never behind the sign-in screen" (`messages/en.json`, `Home.trustBody`).
  But `ads.private.enabled` is ON (owner decision 2026-10-19) and sponsor/ad units render inside
  the authenticated app (dashboard, booking, offering, marksheet — T-B003). The privacy policy
  copy is correct (it discloses in-app ads and the marksheet tap-to-reveal); only the marketing
  copy is stale.
- **Impact**: A public claim that is no longer true; trust and policy inconsistency at launch.
- **Proposed solutions**: Reword `Home.trustBody` to match the live policy (e.g. "ads are
  labelled, only load after consent, and mark values stay behind tap-to-reveal inside the app")
  before launch. Do this as a copy-only change; no functional work required.

## L15. Mobile navigation omits Courses (and Marks), so staff setup is desktop-only

- **What**: The mobile bottom bar (`src/components/shell/nav-items.ts:28-34`) has Dashboard,
  Bookings, Calendar, Messages, Profile — no **Courses** entry — and the mobile header has no
  menu, only the brand and Sign out. The desktop sidebar does include Courses. The Marks hub is
  not in either nav. A mobile-only TA can reach an offering only through incidental dashboard
  links, not by browsing.
- **Impact**: Creating courses/offerings, enrolling students, marks entry, announcements and
  analytics are effectively unreachable on a phone. Students can browse offerings on mobile
  only via the dashboard empty-state link or an upcoming-assessment link.
- **Proposed solutions**: Add **Courses** to the mobile nav (likely by replacing Calendar or
  Messages, which are placeholders), or add a mobile menu button in the header. Small change;
  high impact for phone-first users.

---

### Suggested order if time-boxed

1. L1 + L2 (a minimal admin Memberships + Roles tab) — without these the product cannot be
   used by real users at all.
2. L3 (hide dead nav links) and L4 (hide staff forms) — biggest visible-quality wins for zero
   schema work.
3. L13 + L12 — small polish, low effort.
4. L5, L10, L11 — next iteration.
5. L6, L7, L8 — decisions/documentation, no urgency.
