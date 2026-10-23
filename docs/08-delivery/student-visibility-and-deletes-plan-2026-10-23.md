# Plan: student visibility, TA scoping, and safe deletes

**Status:** implemented in code; migration pending Supabase run  
**Created:** 2026-10-23  
**Implemented:** 2026-10-23  
**Branch when planned:** `zohaib-dev` at `7f9da7a`  
**Migration:** `supabase/migrations/20261024100000_a_student_visibility_and_safe_deletes.sql`

## Goals

1. Students can see evaluation bookings for their own enrolled sections.
2. A TA only sees announcements for the section(s) they own.
3. Every student-facing link resolves; the marksheet fallback is an under-construction page, never a 404.
4. `l242530@lhr.nu.edu.pk` is a TA, not a student; remove leftover test-student data.
5. TAs get delete buttons for the resources they manage, and deleting removes related rows.
6. Students cannot see or act on other students' data, other sections, or unpublished assessments.

## What we found

### Bookings

- Student booking read RLS uses `private.is_enrolled(evaluation_periods.section_id)`.
- `private.is_enrolled()` also requires `university_memberships.status = 'active'` through `private.current_university_ids()`.
- Therefore a student with a pending membership, or with no active enrollment in the period's section, sees an empty bookings page even though a period exists.
- The test-student account created by a friend likely left a pending membership and/or an extra enrollment/student role. This must be verified against the target database before changing data.

### Announcements

- `announcements_staff_read` currently lets **any** `offering_staff` member of the offering read **all** announcements of that offering.
- `offering_staff` is offering-level only; it has no `section_id`.
- `role_assignments` already has an optional `section_id`, but the app does not currently use it for announcement scoping.
- Result: TA A can see TA B's section announcements.

### Marksheet 404

- Student links are rendered from the marks hub and offering page based on marks, not enrollment.
- `private.offering_marksheet()` requires an active enrollment in the offering.
- The marksheet route calls `notFound()` when the offering row is invisible (for example, pending membership), so the link can land on the framework 404 page.
- The route already has an error `EmptyState`, but the request is for an under-construction fallback.

### Student data exposure

- The offering detail page renders all assessments, including `visibility = 'private'`, to every viewer.
- The same page renders staff forms (`SectionForm`, `AssessmentForm`, `EnrollmentForm`) unconditionally. RLS blocks the writes, but students should not see staff-only controls.
- `assessments_member_read` allows any active member of the tenant to read all assessments. This needs tightening for students.
- These are in addition to the announcement leak and must be fixed in the same pass.

### Deletes

- Existing foreign keys are mostly `ON DELETE RESTRICT`:
  - `marks.assessment_id` and `mark_history.mark_id`
  - `slots.period_id`
  - `bookings.period_id` / `bookings.slot_id`
  - `enrollments.section_id`
  - sections/offerings relationships
- A simple `.delete()` will fail or leave records behind. We need explicit security-definer delete RPCs, not bare table deletes.

## Implementation order

### 1. Run diagnostics on the target Supabase database first

Do not apply data cleanup until these return the expected rows.

```sql
-- Account, membership, and roles
select
  p.id,
  p.email,
  p.roll_no,
  m.status as membership_status,
  array_agg(distinct r.name) filter (where r.name is not null) as roles
from public.profiles p
left join public.university_memberships m
  on m.university_id = p.university_id and m.profile_id = p.id
left join public.role_assignments ra
  on ra.university_id = p.university_id and ra.profile_id = p.id and ra.revoked_at is null
left join public.roles r on r.id = ra.role_id and r.university_id = ra.university_id
where lower(p.email) = 'l242530@lhr.nu.edu.pk'
group by p.id, p.email, p.roll_no, m.status;

-- Student enrollment vs. period section
select
  p.email,
  e.status as enrollment_status,
  s.section_code,
  o.offering_code,
  ep.title as period_title
from public.profiles p
left join public.enrollments e on e.profile_id = p.id
left join public.sections s on s.id = e.section_id and s.university_id = e.university_id
left join public.course_offerings o on o.id = s.offering_id and o.university_id = s.university_id
left join public.evaluation_periods ep
  on ep.section_id = s.id and ep.university_id = s.university_id
where lower(p.email) = 'l242530@lhr.nu.edu.pk';

-- Announcement ownership/section visibility
select
  a.id,
  a.title,
  s.section_code,
  p.email as author_email
from public.announcements a
join public.sections s on s.id = a.section_id and s.university_id = a.university_id
join public.profiles p on p.id = a.author_id and p.university_id = a.university_id
order by a.created_at desc;
```

