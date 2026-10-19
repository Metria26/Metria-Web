-- Seed: foundation-auth (lane: shared)
-- Source guidance: docs/03-database/seed/foundation-auth.sql
-- Card: docs/08-delivery/shared/tasks/T-S001-foundation-gate.md (F1)
-- Rules: idempotent (NOT EXISTS / ON CONFLICT DO NOTHING), tenant-scoped,
--        controlled lookup rows only, never real personal data.
-- NOTE (derived data): docs define the permission catalog (SYMBOL_REGISTRY v1)
-- but no role->permission matrix. The mappings below are derived from product
-- semantics (foundation-auth, marks, evaluation-booking, coursework, reviews)
-- and are data-only; changing them never requires a schema change.
-- NOTE (schema quirk): permissions.key is globally UNIQUE while rows carry
-- university_id; a second tenant seed must re-key or a later migration must
-- switch to UNIQUE (university_id, key). Single-tenant foundation seed is safe.

-- 1) University tenant: FAST-NUCES Lahore
INSERT INTO public.universities (slug, name, timezone, is_enabled)
VALUES ('fast-nuces-lahore', 'FAST-NUCES Lahore', 'Asia/Karachi', true)
ON CONFLICT (slug) DO NOTHING;

-- 2) Allowed email domain
INSERT INTO public.university_domains (university_id, domain, is_verified, is_allowed)
SELECT u.id, 'lhr.nu.edu.pk', true, true
FROM public.universities u
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.university_domains d
    WHERE d.university_id = u.id AND d.domain = 'lhr.nu.edu.pk'
  );

-- 3) Role catalog (university scope)
INSERT INTO public.roles (university_id, name, scope)
SELECT u.id, r.name, 'university'
FROM public.universities u
CROSS JOIN (VALUES ('student'), ('ta'), ('teacher')) AS r(name)
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.roles ro
    WHERE ro.university_id = u.id AND ro.name = r.name
  );

-- 4) Permission catalog (SYMBOL_REGISTRY v1 Permissions section)
INSERT INTO public.permissions (university_id, key, description)
SELECT u.id, p.key, p.description
FROM public.universities u
CROSS JOIN (VALUES
  ('platform.manage_universities', 'Manage university records'),
  ('platform.manage_roles', 'Manage role and permission assignments'),
  ('platform.moderate_content', 'Moderate user-generated content'),
  ('platform.manage_ads', 'Configure ad slots, networks and isolation'),
  ('platform.manage_flags', 'Toggle feature flags'),
  ('platform.view_audit', 'View audit and history trails'),
  ('platform.manage_revenue', 'Manage revenue configuration'),
  ('academic.manage_offering', 'Manage courses, sections and enrollment'),
  ('academic.view_offering_analytics', 'View offering analytics'),
  ('marks.manage', 'Enter and edit marks for assigned offerings'),
  ('marks.view_own', 'View own marks'),
  ('booking.manage_period', 'Manage evaluation booking periods and capacity'),
  ('booking.manage_own', 'Book, swap and cancel own evaluation slots'),
  ('objection.manage_assigned', 'Resolve objections assigned to self'),
  ('coursework.manage', 'Create coursework and review submissions'),
  ('coursework.submit_own', 'Submit own coursework'),
  ('messaging.participate', 'Send and receive messages'),
  ('review.moderate', 'Moderate TA/teacher reviews in university'),
  ('review.submit', 'Submit reviews'),
  ('calendar.manage_own', 'Manage own calendar and reminders')
) AS p(key, description)
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.permissions pe
    WHERE pe.key = p.key
  );

-- 5) Role -> permission mappings (derived; see header note)
INSERT INTO public.role_permissions (university_id, role_id, permission_id)
SELECT u.id, r.id, p.id
FROM public.universities u
JOIN public.roles r
  ON r.university_id = u.id
JOIN public.permissions p
  ON p.university_id = u.id
JOIN (VALUES
  -- student: consume own data, participate, act on own commitments
  ('student', 'marks.view_own'),
  ('student', 'booking.manage_own'),
  ('student', 'coursework.submit_own'),
  ('student', 'messaging.participate'),
  ('student', 'review.submit'),
  ('student', 'calendar.manage_own'),
  -- ta: offering staff with narrower ledger authority than teacher
  ('ta', 'academic.manage_offering'),
  ('ta', 'academic.view_offering_analytics'),
  ('ta', 'marks.manage'),
  ('ta', 'booking.manage_period'),
  ('ta', 'objection.manage_assigned'),
  ('ta', 'coursework.manage'),
  ('ta', 'messaging.participate'),
  ('ta', 'calendar.manage_own'),
  -- teacher: offering staff plus review moderation for the university
  ('teacher', 'academic.manage_offering'),
  ('teacher', 'academic.view_offering_analytics'),
  ('teacher', 'marks.manage'),
  ('teacher', 'booking.manage_period'),
  ('teacher', 'objection.manage_assigned'),
  ('teacher', 'coursework.manage'),
  ('teacher', 'messaging.participate'),
  ('teacher', 'review.moderate'),
  ('teacher', 'calendar.manage_own')
  -- platform.* permissions intentionally unmapped: platform scope is granted
  -- only via public.platform_admins (private.is_platform_admin()), never roles.
) AS m(role_name, perm_key)
  ON m.role_name = r.name AND m.perm_key = p.key
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.university_id = u.id AND rp.role_id = r.id AND rp.permission_id = p.id
  );

