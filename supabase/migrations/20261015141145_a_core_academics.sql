-- Migration: core-academics (lane: a)
-- Card: docs/08-delivery/lane-a/tasks/t-a003-academic-catalog-and-enrollment.md (T-A003)
-- Source (order preserved):
--   docs/03-database/schema/core-academics.sql
--   docs/03-database/rls/core-academics.sql
--   docs/03-database/functions/core-academics.sql  (comments-only in docs; no RPCs yet)
-- Registry: docs/SYMBOL_REGISTRY.md v1 (+ REGISTRY DELTA: private.has_permission)
--
-- Documented deviations from doc SQL:
--   D-a. Schema import_batches declared `created_by` twice (nullable, then NOT NULL);
--        Postgres rejects duplicate column names -> kept the NOT NULL declaration only.
--   D-b. Doc RLS helpers wrote `SET search_path=` (invalid) -> `SET search_path = ''`
--        (same fix as F1). Doc RLS helper re-definitions are superseded by SECTION 4.
--   D-c. SECTION 2a: private.current_university_ids() / is_platform_admin() / has_role()
--        are redefined to resolve the caller via profiles.auth_user_id. F1 compared
--        memberships/platform_admins/role_assignments.profile_id (profiles.id) directly
--        to auth.uid() (auth.users.id) -- those ids differ (F3 trigger inserts profiles
--        with a separate gen_random_uuid() id), so the helpers silently returned empty
--        for every real user. Same signatures; SECURITY DEFINER (owner postgres has
--        BYPASSRLS locally) so the profiles join is not blocked by profiles RLS.
--   D-d. Narrow member/staff policies added (the doc RLS file instructs this once
--        identity and role fixtures exist -- they landed in F1/F3). Backed by new
--        private.has_permission (registry delta) and registry-listed
--        private.is_offering_staff / private.is_enrolled (F5-deferred to this card).
--   D-e. Doc schema omits composite FKs on offering_staff.offering_id,
--        assessments.section_id, enrollments.profile_id -- kept verbatim per
--        expand/contract (follow-up for a later card; not invented here).
--
-- Rollback / expand-contract note (P7):
--   This migration is additive (create-only). Do not drop/rename in one release.
--   To roll back consumers: stop the /app/offerings UI first, then a later
--   contract migration may DROP the narrow policies, the three new helpers,
--   has_permission, and (after data-retention review) the core-academics tables.
--   Append-only history tables (mark_history in this schema) are never dropped.

