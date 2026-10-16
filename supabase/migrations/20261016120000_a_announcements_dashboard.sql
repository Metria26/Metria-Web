-- ============================================================================
-- T-A005: announcements member/staff RLS + student dashboard + TA analytics
-- Lane: a  Module: announcements_dashboard
--
-- Depends on: 20261014140937_s_foundation_auth, 20261014213000_s_auth_domain_allowlist,
--             20261015141145_a_core_academics (tables + helpers), 20261015190000_a_marks_import.
--
-- Adds:
--   1. Narrow announcements RLS (T-A003 left it platform-admin-only; this card
--      opens staff write + enrolled-student read, per core-academics.md).
--   2. private.student_dashboard() — one bounded RPC for /app (marks +
--      announcements + upcoming assessments; evaluation_slots stays [] until
--      T-A006 ships the booking tables, expand-only later).
--   3. private.offering_analytics(uuid) — TA analytics with k>=5 suppression
--      on every aggregate (D10/P14). Requires staff membership or
--      academic.view_offering_analytics.
--
-- Deviation note (D-A5-a): the docs functions file ships no dashboard RPC
-- payload contract; the JSON shape below is the registered app contract and
-- mirrors docs/05-frontend/page-specs/academics-and-dashboard.md ("one
-- bounded RPC"). Shapes are additive-only from here (expand/contract, P7).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: announcements RLS — staff write, enrolled read
-- ----------------------------------------------------------------------------
-- Baseline policy from the doc file is platform-admin-only; keep that as the
-- admin path and add narrow member policies (same D-d pattern as T-A003).

DROP POLICY IF EXISTS announcements_tenant_access ON public.announcements;
DROP POLICY IF EXISTS announcements_platform_admin ON public.announcements;
CREATE POLICY announcements_platform_admin ON public.announcements FOR ALL TO authenticated
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());

-- Staff of the section's offering may read every announcement of the offering;
-- enrolled students read announcements of their own sections only.
DROP POLICY IF EXISTS announcements_staff_read ON public.announcements;
CREATE POLICY announcements_staff_read ON public.announcements FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sections s
      JOIN public.offering_staff os
        ON os.university_id = s.university_id AND os.offering_id = s.offering_id
       AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      WHERE s.university_id = announcements.university_id AND s.id = announcements.section_id
    )
    OR private.is_enrolled(announcements.section_id)
  );

-- Staff insert: caller must staff the section's offering, hold
-- academic.manage_offering in the tenant, and author the row as themselves.
DROP POLICY IF EXISTS announcements_staff_insert ON public.announcements;
CREATE POLICY announcements_staff_insert ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (
    private.is_platform_admin()
    OR (
      author_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
      AND private.has_permission(university_id, 'academic.manage_offering')
      AND EXISTS (
        SELECT 1 FROM public.sections s
        JOIN public.offering_staff os
          ON os.university_id = s.university_id AND os.offering_id = s.offering_id
         AND os.profile_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
        WHERE s.university_id = announcements.university_id AND s.id = announcements.section_id
      )
    )
  );