-- 6) Feature flags: all registry keys seeded OFF except the ads activation set
--    (owner decision 2026-10-19: ads MUST be live in production). The master
--    kill switch stays OFF and remains the emergency control. This mirrors the
--    live production config so `db reset`/fresh deploys never silently go dark.
INSERT INTO public.feature_flags (university_id, key, enabled, config)
SELECT u.id, f.key, f.enabled, '{}'::jsonb
FROM public.universities u
CROSS JOIN (VALUES
  ('booking.social.enabled', false),
  ('booking.waitlist.enabled', false),
  ('messaging.enabled', false),
  ('coursework.enabled', false),
  ('calendar.enabled', false),
  ('calendar.free_busy.enabled', false),
  ('ta.reviews.enabled', false),
  ('ta.public_profile.enabled', false),
  ('ta.eligibility.enabled', false),
  ('teacher.reviews.enabled', false),
  ('ads.enabled', true),
  ('ads.public.enabled', true),
  ('ads.private.enabled', true),
  ('ads.global_kill', false),
  ('analytics.visits.enabled', false),
  ('revenue.share.enabled', false),
  ('payouts.enabled', false),
  ('ta.tools.enabled', false),
  ('sharing.enabled', false),
  ('chatbot.faq.enabled', false),
  ('chatbot.ai.enabled', false),
  ('notifications.push.enabled', false)
) AS f(key, enabled)
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.feature_flags ff
    WHERE ff.university_id = u.id AND ff.key = f.key
  );

-- 8) Bootstrap platform-admin email (plan.md F3, D20; founder decision 2026-10-14:
--    this ONE account is exempt from the university-domain allowlist — any domain).
--    created_at on this row is the bootstrap audit timestamp. On production, run
--    this statement ONCE with the operator-recorded BOOTSTRAP_ADMIN_EMAIL value;
--    keep it identical to the app env var of the same name.
INSERT INTO public.platform_settings (university_id, key, value)
SELECT u.id, 'bootstrap_admin_email', '"metria.admin26@gmail.com"'::jsonb
FROM public.universities u
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.platform_settings s
    WHERE s.key = 'bootstrap_admin_email'
  );

-- ============================================================================
-- 9) Core-academics dev fixtures (T-A003; guidance: docs/03-database/seed/core-academics.sql)
--    Idempotent, tenant-scoped, synthetic people only (auth_user_id values are
--    fixture-local UUIDs -- no auth.users rows; e2e creates real auth users via
--    the admin API instead). No real personal data (L: never seed PII).
-- ============================================================================

-- Department
INSERT INTO public.departments (university_id, name, slug)
SELECT u.id, 'Computer Science', 'cs'
FROM public.universities u
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.university_id = u.id AND d.slug = 'cs');

-- Term
INSERT INTO public.terms (university_id, name, starts_on, ends_on, publication_state)
SELECT u.id, 'Fall 2026', DATE '2026-08-01', DATE '2026-12-31', 'published'
FROM public.universities u
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.terms t WHERE t.university_id = u.id AND t.name = 'Fall 2026');

-- Course
INSERT INTO public.courses (university_id, department_id, code, title, description, publication_state)
SELECT u.id, d.id, 'CS301', 'Software Engineering I',
       'Introductory software engineering course (dev fixture).', 'published'
FROM public.universities u
JOIN public.departments d ON d.university_id = u.id AND d.slug = 'cs'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.university_id = u.id AND c.code = 'CS301');

-- Offering
INSERT INTO public.course_offerings (university_id, course_id, term_id, offering_code)
SELECT u.id, c.id, t.id, 'CS301-F26'
FROM public.universities u
JOIN public.courses c ON c.university_id = u.id AND c.code = 'CS301'
JOIN public.terms t ON t.university_id = u.id AND t.name = 'Fall 2026'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.course_offerings o WHERE o.university_id = u.id AND o.offering_code = 'CS301-F26');

