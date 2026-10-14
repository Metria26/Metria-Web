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

-- 6) Feature flags: all registry keys seeded OFF except ads.global_kill
--    (kill switch engaged = ads fully dead at foundation time; plan.md §3 F1).
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
  ('ads.enabled', false),
  ('ads.public.enabled', false),
  ('ads.private.enabled', false),
  ('ads.global_kill', true),
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