-- Authors (or platform admins) may correct/delete their own announcements.
DROP POLICY IF EXISTS announcements_author_update ON public.announcements;
CREATE POLICY announcements_author_update ON public.announcements FOR UPDATE TO authenticated
  USING (
    private.is_platform_admin()
    OR author_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    private.is_platform_admin()
    OR author_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS announcements_author_delete ON public.announcements;
CREATE POLICY announcements_author_delete ON public.announcements FOR DELETE TO authenticated
  USING (
    private.is_platform_admin()
    OR author_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- SECTION 2: student dashboard RPC (one bounded call, D2)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.student_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_uni uuid;
  v_result jsonb;
BEGIN
  SELECT p.id, p.university_id INTO v_profile_id, v_uni
  FROM public.profiles p
  WHERE p.auth_user_id = (SELECT auth.uid());

  IF v_profile_id IS NULL OR v_uni IS NULL THEN
    RAISE EXCEPTION 'profile not provisioned' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'latest_marks', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'recorded_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'assessment_title', a.title,
          'assessment_type', a.assessment_type,
          'course_code', c.code,
          'course_title', c.title,
          'offering_id', o.id,
          'score', m.score,
          'total', a.total,
          'recorded_at', m.updated_at
        ) AS row_json
        FROM public.marks m
        JOIN public.assessments a
          ON a.university_id = m.university_id AND a.id = m.assessment_id
        JOIN public.course_offerings o
          ON o.university_id = a.university_id AND o.id = a.offering_id
        JOIN public.courses c
          ON c.university_id = o.university_id AND c.id = o.course_id
        WHERE m.university_id = v_uni
          AND m.student_id = v_profile_id
          AND a.visibility = 'students'
          AND m.score IS NOT NULL
        ORDER BY m.updated_at DESC
        LIMIT 5
      ) marks_rows
    ), '[]'::jsonb),
    'announcements', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'created_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', an.id,
          'title', an.title,
          'body_html', an.body_html,
          'section_code', s.section_code,
          'course_code', c.code,
          'offering_id', s.offering_id,
          'created_at', an.created_at
        ) AS row_json
        FROM public.announcements an
        JOIN public.sections s
          ON s.university_id = an.university_id AND s.id = an.section_id
        JOIN public.course_offerings o
          ON o.university_id = s.university_id AND o.id = s.offering_id
        JOIN public.courses c
          ON c.university_id = o.university_id AND c.id = o.course_id
        WHERE an.university_id = v_uni
          AND EXISTS (
            SELECT 1 FROM public.enrollments e
            WHERE e.university_id = v_uni
              AND e.section_id = an.section_id
              AND e.profile_id = v_profile_id
              AND e.status = 'active'
          )
        ORDER BY an.created_at DESC
        LIMIT 5
      ) announcement_rows
    ), '[]'::jsonb),
    'upcoming_assessments', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'created_at' ASC)
      FROM (
        SELECT jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'assessment_type', a.assessment_type,
          'total', a.total,
          'weight', a.weight,
          'course_code', c.code,
          'offering_id', o.id,
          'created_at', a.created_at
        ) AS row_json
        FROM public.assessments a
        JOIN public.course_offerings o
          ON o.university_id = a.university_id AND o.id = a.offering_id
        JOIN public.courses c
          ON c.university_id = o.university_id AND c.id = o.course_id
        WHERE a.university_id = v_uni
          AND a.visibility = 'students'
          AND a.id NOT IN (
            SELECT m.assessment_id FROM public.marks m
            WHERE m.university_id = v_uni AND m.student_id = v_profile_id
          )
          AND EXISTS (
            SELECT 1 FROM public.enrollments e
            JOIN public.sections s
              ON s.university_id = e.university_id AND s.id = e.section_id
            WHERE e.university_id = v_uni
              AND e.profile_id = v_profile_id
              AND e.status = 'active'
              AND s.offering_id = o.id
          )
        ORDER BY a.created_at ASC
        LIMIT 5
      ) assessment_rows
    ), '[]'::jsonb),
    -- T-A006 extends with live booking/evaluation slots (expand-only).
    'evaluation_slots', '[]'::jsonb
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION private.student_dashboard() TO authenticated;

-- Thin public wrapper (D-k transport pattern; PostgREST routes public.* only).
CREATE OR REPLACE FUNCTION public.student_dashboard()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT private.student_dashboard() $$;

GRANT EXECUTE ON FUNCTION public.student_dashboard() TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 3: TA offering analytics RPC (k >= 5 suppression, D10/P14)
-- ----------------------------------------------------------------------------
-- Returns per-assessment distribution and per-section aggregates for ONE
-- offering. Every numeric aggregate is suppressed (values nulled, suppressed
-- flag true) when the cohort below it is smaller than 5 — never ship a class
-- average that identifies individuals.