Also check in the Supabase dashboard whether `l242530@lhr.nu.edu.pk` has one auth user/profile or a duplicate test-student profile. If there are two profiles, reconcile manually before deleting anything.

### 2. Migration: account and booking visibility

Planned migration file:

`supabase/migrations/20261024100000_a_student_visibility_and_safe_deletes.sql`

#### 2a. Fix the TA account

- Find the profile by `lower(email) = 'l242530@lhr.nu.edu.pk'`.
- Ensure `university_memberships.status = 'active'`; insert an active membership if one is missing.
- Ensure an active `ta` role assignment exists.
- Revoke active `student` role assignments for this profile.
- Remove test-student enrollment rows for this profile (after confirming no real marks need to be preserved).
- Ensure an `offering_staff` row exists for the offerings they actually TA. Do not blindly staff every offering unless that is confirmed.
- If friend-created marks exist for this profile, add an optional cleanup block that deletes `mark_history` before `marks`. Keep this block commented out until the rows are inspected.

#### 2b. Fix students' membership visibility

- Activate pending memberships for profiles that already have an active `enrollments` row or an accepted enrollment invite. This is safer than activating every pending account.
- Verify `enrollment_invites` rows for existing profiles were materialized into `enrollments`; if not, apply the existing invite-sync path.
- Add an RLS test: a student enrolled in section A sees A periods, not B periods, and an unenrolled student sees none.

### 3. Migration: announcement section scoping

Preferred design: make TA ownership explicit.

- Add nullable `section_id uuid` to `public.offering_staff`.
- Backfill it from `role_assignments.section_id` where the role is `ta` and the offering/section match.
- For teacher/coordinator staff roles, `section_id` stays null and they keep offering-wide access.
- Replace `announcements_staff_read` so:
  - platform admins see all;
  - teachers/coordinators of the offering see all offering announcements;
  - a TA with `offering_staff.section_id` set sees only that section's announcements;
  - a TA with no section assignment sees only announcements they authored (safe fallback, no cross-TA leak);
  - enrolled students still see only their own sections.
- Apply the same scope to `announcements_staff_insert` so a TA cannot post into another TA's section.
- Add a minimal staff UI only if needed to assign a TA to a section. If `role_assignments.section_id` is already populated in the target data, no new UI is required for the immediate fix.

Tests:

- TA A cannot read TA B's section announcement.
- TA A cannot insert into TA B's section.
- A student sees announcements only for enrolled sections.
- Teacher still sees the whole offering.

### 4. Code: marksheet fallback and link safety

Files:

- `src/app/(app)/app/offerings/[offeringId]/marksheet/page.tsx`
- `src/app/(app)/app/marks/page.tsx`
- `src/app/(app)/app/page.tsx`
- `src/app/(app)/app/offerings/[offeringId]/page.tsx`

Changes:

- Replace the marksheet `notFound()` and `forbidden`/`not_found` branches with the shared `UnderConstruction` component (or a small wrapper that keeps a back link to the offering). This guarantees no dead end.
- Keep a generic error state only for unexpected RPC/schema failures.
- Gate marksheet links on actual access, or leave the link and let the fallback render. Prefer gating if an inexpensive enrollment check is available.
- Add the marksheet route to the temporary routes list comment in `src/components/states/under-construction.tsx` if the fallback is page-specific.

### 5. Code: close student data exposure

Files:

- `src/app/(app)/app/offerings/[offeringId]/page.tsx`
- related RLS migrations/policies

Changes:

- For non-staff viewers, filter assessments to `visibility = 'students'`.
- Render `SectionForm`, `AssessmentForm`, `EnrollmentForm`, staff marks links, and any management-only controls only when `viewerIsStaff`.
- Keep student marksheet links and released assessment lists.
- Tighten `assessments_member_read`:
  - staff/manage roles may read all assessments for offerings they manage;
  - students may read only released (`visibility = 'students'`) assessments for offerings/sections they are enrolled in.
- Confirm `marks` RLS still only exposes the student's own released marks.
- Add a student privacy RLS test covering enrollments, profiles, announcements, assessments, marks, and bookings.

### 6. Migration + code: cascade delete RPCs and buttons

#### Delete RPCs

Add security-definer functions in `private`, with public wrappers and grants:

- `private.delete_assessment(p_assessment_id uuid)`
  - permission: platform admin or offering staff + `academic.manage_offering`;
  - delete `mark_history` for marks of the assessment;
  - delete `marks`;
  - delete the assessment.