-- Sections A + B
INSERT INTO public.sections (university_id, offering_id, section_code, capacity)
SELECT u.id, o.id, s.code, s.capacity
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'CS301-F26'
CROSS JOIN (VALUES ('A', 40), ('B', 40)) AS s(code, capacity)
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.sections se WHERE se.university_id = u.id AND se.offering_id = o.id AND se.section_code = s.code);

-- Grading scale (FAST-style percentage bands)
INSERT INTO public.grading_scales (university_id, name, scale_type, definition)
SELECT u.id, 'FAST Percentage', 'percentage',
       '{"bands":[{"min":85,"grade":"A"},{"min":80,"grade":"A-"},{"min":75,"grade":"B+"},{"min":70,"grade":"B"},{"min":65,"grade":"C+"},{"min":60,"grade":"C"},{"min":50,"grade":"D"},{"min":0,"grade":"F"}]}'::jsonb
FROM public.universities u
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.grading_scales g WHERE g.university_id = u.id AND g.name = 'FAST Percentage');

-- Assessments
INSERT INTO public.assessments (university_id, offering_id, title, assessment_type, total, weight, visibility)
SELECT u.id, o.id, a.title, a.assessment_type, a.total, a.weight, 'private'
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'CS301-F26'
CROSS JOIN (VALUES ('Quiz 1', 'quiz', 10::numeric, 10::numeric), ('Midterm', 'exam', 30::numeric, 25::numeric)) AS a(title, assessment_type, total, weight)
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.assessments ass WHERE ass.university_id = u.id AND ass.offering_id = o.id AND ass.title = a.title);

-- Synthetic TA (active membership + ta role + offering staff)
INSERT INTO public.profiles (university_id, auth_user_id, display_name, email, roll_no)
SELECT u.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', 'Dev TA', 'ta.dev@lhr.nu.edu.pk', 'TA-0001'
FROM public.universities u
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.email = 'ta.dev@lhr.nu.edu.pk');

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'ta.dev@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.university_memberships m WHERE m.university_id = u.id AND m.profile_id = p.id);

INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'ta.dev@lhr.nu.edu.pk'
JOIN public.roles r ON r.university_id = u.id AND r.name = 'ta'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_assignments ra
    WHERE ra.university_id = u.id AND ra.profile_id = p.id AND ra.role_id = r.id AND ra.revoked_at IS NULL
  );

INSERT INTO public.offering_staff (university_id, offering_id, profile_id, staff_role, created_by)
SELECT u.id, o.id, p.id, 'ta', p.id
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'CS301-F26'
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'ta.dev@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.offering_staff os
    WHERE os.university_id = u.id AND os.offering_id = o.id AND os.profile_id = p.id
  );

-- Synthetic student (active membership + student role + enrolled in section A)
INSERT INTO public.profiles (university_id, auth_user_id, display_name, email, roll_no)
SELECT u.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', 'Dev Student', 'student.dev@lhr.nu.edu.pk', 'lhr-2026-0002'
FROM public.universities u
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.email = 'student.dev@lhr.nu.edu.pk');

INSERT INTO public.university_memberships (university_id, profile_id, status)
SELECT u.id, p.id, 'active'
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'student.dev@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (SELECT 1 FROM public.university_memberships m WHERE m.university_id = u.id AND m.profile_id = p.id);

INSERT INTO public.role_assignments (university_id, profile_id, role_id, assigned_by)
SELECT u.id, p.id, r.id, p.id
FROM public.universities u
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'student.dev@lhr.nu.edu.pk'
JOIN public.roles r ON r.university_id = u.id AND r.name = 'student'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_assignments ra
    WHERE ra.university_id = u.id AND ra.profile_id = p.id AND ra.role_id = r.id AND ra.revoked_at IS NULL
  );

INSERT INTO public.enrollments (university_id, section_id, profile_id, status, created_by)
SELECT u.id, s.id, p.id, 'active', p.id
FROM public.universities u
JOIN public.sections s
  ON s.university_id = u.id
 AND s.section_code = 'A'
 AND s.offering_id = (SELECT o.id FROM public.course_offerings o WHERE o.university_id = u.id AND o.offering_code = 'CS301-F26')
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'student.dev@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.university_id = u.id AND e.section_id = s.id AND e.profile_id = p.id
  );

-- Section 10: evaluation booking fixtures (T-A006) — one future-dated period
-- with two slots on CS301-F26 section A (student.dev is enrolled there).
-- Idempotent: guarded by period title and slot location.

INSERT INTO public.evaluation_periods (university_id, offering_id, section_id, title, starts_at, ends_at, cutoff_hours, created_by)
SELECT u.id, o.id, s.id, 'Midterm evaluation (dev fixture)',
       date_trunc('day', now()) + interval '7 days 8 hours',
       date_trunc('day', now()) + interval '7 days 18 hours',
       6, p.id