-- ============================================================================
-- SECTION 1: SCHEMA (from docs/03-database/schema/core-academics.sql)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS public.departments(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, name text NOT NULL, slug text NOT NULL, CONSTRAINT departments_pkey PRIMARY KEY(id), CONSTRAINT departments_tenant_id_key UNIQUE(university_id,id), CONSTRAINT departments_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS departments_tenant_created_idx ON public.departments(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS departments_creator_idx ON public.departments(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.departments FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_departments() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS departments_touch ON public.departments; CREATE TRIGGER departments_touch BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION private.touch_departments();
CREATE TABLE IF NOT EXISTS public.terms(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, publication_state text NOT NULL DEFAULT 'draft', CONSTRAINT terms_pkey PRIMARY KEY(id), CONSTRAINT terms_tenant_id_key UNIQUE(university_id,id), CONSTRAINT terms_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS terms_tenant_created_idx ON public.terms(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS terms_creator_idx ON public.terms(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY; ALTER TABLE public.terms FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_terms() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS terms_touch ON public.terms; CREATE TRIGGER terms_touch BEFORE UPDATE ON public.terms FOR EACH ROW EXECUTE FUNCTION private.touch_terms();
CREATE TABLE IF NOT EXISTS public.courses(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, department_id uuid, code text NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', publication_state text NOT NULL DEFAULT 'draft', CONSTRAINT courses_pkey PRIMARY KEY(id), CONSTRAINT courses_tenant_id_key UNIQUE(university_id,id), CONSTRAINT courses_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT courses_department_id_tenant_fk FOREIGN KEY(university_id,department_id) REFERENCES public.departments(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS courses_tenant_created_idx ON public.courses(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS courses_creator_idx ON public.courses(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY; ALTER TABLE public.courses FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_courses() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS courses_touch ON public.courses; CREATE TRIGGER courses_touch BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION private.touch_courses();
CREATE TABLE IF NOT EXISTS public.course_offerings(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, course_id uuid NOT NULL, term_id uuid NOT NULL, offering_code text NOT NULL, CONSTRAINT course_offerings_pkey PRIMARY KEY(id), CONSTRAINT course_offerings_tenant_id_key UNIQUE(university_id,id), CONSTRAINT course_offerings_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT course_offerings_course_id_tenant_fk FOREIGN KEY(university_id,course_id) REFERENCES public.courses(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS course_offerings_tenant_created_idx ON public.course_offerings(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS course_offerings_creator_idx ON public.course_offerings(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.course_offerings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.course_offerings FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_course_offerings() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS course_offerings_touch ON public.course_offerings; CREATE TRIGGER course_offerings_touch BEFORE UPDATE ON public.course_offerings FOR EACH ROW EXECUTE FUNCTION private.touch_course_offerings();
CREATE TABLE IF NOT EXISTS public.sections(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, offering_id uuid NOT NULL, section_code text NOT NULL, capacity integer, CONSTRAINT sections_pkey PRIMARY KEY(id), CONSTRAINT sections_tenant_id_key UNIQUE(university_id,id), CONSTRAINT sections_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT sections_offering_id_tenant_fk FOREIGN KEY(university_id,offering_id) REFERENCES public.course_offerings(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS sections_tenant_created_idx ON public.sections(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sections_creator_idx ON public.sections(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sections FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_sections() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS sections_touch ON public.sections; CREATE TRIGGER sections_touch BEFORE UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION private.touch_sections();
CREATE TABLE IF NOT EXISTS public.enrollments(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, section_id uuid NOT NULL, profile_id uuid NOT NULL, status text NOT NULL DEFAULT 'active', CONSTRAINT enrollments_pkey PRIMARY KEY(id), CONSTRAINT enrollments_tenant_id_key UNIQUE(university_id,id), CONSTRAINT enrollments_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT enrollments_section_id_tenant_fk FOREIGN KEY(university_id,section_id) REFERENCES public.sections(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS enrollments_tenant_created_idx ON public.enrollments(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS enrollments_creator_idx ON public.enrollments(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.enrollments FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_enrollments() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS enrollments_touch ON public.enrollments; CREATE TRIGGER enrollments_touch BEFORE UPDATE ON public.enrollments FOR EACH ROW EXECUTE FUNCTION private.touch_enrollments();
CREATE TABLE IF NOT EXISTS public.offering_staff(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, offering_id uuid NOT NULL, profile_id uuid NOT NULL, staff_role text NOT NULL, CONSTRAINT offering_staff_pkey PRIMARY KEY(id), CONSTRAINT offering_staff_tenant_id_key UNIQUE(university_id,id), CONSTRAINT offering_staff_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS offering_staff_tenant_created_idx ON public.offering_staff(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS offering_staff_creator_idx ON public.offering_staff(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.offering_staff ENABLE ROW LEVEL SECURITY; ALTER TABLE public.offering_staff FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_offering_staff() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS offering_staff_touch ON public.offering_staff; CREATE TRIGGER offering_staff_touch BEFORE UPDATE ON public.offering_staff FOR EACH ROW EXECUTE FUNCTION private.touch_offering_staff();
CREATE TABLE IF NOT EXISTS public.grading_scales(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, name text NOT NULL, scale_type text NOT NULL, definition jsonb NOT NULL, CONSTRAINT grading_scales_pkey PRIMARY KEY(id), CONSTRAINT grading_scales_tenant_id_key UNIQUE(university_id,id), CONSTRAINT grading_scales_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS grading_scales_tenant_created_idx ON public.grading_scales(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS grading_scales_creator_idx ON public.grading_scales(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.grading_scales ENABLE ROW LEVEL SECURITY; ALTER TABLE public.grading_scales FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_grading_scales() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS grading_scales_touch ON public.grading_scales; CREATE TRIGGER grading_scales_touch BEFORE UPDATE ON public.grading_scales FOR EACH ROW EXECUTE FUNCTION private.touch_grading_scales();
CREATE TABLE IF NOT EXISTS public.assessments(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, offering_id uuid NOT NULL, section_id uuid, title text NOT NULL, assessment_type text NOT NULL, total numeric(10,2) NOT NULL CHECK(total>0), weight numeric(7,4) NOT NULL CHECK(weight>=0), visibility text NOT NULL DEFAULT 'private', CONSTRAINT assessments_pkey PRIMARY KEY(id), CONSTRAINT assessments_tenant_id_key UNIQUE(university_id,id), CONSTRAINT assessments_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT assessments_offering_id_tenant_fk FOREIGN KEY(university_id,offering_id) REFERENCES public.course_offerings(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS assessments_tenant_created_idx ON public.assessments(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS assessments_creator_idx ON public.assessments(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.assessments FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_assessments() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS assessments_touch ON public.assessments; CREATE TRIGGER assessments_touch BEFORE UPDATE ON public.assessments FOR EACH ROW EXECUTE FUNCTION private.touch_assessments();
CREATE TABLE IF NOT EXISTS public.marks(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, assessment_id uuid NOT NULL, student_id uuid NOT NULL, score numeric(10,2), status text NOT NULL DEFAULT 'pending', UNIQUE(university_id,assessment_id,student_id), CONSTRAINT marks_pkey PRIMARY KEY(id), CONSTRAINT marks_tenant_id_key UNIQUE(university_id,id), CONSTRAINT marks_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT marks_assessment_id_tenant_fk FOREIGN KEY(university_id,assessment_id) REFERENCES public.assessments(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS marks_tenant_created_idx ON public.marks(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS marks_creator_idx ON public.marks(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY; ALTER TABLE public.marks FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_marks() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS marks_touch ON public.marks; CREATE TRIGGER marks_touch BEFORE UPDATE ON public.marks FOR EACH ROW EXECUTE FUNCTION private.touch_marks();
CREATE TABLE IF NOT EXISTS public.mark_history(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, mark_id uuid NOT NULL, actor_id uuid NOT NULL, old_score numeric(10,2), new_score numeric(10,2), reason text NOT NULL, source text NOT NULL CHECK(source IN ('manual','csv','objection')), CONSTRAINT mark_history_pkey PRIMARY KEY(id), CONSTRAINT mark_history_tenant_id_key UNIQUE(university_id,id), CONSTRAINT mark_history_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT mark_history_mark_id_tenant_fk FOREIGN KEY(university_id,mark_id) REFERENCES public.marks(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS mark_history_tenant_created_idx ON public.mark_history(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS mark_history_creator_idx ON public.mark_history(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.mark_history ENABLE ROW LEVEL SECURITY; ALTER TABLE public.mark_history FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_mark_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS mark_history_touch ON public.mark_history; CREATE TRIGGER mark_history_touch BEFORE UPDATE ON public.mark_history FOR EACH ROW EXECUTE FUNCTION private.touch_mark_history();
CREATE TABLE IF NOT EXISTS public.import_batches(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, assessment_id uuid NOT NULL, idempotency_key text NOT NULL, state text NOT NULL, expires_at timestamptz NOT NULL, UNIQUE(university_id,idempotency_key), CONSTRAINT import_batches_pkey PRIMARY KEY(id), CONSTRAINT import_batches_tenant_id_key UNIQUE(university_id,id), CONSTRAINT import_batches_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT import_batches_assessment_id_tenant_fk FOREIGN KEY(university_id,assessment_id) REFERENCES public.assessments(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS import_batches_tenant_created_idx ON public.import_batches(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS import_batches_creator_idx ON public.import_batches(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY; ALTER TABLE public.import_batches FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_import_batches() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS import_batches_touch ON public.import_batches; CREATE TRIGGER import_batches_touch BEFORE UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION private.touch_import_batches();
CREATE TABLE IF NOT EXISTS public.import_rows(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, batch_id uuid NOT NULL, row_number integer NOT NULL, row_hash text NOT NULL, email text, proposed_score numeric(10,2), status text NOT NULL, error_code text, CONSTRAINT import_rows_pkey PRIMARY KEY(id), CONSTRAINT import_rows_tenant_id_key UNIQUE(university_id,id), CONSTRAINT import_rows_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT import_rows_batch_id_tenant_fk FOREIGN KEY(university_id,batch_id) REFERENCES public.import_batches(university_id,id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS import_rows_tenant_created_idx ON public.import_rows(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS import_rows_creator_idx ON public.import_rows(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY; ALTER TABLE public.import_rows FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_import_rows() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS import_rows_touch ON public.import_rows; CREATE TRIGGER import_rows_touch BEFORE UPDATE ON public.import_rows FOR EACH ROW EXECUTE FUNCTION private.touch_import_rows();
CREATE TABLE IF NOT EXISTS public.announcements(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, section_id uuid NOT NULL, author_id uuid NOT NULL, title text NOT NULL, body_html text NOT NULL, CONSTRAINT announcements_pkey PRIMARY KEY(id), CONSTRAINT announcements_tenant_id_key UNIQUE(university_id,id), CONSTRAINT announcements_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS announcements_tenant_created_idx ON public.announcements(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS announcements_creator_idx ON public.announcements(university_id,created_by) WHERE created_by IS NOT NULL;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY; ALTER TABLE public.announcements FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_announcements() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS announcements_touch ON public.announcements; CREATE TRIGGER announcements_touch BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION private.touch_announcements();

-- ============================================================================
-- SECTION 2: RLS (baseline from docs/03-database/rls/core-academics.sql)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
-- Doc helper re-definitions (current_university_ids/is_platform_admin) are superseded by the corrected DEFINER versions in SECTION 2a (deviation D-c).
DROP POLICY IF EXISTS departments_tenant_access ON public.departments;
CREATE POLICY departments_tenant_access ON public.departments FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.departments FROM anon;
DROP POLICY IF EXISTS terms_tenant_access ON public.terms;
CREATE POLICY terms_tenant_access ON public.terms FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.terms FROM anon;
DROP POLICY IF EXISTS courses_tenant_access ON public.courses;
CREATE POLICY courses_tenant_access ON public.courses FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.courses FROM anon;
DROP POLICY IF EXISTS course_offerings_tenant_access ON public.course_offerings;
CREATE POLICY course_offerings_tenant_access ON public.course_offerings FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.course_offerings FROM anon;
DROP POLICY IF EXISTS sections_tenant_access ON public.sections;
CREATE POLICY sections_tenant_access ON public.sections FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.sections FROM anon;
DROP POLICY IF EXISTS enrollments_tenant_access ON public.enrollments;
CREATE POLICY enrollments_tenant_access ON public.enrollments FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.enrollments FROM anon;
DROP POLICY IF EXISTS offering_staff_tenant_access ON public.offering_staff;
CREATE POLICY offering_staff_tenant_access ON public.offering_staff FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.offering_staff FROM anon;
DROP POLICY IF EXISTS grading_scales_tenant_access ON public.grading_scales;
CREATE POLICY grading_scales_tenant_access ON public.grading_scales FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.grading_scales FROM anon;
DROP POLICY IF EXISTS assessments_tenant_access ON public.assessments;
CREATE POLICY assessments_tenant_access ON public.assessments FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.assessments FROM anon;
DROP POLICY IF EXISTS marks_tenant_access ON public.marks;
CREATE POLICY marks_tenant_access ON public.marks FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.marks FROM anon;
DROP POLICY IF EXISTS mark_history_tenant_access ON public.mark_history;
CREATE POLICY mark_history_tenant_access ON public.mark_history FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.mark_history FROM anon;
REVOKE UPDATE,DELETE ON public.mark_history FROM anon,authenticated;
DROP POLICY IF EXISTS import_batches_tenant_access ON public.import_batches;
CREATE POLICY import_batches_tenant_access ON public.import_batches FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.import_batches FROM anon;
DROP POLICY IF EXISTS import_rows_tenant_access ON public.import_rows;
CREATE POLICY import_rows_tenant_access ON public.import_rows FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.import_rows FROM anon;
DROP POLICY IF EXISTS announcements_tenant_access ON public.announcements;
CREATE POLICY announcements_tenant_access ON public.announcements FOR ALL TO authenticated USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
REVOKE ALL ON public.announcements FROM anon;
-- Baseline platform-admin policies above are from the doc file verbatim; narrow member/staff policies follow in SECTION 2c (see header deviation D-d).
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- ============================================================================
-- SECTION 2a: HELPERS -- fixes (D-c) + registry delta + F5-deferred (D-d) + grants (D-f)
-- Defined before the narrow policies that call them.
-- ============================================================================

-- D-c: resolve the caller via profiles.auth_user_id (F1 compared profile_id to auth.uid() directly).
CREATE OR REPLACE FUNCTION private.current_university_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT m.university_id FROM public.university_memberships m JOIN public.profiles p ON p.id = m.profile_id WHERE p.auth_user_id = (SELECT auth.uid()) AND m.status = 'active' $$;
CREATE OR REPLACE FUNCTION private.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.platform_admins pa JOIN public.profiles p ON p.id = pa.profile_id WHERE p.auth_user_id = (SELECT auth.uid()) AND pa.revoked_at IS NULL) $$;
CREATE OR REPLACE FUNCTION private.has_role(p_university_id uuid, p_role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.role_assignments ra JOIN public.roles r ON r.id = ra.role_id AND r.university_id = ra.university_id WHERE ra.university_id = p_university_id AND ra.profile_id = (SELECT id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())) AND r.name = p_role AND ra.revoked_at IS NULL) $$;

-- REGISTRY DELTA (docs/SYMBOL_REGISTRY.md): private.has_permission(p_university_id uuid, p_permission text)
CREATE OR REPLACE FUNCTION private.has_permission(p_university_id uuid, p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.role_assignments ra JOIN public.roles r ON r.id = ra.role_id AND r.university_id = ra.university_id JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.university_id = r.university_id JOIN public.permissions pe ON pe.id = rp.permission_id AND pe.university_id = rp.university_id WHERE ra.university_id = p_university_id AND ra.profile_id = (SELECT id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())) AND ra.revoked_at IS NULL AND pe.key = p_permission) $$;

-- Registry-listed, F5-deferred to this card (tables arrive above).
CREATE OR REPLACE FUNCTION private.is_offering_staff(p_offering_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.offering_staff os WHERE os.university_id IN (SELECT private.current_university_ids()) AND os.offering_id = p_offering_id AND os.profile_id = (SELECT id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()))) $$;
CREATE OR REPLACE FUNCTION private.is_enrolled(p_section_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.enrollments e WHERE e.university_id IN (SELECT private.current_university_ids()) AND e.section_id = p_section_id AND e.profile_id = (SELECT id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())) AND e.status = 'active') $$;

-- D-f: allow the authenticated role to evaluate policies / call these helpers.
-- Never granted to anon. Other private.* functions stay unreachable from clients.
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_university_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_offering_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_enrolled(uuid) TO authenticated;

-- ============================================================================
-- SECTION 2c: NARROW MEMBER/STAFF POLICIES (deviation D-d)
-- Catalog reads: any active member of the row's tenant.
-- Catalog/offering management: holders of academic.manage_offering in the row's
-- tenant (ta + teacher roles per seed matrix) or platform admins (baseline above).
-- enrollments/offering_staff are management-only (no broad member read).
-- marks/mark_history/import_*/announcements stay platform-admin-only (T-A004/T-A005).
-- ============================================================================

DROP POLICY IF EXISTS departments_member_read ON public.departments;
CREATE POLICY departments_member_read ON public.departments FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()));
DROP POLICY IF EXISTS departments_manage ON public.departments;
CREATE POLICY departments_manage ON public.departments FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
DROP POLICY IF EXISTS terms_member_read ON public.terms;
CREATE POLICY terms_member_read ON public.terms FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()));
DROP POLICY IF EXISTS terms_manage ON public.terms;
CREATE POLICY terms_manage ON public.terms FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
DROP POLICY IF EXISTS courses_member_read ON public.courses;
CREATE POLICY courses_member_read ON public.courses FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()));
DROP POLICY IF EXISTS courses_manage ON public.courses;
CREATE POLICY courses_manage ON public.courses FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
DROP POLICY IF EXISTS course_offerings_member_read ON public.course_offerings;
CREATE POLICY course_offerings_member_read ON public.course_offerings FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()));
DROP POLICY IF EXISTS course_offerings_manage ON public.course_offerings;
CREATE POLICY course_offerings_manage ON public.course_offerings FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
DROP POLICY IF EXISTS sections_member_read ON public.sections;
CREATE POLICY sections_member_read ON public.sections FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()));
DROP POLICY IF EXISTS sections_manage ON public.sections;
CREATE POLICY sections_manage ON public.sections FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
DROP POLICY IF EXISTS grading_scales_member_read ON public.grading_scales;
CREATE POLICY grading_scales_member_read ON public.grading_scales FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()));
DROP POLICY IF EXISTS grading_scales_manage ON public.grading_scales;
CREATE POLICY grading_scales_manage ON public.grading_scales FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
DROP POLICY IF EXISTS assessments_member_read ON public.assessments;
CREATE POLICY assessments_member_read ON public.assessments FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()));
DROP POLICY IF EXISTS assessments_manage ON public.assessments;
CREATE POLICY assessments_manage ON public.assessments FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
DROP POLICY IF EXISTS enrollments_manage ON public.enrollments;
CREATE POLICY enrollments_manage ON public.enrollments FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));
DROP POLICY IF EXISTS offering_staff_manage ON public.offering_staff;
CREATE POLICY offering_staff_manage ON public.offering_staff FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering')) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));

-- Cross-lane additive policy (same deviation family as D-d): enrollment flows
-- resolve a student email -> profiles.id inside the tenant. Only holders of
-- academic.manage_offering may read tenant profiles; students still cannot
-- browse the member directory. Existing platform-admin policy above is unchanged.
DROP POLICY IF EXISTS profiles_manage_read ON public.profiles;
CREATE POLICY profiles_manage_read ON public.profiles FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.has_permission(university_id, 'academic.manage_offering'));


-- ============================================================================
-- SECTION 3: FUNCTIONS (docs file is comments-only; no module RPCs yet)
-- ============================================================================
-- Security-definer RPCs must set search_path to empty, validate auth.uid(), verify tenant and role, and be granted narrowly.
-- Transactional module operations are defined as narrowly scoped RPCs in the API contract before UI consumers are implemented.
-- Rollback: revoke execute first; preserve append-only audit and financial history.

-- ============================================================================
-- SECTION 4: (helpers live in SECTION 2a so they exist before the SECTION 2c
-- policies that reference them; grants D-f are there too.)
-- ============================================================================

-- ============================================================================
-- Rollback note (see header): additive migration; contract later, never in-place.
-- ============================================================================