- `private.delete_evaluation_period(p_period_id uuid)`
  - permission: platform admin or offering staff + `booking.manage_period`;
  - delete swap requests tied to bookings;
  - delete bookings;
  - delete waitlist entries for slots;
  - delete slots;
  - delete the period.
- `private.delete_slot(p_slot_id uuid)`
  - same booking permission;
  - delete swap requests/bookings/waitlist entries for the slot;
  - delete the slot.
- `private.delete_section_cascade(p_section_id uuid)`
  - permission: platform admin or offering staff + `academic.manage_offering`;
  - run the assessment/period cleanup for the section;
  - delete announcements, enrollments, enrollment invites;
  - delete the section;
  - do not delete the offering or course.
- `private.delete_enrollment(p_enrollment_id uuid)`
  - permission: offering staff + `academic.manage_offering`;
  - delete the enrollment only (no marks attached to enrollment rows).
- Announcement delete can stay table-level because the existing `announcements_author_delete` policy is author/admin only; add an RPC only if teachers need to delete other authors' announcements.

Every RPC must:

- set `search_path = ''`;
- resolve `auth.uid()` and the caller's profile;
- verify the row belongs to the caller's university;
- verify the permission and offering staff membership;
- raise stable `42501`/`not_found` errors;
- be granted only to `authenticated` and revoked from `anon`/`PUBLIC`.

#### App actions

- `src/features/academics/actions.ts`
  - `deleteAssessmentAction(formData)`
  - `deleteAnnouncementAction(formData)`
  - `deleteSectionAction(formData)`
  - `deleteEnrollmentAction(formData)`
- `src/features/booking/actions.ts`
  - `deletePeriodAction(formData)`
  - `deleteSlotAction(formData)`

All actions return the existing `ActionResult` shape, revalidate the offering/period pages, and use i18n error keys.

#### UI

- Add `src/components/ui/confirm-delete-button.tsx` (client component) with a confirmation prompt.
- Offering page:
  - delete assessment (next to “Enter marks”);
  - delete announcement (only for the author, unless a teacher-delete RPC is added);
  - remove enrollment (students section);
  - delete section (with a strong warning about cascading periods/assessments/announcements).
- Period page:
  - delete period (staff/manager only);
  - delete individual slot.
- Confirm copy should state exactly what else will be deleted.
- Keep destructive buttons visually secondary/danger and never render them for students.

### 7. Verification checklist

- [ ] Student in section A sees section A bookings; no section B periods.
- [ ] Student with pending membership is activated only through the safe enrollment-based rule.
- [ ] `l242530@lhr.nu.edu.pk` has active membership, `ta` role, no active `student` role, and no test-student enrollment.
- [ ] TA A cannot read or post to TA B's section announcements.
- [ ] Teacher can still see and manage the whole offering.
- [ ] Student sees only released assessments and no staff forms.
- [ ] Marksheet links always render content or the under-construction fallback, never a 404.
- [ ] Deleting an assessment removes its marks and mark history.
- [ ] Deleting a period/slot removes related bookings and waitlist rows.
- [ ] Deleting a section removes its enrollments, announcements, assessments, marks, periods, slots, and bookings.
- [ ] Students cannot execute any delete RPC.
- [ ] Targeted Vitest + RLS tests pass; no full-project build needed.

## Files likely touched

- `supabase/migrations/20261024100000_a_student_visibility_and_safe_deletes.sql` (new)
- `supabase/tests/announcements-analytics.rls.test.sql`
- `supabase/tests/evaluation-booking.rls.test.sql`
- `supabase/tests/core-academics.test.sql`
- `src/app/(app)/app/offerings/[offeringId]/page.tsx`
- `src/app/(app)/app/offerings/[offeringId]/marksheet/page.tsx`
- `src/app/(app)/app/bookings/[periodId]/page.tsx`
- `src/components/states/under-construction.tsx`
- `src/components/ui/confirm-delete-button.tsx` (new)
- `src/features/academics/actions.ts`
- `src/features/booking/actions.ts`
- `messages/en.json`

## Notes

- Code and the migration were implemented on 2026-10-23; the migration still
  needs to be run in Supabase.
- The existing marks release behavior stays unchanged: release is explicit via `assessments.visibility = 'students'`.
- The earlier ad fallback and under-construction routes remain at `7f9da7a`.
- Before running the migration in Supabase, take a database backup or confirm the project has point-in-time recovery.