CREATE OR REPLACE FUNCTION private.offering_analytics(p_offering_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uni uuid;
  v_k constant integer := 5;
BEGIN
  SELECT o.university_id INTO v_uni
  FROM public.course_offerings o
  WHERE o.id = p_offering_id;

  IF v_uni IS NULL OR v_uni NOT IN (SELECT private.current_university_ids()) THEN
    RAISE EXCEPTION 'offering not visible' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    private.is_offering_staff(p_offering_id)
    OR private.has_permission(v_uni, 'academic.view_offering_analytics')
  ) THEN
    RAISE EXCEPTION 'analytics permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'offering_id', p_offering_id,
    'k', v_k,
    'assessments', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'created_at' ASC)
      FROM (
        SELECT jsonb_build_object(
          'assessment_id', a.id,
          'title', a.title,
          'assessment_type', a.assessment_type,
          'total', a.total,
          'n', agg.n,
          'suppressed', agg.n < v_k,
          'avg_percent', CASE WHEN agg.n >= v_k THEN agg.avg_percent END,
          'min_percent', CASE WHEN agg.n >= v_k THEN agg.min_percent END,
          'max_percent', CASE WHEN agg.n >= v_k THEN agg.max_percent END,
          'bucket_0_49', CASE WHEN agg.n >= v_k THEN agg.bucket_0_49 END,
          'bucket_50_74', CASE WHEN agg.n >= v_k THEN agg.bucket_50_74 END,
          'bucket_75_100', CASE WHEN agg.n >= v_k THEN agg.bucket_75_100 END,
          'created_at', a.created_at
        ) AS row_json
        FROM public.assessments a
        CROSS JOIN LATERAL (
          SELECT
            count(*)::int AS n,
            round(avg(m.score / a.total * 100), 1) AS avg_percent,
            round(min(m.score / a.total * 100), 1) AS min_percent,
            round(max(m.score / a.total * 100), 1) AS max_percent,
            count(*) FILTER (WHERE m.score / a.total * 100 < 50)::int AS bucket_0_49,
            count(*) FILTER (WHERE m.score / a.total * 100 >= 50 AND m.score / a.total * 100 < 75)::int AS bucket_50_74,
            count(*) FILTER (WHERE m.score / a.total * 100 >= 75)::int AS bucket_75_100
          FROM public.marks m
          WHERE m.university_id = a.university_id
            AND m.assessment_id = a.id
            AND m.score IS NOT NULL
        ) agg
        WHERE a.university_id = v_uni
          AND a.offering_id = p_offering_id
      ) assessment_rows
    ), '[]'::jsonb),
    'sections', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY row_json->>'section_code' ASC)
      FROM (
        SELECT jsonb_build_object(
          'section_id', s.id,
          'section_code', s.section_code,
          'n', agg.n,
          'suppressed', agg.n < v_k,
          'avg_percent', CASE WHEN agg.n >= v_k THEN agg.avg_percent END
        ) AS row_json
        FROM public.sections s
        CROSS JOIN LATERAL (
          SELECT
            count(*)::int AS n,
            round(avg(stud.avg_percent), 1) AS avg_percent
          FROM (
            SELECT
              round(avg(m.score / a.total * 100), 1) AS avg_percent
            FROM public.enrollments e
            JOIN public.marks m
              ON m.university_id = e.university_id
             AND m.student_id = e.profile_id
            JOIN public.assessments a
              ON a.university_id = m.university_id
             AND a.id = m.assessment_id
             AND a.offering_id = s.offering_id
            WHERE e.university_id = s.university_id
              AND e.section_id = s.id
              AND e.status = 'active'
              AND m.score IS NOT NULL
            GROUP BY e.profile_id
          ) stud
        ) agg
        WHERE s.university_id = v_uni
          AND s.offering_id = p_offering_id
      ) section_rows
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION private.offering_analytics(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.offering_analytics(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT private.offering_analytics(p_offering_id) $$;

GRANT EXECUTE ON FUNCTION public.offering_analytics(uuid) TO authenticated;

-- ============================================================================
-- Rollback note (expand/contract, P7):
--   DROP POLICY IF EXISTS announcements_staff_read/announcements_staff_insert/
--   announcements_author_update/announcements_author_delete ON public.announcements;
--   CREATE POLICY announcements_tenant_access ON public.announcements FOR ALL
--     TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
--   DROP FUNCTION IF EXISTS public.student_dashboard(); DROP FUNCTION IF EXISTS private.student_dashboard();
--   DROP FUNCTION IF EXISTS public.offering_analytics(uuid); DROP FUNCTION IF EXISTS private.offering_analytics(uuid);
--   No table/column is added, dropped or renamed by this migration — revert is
--   exactly the statements above and needs no data backfill.
-- ============================================================================
