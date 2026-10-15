-- Migration: marks_import (lane: a)
-- Card: docs/08-delivery/lane-a/tasks/t-a004-marks-and-csv-importer.md (T-A004)
-- Source (order preserved):
--   docs/03-database/schema/core-academics.sql   (marks/mark_history/import_* landed in T-A003)
--   docs/03-database/rls/core-academics.sql      (baseline platform-admin policies landed in T-A003;
--                                                 this migration adds the narrow staff/student policies
--                                                 the doc file calls for once role fixtures exist)
--   docs/03-database/functions/core-academics.sql (comments-only in docs; registered RPC signatures)
--   docs/03-database/functions/marks-objections.sql (change_mark_from_objection is T-A008, not here)
-- Registry: docs/SYMBOL_REGISTRY.md v1
--   (+ REGISTRY DELTA: private.offering_marksheet; confirm_mark_import implemented at its
--      registered signature private.confirm_mark_import(p_batch_id uuid))
--
-- Documented deviations from doc SQL:
--   D-g. Doc schema omitted CHECK/UNIQUE the registry declares for import data: added
--        import_rows.status CHECK (ready/not_found/duplicate/invalid/applied/skipped per
--        SYMBOL_REGISTRY "Text plus CHECK") and UNIQUE (batch_id, row_hash) (P9 idempotency
--        at row granularity). batch.state stays free text (not registry-constrained): the
--        app/RPC use exactly 'preview' | 'applied'; 'expired' is never persisted (expiry
--        raises before the state write would commit).
--   D-h. profiles gained a narrow self-read policy (profiles_self_read). Doc RLS ships only
--        the platform-admin baseline + T-A003's manage-permission read, so a student could
--        not resolve their own profile row -- any student-facing marks policy that maps
--        auth.uid() -> profiles.id would silently see zero rows. Narrow: own row only.
--   D-i. import_batches.overwrite_existing boolean NOT NULL DEFAULT false added (expand):
--        R10 conflict mode (skip vs overwrite-with-confirmation) has no column in the doc
--        schema; preview stores the confirmed choice, confirm honours it per batch.
--   D-j. marks writes are RLS-direct (staff policies) + history via AFTER trigger, not a
--        write-RPC: the plan's "RPC writes history+audit atomically" is satisfied for the
--        CSV path (confirm_mark_import runs marks+history in one transaction) and for
--        manual entry (trigger fires in the same transaction as the mark write).
--   D-k. HTTP reachability: supabase/config.toml [api].schemas = ["public","graphql_public"]
--        only -- PostgREST never routes /rpc/* to `private`, so the registered
--        private.* signatures are unreachable from the app as-is. Thin public wrapper
--        functions (same arg names, SECURITY INVOKER, EXECUTE to authenticated only)
--        forward to the private implementations. Registry signatures stay canonical;
--        wrappers are the API surface (mirrored in docs/SYMBOL_REGISTRY.md).
--
-- Deferred (documented, not invented here):
--   - audit_log does not exist yet: it belongs to Lane B's admin module (T-B008,
--     docs/03-database/schema/admin.sql). 'mark.changed' audit rows are therefore deferred
--     to the card that lands audit_log; mark_history (P6) is written on every mutation now.
--     The objection RPC (T-A008) must insert audit_log atomically when the table exists.
--   - mark_history writes by private.change_mark_from_objection (T-A008): the docs function
--     inserts mark_history manually AND UPDATEs marks, which would double-log through this
--     migration's trigger. When implementing T-A008 either keep its manual insert and
--     PERFORM set_config('app.mark_history_suppress','1',true) before the UPDATE, or drop
--     its manual insert and let the trigger record it (single-writer rule).
--   - Privacy note (D10/P14): offering_marksheet gates class stats AND own rank behind
--     cohort >= 5; rank is only ever returned for the caller (no identities are exposed).
--     GUC 'app.mark_source' (csv|manual|objection) selects mark_history.source; it is
--     session-settable by any authenticated writer, so it can mislabel but never forge
--     actor/old/new values (those come from auth.uid() and the row pair).
--
-- Rollback / expand-contract note (P7):
--   Consumers first: stop /app/marks and the import panel, then a contract migration may
--   DROP the narrow policies (marks_staff_*, marks_student_read, mark_history_staff_read,
--   import_*_staff_*, profiles_self_read), the trigger, both RPCs (REVOKE first), the
--   import_rows constraints and import_batches.overwrite_existing. Never drop or delete
--   mark_history or applied import_batches/rows (append-only / financial-grade audit).

-- ============================================================================
-- SECTION 1: SCHEMA EXTENSIONS (expand)
-- ============================================================================

ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS overwrite_existing boolean NOT NULL DEFAULT false;
ALTER TABLE public.import_rows ADD CONSTRAINT import_rows_batch_row_hash_key UNIQUE (batch_id, row_hash);
ALTER TABLE public.import_rows ADD CONSTRAINT import_rows_status_check CHECK (status IN ('ready','not_found','duplicate','invalid','applied','skipped'));

-- ============================================================================
-- SECTION 2: NARROW POLICIES (D-h + staff/student access for marks module)
-- Baseline platform-admin *_tenant_access policies from T-A003 stay in place;
-- policies are permissive, so admin access unions with the rows below.
-- ============================================================================

-- D-h: a member reads exactly their own profile row (students resolve auth.uid() -> profiles.id).
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()));

-- marks: offering staff (of the mark's assessment) may read/write; no DELETE policy for
-- authenticated (only the platform-admin baseline can delete, and only with BOTH the
-- policy and table privilege).
DROP POLICY IF EXISTS marks_staff_read ON public.marks;
CREATE POLICY marks_staff_read ON public.marks FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.assessments a WHERE a.university_id = marks.university_id AND a.id = marks.assessment_id)));
DROP POLICY IF EXISTS marks_staff_insert ON public.marks;
CREATE POLICY marks_staff_insert ON public.marks FOR INSERT TO authenticated WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.assessments a WHERE a.university_id = marks.university_id AND a.id = marks.assessment_id)));
DROP POLICY IF EXISTS marks_staff_update ON public.marks;
CREATE POLICY marks_staff_update ON public.marks FOR UPDATE TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.assessments a WHERE a.university_id = marks.university_id AND a.id = marks.assessment_id))) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.assessments a WHERE a.university_id = marks.university_id AND a.id = marks.assessment_id)));

-- marks: a student reads own marks only, and only for assessments released to
-- students (visibility='students') in a section they are actively enrolled in.
-- Enrollment is checked through private.is_enrolled (SECURITY DEFINER): a raw
-- enrollments/sections EXISTS here would re-apply those tables' RLS as the
-- querying student (enrollments is manage-readable only) and silently hide
-- the student's own marks (nested-RLS trap, caught by marks.rls.test.sql).
DROP POLICY IF EXISTS marks_student_read ON public.marks;
CREATE POLICY marks_student_read ON public.marks FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND student_id IN (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid())) AND EXISTS (SELECT 1 FROM public.assessments a WHERE a.university_id = marks.university_id AND a.id = marks.assessment_id AND a.visibility = 'students' AND EXISTS (SELECT 1 FROM public.sections s WHERE s.university_id = marks.university_id AND s.offering_id = a.offering_id AND private.is_enrolled(s.id))));

-- mark_history: append-only (UPDATE/DELETE privileges were revoked in T-A003); offering
-- staff may read the history of their offering's marks. Writes happen only through the
-- private.record_mark_history trigger (SECURITY DEFINER) -- no INSERT policy for clients.
DROP POLICY IF EXISTS mark_history_staff_read ON public.mark_history;
CREATE POLICY mark_history_staff_read ON public.mark_history FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.marks m JOIN public.assessments a ON a.university_id = m.university_id AND a.id = m.assessment_id WHERE m.university_id = mark_history.university_id AND m.id = mark_history.mark_id)));

-- import_batches / import_rows: staff of the batch's assessment offering read, create
-- previews and advance rows; no DELETE policy for authenticated.
DROP POLICY IF EXISTS import_batches_staff_read ON public.import_batches;
CREATE POLICY import_batches_staff_read ON public.import_batches FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.assessments a WHERE a.university_id = import_batches.university_id AND a.id = import_batches.assessment_id)));
DROP POLICY IF EXISTS import_batches_staff_insert ON public.import_batches;
CREATE POLICY import_batches_staff_insert ON public.import_batches FOR INSERT TO authenticated WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.assessments a WHERE a.university_id = import_batches.university_id AND a.id = import_batches.assessment_id)));
DROP POLICY IF EXISTS import_batches_staff_update ON public.import_batches;
CREATE POLICY import_batches_staff_update ON public.import_batches FOR UPDATE TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.assessments a WHERE a.university_id = import_batches.university_id AND a.id = import_batches.assessment_id))) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.assessments a WHERE a.university_id = import_batches.university_id AND a.id = import_batches.assessment_id)));

DROP POLICY IF EXISTS import_rows_staff_read ON public.import_rows;
CREATE POLICY import_rows_staff_read ON public.import_rows FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.import_batches b JOIN public.assessments a ON a.university_id = b.university_id AND a.id = b.assessment_id WHERE b.university_id = import_rows.university_id AND b.id = import_rows.batch_id)));
DROP POLICY IF EXISTS import_rows_staff_insert ON public.import_rows;
CREATE POLICY import_rows_staff_insert ON public.import_rows FOR INSERT TO authenticated WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.import_batches b JOIN public.assessments a ON a.university_id = b.university_id AND a.id = b.assessment_id WHERE b.university_id = import_rows.university_id AND b.id = import_rows.batch_id)));
DROP POLICY IF EXISTS import_rows_staff_update ON public.import_rows;
CREATE POLICY import_rows_staff_update ON public.import_rows FOR UPDATE TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.import_batches b JOIN public.assessments a ON a.university_id = b.university_id AND a.id = b.assessment_id WHERE b.university_id = import_rows.university_id AND b.id = import_rows.batch_id))) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.is_offering_staff((SELECT a.offering_id FROM public.import_batches b JOIN public.assessments a ON a.university_id = b.university_id AND a.id = b.assessment_id WHERE b.university_id = import_rows.university_id AND b.id = import_rows.batch_id)));

-- ============================================================================
-- SECTION 3: APPEND-ONLY MARK HISTORY (P6) -- trigger fires for every writer
-- (manual RLS entry, confirm_mark_import, future objection RPC).
-- SECURITY DEFINER (T-A003 D-c pattern): history must never depend on the
-- caller's ability to read profiles or insert mark_history.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.record_mark_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid;
  v_source text;
  v_suppress text := COALESCE(NULLIF(current_setting('app.mark_history_suppress', true), ''), '0');
BEGIN
  IF v_suppress = '1' THEN RETURN NULL; END IF;
  SELECT p.id INTO v_actor FROM public.profiles p WHERE p.auth_user_id = (SELECT auth.uid());
  IF v_actor IS NULL THEN RETURN NULL; END IF;
  v_source := NULLIF(current_setting('app.mark_source', true), '');
  IF v_source IS NULL OR v_source NOT IN ('manual','csv','objection') THEN v_source := 'manual'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.score IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.mark_history (university_id, created_by, mark_id, actor_id, old_score, new_score, reason, source)
    VALUES (NEW.university_id, v_actor, NEW.id, v_actor, NULL, NEW.score, 'Mark created', v_source);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.score IS NOT DISTINCT FROM NEW.score THEN RETURN NULL; END IF;
    INSERT INTO public.mark_history (university_id, created_by, mark_id, actor_id, old_score, new_score, reason, source)
    VALUES (NEW.university_id, v_actor, NEW.id, v_actor, OLD.score, NEW.score,
            CASE WHEN NEW.score IS NULL THEN 'Score cleared' ELSE 'Score changed' END, v_source);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS marks_history ON public.marks;
CREATE TRIGGER marks_history AFTER INSERT OR UPDATE OF score ON public.marks FOR EACH ROW EXECUTE FUNCTION private.record_mark_history();

-- ============================================================================
-- SECTION 4: RPCs
-- ============================================================================

-- Registered signature (docs/SYMBOL_REGISTRY.md): private.confirm_mark_import(p_batch_id uuid).
-- Two-phase import commit: preview rows were written by /api/imports/preview; this call
-- applies ready rows exactly once (idempotent replay when state='applied'), honours the
-- batch's overwrite flag (R10), enforces expiry (stable code batch_expired) and writes
-- marks + mark_history + batch/row state in ONE transaction.
CREATE OR REPLACE FUNCTION private.confirm_mark_import(p_batch_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_profile public.profiles%ROWTYPE;
  v_batch public.import_batches%ROWTYPE;
  v_offering uuid;
  v_counts jsonb;
  v_student uuid;
  v_existing public.marks%ROWTYPE;
  r public.import_rows%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.* INTO v_profile FROM public.profiles p WHERE p.auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT b.* INTO v_batch FROM public.import_batches b
  WHERE b.id = p_batch_id AND b.university_id = v_profile.university_id
  FOR UPDATE OF b;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT a.offering_id INTO v_offering FROM public.assessments a
  WHERE a.university_id = v_batch.university_id AND a.id = v_batch.assessment_id;
  IF v_offering IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.offering_staff os
    WHERE os.university_id = v_profile.university_id
      AND os.offering_id = v_offering
      AND os.profile_id = v_profile.id
  ) AND NOT private.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_batch.state = 'applied' THEN
    SELECT COALESCE(jsonb_object_agg(s.k, s.n), '{}'::jsonb) INTO v_counts
    FROM (SELECT status AS k, count(*)::int AS n FROM public.import_rows WHERE batch_id = v_batch.id GROUP BY status) s;
    RETURN jsonb_build_object('batchId', v_batch.id, 'state', 'applied', 'counts', v_counts);
  END IF;
  IF v_batch.expires_at < now() THEN
    RAISE EXCEPTION 'batch_expired';
  END IF;
  IF v_batch.state <> 'preview' THEN RAISE EXCEPTION 'conflict'; END IF;

  PERFORM set_config('app.mark_source', 'csv', true);

  FOR r IN SELECT * FROM public.import_rows WHERE batch_id = v_batch.id AND status = 'ready' ORDER BY row_number LOOP
    SELECT p2.id INTO v_student FROM public.profiles p2
    WHERE p2.university_id = v_batch.university_id AND lower(p2.email) = lower(r.email);
    IF v_student IS NULL THEN
      UPDATE public.import_rows SET status = 'not_found', error_code = 'student_not_found' WHERE id = r.id;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.sections s ON s.university_id = e.university_id AND s.id = e.section_id
      WHERE e.university_id = v_batch.university_id
        AND e.profile_id = v_student
        AND e.status = 'active'
        AND s.offering_id = v_offering
    ) THEN
      UPDATE public.import_rows SET status = 'not_found', error_code = 'not_enrolled' WHERE id = r.id;
      CONTINUE;
    END IF;
    SELECT m.* INTO v_existing FROM public.marks m
    WHERE m.university_id = v_batch.university_id
      AND m.assessment_id = v_batch.assessment_id
      AND m.student_id = v_student
    FOR UPDATE OF m;
    IF FOUND THEN
      IF v_batch.overwrite_existing THEN
        UPDATE public.marks SET score = r.proposed_score, status = 'graded' WHERE id = v_existing.id;
        UPDATE public.import_rows SET status = 'applied' WHERE id = r.id;
      ELSE
        UPDATE public.import_rows SET status = 'skipped', error_code = 'exists' WHERE id = r.id;
      END IF;
    ELSE
      INSERT INTO public.marks (university_id, created_by, assessment_id, student_id, score, status)
      VALUES (v_batch.university_id, v_profile.id, v_batch.assessment_id, v_student, r.proposed_score, 'graded');
      UPDATE public.import_rows SET status = 'applied' WHERE id = r.id;
    END IF;
  END LOOP;

  UPDATE public.import_batches SET state = 'applied' WHERE id = v_batch.id;

  SELECT COALESCE(jsonb_object_agg(s.k, s.n), '{}'::jsonb) INTO v_counts
  FROM (SELECT status AS k, count(*)::int AS n FROM public.import_rows WHERE batch_id = v_batch.id GROUP BY status) s;
  RETURN jsonb_build_object('batchId', v_batch.id, 'state', 'applied', 'counts', v_counts);
END $$;

-- REGISTRY DELTA (docs/SYMBOL_REGISTRY.md): private.offering_marksheet(p_offering_id uuid)
-- Student-facing marksheet (feature 2.3): own scores/weighted total always; class stats
-- and own rank only when the active cohort >= 5 (D10/P14). Only assessments released to
-- students (visibility='students') are visible/weighted for the caller.
CREATE OR REPLACE FUNCTION private.offering_marksheet(p_offering_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_profile public.profiles%ROWTYPE;
  v_uni uuid;
  v_cohort int;
  v_threshold constant int := 5;
  v_assessments jsonb;
  v_own jsonb;
  v_scale jsonb;
  v_stats jsonb := NULL;
  v_rank int := NULL;
  v_own_total numeric := 0;
  v_score numeric;
  a public.assessments%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT p.* INTO v_profile FROM public.profiles p WHERE p.auth_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  v_uni := v_profile.university_id;

  IF NOT EXISTS (SELECT 1 FROM public.course_offerings co WHERE co.id = p_offering_id AND co.university_id = v_uni) THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    JOIN public.sections s ON s.university_id = e.university_id AND s.id = e.section_id
    WHERE e.university_id = v_uni AND s.offering_id = p_offering_id
      AND e.profile_id = v_profile.id AND e.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(DISTINCT e.profile_id) INTO v_cohort
  FROM public.enrollments e
  JOIN public.sections s ON s.university_id = e.university_id AND s.id = e.section_id
  WHERE e.university_id = v_uni AND s.offering_id = p_offering_id AND e.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a2.id, 'title', a2.title, 'type', a2.assessment_type, 'total', a2.total, 'weight', a2.weight) ORDER BY a2.created_at), '[]'::jsonb)
  INTO v_assessments
  FROM public.assessments a2
  WHERE a2.university_id = v_uni AND a2.offering_id = p_offering_id AND a2.visibility = 'students';

  SELECT COALESCE(jsonb_object_agg(m.assessment_id, jsonb_build_object('score', m.score, 'status', m.status)), '{}'::jsonb)
  INTO v_own
  FROM public.marks m
  WHERE m.university_id = v_uni AND m.student_id = v_profile.id
    AND m.assessment_id IN (SELECT (v_el->>'id')::uuid FROM jsonb_array_elements(v_assessments) v_el);

  FOR a IN SELECT * FROM public.assessments a2 WHERE a2.university_id = v_uni AND a2.offering_id = p_offering_id AND a2.visibility = 'students' ORDER BY a2.created_at LOOP
    SELECT m.score INTO v_score FROM public.marks m
    WHERE m.university_id = v_uni AND m.assessment_id = a.id AND m.student_id = v_profile.id;
    IF v_score IS NOT NULL THEN
      v_own_total := v_own_total + (v_score / a.total) * a.weight;
    END IF;
  END LOOP;

  IF v_cohort >= v_threshold THEN
    WITH cohort AS (
      SELECT DISTINCT e.profile_id FROM public.enrollments e
      JOIN public.sections s ON s.university_id = e.university_id AND s.id = e.section_id
      WHERE e.university_id = v_uni AND s.offering_id = p_offering_id AND e.status = 'active'
    ), totals AS (
      SELECT c.profile_id,
             COALESCE(sum(CASE WHEN m.score IS NOT NULL THEN (m.score / a2.total) * a2.weight ELSE 0 END), 0)::numeric AS total
      FROM cohort c
      CROSS JOIN public.assessments a2
      LEFT JOIN public.marks m ON m.university_id = v_uni AND m.assessment_id = a2.id AND m.student_id = c.profile_id
      WHERE a2.university_id = v_uni AND a2.offering_id = p_offering_id AND a2.visibility = 'students'
      GROUP BY c.profile_id
    )
    SELECT jsonb_build_object('count', count(*)::int,
                              'mean', round(avg(total), 2),
                              'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY total))::numeric, 2),
                              'min', round(min(total), 2),
                              'max', round(max(total), 2))
    INTO v_stats FROM totals;

    WITH cohort AS (
      SELECT DISTINCT e.profile_id FROM public.enrollments e
      JOIN public.sections s ON s.university_id = e.university_id AND s.id = e.section_id
      WHERE e.university_id = v_uni AND s.offering_id = p_offering_id AND e.status = 'active'
    ), totals AS (
      SELECT c.profile_id,
             COALESCE(sum(CASE WHEN m.score IS NOT NULL THEN (m.score / a2.total) * a2.weight ELSE 0 END), 0)::numeric AS total
      FROM cohort c
      CROSS JOIN public.assessments a2
      LEFT JOIN public.marks m ON m.university_id = v_uni AND m.assessment_id = a2.id AND m.student_id = c.profile_id
      WHERE a2.university_id = v_uni AND a2.offering_id = p_offering_id AND a2.visibility = 'students'
      GROUP BY c.profile_id
    )
    SELECT (1 + count(*))::int INTO v_rank FROM totals t WHERE t.total > round(v_own_total, 2);
  END IF;

  SELECT jsonb_build_object('id', g.id, 'name', g.name, 'bands', g.definition->'bands')
  INTO v_scale
  FROM public.grading_scales g
  WHERE g.university_id = v_uni AND g.scale_type = 'percentage'
  ORDER BY g.created_at
  LIMIT 1;

  RETURN jsonb_build_object(
    'offeringId', p_offering_id,
    'cohortSize', v_cohort,
    'threshold', v_threshold,
    'thresholdMet', v_cohort >= v_threshold,
    'assessments', v_assessments,
    'ownScores', v_own,
    'ownTotal', round(v_own_total, 2),
    'ownRank', v_rank,
    'stats', v_stats,
    'gradingScale', v_scale
  );
END $$;

-- D-f pattern: narrow grants (never anon; private schema USAGE was revoked from PUBLIC in T-A003).
GRANT EXECUTE ON FUNCTION private.confirm_mark_import(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.offering_marksheet(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.confirm_mark_import(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.offering_marksheet(uuid) FROM anon;

-- D-k: public wrappers are what PostgREST actually routes (default profile).
-- SECURITY INVOKER: the caller already holds private USAGE + EXECUTE (grants above),
-- so the forward is just a qualification hop; RAISE messages pass through verbatim.
CREATE OR REPLACE FUNCTION public.confirm_mark_import(p_batch_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$ SELECT private.confirm_mark_import(p_batch_id) $$;
CREATE OR REPLACE FUNCTION public.offering_marksheet(p_offering_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$ SELECT private.offering_marksheet(p_offering_id) $$;
GRANT EXECUTE ON FUNCTION public.confirm_mark_import(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offering_marksheet(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_mark_import(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.offering_marksheet(uuid) FROM PUBLIC, anon;