FROM public.universities u
JOIN public.course_offerings o ON o.university_id = u.id AND o.offering_code = 'CS301-F26'
JOIN public.sections s ON s.university_id = u.id AND s.offering_id = o.id AND s.section_code = 'A'
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'ta.dev@lhr.nu.edu.pk'
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.evaluation_periods ep
    WHERE ep.university_id = u.id AND ep.title = 'Midterm evaluation (dev fixture)'
  );

INSERT INTO public.slots (university_id, period_id, starts_at, ends_at, capacity, location, created_by)
SELECT u.id, ep.id, v.starts_at, v.ends_at, v.capacity, v.location, p.id
FROM public.universities u
JOIN public.evaluation_periods ep
  ON ep.university_id = u.id AND ep.title = 'Midterm evaluation (dev fixture)'
JOIN public.profiles p ON p.university_id = u.id AND p.email = 'ta.dev@lhr.nu.edu.pk'
CROSS JOIN (VALUES
  (date_trunc('day', now()) + interval '7 days 9 hours', date_trunc('day', now()) + interval '7 days 9 hours 15 minutes', 3, 'CS Lab 1'),
  (date_trunc('day', now()) + interval '7 days 9 hours 30 minutes', date_trunc('day', now()) + interval '7 days 9 hours 45 minutes', 3, 'CS Lab 2')
) AS v(starts_at, ends_at, capacity, location)
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.slots sl
    WHERE sl.university_id = u.id AND sl.period_id = ep.id AND sl.location = v.location
  );


-- Section 11: ads registries (T-B002 + T-B003) — page types, formats and one
-- network for the dev tenant, plus three dev placements. Ads are LIVE per the
-- 2026-10-19 owner decision: ads.enabled/public/private=true and
-- ads.global_kill=false (Section 6), and the adsterra network is enabled.
-- Idempotent: registry rows are guarded by the global key uniqueness, placements by slot_key + page
-- type. `booking` page type + `booking-top` placement added by T-B003 so the
-- booking period page can reserve ad geometry next to Book/Cancel (R1).

INSERT INTO public.page_types (university_id, key, is_auth, enabled)
SELECT u.id, v.key, v.is_auth, v.enabled
FROM public.universities u
CROSS JOIN (VALUES
  ('public_home', false, true),
  ('login', true, false),
  ('dashboard', false, true),
  ('offering', false, true),
  ('booking', false, true),
  ('marks', false, true)
) AS v(key, is_auth, enabled)
WHERE u.slug = 'fast-nuces-lahore'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ad_formats (university_id, key, is_pop_style, needs_consent, injection_mode)
SELECT u.id, v.key, v.is_pop_style, v.needs_consent, v.injection_mode
FROM public.universities u
CROSS JOIN (VALUES
  ('banner', false, true, 'script_async'),
  ('native', false, true, 'script_async'),
  ('social_bar', false, true, 'script_async'),
  ('in_page_push', false, true, 'script_async'),
  ('pop_under', true, true, 'script_pop'),
  ('smartlink', true, true, 'link'),
  ('direct_sponsor', false, false, 'first_party')
) AS v(key, is_pop_style, needs_consent, injection_mode)
WHERE u.slug = 'fast-nuces-lahore'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ad_networks (university_id, key, name, enabled)
SELECT u.id, 'adsterra', 'Adsterra', true
FROM public.universities u
WHERE u.slug = 'fast-nuces-lahore'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ad_placements (university_id, page_type_id, network_id, format_id, slot_key, enabled, priority, isolation_mode)
SELECT u.id, pt.id, n.id, f.id, v.slot_key, true, v.priority, v.isolation_mode
FROM public.universities u
CROSS JOIN (VALUES
  ('dashboard', 'banner', 'dashboard-top', 10, 'no_script_ads'),
  ('offering', 'native', 'offering-inline', 5, 'iframe_only'),
  ('booking', 'banner', 'booking-top', 5, 'no_script_ads')
) AS v(page_type, format, slot_key, priority, isolation_mode)
JOIN public.page_types pt ON pt.university_id = u.id AND pt.key = v.page_type
JOIN public.ad_networks n ON n.university_id = u.id AND n.key = 'adsterra'
JOIN public.ad_formats f ON f.university_id = u.id AND f.key = v.format
WHERE u.slug = 'fast-nuces-lahore'
  AND NOT EXISTS (
    SELECT 1 FROM public.ad_placements p
    WHERE p.university_id = u.id AND p.page_type_id = pt.id AND p.slot_key = v.slot_key
  );
