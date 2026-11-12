-- Migration: projects-groups (lane: a)
-- Card: owner request 2026-11-11 — Projects & Group Management module
-- BUILD MARKER: v8 2026-11-12 — replaced the 4 composite tenant FKs that used
--   ON DELETE SET NULL (project_group_members.profile_id, project_groups.
--   leader_member_id, project_member_requests.member_id, project_reviews.
--   submission_id): SET NULL on a composite FK tries to null the NOT NULL
--   tenant column too and fails with 23502. They are now single-column FKs on
--   the nullable column.
-- BUILD MARKER: v7 2026-11-12 — create_project_group stored the leader's
--   PROFILE id in project_groups.leader_member_id, which FKs to
--   project_group_members.id (member ROW id) → 23503 on every group creation.
--   It now resolves the first member's row id by profile.
-- BUILD MARKER: v6 2026-11-12 — fixed an authorization bypass in the leader
--   check shared by 6 RPCs: `leader_member_id IS NULL OR leader_member_id <>
--   (subquery)` evaluated to NULL (→ no raise) when the caller was not a group
--   member, letting a non-member act as leader. All 6 now use IS DISTINCT FROM.
-- BUILD MARKER: v5 2026-11-12 — fixed the correlated-subquery shadowing bug that
--   raised 42883 "operator does not exist: uuid = text" in the 8 policies on
--   project_group_members / project_member_requests / project_submissions /
--   project_links (bare `group_id` resolved to project_groups.group_id, a TEXT
--   column, inside the subquery). Now routed through the new private.
--   project_group_dashboard_id(uuid) helper. Notifications remain removed.
--   If you do not see these lines at the very top of what you are running, you
--   are executing an older copy (check the SQL editor's history / saved queries
--   and paste this file into a NEW query).
-- Source (order preserved):
--   docs/03-database/schema/projects.sql   (contract)
--   docs/03-database/functions/projects.sql (contract)
-- Registry: docs/SYMBOL_REGISTRY.md v1 (+ REGISTRY DELTA 2026-11-11 Projects)
--
-- REGISTRY DELTA (mirrored in docs/SYMBOL_REGISTRY.md):
--   Tables: project_dashboards, project_dashboard_fields, project_group_id_ledger,
--     project_groups, project_group_members, project_member_requests,
--     project_submissions, project_submission_responses, project_links,
--     project_reviews, project_activity_logs.
--   Private helpers: private.is_offering_enrolled(uuid),
--     private.is_project_group_member(uuid), private.project_dashboard_readable(uuid),
--     private.project_dashboard_manageable(uuid), private.project_actor(),
--     private.project_resolve_member(...), private.project_validate_members(...),
--     private.project_validate_members(...), private.project_student_content_allowed(...),
--     private.project_next_group_id_candidate(...) / project_generate_group_id(...),
--     private.project_log(...).
--   Private RPCs (HTTP via public wrappers of the same name per D-k):
--     create_project_dashboard, update_project_dashboard, set_project_dashboard_status,
--     duplicate_project_dashboard, delete_project_dashboard, set_project_deadline,
--     next_project_group_id, create_project_group, update_project_group,
--     add_project_group_members, remove_project_group_member, transfer_project_member,
--     set_project_group_leader, archive_project_group, delete_project_group,
--     request_project_member_change, decide_project_member_request, submit_project,
--     create_project_review, update_project_review, delete_project_review,
--     set_project_group_status, upsert_project_link, delete_project_link.
--     (Form-field CRUD is direct RLS-guarded table writes from server actions,
--     not RPCs.)
--   Permissions: projects.manage (ta/teacher), projects.submit_own (student).
--   JSONB usage: submission fields_snapshot + member request payloads + activity
--     prev/new value snapshots (immutable audit/input snapshots, per conventions).
--
-- Design rules honoured:
--   - Group IDs are TA-controlled: dashboard.group_id_prefix + group_id_seq,
--     generated inside a transaction holding a row lock on the dashboard row so
--     concurrent creations cannot collide; every issued ID is written to
--     project_group_id_ledger and never deleted, so deleted/archived IDs are
--     never reused. Manual TA IDs are accepted when unique (case kept verbatim).
--   - Submission history: project_submissions keeps one row per version with an
--     immutable fields_snapshot; responses attach to a version, so later form
--     edits never corrupt historical answers.
--   - Review history: project_reviews rows are never overwritten; edits keep the
--     row (is_edited) and audit trail in project_activity_logs; deletes are soft
--     (deleted_at) so history survives.
--   - Private TA notes live in project_reviews.visibility='private' and are
--     excluded from every student-visible policy AND from every RPC payload
--     students can receive.
--   - All student writes go through private RPCs; table grants for students stay
--     read-only, so no client can bypass validation or approval flows.
--
-- Rollback / expand-contract note (P7): additive (create-only). To roll back,
-- stop the /app/projects UI first, then drop the tables in reverse dependency
-- order. append-only logs (project_activity_logs) are never rewritten.
--
-- Deviations from the request brief (documented):
--   D-a. The suggested "Project Dashboard Field Versions" and "Project
--        Submission Versions" tables are collapsed into an immutable
--        fields_snapshot + version counter (equivalent safe approach allowed by
--        the brief; avoids duplicate relational data).
--   D-b. The suggested "Project Review History" and "Project Feedback" tables
--        are represented by append-only project_reviews rows (public feedback
--        and private notes share one table, separated by visibility).
--   D-c. The suggested "Project Group ID Sequences" table is implemented as
--        project_group_id_ledger (one row per issued ID) + group_id_seq counter
--        on the dashboard — transactional issuance + permanent non-reuse.
--   D-d. Project notifications are intentionally NOT implemented (owner
--        request 2026-11-11): the platform has no notification engine yet, and
--        the module stays purely in-page. Activity logs carry the history.

-- ============================================================================
-- SECTION 1: SCHEMA
-- ============================================================================

-- Atomic run: any failure rolls the whole file back, so a fixed file can be
-- re-run safely on top of a failed attempt (all statements are also written
-- idempotently: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS /
-- seeded grants via WHERE NOT EXISTS).
BEGIN;

CREATE TABLE IF NOT EXISTS public.project_dashboards(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, deleted_at timestamptz, offering_id uuid NOT NULL, section_id uuid, title text NOT NULL, description text NOT NULL DEFAULT '', instructions text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','closed','archived')), opens_at timestamptz, deadline_at timestamptz, late_allowed boolean NOT NULL DEFAULT false, allow_edit_after_submission boolean NOT NULL DEFAULT false, allow_member_changes_after_submission boolean NOT NULL DEFAULT false, require_member_change_approval boolean NOT NULL DEFAULT false, allow_individual boolean NOT NULL DEFAULT false, allow_student_groups boolean NOT NULL DEFAULT true, min_members integer NOT NULL DEFAULT 2 CHECK(min_members >= 1), max_members integer NOT NULL DEFAULT 5 CHECK(max_members >= 1), group_id_prefix text NOT NULL DEFAULT '' CHECK(char_length(group_id_prefix) <= 32), group_id_seq integer NOT NULL DEFAULT 0 CHECK(group_id_seq >= 0), CONSTRAINT project_dashboards_pkey PRIMARY KEY(id), CONSTRAINT project_dashboards_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_dashboards_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_dashboards_offering_id_tenant_fk FOREIGN KEY(university_id,offering_id) REFERENCES public.course_offerings(university_id,id) ON DELETE RESTRICT, CONSTRAINT project_dashboards_section_id_tenant_fk FOREIGN KEY(university_id,section_id) REFERENCES public.sections(university_id,id) ON DELETE RESTRICT, CONSTRAINT project_dashboards_size_check CHECK(max_members >= min_members));
CREATE INDEX IF NOT EXISTS project_dashboards_tenant_created_idx ON public.project_dashboards(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_dashboards_creator_idx ON public.project_dashboards(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_dashboards_offering_idx ON public.project_dashboards(university_id,offering_id);
CREATE INDEX IF NOT EXISTS project_dashboards_status_idx ON public.project_dashboards(university_id,status);
ALTER TABLE public.project_dashboards ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_dashboards FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_dashboards() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_dashboards_touch ON public.project_dashboards; CREATE TRIGGER project_dashboards_touch BEFORE UPDATE ON public.project_dashboards FOR EACH ROW EXECUTE FUNCTION private.touch_project_dashboards();

CREATE TABLE IF NOT EXISTS public.project_dashboard_fields(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, deleted_at timestamptz, dashboard_id uuid NOT NULL, position integer NOT NULL CHECK(position >= 0), label text NOT NULL, description text NOT NULL DEFAULT '', field_type text NOT NULL CHECK(field_type IN ('short_text','long_text','url','number','select')), required boolean NOT NULL DEFAULT false, placeholder text NOT NULL DEFAULT '', options text[] NOT NULL DEFAULT '{}', is_system boolean NOT NULL DEFAULT false, kind text CHECK(kind IN ('project_title','project_idea','problem_statement','proposed_solution')), enabled boolean NOT NULL DEFAULT true, CONSTRAINT project_dashboard_fields_pkey PRIMARY KEY(id), CONSTRAINT project_dashboard_fields_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_dashboard_fields_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_dashboard_fields_dashboard_id_tenant_fk FOREIGN KEY(university_id,dashboard_id) REFERENCES public.project_dashboards(university_id,id) ON DELETE CASCADE, CONSTRAINT project_dashboard_fields_select_options_check CHECK(field_type <> 'select' OR cardinality(options) >= 1));
CREATE INDEX IF NOT EXISTS project_dashboard_fields_tenant_created_idx ON public.project_dashboard_fields(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_dashboard_fields_creator_idx ON public.project_dashboard_fields(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_dashboard_fields_dashboard_idx ON public.project_dashboard_fields(university_id,dashboard_id,position);
ALTER TABLE public.project_dashboard_fields ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_dashboard_fields FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_dashboard_fields() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_dashboard_fields_touch ON public.project_dashboard_fields; CREATE TRIGGER project_dashboard_fields_touch BEFORE UPDATE ON public.project_dashboard_fields FOR EACH ROW EXECUTE FUNCTION private.touch_project_dashboard_fields();

-- Permanent record of every issued Group ID (D-c). Rows are never deleted
-- (except with the whole dashboard), so IDs of deleted/archived groups can
-- never be handed out again. project_groups.group_id references this ledger.
CREATE TABLE IF NOT EXISTS public.project_group_id_ledger(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, dashboard_id uuid NOT NULL, group_id text NOT NULL, released_at timestamptz, CONSTRAINT project_group_id_ledger_pkey PRIMARY KEY(id), CONSTRAINT project_group_id_ledger_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_group_id_ledger_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_group_id_ledger_dashboard_id_tenant_fk FOREIGN KEY(university_id,dashboard_id) REFERENCES public.project_dashboards(university_id,id) ON DELETE CASCADE, CONSTRAINT project_group_id_ledger_dashboard_group_key UNIQUE(university_id,dashboard_id,group_id), CONSTRAINT project_group_id_ledger_format_check CHECK(group_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'));
CREATE INDEX IF NOT EXISTS project_group_id_ledger_tenant_created_idx ON public.project_group_id_ledger(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_group_id_ledger_creator_idx ON public.project_group_id_ledger(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_group_id_ledger_dashboard_idx ON public.project_group_id_ledger(university_id,dashboard_id);
ALTER TABLE public.project_group_id_ledger ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_group_id_ledger FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_group_id_ledger() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_group_id_ledger_touch ON public.project_group_id_ledger; CREATE TRIGGER project_group_id_ledger_touch BEFORE UPDATE ON public.project_group_id_ledger FOR EACH ROW EXECUTE FUNCTION private.touch_project_group_id_ledger();

CREATE TABLE IF NOT EXISTS public.project_groups(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, deleted_at timestamptz, archived_at timestamptz, dashboard_id uuid NOT NULL, group_id text NOT NULL, project_title text NOT NULL DEFAULT '', leader_member_id uuid, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','revision_required','approved','in_progress','completed','rejected','archived')), submission_status text NOT NULL DEFAULT 'not_submitted' CHECK(submission_status IN ('not_submitted','submitted','resubmitted','late')), submitted_at timestamptz, latest_submission_id uuid, deadline_override_at timestamptz, CONSTRAINT project_groups_pkey PRIMARY KEY(id), CONSTRAINT project_groups_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_groups_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_groups_dashboard_id_tenant_fk FOREIGN KEY(university_id,dashboard_id) REFERENCES public.project_dashboards(university_id,id) ON DELETE CASCADE, CONSTRAINT project_groups_ledger_fk FOREIGN KEY(university_id,dashboard_id,group_id) REFERENCES public.project_group_id_ledger(university_id,dashboard_id,group_id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS project_groups_tenant_created_idx ON public.project_groups(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_groups_creator_idx ON public.project_groups(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_groups_dashboard_idx ON public.project_groups(university_id,dashboard_id,status);
CREATE INDEX IF NOT EXISTS project_groups_group_id_idx ON public.project_groups(university_id,dashboard_id,group_id);
ALTER TABLE public.project_groups ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_groups FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_groups() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_groups_touch ON public.project_groups; CREATE TRIGGER project_groups_touch BEFORE UPDATE ON public.project_groups FOR EACH ROW EXECUTE FUNCTION private.touch_project_groups();

CREATE TABLE IF NOT EXISTS public.project_group_members(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, group_id uuid NOT NULL, profile_id uuid, name text NOT NULL, reg_no text NOT NULL, email text, member_role text NOT NULL DEFAULT 'member', responsibilities text NOT NULL DEFAULT '', position integer NOT NULL DEFAULT 0, CONSTRAINT project_group_members_pkey PRIMARY KEY(id), CONSTRAINT project_group_members_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_group_members_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_group_members_group_id_tenant_fk FOREIGN KEY(university_id,group_id) REFERENCES public.project_groups(university_id,id) ON DELETE CASCADE, CONSTRAINT project_group_members_profile_id_fk FOREIGN KEY(profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL);
CREATE UNIQUE INDEX IF NOT EXISTS project_group_members_reg_unique_idx ON public.project_group_members(university_id,group_id,lower(reg_no));
CREATE INDEX IF NOT EXISTS project_group_members_tenant_created_idx ON public.project_group_members(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_group_members_group_idx ON public.project_group_members(university_id,group_id,position);
CREATE INDEX IF NOT EXISTS project_group_members_profile_idx ON public.project_group_members(university_id,profile_id) WHERE profile_id IS NOT NULL;
ALTER TABLE public.project_group_members ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_group_members FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_group_members() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_group_members_touch ON public.project_group_members; CREATE TRIGGER project_group_members_touch BEFORE UPDATE ON public.project_group_members FOR EACH ROW EXECUTE FUNCTION private.touch_project_group_members();

-- Leader is a member pointer; declared after the members table exists.
ALTER TABLE public.project_groups DROP CONSTRAINT IF EXISTS project_groups_leader_member_tenant_fk;
ALTER TABLE public.project_groups ADD CONSTRAINT project_groups_leader_member_fk FOREIGN KEY(leader_member_id) REFERENCES public.project_group_members(id) ON DELETE SET NULL;

-- Pending add/remove member requests (require_member_change_approval flow).
CREATE TABLE IF NOT EXISTS public.project_member_requests(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, group_id uuid NOT NULL, request_type text NOT NULL CHECK(request_type IN ('add','remove')), payload jsonb NOT NULL, member_id uuid, requested_by uuid NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')), decided_by uuid, decided_at timestamptz, CONSTRAINT project_member_requests_pkey PRIMARY KEY(id), CONSTRAINT project_member_requests_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_member_requests_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_member_requests_group_id_tenant_fk FOREIGN KEY(university_id,group_id) REFERENCES public.project_groups(university_id,id) ON DELETE CASCADE, CONSTRAINT project_member_requests_member_id_fk FOREIGN KEY(member_id) REFERENCES public.project_group_members(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS project_member_requests_tenant_created_idx ON public.project_member_requests(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_member_requests_creator_idx ON public.project_member_requests(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_member_requests_group_idx ON public.project_member_requests(university_id,group_id,status);
ALTER TABLE public.project_member_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_member_requests FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_member_requests() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_member_requests_touch ON public.project_member_requests; CREATE TRIGGER project_member_requests_touch BEFORE UPDATE ON public.project_member_requests FOR EACH ROW EXECUTE FUNCTION private.touch_project_member_requests();

-- One row per submission version; fields_snapshot is the immutable form
-- definition captured at submit time (D-a).
CREATE TABLE IF NOT EXISTS public.project_submissions(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, group_id uuid NOT NULL, version integer NOT NULL CHECK(version >= 1), fields_snapshot jsonb NOT NULL, submitted_by uuid NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(), late boolean NOT NULL DEFAULT false, CONSTRAINT project_submissions_pkey PRIMARY KEY(id), CONSTRAINT project_submissions_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_submissions_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_submissions_group_id_tenant_fk FOREIGN KEY(university_id,group_id) REFERENCES public.project_groups(university_id,id) ON DELETE CASCADE, CONSTRAINT project_submissions_version_key UNIQUE(university_id,group_id,version));
CREATE INDEX IF NOT EXISTS project_submissions_tenant_created_idx ON public.project_submissions(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_submissions_creator_idx ON public.project_submissions(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_submissions_group_idx ON public.project_submissions(university_id,group_id,version DESC);
ALTER TABLE public.project_submissions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_submissions FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_submissions() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_submissions_touch ON public.project_submissions; CREATE TRIGGER project_submissions_touch BEFORE UPDATE ON public.project_submissions FOR EACH ROW EXECUTE FUNCTION private.touch_project_submissions();

CREATE TABLE IF NOT EXISTS public.project_submission_responses(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, submission_id uuid NOT NULL, field_id uuid NOT NULL, value text NOT NULL DEFAULT '', CONSTRAINT project_submission_responses_pkey PRIMARY KEY(id), CONSTRAINT project_submission_responses_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_submission_responses_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_submission_responses_submission_id_tenant_fk FOREIGN KEY(university_id,submission_id) REFERENCES public.project_submissions(university_id,id) ON DELETE CASCADE, CONSTRAINT project_submission_responses_field_id_tenant_fk FOREIGN KEY(university_id,field_id) REFERENCES public.project_dashboard_fields(university_id,id) ON DELETE RESTRICT, CONSTRAINT project_submission_responses_key UNIQUE(university_id,submission_id,field_id));
CREATE INDEX IF NOT EXISTS project_submission_responses_tenant_created_idx ON public.project_submission_responses(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_submission_responses_creator_idx ON public.project_submission_responses(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_submission_responses_submission_idx ON public.project_submission_responses(university_id,submission_id);
ALTER TABLE public.project_submission_responses ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_submission_responses FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_submission_responses() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_submission_responses_touch ON public.project_submission_responses; CREATE TRIGGER project_submission_responses_touch BEFORE UPDATE ON public.project_submission_responses FOR EACH ROW EXECUTE FUNCTION private.touch_project_submission_responses();

CREATE TABLE IF NOT EXISTS public.project_links(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, group_id uuid NOT NULL, title text NOT NULL, url text NOT NULL, description text NOT NULL DEFAULT '', CONSTRAINT project_links_pkey PRIMARY KEY(id), CONSTRAINT project_links_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_links_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_links_group_id_tenant_fk FOREIGN KEY(university_id,group_id) REFERENCES public.project_groups(university_id,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS project_links_tenant_created_idx ON public.project_links(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_links_creator_idx ON public.project_links(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_links_group_idx ON public.project_links(university_id,group_id);
ALTER TABLE public.project_links ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_links FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_links() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_links_touch ON public.project_links; CREATE TRIGGER project_links_touch BEFORE UPDATE ON public.project_links FOR EACH ROW EXECUTE FUNCTION private.touch_project_links();

-- Append-only review rows (public feedback AND private TA notes; D-b).
CREATE TABLE IF NOT EXISTS public.project_reviews(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, deleted_at timestamptz, dashboard_id uuid NOT NULL, group_id uuid NOT NULL, submission_id uuid, review_type text NOT NULL CHECK(review_type IN ('approve','reject','request_changes','general')), review_status text NOT NULL CHECK(review_status IN ('approved','rejected','revision_required','unchanged')), general_comments text NOT NULL DEFAULT '', approval_explanation text NOT NULL DEFAULT '', rejection_reason text NOT NULL DEFAULT '', required_changes text NOT NULL DEFAULT '', suggestions text NOT NULL DEFAULT '', visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')), reviewer_id uuid NOT NULL, reviewer_name text NOT NULL, is_edited boolean NOT NULL DEFAULT false, CONSTRAINT project_reviews_pkey PRIMARY KEY(id), CONSTRAINT project_reviews_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_reviews_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_reviews_dashboard_id_tenant_fk FOREIGN KEY(university_id,dashboard_id) REFERENCES public.project_dashboards(university_id,id) ON DELETE CASCADE, CONSTRAINT project_reviews_group_id_tenant_fk FOREIGN KEY(university_id,group_id) REFERENCES public.project_groups(university_id,id) ON DELETE CASCADE, CONSTRAINT project_reviews_submission_id_fk FOREIGN KEY(submission_id) REFERENCES public.project_submissions(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS project_reviews_tenant_created_idx ON public.project_reviews(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_reviews_creator_idx ON public.project_reviews(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_reviews_group_idx ON public.project_reviews(university_id,group_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_reviews_dashboard_idx ON public.project_reviews(university_id,dashboard_id);

-- v8: composite tenant FKs cannot use ON DELETE SET NULL — the tenant column is
-- NOT NULL, so nulling the pair fails with 23502 (fired when deleting a
-- submission referenced by reviews). The four optional-reference FKs become
-- single-column FKs on the nullable column. Swap is idempotent for both fresh
-- and existing databases.
ALTER TABLE public.project_group_members DROP CONSTRAINT IF EXISTS project_group_members_profile_id_tenant_fk;
ALTER TABLE public.project_group_members DROP CONSTRAINT IF EXISTS project_group_members_profile_id_fk;
ALTER TABLE public.project_group_members ADD CONSTRAINT project_group_members_profile_id_fk FOREIGN KEY(profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.project_groups DROP CONSTRAINT IF EXISTS project_groups_leader_member_tenant_fk;
ALTER TABLE public.project_groups DROP CONSTRAINT IF EXISTS project_groups_leader_member_fk;
ALTER TABLE public.project_groups ADD CONSTRAINT project_groups_leader_member_fk FOREIGN KEY(leader_member_id) REFERENCES public.project_group_members(id) ON DELETE SET NULL;
ALTER TABLE public.project_member_requests DROP CONSTRAINT IF EXISTS project_member_requests_member_id_tenant_fk;
ALTER TABLE public.project_member_requests DROP CONSTRAINT IF EXISTS project_member_requests_member_id_fk;
ALTER TABLE public.project_member_requests ADD CONSTRAINT project_member_requests_member_id_fk FOREIGN KEY(member_id) REFERENCES public.project_group_members(id) ON DELETE SET NULL;
ALTER TABLE public.project_reviews DROP CONSTRAINT IF EXISTS project_reviews_submission_id_tenant_fk;
ALTER TABLE public.project_reviews DROP CONSTRAINT IF EXISTS project_reviews_submission_id_fk;
ALTER TABLE public.project_reviews ADD CONSTRAINT project_reviews_submission_id_fk FOREIGN KEY(submission_id) REFERENCES public.project_submissions(id) ON DELETE SET NULL;

ALTER TABLE public.project_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_reviews FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_reviews() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_reviews_touch ON public.project_reviews; CREATE TRIGGER project_reviews_touch BEFORE UPDATE ON public.project_reviews FOR EACH ROW EXECUTE FUNCTION private.touch_project_reviews();

-- Append-only activity history (students see only student_visible rows of
-- their own group; TAs see everything on their dashboards).
CREATE TABLE IF NOT EXISTS public.project_activity_logs(id uuid NOT NULL DEFAULT gen_random_uuid(), university_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, dashboard_id uuid NOT NULL, group_id uuid, actor_id uuid NOT NULL, actor_role text NOT NULL, actor_name text NOT NULL, action text NOT NULL, entity_type text NOT NULL, entity_id uuid, entity_label text NOT NULL DEFAULT '', student_visible boolean NOT NULL DEFAULT true, prev_values jsonb, new_values jsonb, CONSTRAINT project_activity_logs_pkey PRIMARY KEY(id), CONSTRAINT project_activity_logs_tenant_id_key UNIQUE(university_id,id), CONSTRAINT project_activity_logs_university_fk FOREIGN KEY(university_id) REFERENCES public.universities(id) ON DELETE RESTRICT, CONSTRAINT project_activity_logs_dashboard_id_tenant_fk FOREIGN KEY(university_id,dashboard_id) REFERENCES public.project_dashboards(university_id,id) ON DELETE CASCADE, CONSTRAINT project_activity_logs_group_id_tenant_fk FOREIGN KEY(university_id,group_id) REFERENCES public.project_groups(university_id,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS project_activity_logs_tenant_created_idx ON public.project_activity_logs(university_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_activity_logs_creator_idx ON public.project_activity_logs(university_id,created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_activity_logs_dashboard_idx ON public.project_activity_logs(university_id,dashboard_id,created_at DESC);
CREATE INDEX IF NOT EXISTS project_activity_logs_group_idx ON public.project_activity_logs(university_id,group_id,created_at DESC) WHERE group_id IS NOT NULL;
ALTER TABLE public.project_activity_logs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.project_activity_logs FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION private.touch_project_activity_logs() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS project_activity_logs_touch ON public.project_activity_logs; CREATE TRIGGER project_activity_logs_touch BEFORE UPDATE ON public.project_activity_logs FOR EACH ROW EXECUTE FUNCTION private.touch_project_activity_logs();

-- NOTE (2026-11-11): the in-app project_notifications table was removed at the
-- owner's request — the platform has no notification engine yet, so this module
-- stays purely in-page (activity logs remain the user-facing history).

-- ============================================================================
-- SECTION 2: PRIVATE HELPERS (defined before the policies that call them)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- Registry-listed: enrollment in any active section of an offering.
CREATE OR REPLACE FUNCTION private.is_offering_enrolled(p_offering_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.enrollments e JOIN public.sections s ON s.id = e.section_id WHERE s.university_id IN (SELECT private.current_university_ids()) AND s.offering_id = p_offering_id AND e.profile_id = (SELECT id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())) AND e.status = 'active') $$;

-- Registry-listed: caller is a member of this project group.
CREATE OR REPLACE FUNCTION private.is_project_group_member(p_group_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.project_group_members m JOIN public.profiles p ON p.id = m.profile_id WHERE m.university_id IN (SELECT private.current_university_ids()) AND m.group_id = p_group_id AND p.auth_user_id = (SELECT auth.uid())) $$;

-- Resolves a group's owning dashboard for RLS on member/request/submission/link
-- rows (those tables carry group_id, not dashboard_id).
CREATE OR REPLACE FUNCTION private.project_group_dashboard_id(p_group_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT dashboard_id FROM public.project_groups WHERE id = p_group_id $$;

-- Registry-listed: students (enrolled) can read published/closed dashboards;
-- offering staff and platform admins read every status.
CREATE OR REPLACE FUNCTION private.project_dashboard_readable(p_dashboard_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.project_dashboards d WHERE d.id = p_dashboard_id AND d.deleted_at IS NULL AND ((d.status IN ('published','closed') AND (CASE WHEN d.section_id IS NOT NULL THEN private.is_enrolled(d.section_id) ELSE private.is_offering_enrolled(d.offering_id) END)) OR private.is_offering_staff(d.offering_id) OR private.is_platform_admin())) $$;

-- Registry-listed: offering staff / platform admin manage access.
CREATE OR REPLACE FUNCTION private.project_dashboard_manageable(p_dashboard_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT EXISTS(SELECT 1 FROM public.project_dashboards d WHERE d.id = p_dashboard_id AND d.deleted_at IS NULL AND (private.is_offering_staff(d.offering_id) OR private.is_platform_admin())) $$;

-- Caller profile snapshot (id, university, display name); NULL when unauthenticated.
CREATE OR REPLACE FUNCTION private.project_actor() RETURNS public.profiles LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile public.profiles;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()) AND deleted_at IS NULL LIMIT 1;
  RETURN v_profile;
END $$;

-- ============================================================================
-- SECTION 3: RLS POLICIES
-- ============================================================================

-- project_dashboards ---------------------------------------------------------
DROP POLICY IF EXISTS project_dashboards_read ON public.project_dashboards;
CREATE POLICY project_dashboards_read ON public.project_dashboards FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_readable(id));
DROP POLICY IF EXISTS project_dashboards_manage ON public.project_dashboards;
CREATE POLICY project_dashboards_manage ON public.project_dashboards FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(id)) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND (private.is_platform_admin() OR private.is_offering_staff(offering_id)));
REVOKE ALL ON public.project_dashboards FROM anon;

-- project_dashboard_fields ---------------------------------------------------
DROP POLICY IF EXISTS project_dashboard_fields_read ON public.project_dashboard_fields;
CREATE POLICY project_dashboard_fields_read ON public.project_dashboard_fields FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_readable(dashboard_id));
DROP POLICY IF EXISTS project_dashboard_fields_manage ON public.project_dashboard_fields;
CREATE POLICY project_dashboard_fields_manage ON public.project_dashboard_fields FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id)) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id));
REVOKE ALL ON public.project_dashboard_fields FROM anon;

-- project_group_id_ledger (staff read only; writes via RPC) -------------------
DROP POLICY IF EXISTS project_group_id_ledger_read ON public.project_group_id_ledger;
CREATE POLICY project_group_id_ledger_read ON public.project_group_id_ledger FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id));
REVOKE ALL ON public.project_group_id_ledger FROM anon;

-- project_groups --------------------------------------------------------------
DROP POLICY IF EXISTS project_groups_read ON public.project_groups;
CREATE POLICY project_groups_read ON public.project_groups FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND (private.project_dashboard_manageable(dashboard_id) OR (private.project_dashboard_readable(dashboard_id) AND private.is_project_group_member(id) AND deleted_at IS NULL AND archived_at IS NULL)));
DROP POLICY IF EXISTS project_groups_manage ON public.project_groups;
CREATE POLICY project_groups_manage ON public.project_groups FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id)) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id));
REVOKE ALL ON public.project_groups FROM anon;

-- project_group_members -------------------------------------------------------
DROP POLICY IF EXISTS project_group_members_read ON public.project_group_members;
CREATE POLICY project_group_members_read ON public.project_group_members FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND (private.project_dashboard_manageable(private.project_group_dashboard_id(group_id)) OR private.is_project_group_member(group_id)));
DROP POLICY IF EXISTS project_group_members_manage ON public.project_group_members;
CREATE POLICY project_group_members_manage ON public.project_group_members FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(private.project_group_dashboard_id(group_id))) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(private.project_group_dashboard_id(group_id)));
REVOKE ALL ON public.project_group_members FROM anon;

-- project_member_requests -----------------------------------------------------
DROP POLICY IF EXISTS project_member_requests_read ON public.project_member_requests;
CREATE POLICY project_member_requests_read ON public.project_member_requests FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND (private.project_dashboard_manageable(private.project_group_dashboard_id(group_id)) OR private.is_project_group_member(group_id)));
DROP POLICY IF EXISTS project_member_requests_manage ON public.project_member_requests;
CREATE POLICY project_member_requests_manage ON public.project_member_requests FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(private.project_group_dashboard_id(group_id))) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(private.project_group_dashboard_id(group_id)));
REVOKE ALL ON public.project_member_requests FROM anon;

-- project_submissions ---------------------------------------------------------
DROP POLICY IF EXISTS project_submissions_read ON public.project_submissions;
CREATE POLICY project_submissions_read ON public.project_submissions FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND (private.project_dashboard_manageable(private.project_group_dashboard_id(group_id)) OR (private.project_dashboard_readable(private.project_group_dashboard_id(group_id)) AND private.is_project_group_member(group_id))));
DROP POLICY IF EXISTS project_submissions_manage ON public.project_submissions;
CREATE POLICY project_submissions_manage ON public.project_submissions FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(private.project_group_dashboard_id(group_id))) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(private.project_group_dashboard_id(group_id)));
REVOKE ALL ON public.project_submissions FROM anon;

-- project_submission_responses ------------------------------------------------
DROP POLICY IF EXISTS project_submission_responses_read ON public.project_submission_responses;
CREATE POLICY project_submission_responses_read ON public.project_submission_responses FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND (private.project_dashboard_manageable((SELECT dashboard_id FROM public.project_submissions s JOIN public.project_groups g ON g.id = s.group_id WHERE s.id = submission_id)) OR (private.project_dashboard_readable((SELECT dashboard_id FROM public.project_submissions s JOIN public.project_groups g ON g.id = s.group_id WHERE s.id = submission_id)) AND private.is_project_group_member((SELECT group_id FROM public.project_submissions s WHERE s.id = submission_id)))));
DROP POLICY IF EXISTS project_submission_responses_manage ON public.project_submission_responses;
CREATE POLICY project_submission_responses_manage ON public.project_submission_responses FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable((SELECT dashboard_id FROM public.project_submissions s JOIN public.project_groups g ON g.id = s.group_id WHERE s.id = submission_id))) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable((SELECT dashboard_id FROM public.project_submissions s JOIN public.project_groups g ON g.id = s.group_id WHERE s.id = submission_id)));
REVOKE ALL ON public.project_submission_responses FROM anon;

-- project_links ---------------------------------------------------------------
DROP POLICY IF EXISTS project_links_read ON public.project_links;
CREATE POLICY project_links_read ON public.project_links FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND (private.project_dashboard_manageable(private.project_group_dashboard_id(group_id)) OR (private.project_dashboard_readable(private.project_group_dashboard_id(group_id)) AND private.is_project_group_member(group_id))));
DROP POLICY IF EXISTS project_links_manage ON public.project_links;
CREATE POLICY project_links_manage ON public.project_links FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(private.project_group_dashboard_id(group_id))) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(private.project_group_dashboard_id(group_id)));
REVOKE ALL ON public.project_links FROM anon;

-- project_reviews (private notes never visible to students) -------------------
DROP POLICY IF EXISTS project_reviews_read ON public.project_reviews;
CREATE POLICY project_reviews_read ON public.project_reviews FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND (private.project_dashboard_manageable(dashboard_id) OR (visibility = 'public' AND deleted_at IS NULL AND private.project_dashboard_readable(dashboard_id) AND private.is_project_group_member(group_id))));
DROP POLICY IF EXISTS project_reviews_manage ON public.project_reviews;
CREATE POLICY project_reviews_manage ON public.project_reviews FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id)) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id));
REVOKE ALL ON public.project_reviews FROM anon;

-- project_activity_logs (append-only: no UPDATE/DELETE for clients) -----------
DROP POLICY IF EXISTS project_activity_logs_read ON public.project_activity_logs;
CREATE POLICY project_activity_logs_read ON public.project_activity_logs FOR SELECT TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND (private.project_dashboard_manageable(dashboard_id) OR (student_visible AND group_id IS NOT NULL AND private.project_dashboard_readable(dashboard_id) AND private.is_project_group_member(group_id))));
REVOKE UPDATE,DELETE ON public.project_activity_logs FROM anon,authenticated;
DROP POLICY IF EXISTS project_activity_logs_manage ON public.project_activity_logs;
CREATE POLICY project_activity_logs_manage ON public.project_activity_logs FOR ALL TO authenticated USING (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id)) WITH CHECK (university_id IN (SELECT private.current_university_ids()) AND private.project_dashboard_manageable(dashboard_id));
REVOKE ALL ON public.project_activity_logs FROM anon;

-- ============================================================================
-- SECTION 4: PERMISSIONS (registry delta: projects.manage / projects.submit_own)
-- ============================================================================

INSERT INTO public.permissions (university_id, key, description)
SELECT u.id, p.key, p.description
FROM public.universities u
CROSS JOIN (VALUES
  ('projects.manage', 'Create and manage project dashboards, groups and reviews'),
  ('projects.submit_own', 'Create own project group and submit project details')
) AS p(key, description)
WHERE NOT EXISTS (SELECT 1 FROM public.permissions pe WHERE pe.key = p.key);

INSERT INTO public.role_permissions (university_id, role_id, permission_id)
SELECT u.id, r.id, p.id
FROM public.universities u
JOIN public.roles r ON r.university_id = u.id
JOIN public.permissions p ON p.university_id = u.id
JOIN (VALUES
  ('ta', 'projects.manage'),
  ('teacher', 'projects.manage'),
  ('student', 'projects.submit_own')
) AS m(role_name, perm_key)
  ON m.role_name = r.name AND m.perm_key = p.key
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp
  WHERE rp.university_id = u.id AND rp.role_id = r.id AND rp.permission_id = p.id
);

-- ============================================================================
-- SECTION 5: PRIVATE RPCs (SECURITY DEFINER, empty search_path, stable codes)
-- ============================================================================

-- Shared activity writer (append-only table).
CREATE OR REPLACE FUNCTION private.project_log(p_university_id uuid, p_dashboard_id uuid, p_group_id uuid, p_actor_id uuid, p_actor_role text, p_actor_name text, p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text, p_student_visible boolean, p_prev jsonb, p_new jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ INSERT INTO public.project_activity_logs(university_id, dashboard_id, group_id, actor_id, actor_role, actor_name, action, entity_type, entity_id, entity_label, student_visible, prev_values, new_values) VALUES (p_university_id, p_dashboard_id, p_group_id, p_actor_id, p_actor_role, p_actor_name, p_action, p_entity_type, p_entity_id, p_entity_label, p_student_visible, p_prev, p_new) $$;

-- Computes the next sequential Group ID candidate without writing anything
-- (pure; used for the TA's before-create preview).
CREATE OR REPLACE FUNCTION private.project_next_group_id_candidate(p_university_id uuid, p_dashboard_id uuid, p_prefix text, p_seq integer) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_candidate text; v_seq integer := GREATEST(p_seq, 1);
BEGIN
  LOOP
    v_candidate := p_prefix || '_' || CASE WHEN v_seq < 100 THEN lpad(v_seq::text, 2, '0') ELSE v_seq::text END;
    EXIT WHEN NOT EXISTS(SELECT 1 FROM public.project_group_id_ledger l WHERE l.university_id = p_university_id AND l.dashboard_id = p_dashboard_id AND l.group_id = v_candidate);
    v_seq := v_seq + 1;
  END LOOP;
  RETURN v_candidate;
END $$;

-- Consuming variant: computes the candidate then persists the counter. The
-- caller MUST hold a row lock on the dashboard (FOR UPDATE) so concurrent
-- creations serialize; group_id_seq only ever increases, so deleted/archived
-- IDs are never reused.
CREATE OR REPLACE FUNCTION private.project_generate_group_id(p_university_id uuid, p_dashboard_id uuid, p_prefix text, p_seq integer) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_candidate text;
BEGIN
  v_candidate := private.project_next_group_id_candidate(p_university_id, p_dashboard_id, p_prefix, p_seq);
  UPDATE public.project_dashboards
  SET group_id_seq = GREATEST(
    (SELECT group_id_seq FROM public.project_dashboards WHERE id = p_dashboard_id),
    substring(v_candidate from char_length(p_prefix) + 2)::integer
  )
  WHERE id = p_dashboard_id;
  RETURN v_candidate;
END $$;

-- Registry-listed: next Group ID preview (pure read; inserts and consumes nothing).
CREATE OR REPLACE FUNCTION private.next_project_group_id(p_dashboard_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF btrim(v_dash.group_id_prefix) = '' THEN RAISE EXCEPTION 'prefix_required'; END IF;
  RETURN private.project_next_group_id_candidate(v_dash.university_id, v_dash.id, v_dash.group_id_prefix, v_dash.group_id_seq + 1);
END $$;

-- Resolves a registration number / email to a profile in the tenant (NULL when
-- unknown; callers turn that into student_not_found). Follows the university's
-- FAST roll-number rule (same transforms as the enrollment import, D-e).
CREATE OR REPLACE FUNCTION private.project_resolve_member(p_university_id uuid, p_input text) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_raw text := lower(btrim(coalesce(p_input, ''))); v_norm text; v_local text := ''; v_alt text := '';
BEGIN
  IF v_raw = '' THEN RETURN NULL; END IF;
  IF position('@' in v_raw) > 0 THEN
    RETURN (SELECT id FROM public.profiles WHERE university_id = p_university_id AND deleted_at IS NULL AND lower(email) = v_raw LIMIT 1);
  END IF;
  v_norm := regexp_replace(v_raw, '[^a-z0-9]', '', 'g');
  IF v_norm = '' OR length(v_norm) > 40 THEN RETURN NULL; END IF;
  IF v_norm ~ '^[a-z][0-9]{4,}$' THEN
    v_local := v_norm;
  ELSIF v_norm ~ '^[0-9]{2}[a-z][0-9]{2,}$' THEN
    v_local := substring(v_norm from 3 for 1) || substring(v_norm from 1 for 2) || substring(v_norm from 4);
  ELSE
    RETURN NULL;
  END IF;
  IF length(v_local) >= 4 AND length(v_local) < 7 THEN
    v_alt := substring(v_local from 1 for 3) || lpad(substring(v_local from 4), 4, '0');
  END IF;
  RETURN (SELECT id FROM public.profiles WHERE university_id = p_university_id AND deleted_at IS NULL
    AND (regexp_replace(lower(coalesce(roll_no, '')), '[^a-z0-9]', '', 'g') = v_norm
      OR split_part(lower(email), '@', 1) IN (v_local, NULLIF(v_alt, '')))
    LIMIT 1);
END $$;

-- Validates + resolves a members payload (D-b JSONB input snapshot). Raises
-- stable codes; returns resolved rows ordered as provided.
CREATE OR REPLACE FUNCTION private.project_validate_members(p_university_id uuid, p_offering_id uuid, p_section_id uuid, p_group_id uuid, p_members jsonb, p_max_size integer) RETURNS TABLE(profile_id uuid, member_name text, member_reg_no text, member_email text, member_role text, member_resp text, member_pos integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item jsonb; v_count integer := 0; v_seen text[] := '{}'; v_norm text; v_pid uuid; v_profile public.profiles; v_name text; v_reg text; v_role text; v_resp text;
BEGIN
  IF p_members IS NULL OR jsonb_typeof(p_members) <> 'array' OR jsonb_array_length(p_members) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF jsonb_array_length(p_members) > p_max_size THEN RAISE EXCEPTION 'group_full'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_members) LOOP
    v_count := v_count + 1;
    IF v_count > 50 THEN RAISE EXCEPTION 'group_full'; END IF;
    v_name := left(btrim(coalesce(v_item ->> 'name', '')), 120);
    v_reg := left(btrim(coalesce(v_item ->> 'reg_no', v_item ->> 'regNo', '')), 40);
    v_role := left(btrim(coalesce(v_item ->> 'member_role', v_item ->> 'memberRole', 'member')), 80);
    v_resp := left(btrim(coalesce(v_item ->> 'responsibilities', '')), 500);
    IF v_name = '' OR v_reg = '' THEN RAISE EXCEPTION 'invalid_input'; END IF;
    v_norm := regexp_replace(lower(v_reg), '[^a-z0-9]', '', 'g');
    IF v_norm = ANY (v_seen) THEN RAISE EXCEPTION 'duplicate_member'; END IF;
    v_seen := array_append(v_seen, v_norm);
    v_pid := private.project_resolve_member(p_university_id, v_reg);
    IF v_pid IS NULL THEN RAISE EXCEPTION 'student_not_found'; END IF;
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_pid;
    IF NOT EXISTS(
      SELECT 1 FROM public.enrollments e JOIN public.sections s ON s.id = e.section_id
      WHERE s.university_id = p_university_id AND s.offering_id = p_offering_id
        AND (p_section_id IS NULL OR s.id = p_section_id)
        AND e.profile_id = v_pid AND e.status = 'active'
    ) THEN RAISE EXCEPTION 'student_not_enrolled'; END IF;
    IF EXISTS(
      SELECT 1 FROM public.project_group_members m
      JOIN public.project_groups g ON g.id = m.group_id AND g.university_id = m.university_id
      JOIN public.project_dashboards d ON d.id = g.dashboard_id AND d.university_id = g.university_id
      WHERE d.university_id = p_university_id AND d.offering_id = p_offering_id
        AND g.deleted_at IS NULL AND g.archived_at IS NULL
        AND (p_group_id IS NULL OR g.id <> p_group_id)
        AND m.profile_id = v_pid
    ) THEN RAISE EXCEPTION 'student_in_group'; END IF;
    profile_id := v_pid;
    member_name := coalesce(nullif(btrim(coalesce(v_profile.display_name, '')), ''), v_name);
    member_reg_no := v_reg;
    member_email := v_profile.email;
    member_role := v_role;
    member_resp := v_resp;
    member_pos := v_count - 1;
    RETURN NEXT;
  END LOOP;
END $$;

-- Tenant + offering sanity for dashboard configs.
CREATE OR REPLACE FUNCTION private.project_assert_offering(p_university_id uuid, p_offering_id uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.course_offerings o WHERE o.university_id = p_university_id AND o.id = p_offering_id) THEN RAISE EXCEPTION 'not_found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.create_project_dashboard(p_university_id uuid, p_offering_id uuid, p_section_id uuid, p_title text, p_description text, p_instructions text, p_opens_at timestamptz, p_deadline_at timestamptz, p_late_allowed boolean, p_allow_edit_after_submission boolean, p_allow_member_changes_after_submission boolean, p_require_member_change_approval boolean, p_allow_individual boolean, p_allow_student_groups boolean, p_min_members integer, p_max_members integer, p_group_id_prefix text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_id uuid; v_prefix text := left(btrim(coalesce(p_group_id_prefix, '')), 32);
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_university_id IS NULL OR p_university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (private.is_platform_admin() OR private.is_offering_staff(p_offering_id)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_offerings o WHERE o.university_id = p_university_id AND o.id = p_offering_id) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sections s WHERE s.university_id = p_university_id AND s.id = p_section_id AND s.offering_id = p_offering_id) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF btrim(coalesce(p_title, '')) = '' OR char_length(btrim(p_title)) > 160 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_min_members IS NULL OR p_max_members IS NULL OR p_min_members < 1 OR p_max_members < 1 OR p_max_members < p_min_members OR p_min_members > 99 OR p_max_members > 99 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF v_prefix <> '' AND v_prefix !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_opens_at IS NOT NULL AND p_deadline_at IS NOT NULL AND p_deadline_at < p_opens_at THEN RAISE EXCEPTION 'invalid_input'; END IF;

  INSERT INTO public.project_dashboards(university_id, created_by, offering_id, section_id, title, description, instructions, opens_at, deadline_at, late_allowed, allow_edit_after_submission, allow_member_changes_after_submission, require_member_change_approval, allow_individual, allow_student_groups, min_members, max_members, group_id_prefix)
  VALUES (p_university_id, v_actor.id, p_offering_id, p_section_id, btrim(p_title), left(coalesce(p_description, ''), 4000), left(coalesce(p_instructions, ''), 4000), p_opens_at, p_deadline_at, coalesce(p_late_allowed, false), coalesce(p_allow_edit_after_submission, false), coalesce(p_allow_member_changes_after_submission, false), coalesce(p_require_member_change_approval, false), coalesce(p_allow_individual, false), coalesce(p_allow_student_groups, true), p_min_members, p_max_members, v_prefix)
  RETURNING id INTO v_id;

  INSERT INTO public.project_dashboard_fields(university_id, created_by, dashboard_id, position, label, description, field_type, required, placeholder, options, is_system, kind)
  VALUES
    (p_university_id, v_actor.id, v_id, 0, 'Project Title', 'The official title of your project.', 'short_text', true, 'e.g. Smart Attendance System', '{}', true, 'project_title'),
    (p_university_id, v_actor.id, v_id, 1, 'Project Idea / Description', 'Describe the project idea in your own words.', 'long_text', true, 'What does your project do, and why is it useful?', '{}', true, 'project_idea'),
    (p_university_id, v_actor.id, v_id, 2, 'Problem Statement', 'The specific problem your project addresses.', 'long_text', false, 'What problem are you solving?', '{}', true, 'problem_statement'),
    (p_university_id, v_actor.id, v_id, 3, 'Proposed Solution', 'How your project solves the problem.', 'long_text', false, 'Summarize your approach or architecture.', '{}', true, 'proposed_solution');

  PERFORM private.project_log(p_university_id, v_id, NULL, v_actor.id, 'ta', v_actor.display_name, 'project.dashboard.created', 'dashboard', v_id, btrim(p_title), false, NULL, jsonb_build_object('title', btrim(p_title), 'status', 'draft'));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.update_project_dashboard(p_dashboard_id uuid, p_title text, p_description text, p_instructions text, p_late_allowed boolean, p_allow_edit_after_submission boolean, p_allow_member_changes_after_submission boolean, p_require_member_change_approval boolean, p_allow_individual boolean, p_allow_student_groups boolean, p_min_members integer, p_max_members integer, p_group_id_prefix text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards; v_prefix text := left(btrim(coalesce(p_group_id_prefix, '')), 32);
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF btrim(coalesce(p_title, '')) = '' OR char_length(btrim(p_title)) > 160 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_min_members IS NULL OR p_max_members IS NULL OR p_min_members < 1 OR p_max_members < 1 OR p_max_members < p_min_members OR p_min_members > 99 OR p_max_members > 99 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF v_prefix <> '' AND v_prefix !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' THEN RAISE EXCEPTION 'invalid_input'; END IF;

  UPDATE public.project_dashboards SET
    title = btrim(p_title), description = left(coalesce(p_description, ''), 4000), instructions = left(coalesce(p_instructions, ''), 4000),
    late_allowed = coalesce(p_late_allowed, late_allowed), allow_edit_after_submission = coalesce(p_allow_edit_after_submission, allow_edit_after_submission),
    allow_member_changes_after_submission = coalesce(p_allow_member_changes_after_submission, allow_member_changes_after_submission),
    require_member_change_approval = coalesce(p_require_member_change_approval, require_member_change_approval),
    allow_individual = coalesce(p_allow_individual, allow_individual), allow_student_groups = coalesce(p_allow_student_groups, allow_student_groups),
    min_members = p_min_members, max_members = p_max_members, group_id_prefix = v_prefix
  WHERE id = v_dash.id;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, NULL, v_actor.id, 'ta', v_actor.display_name, 'project.dashboard.updated', 'dashboard', v_dash.id, btrim(p_title), false,
    jsonb_build_object('title', v_dash.title, 'min_members', v_dash.min_members, 'max_members', v_dash.max_members, 'group_id_prefix', v_dash.group_id_prefix, 'late_allowed', v_dash.late_allowed, 'allow_edit_after_submission', v_dash.allow_edit_after_submission, 'allow_member_changes_after_submission', v_dash.allow_member_changes_after_submission, 'require_member_change_approval', v_dash.require_member_change_approval, 'allow_individual', v_dash.allow_individual, 'allow_student_groups', v_dash.allow_student_groups),
    jsonb_build_object('title', btrim(p_title), 'min_members', p_min_members, 'max_members', p_max_members, 'group_id_prefix', v_prefix, 'late_allowed', coalesce(p_late_allowed, v_dash.late_allowed), 'allow_edit_after_submission', coalesce(p_allow_edit_after_submission, v_dash.allow_edit_after_submission), 'allow_member_changes_after_submission', coalesce(p_allow_member_changes_after_submission, v_dash.allow_member_changes_after_submission), 'require_member_change_approval', coalesce(p_require_member_change_approval, v_dash.require_member_change_approval), 'allow_individual', coalesce(p_allow_individual, v_dash.allow_individual), 'allow_student_groups', coalesce(p_allow_student_groups, v_dash.allow_student_groups)));
END $$;

CREATE OR REPLACE FUNCTION private.set_project_dashboard_status(p_dashboard_id uuid, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status NOT IN ('draft','published','closed','archived') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF NOT (
    (v_dash.status = 'draft' AND p_status IN ('published','archived')) OR
    (v_dash.status = 'published' AND p_status IN ('draft','closed','archived')) OR
    (v_dash.status = 'closed' AND p_status IN ('published','archived')) OR
    (v_dash.status = 'archived' AND p_status = 'published')
  ) THEN RAISE EXCEPTION 'invalid_status'; END IF;

  UPDATE public.project_dashboards SET status = p_status WHERE id = v_dash.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, NULL, v_actor.id, 'ta', v_actor.display_name, 'project.dashboard.status', 'dashboard', v_dash.id, v_dash.title, false, jsonb_build_object('status', v_dash.status), jsonb_build_object('status', p_status));
END $$;

CREATE OR REPLACE FUNCTION private.set_project_deadline(p_dashboard_id uuid, p_opens_at timestamptz, p_deadline_at timestamptz, p_late_allowed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_opens_at IS NOT NULL AND p_deadline_at IS NOT NULL AND p_deadline_at < p_opens_at THEN RAISE EXCEPTION 'invalid_input'; END IF;

  UPDATE public.project_dashboards SET opens_at = p_opens_at, deadline_at = p_deadline_at, late_allowed = coalesce(p_late_allowed, late_allowed) WHERE id = v_dash.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, NULL, v_actor.id, 'ta', v_actor.display_name, 'project.deadline.changed', 'dashboard', v_dash.id, v_dash.title, true,
    jsonb_build_object('opens_at', v_dash.opens_at, 'deadline_at', v_dash.deadline_at, 'late_allowed', v_dash.late_allowed),
    jsonb_build_object('opens_at', p_opens_at, 'deadline_at', p_deadline_at, 'late_allowed', coalesce(p_late_allowed, v_dash.late_allowed)));
END $$;

CREATE OR REPLACE FUNCTION private.duplicate_project_dashboard(p_dashboard_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards; v_new uuid; v_field record;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;

  INSERT INTO public.project_dashboards(university_id, created_by, offering_id, section_id, title, description, instructions, status, opens_at, deadline_at, late_allowed, allow_edit_after_submission, allow_member_changes_after_submission, require_member_change_approval, allow_individual, allow_student_groups, min_members, max_members, group_id_prefix, group_id_seq)
  VALUES (v_dash.university_id, v_actor.id, v_dash.offering_id, v_dash.section_id,
    left(v_dash.title || ' (copy)', 160), v_dash.description, v_dash.instructions, 'draft', v_dash.opens_at, v_dash.deadline_at, v_dash.late_allowed,
    v_dash.allow_edit_after_submission, v_dash.allow_member_changes_after_submission, v_dash.require_member_change_approval,
    v_dash.allow_individual, v_dash.allow_student_groups, v_dash.min_members, v_dash.max_members, v_dash.group_id_prefix, 0)
  RETURNING id INTO v_new;

  -- Settings + custom fields copied; groups, submissions, reviews and activity
  -- records are never copied.
  INSERT INTO public.project_dashboard_fields(university_id, created_by, dashboard_id, position, label, description, field_type, required, placeholder, options, is_system, kind, enabled)
  SELECT v_dash.university_id, v_actor.id, v_new, f.position, f.label, f.description, f.field_type, f.required, f.placeholder, f.options, f.is_system, f.kind, f.enabled
  FROM public.project_dashboard_fields f WHERE f.university_id = v_dash.university_id AND f.dashboard_id = v_dash.id AND f.deleted_at IS NULL;

  PERFORM private.project_log(v_dash.university_id, v_new, NULL, v_actor.id, 'ta', v_actor.display_name, 'project.dashboard.duplicated', 'dashboard', v_new, left(v_dash.title || ' (copy)', 160), false, NULL, jsonb_build_object('source_dashboard_id', v_dash.id));
  RETURN v_new;
END $$;

-- Hard delete with confirmation on the client. Module activity rows cascade
-- with the dashboard; a platform audit_log row preserves the deletion record.
CREATE OR REPLACE FUNCTION private.delete_project_dashboard(p_dashboard_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards; v_groups integer;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*) INTO v_groups FROM public.project_groups WHERE university_id = v_dash.university_id AND dashboard_id = v_dash.id;
  INSERT INTO public.audit_log(university_id, created_by, actor_id, event_type, target_type, target_id, payload)
  VALUES (v_dash.university_id, v_actor.id, v_actor.id, 'project.dashboard.deleted', 'project_dashboard', v_dash.id, jsonb_build_object('title', v_dash.title, 'groups', v_groups));
  DELETE FROM public.project_dashboards WHERE id = v_dash.id;
END $$;

-- ============================================================================
-- SECTION 5b: GROUPS, MEMBERS, REQUESTS, SUBMISSIONS
-- ============================================================================

-- Group creation. Staff create anywhere on their dashboards; students create
-- only on published dashboards with allow_student_groups, must be enrolled,
-- must be the first (leader) member and must not already belong to a group in
-- the same offering. Holds the dashboard row lock during ID issuance.
CREATE OR REPLACE FUNCTION private.create_project_group(p_dashboard_id uuid, p_group_id text, p_project_title text, p_members jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_dash public.project_dashboards; v_group_id text; v_new uuid; v_seq integer; v_first uuid; v_is_staff boolean; v_resolved record; v_pos integer := 0;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = p_dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_is_staff := private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id));

  IF NOT v_is_staff THEN
    IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_dash.status <> 'published' THEN RAISE EXCEPTION 'not_published'; END IF;
    IF NOT v_dash.allow_student_groups THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF (CASE WHEN v_dash.section_id IS NOT NULL THEN private.is_enrolled(v_dash.section_id) ELSE private.is_offering_enrolled(v_dash.offering_id) END) = false THEN RAISE EXCEPTION 'student_not_enrolled'; END IF;
    IF EXISTS(
      SELECT 1 FROM public.project_group_members m
      JOIN public.project_groups g ON g.id = m.group_id AND g.university_id = m.university_id
      JOIN public.project_dashboards d ON d.id = g.dashboard_id AND d.university_id = g.university_id
      WHERE d.university_id = v_dash.university_id AND d.offering_id = v_dash.offering_id
        AND g.deleted_at IS NULL AND g.archived_at IS NULL AND m.profile_id = v_actor.id
    ) THEN RAISE EXCEPTION 'student_in_group'; END IF;
  END IF;

  IF btrim(coalesce(p_project_title, '')) = '' OR char_length(btrim(p_project_title)) > 160 THEN RAISE EXCEPTION 'invalid_input'; END IF;

  -- Group ID: TA-supplied (staff only) or transactional sequential generation.
  IF coalesce(btrim(p_group_id, ''), '') <> '' THEN
    IF NOT v_is_staff THEN RAISE EXCEPTION 'forbidden'; END IF;
    v_group_id := left(btrim(p_group_id), 40);
    IF v_group_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' THEN RAISE EXCEPTION 'invalid_input'; END IF;
    IF EXISTS(SELECT 1 FROM public.project_group_id_ledger l WHERE l.university_id = v_dash.university_id AND l.dashboard_id = v_dash.id AND l.group_id = v_group_id) THEN RAISE EXCEPTION 'duplicate_group_id'; END IF;
  ELSE
    IF btrim(v_dash.group_id_prefix) = '' THEN RAISE EXCEPTION 'prefix_required'; END IF;
    v_group_id := private.project_generate_group_id(v_dash.university_id, v_dash.id, v_dash.group_id_prefix, v_dash.group_id_seq + 1);
  END IF;

  -- Resolve + validate members against size cap, enrollment and other groups.
  FOR v_resolved IN SELECT * FROM private.project_validate_members(v_dash.university_id, v_dash.offering_id, v_dash.section_id, NULL, p_members, v_dash.max_members) ORDER BY member_pos LOOP
    IF v_pos = 0 THEN v_first := v_resolved.profile_id; END IF;
    v_pos := v_pos + 1;
  END LOOP;
  IF v_pos = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF NOT v_is_staff AND v_first <> v_actor.id THEN RAISE EXCEPTION 'not_leader'; END IF;

  INSERT INTO public.project_group_id_ledger(university_id, created_by, dashboard_id, group_id) VALUES (v_dash.university_id, v_actor.id, v_dash.id, v_group_id);
  INSERT INTO public.project_groups(university_id, created_by, dashboard_id, group_id, project_title) VALUES (v_dash.university_id, v_actor.id, v_dash.id, v_group_id, btrim(p_project_title)) RETURNING id INTO v_new;

  INSERT INTO public.project_group_members(university_id, created_by, group_id, profile_id, name, reg_no, email, member_role, responsibilities, position)
  SELECT v_dash.university_id, v_actor.id, v_new, r.profile_id, r.member_name, r.member_reg_no, r.member_email, r.member_role, r.member_resp, r.member_pos
  FROM private.project_validate_members(v_dash.university_id, v_dash.offering_id, v_dash.section_id, NULL, p_members, v_dash.max_members) r ORDER BY r.member_pos;

  UPDATE public.project_groups SET leader_member_id = (SELECT m.id FROM public.project_group_members m WHERE m.university_id = v_dash.university_id AND m.group_id = v_new AND m.profile_id = v_first) WHERE id = v_new;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_new, v_actor.id, CASE WHEN v_is_staff THEN 'ta' ELSE 'student' END, v_actor.display_name, 'project.group.created', 'group', v_new, v_group_id, true, NULL, jsonb_build_object('group_id', v_group_id, 'title', btrim(p_project_title), 'members', v_pos));
  RETURN v_new;
END $$;

-- Group settings edit (staff). Changing the Group ID is explicit and separate:
-- the ledger keeps the old ID permanently (never reused) and the new ID must
-- be unique within the dashboard.
CREATE OR REPLACE FUNCTION private.update_project_group(p_group_id uuid, p_project_title text, p_group_label text, p_deadline_override_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF btrim(coalesce(p_project_title, '')) = '' OR char_length(btrim(p_project_title)) > 160 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_group_label IS NOT NULL AND (btrim(p_group_label) = '' OR char_length(btrim(p_group_label)) > 40 OR btrim(p_group_label) !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$') THEN RAISE EXCEPTION 'invalid_input'; END IF;

  -- Group ID edit is explicit: the new ID must be unique in the dashboard and
  -- the old ID stays in the ledger forever (released, never reused).
  IF btrim(p_group_label) <> '' AND btrim(p_group_label) <> v_group.group_id THEN
    IF EXISTS(SELECT 1 FROM public.project_group_id_ledger l WHERE l.university_id = v_group.university_id AND l.dashboard_id = v_group.dashboard_id AND l.group_id = btrim(p_group_label)) THEN RAISE EXCEPTION 'duplicate_group_id'; END IF;
    INSERT INTO public.project_group_id_ledger(university_id, created_by, dashboard_id, group_id) VALUES (v_group.university_id, v_actor.id, v_group.dashboard_id, btrim(p_group_label));
    UPDATE public.project_group_id_ledger SET released_at = now() WHERE university_id = v_group.university_id AND dashboard_id = v_group.dashboard_id AND group_id = v_group.group_id;
    UPDATE public.project_groups SET group_id = btrim(p_group_label) WHERE id = v_group.id;
  END IF;

  UPDATE public.project_groups SET project_title = btrim(p_project_title), deadline_override_at = p_deadline_override_at WHERE id = v_group.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'ta', v_actor.display_name, 'project.group.updated', 'group', v_group.id, btrim(coalesce(nullif(btrim(p_group_label), ''), v_group.group_id)), true,
    jsonb_build_object('project_title', v_group.project_title, 'group_id', v_group.group_id, 'deadline_override_at', v_group.deadline_override_at),
    jsonb_build_object('project_title', btrim(p_project_title), 'group_id', btrim(coalesce(nullif(btrim(p_group_label), ''), v_group.group_id)), 'deadline_override_at', p_deadline_override_at));
END $$;

-- Whether the caller (student leader) may mutate group content right now.
CREATE OR REPLACE FUNCTION private.project_student_content_allowed(p_group public.project_groups, p_dash public.project_dashboards) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT p_dash.status = 'published' AND p_group.deleted_at IS NULL AND p_group.archived_at IS NULL AND (p_group.submitted_at IS NULL OR p_dash.allow_edit_after_submission OR p_group.status = 'revision_required') $$;

-- Adds members. Staff always; student leaders only while the dashboard's
-- member-change rules allow it (after submission / approval flow).
CREATE OR REPLACE FUNCTION private.add_project_group_members(p_group_id uuid, p_members jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_is_staff boolean; v_count integer; v_names text := '';
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  v_is_staff := private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id));

  IF NOT v_is_staff THEN
    IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_group.leader_member_id IS DISTINCT FROM (SELECT id FROM public.project_group_members WHERE group_id = v_group.id AND profile_id = v_actor.id) THEN RAISE EXCEPTION 'not_leader'; END IF;
    IF v_group.submitted_at IS NOT NULL AND NOT v_dash.allow_member_changes_after_submission THEN RAISE EXCEPTION 'member_changes_locked'; END IF;
    IF v_dash.require_member_change_approval THEN RAISE EXCEPTION 'approval_required'; END IF;
    IF NOT private.project_student_content_allowed(v_group, v_dash) THEN RAISE EXCEPTION 'member_changes_locked'; END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.project_group_members WHERE university_id = v_group.university_id AND group_id = v_group.id;

  -- Validate once for names/logging and once for the insert, both BEFORE any
  -- write so the two passes see identical state (STABLE function).
  SELECT string_agg(r.member_name, ', ') INTO v_names FROM private.project_validate_members(v_group.university_id, v_dash.offering_id, v_dash.section_id, v_group.id, p_members, v_dash.max_members - v_count) r;
  INSERT INTO public.project_group_members(university_id, created_by, group_id, profile_id, name, reg_no, email, member_role, responsibilities, position)
  SELECT v_group.university_id, v_actor.id, v_group.id, r.profile_id, r.member_name, r.member_reg_no, r.member_email, r.member_role, r.member_resp, v_count + r.member_pos
  FROM private.project_validate_members(v_group.university_id, v_dash.offering_id, v_dash.section_id, v_group.id, p_members, v_dash.max_members - v_count) r ORDER BY r.member_pos;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, CASE WHEN v_is_staff THEN 'ta' ELSE 'student' END, v_actor.display_name, 'project.member.added', 'member', v_group.id, v_group.group_id, true, NULL, jsonb_build_object('members', v_names, 'count', v_count));
END $$;

-- Removes a member (leader handover when the leader leaves). Authorization is
-- the caller's job; decide_project_member_request reuses this inner helper.
CREATE OR REPLACE FUNCTION private.project_remove_member_inner(p_group public.project_groups, p_dash public.project_dashboards, p_member_id uuid, p_actor public.profiles, p_actor_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member public.project_group_members; v_next uuid;
BEGIN
  SELECT * INTO v_member FROM public.project_group_members WHERE id = p_member_id AND university_id = p_group.university_id AND group_id = p_group.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  DELETE FROM public.project_group_members WHERE id = v_member.id;
  IF p_group.leader_member_id = v_member.id THEN
    SELECT id INTO v_next FROM public.project_group_members WHERE group_id = p_group.id AND university_id = p_group.university_id ORDER BY position LIMIT 1;
    UPDATE public.project_groups SET leader_member_id = v_next WHERE id = p_group.id;
  END IF;

  PERFORM private.project_log(p_group.university_id, p_dash.id, p_group.id, p_actor.id, p_actor_role, p_actor.display_name, 'project.member.removed', 'member', v_member.id, v_member.name, true, jsonb_build_object('name', v_member.name, 'reg_no', v_member.reg_no), NULL);
END $$;

-- Removes a member (leader handover when the leader leaves).
CREATE OR REPLACE FUNCTION private.remove_project_group_member(p_group_id uuid, p_member_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_member public.project_group_members; v_is_staff boolean;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_member FROM public.project_group_members WHERE id = p_member_id AND university_id = v_group.university_id AND group_id = v_group.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_is_staff := private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id));

  IF NOT v_is_staff THEN
    IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_group.leader_member_id IS DISTINCT FROM (SELECT id FROM public.project_group_members WHERE group_id = v_group.id AND profile_id = v_actor.id) THEN RAISE EXCEPTION 'not_leader'; END IF;
    IF v_group.submitted_at IS NOT NULL AND NOT v_dash.allow_member_changes_after_submission THEN RAISE EXCEPTION 'member_changes_locked'; END IF;
    IF v_dash.require_member_change_approval THEN RAISE EXCEPTION 'approval_required'; END IF;
    IF NOT private.project_student_content_allowed(v_group, v_dash) THEN RAISE EXCEPTION 'member_changes_locked'; END IF;
  END IF;

  PERFORM private.project_remove_member_inner(v_group, v_dash, v_member.id, v_actor, CASE WHEN v_is_staff THEN 'ta' ELSE 'student' END);
END $$;

-- Staff-only: move a member to another group on the same dashboard.
CREATE OR REPLACE FUNCTION private.transfer_project_member(p_member_id uuid, p_target_group_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_member public.project_group_members; v_source public.project_groups; v_target public.project_groups; v_dash public.project_dashboards; v_target_count integer;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_member FROM public.project_group_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_source FROM public.project_groups WHERE id = v_member.group_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_target FROM public.project_groups WHERE id = p_target_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_target.university_id <> v_member.university_id OR v_target.dashboard_id <> v_source.dashboard_id THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_source.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_target.archived_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;

  SELECT count(*) INTO v_target_count FROM public.project_group_members WHERE university_id = v_target.university_id AND group_id = v_target.id;
  IF v_target_count + 1 > v_dash.max_members THEN RAISE EXCEPTION 'group_full'; END IF;
  IF EXISTS(SELECT 1 FROM public.project_group_members WHERE university_id = v_target.university_id AND group_id = v_target.id AND lower(reg_no) = lower(v_member.reg_no)) THEN RAISE EXCEPTION 'duplicate_member'; END IF;

  UPDATE public.project_group_members SET group_id = v_target.id, position = v_target_count WHERE id = v_member.id;
  IF v_source.leader_member_id = v_member.id THEN
    UPDATE public.project_groups SET leader_member_id = (SELECT id FROM public.project_group_members WHERE group_id = v_source.id AND university_id = v_source.university_id AND id <> v_member.id ORDER BY position LIMIT 1) WHERE id = v_source.id;
  END IF;
  IF v_target.leader_member_id IS NULL THEN
    UPDATE public.project_groups SET leader_member_id = v_member.id WHERE id = v_target.id;
  END IF;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_target.id, v_actor.id, 'ta', v_actor.display_name, 'project.member.transferred', 'member', v_member.id, v_member.name, true,
    jsonb_build_object('from_group', v_source.group_id), jsonb_build_object('to_group', v_target.group_id));
END $$;

-- Staff-only: change the group leader.
CREATE OR REPLACE FUNCTION private.set_project_group_leader(p_group_id uuid, p_member_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_prev uuid;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.project_group_members WHERE id = p_member_id AND university_id = v_group.university_id AND group_id = v_group.id) THEN RAISE EXCEPTION 'not_found'; END IF;
  v_prev := v_group.leader_member_id;
  UPDATE public.project_groups SET leader_member_id = p_member_id WHERE id = v_group.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'ta', v_actor.display_name, 'project.leader.changed', 'group', v_group.id, v_group.group_id, true, jsonb_build_object('leader_member_id', v_prev), jsonb_build_object('leader_member_id', p_member_id));
END $$;

-- Staff: archive (keeps everything, hides from active tables) or hard delete.
CREATE OR REPLACE FUNCTION private.archive_project_group(p_group_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_group.archived_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
  UPDATE public.project_groups SET archived_at = now(), status = 'archived' WHERE id = v_group.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'ta', v_actor.display_name, 'project.group.archived', 'group', v_group.id, v_group.group_id, true, jsonb_build_object('status', v_group.status), jsonb_build_object('status', 'archived'));
END $$;

CREATE OR REPLACE FUNCTION private.delete_project_group(p_group_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;

  INSERT INTO public.audit_log(university_id, created_by, actor_id, event_type, target_type, target_id, payload)
  VALUES (v_group.university_id, v_actor.id, v_actor.id, 'project.group.deleted', 'project_group', v_group.id, jsonb_build_object('group_id', v_group.group_id, 'title', v_group.project_title, 'dashboard_id', v_group.dashboard_id));
  DELETE FROM public.project_groups WHERE id = v_group.id;
END $$;

-- Student leader: pending add/remove member request when TA approval is on.
CREATE OR REPLACE FUNCTION private.request_project_member_change(p_group_id uuid, p_request_type text, p_member jsonb, p_member_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_new uuid; v_count integer;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT v_dash.require_member_change_approval THEN RAISE EXCEPTION 'approval_not_required'; END IF;
  IF v_group.leader_member_id IS DISTINCT FROM (SELECT id FROM public.project_group_members WHERE group_id = v_group.id AND profile_id = v_actor.id) THEN RAISE EXCEPTION 'not_leader'; END IF;
  IF v_group.submitted_at IS NOT NULL AND NOT v_dash.allow_member_changes_after_submission THEN RAISE EXCEPTION 'member_changes_locked'; END IF;
  IF NOT private.project_student_content_allowed(v_group, v_dash) THEN RAISE EXCEPTION 'member_changes_locked'; END IF;
  IF p_request_type NOT IN ('add','remove') THEN RAISE EXCEPTION 'invalid_input'; END IF;

  IF p_request_type = 'add' THEN
    IF p_member IS NULL OR jsonb_typeof(p_member) <> 'object' THEN RAISE EXCEPTION 'invalid_input'; END IF;
    SELECT count(*) INTO v_count FROM public.project_group_members WHERE university_id = v_group.university_id AND group_id = v_group.id;
    IF v_count + 1 > v_dash.max_members THEN RAISE EXCEPTION 'group_full'; END IF;
    -- Pre-validate the candidate the same way the apply step will.
    PERFORM private.project_validate_members(v_dash.university_id, v_dash.offering_id, v_dash.section_id, v_group.id, jsonb_build_array(p_member), v_dash.max_members);
    IF EXISTS(SELECT 1 FROM public.project_member_requests r WHERE r.group_id = v_group.id AND r.status = 'pending' AND r.request_type = 'add' AND lower(coalesce(r.payload ->> 'reg_no', '')) = lower(coalesce(p_member ->> 'reg_no', ''))) THEN RAISE EXCEPTION 'request_pending'; END IF;
  ELSE
    IF p_member_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.project_group_members WHERE id = p_member_id AND university_id = v_group.university_id AND group_id = v_group.id) THEN RAISE EXCEPTION 'not_found'; END IF;
    IF p_member_id = v_group.leader_member_id THEN RAISE EXCEPTION 'invalid_input'; END IF;
    IF EXISTS(SELECT 1 FROM public.project_member_requests r WHERE r.group_id = v_group.id AND r.status = 'pending' AND r.request_type = 'remove' AND r.member_id = p_member_id) THEN RAISE EXCEPTION 'request_pending'; END IF;
  END IF;

  INSERT INTO public.project_member_requests(university_id, created_by, group_id, request_type, payload, member_id, requested_by)
  VALUES (v_group.university_id, v_actor.id, v_group.id, p_request_type, coalesce(p_member, jsonb_build_object('member_id', p_member_id)), p_member_id, v_actor.id)
  RETURNING id INTO v_new;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'student', v_actor.display_name, 'project.member.request.created', 'member_request', v_new, v_group.group_id, true, NULL, jsonb_build_object('type', p_request_type, 'payload', coalesce(p_member, jsonb_build_object('member_id', p_member_id))));
  RETURN v_new;
END $$;

-- Staff decision on a pending member request (re-validates on apply).
CREATE OR REPLACE FUNCTION private.decide_project_member_request(p_request_id uuid, p_approve boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_request public.project_member_requests; v_group public.project_groups; v_dash public.project_dashboards; v_count integer;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_request FROM public.project_member_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_pending'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = v_request.group_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_approve THEN
    IF v_request.request_type = 'add' THEN
      SELECT count(*) INTO v_count FROM public.project_group_members WHERE university_id = v_group.university_id AND group_id = v_group.id;
      INSERT INTO public.project_group_members(university_id, created_by, group_id, profile_id, name, reg_no, email, member_role, responsibilities, position)
      SELECT v_group.university_id, v_actor.id, v_group.id, r.profile_id, r.member_name, r.member_reg_no, r.member_email, r.member_role, r.member_resp, v_count + r.member_pos
      FROM private.project_validate_members(v_group.university_id, v_dash.offering_id, v_dash.section_id, v_group.id, jsonb_build_array(v_request.payload), v_dash.max_members - v_count) r ORDER BY r.member_pos;
      PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'ta', v_actor.display_name, 'project.member.added', 'member', v_group.id, v_group.group_id, true, NULL, jsonb_build_object('members', coalesce(v_request.payload ->> 'name', ''), 'via', 'request'));
    ELSE
      PERFORM private.project_remove_member_inner(v_group, v_dash, v_request.member_id, v_actor, 'ta');
    END IF;
    UPDATE public.project_member_requests SET status = 'applied', decided_by = v_actor.id, decided_at = now() WHERE id = v_request.id;
  ELSE
    UPDATE public.project_member_requests SET status = 'rejected', decided_by = v_actor.id, decided_at = now() WHERE id = v_request.id;
  END IF;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'ta', v_actor.display_name, 'project.member.request.decided', 'member_request', v_request.id, v_group.group_id, true, jsonb_build_object('status', 'pending'), jsonb_build_object('status', CASE WHEN p_approve THEN 'applied' ELSE 'rejected' END, 'type', v_request.request_type));
END $$;

-- ============================================================================
-- SECTION 5c: SUBMISSIONS, REVIEWS, LINKS, STATUS
-- ============================================================================

-- Student (leader) or staff submission: validates the dashboard's enabled
-- fields against the payload, enforces open window/deadline/late rules and
-- group size, then writes an immutable versioned submission.
CREATE OR REPLACE FUNCTION private.submit_project(p_group_id uuid, p_responses jsonb, p_links jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_is_staff boolean; v_member_count integer; v_effective_deadline timestamptz; v_late boolean := false; v_field record; v_value text; v_version integer; v_sub_id uuid; v_title_value text := ''; v_snapshot jsonb; v_link jsonb; v_count integer;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'object' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_links IS NOT NULL AND jsonb_typeof(p_links) <> 'array' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  v_is_staff := private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id));

  IF NOT v_is_staff THEN
    IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_group.leader_member_id IS DISTINCT FROM (SELECT id FROM public.project_group_members WHERE group_id = v_group.id AND profile_id = v_actor.id) THEN RAISE EXCEPTION 'not_leader'; END IF;
    IF v_dash.status <> 'published' THEN RAISE EXCEPTION 'dashboard_closed'; END IF;
    IF NOT private.project_student_content_allowed(v_group, v_dash) THEN RAISE EXCEPTION 'edit_not_allowed'; END IF;
  ELSIF v_dash.status IN ('closed','archived') THEN
    RAISE EXCEPTION 'dashboard_closed';
  END IF;

  -- Open window / deadline (skipped for revision resubmissions so requested
  -- changes can always be turned in while the dashboard is published).
  IF v_dash.opens_at IS NOT NULL AND now() < v_dash.opens_at AND v_group.status <> 'revision_required' THEN RAISE EXCEPTION 'not_open'; END IF;
  v_effective_deadline := GREATEST(v_dash.deadline_at, v_group.deadline_override_at);
  IF v_effective_deadline IS NOT NULL AND now() > v_effective_deadline AND v_group.status <> 'revision_required' THEN
    IF v_dash.late_allowed THEN v_late := true; ELSE RAISE EXCEPTION 'deadline_passed'; END IF;
  END IF;

  -- Group size at submit time: min applies unless individual projects are on.
  SELECT count(*) INTO v_member_count FROM public.project_group_members WHERE university_id = v_group.university_id AND group_id = v_group.id;
  IF v_member_count < 1 OR v_member_count > v_dash.max_members THEN RAISE EXCEPTION 'group_size'; END IF;
  IF v_member_count < v_dash.min_members AND NOT (v_dash.allow_individual AND v_member_count = 1) THEN RAISE EXCEPTION 'group_too_small'; END IF;

  -- Validate responses against the CURRENT enabled field definitions.
  FOR v_field IN SELECT * FROM public.project_dashboard_fields WHERE university_id = v_dash.university_id AND dashboard_id = v_dash.id AND deleted_at IS NULL AND enabled ORDER BY position LOOP
    v_value := left(coalesce(p_responses ->> (v_field.id::text), ''), 2000);
    IF v_field.required AND btrim(coalesce(v_value, '')) = '' THEN RAISE EXCEPTION 'field_required'; END IF;
    IF coalesce(btrim(v_value), '') <> '' THEN
      IF v_field.field_type = 'number' AND v_value !~ '^-?[0-9]+(\.[0-9]+)?$' THEN RAISE EXCEPTION 'invalid_field'; END IF;
      IF v_field.field_type = 'url' AND (v_value !~* '^https?://[^[:space:]]+$' OR char_length(v_value) > 500) THEN RAISE EXCEPTION 'invalid_url'; END IF;
      IF v_field.field_type = 'select' AND NOT (v_value = ANY (v_field.options)) THEN RAISE EXCEPTION 'invalid_field'; END IF;
      IF v_field.field_type = 'short_text' AND char_length(v_value) > 200 THEN RAISE EXCEPTION 'invalid_field'; END IF;
    END IF;
    IF v_field.kind = 'project_title' THEN v_title_value := btrim(v_value); END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label, 'description', f.description, 'field_type', f.field_type, 'required', f.required, 'placeholder', f.placeholder, 'options', to_jsonb(f.options)) ORDER BY f.position), '[]'::jsonb)
    INTO v_snapshot
  FROM public.project_dashboard_fields f
  WHERE f.university_id = v_dash.university_id AND f.dashboard_id = v_dash.id AND f.deleted_at IS NULL AND f.enabled;

  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.project_submissions WHERE university_id = v_group.university_id AND group_id = v_group.id;

  INSERT INTO public.project_submissions(university_id, created_by, group_id, version, fields_snapshot, submitted_by, late)
  VALUES (v_group.university_id, v_actor.id, v_group.id, v_version, v_snapshot, v_actor.id, v_late)
  RETURNING id INTO v_sub_id;

  INSERT INTO public.project_submission_responses(university_id, created_by, submission_id, field_id, value)
  SELECT v_group.university_id, v_actor.id, v_sub_id, f.id, left(coalesce(p_responses ->> (f.id::text), ''), 2000)
  FROM public.project_dashboard_fields f
  WHERE f.university_id = v_dash.university_id AND f.dashboard_id = v_dash.id AND f.deleted_at IS NULL AND f.enabled
    AND (p_responses ? (f.id::text));

  -- Project links (links only; no uploads anywhere in this module).
  IF p_links IS NOT NULL THEN
    v_count := 0;
    FOR v_link IN SELECT * FROM jsonb_array_elements(p_links) LOOP
      v_count := v_count + 1;
      IF v_count > 20 THEN RAISE EXCEPTION 'too_many_links'; END IF;
      IF btrim(coalesce(v_link ->> 'title', '')) = '' OR char_length(btrim(v_link ->> 'title', '')) > 120 THEN RAISE EXCEPTION 'invalid_input'; END IF;
      IF coalesce(v_link ->> 'url', '') !~* '^https?://[^[:space:]]+$' OR char_length(coalesce(v_link ->> 'url', '')) > 500 THEN RAISE EXCEPTION 'invalid_url'; END IF;
      INSERT INTO public.project_links(university_id, created_by, group_id, title, url, description)
      VALUES (v_group.university_id, v_actor.id, v_group.id, btrim(v_link ->> 'title'), btrim(v_link ->> 'url'), left(coalesce(v_link ->> 'description', ''), 300));
    END LOOP;
  END IF;

  UPDATE public.project_groups SET
    latest_submission_id = v_sub_id,
    submitted_at = CASE WHEN v_group.submitted_at IS NULL THEN now() ELSE v_group.submitted_at END,
    submission_status = CASE WHEN v_group.submitted_at IS NULL THEN (CASE WHEN v_late THEN 'late' ELSE 'submitted' END) ELSE 'resubmitted' END,
    status = 'submitted',
    project_title = coalesce(nullif(v_title_value, ''), v_group.project_title)
  WHERE id = v_group.id;

  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, CASE WHEN v_is_staff THEN 'ta' ELSE 'student' END, v_actor.display_name,
    CASE WHEN v_version = 1 THEN 'project.submission.created' ELSE 'project.submission.resubmitted' END, 'submission', v_sub_id, v_group.group_id, true,
    CASE WHEN v_version > 1 THEN jsonb_build_object('previous_version', v_version - 1) END,
    jsonb_build_object('version', v_version, 'late', v_late));
  RETURN v_sub_id;
END $$;

-- TA review: approve / reject / request changes / general. Public feedback is
-- visible to members via the reviews read policy; private notes are TA-only.
CREATE OR REPLACE FUNCTION private.create_project_review(p_group_id uuid, p_review_type text, p_general_comments text, p_approval_explanation text, p_rejection_reason text, p_required_changes text, p_suggestions text, p_visibility text, p_new_status text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_status text; v_new uuid; v_review_status text;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_review_type NOT IN ('approve','reject','request_changes','general') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF coalesce(p_visibility, 'public') NOT IN ('public','private') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_new_status IS NOT NULL AND p_new_status NOT IN ('draft','submitted','under_review','revision_required','approved','in_progress','completed','rejected') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  v_review_status := CASE p_review_type WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' WHEN 'request_changes' THEN 'revision_required' ELSE 'unchanged' END;
  IF p_review_type = 'reject' AND btrim(coalesce(p_rejection_reason, '')) = '' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_review_type = 'request_changes' AND btrim(coalesce(p_required_changes, '')) = '' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  v_status := coalesce(p_new_status, CASE p_review_type WHEN 'general' THEN v_group.status ELSE v_review_status::text END);

  INSERT INTO public.project_reviews(university_id, created_by, dashboard_id, group_id, submission_id, review_type, review_status, general_comments, approval_explanation, rejection_reason, required_changes, suggestions, visibility, reviewer_id, reviewer_name)
  VALUES (v_group.university_id, v_actor.id, v_dash.id, v_group.id, v_group.latest_submission_id, p_review_type, v_review_status,
    left(coalesce(p_general_comments, ''), 2000), left(coalesce(p_approval_explanation, ''), 2000), left(coalesce(p_rejection_reason, ''), 2000),
    left(coalesce(p_required_changes, ''), 2000), left(coalesce(p_suggestions, ''), 2000), coalesce(p_visibility, 'public'), v_actor.id, v_actor.display_name)
  RETURNING id INTO v_new;

  UPDATE public.project_groups SET status = v_status WHERE id = v_group.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'ta', v_actor.display_name, 'project.review.created', 'review', v_new, v_group.group_id, coalesce(p_visibility, 'public') = 'public',
    jsonb_build_object('status', v_group.status), jsonb_build_object('status', v_status, 'review_type', p_review_type, 'visibility', coalesce(p_visibility, 'public')));
  RETURN v_new;
END $$;

-- Review edits keep the row (append history) and mark is_edited.
CREATE OR REPLACE FUNCTION private.update_project_review(p_review_id uuid, p_general_comments text, p_approval_explanation text, p_rejection_reason text, p_required_changes text, p_suggestions text, p_visibility text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_review public.project_reviews; v_dash public.project_dashboards; v_vis text;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_review FROM public.project_reviews WHERE id = p_review_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_review.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_visibility IS NOT NULL AND p_visibility NOT IN ('public','private') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  v_vis := coalesce(p_visibility, v_review.visibility);
  IF v_review.review_type = 'reject' AND btrim(coalesce(p_rejection_reason, '')) = '' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF v_review.review_type = 'request_changes' AND btrim(coalesce(p_required_changes, '')) = '' THEN RAISE EXCEPTION 'invalid_input'; END IF;

  UPDATE public.project_reviews SET general_comments = left(coalesce(p_general_comments, ''), 2000), approval_explanation = left(coalesce(p_approval_explanation, ''), 2000), rejection_reason = left(coalesce(p_rejection_reason, ''), 2000), required_changes = left(coalesce(p_required_changes, ''), 2000), suggestions = left(coalesce(p_suggestions, ''), 2000), visibility = v_vis, is_edited = true WHERE id = v_review.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_review.group_id, v_actor.id, 'ta', v_actor.display_name, 'project.review.updated', 'review', v_review.id, '', v_vis = 'public',
    jsonb_build_object('general_comments', v_review.general_comments, 'approval_explanation', v_review.approval_explanation, 'rejection_reason', v_review.rejection_reason, 'required_changes', v_review.required_changes, 'suggestions', v_review.suggestions, 'visibility', v_review.visibility),
    jsonb_build_object('general_comments', left(coalesce(p_general_comments, ''), 2000), 'approval_explanation', left(coalesce(p_approval_explanation, ''), 2000), 'rejection_reason', left(coalesce(p_rejection_reason, ''), 2000), 'required_changes', left(coalesce(p_required_changes, ''), 2000), 'suggestions', left(coalesce(p_suggestions, ''), 2000), 'visibility', v_vis));
END $$;

-- Soft delete keeps the audit trail; students stop seeing it via policy.
CREATE OR REPLACE FUNCTION private.delete_project_review(p_review_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_review public.project_reviews; v_dash public.project_dashboards;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_review FROM public.project_reviews WHERE id = p_review_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_review.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.project_reviews SET deleted_at = now() WHERE id = v_review.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_review.group_id, v_actor.id, 'ta', v_actor.display_name, 'project.review.deleted', 'review', v_review.id, '', v_review.visibility = 'public', NULL, NULL);
END $$;

-- Manual TA status change (archiving has its own RPC).
CREATE OR REPLACE FUNCTION private.set_project_group_status(p_group_id uuid, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT (private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status NOT IN ('draft','submitted','under_review','revision_required','approved','in_progress','completed','rejected') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.project_groups SET status = p_status WHERE id = v_group.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, 'ta', v_actor.display_name, 'project.status.changed', 'group', v_group.id, v_group.group_id, true, jsonb_build_object('status', v_group.status), jsonb_build_object('status', p_status));
END $$;

-- Link upsert: students (leader) while content editing is allowed, staff always.
CREATE OR REPLACE FUNCTION private.upsert_project_link(p_group_id uuid, p_link_id uuid, p_title text, p_url text, p_description text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_is_staff boolean; v_prev public.project_links;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  v_is_staff := private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id));

  IF NOT v_is_staff THEN
    IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_group.leader_member_id IS DISTINCT FROM (SELECT id FROM public.project_group_members WHERE group_id = v_group.id AND profile_id = v_actor.id) THEN RAISE EXCEPTION 'not_leader'; END IF;
    IF NOT private.project_student_content_allowed(v_group, v_dash) THEN RAISE EXCEPTION 'edit_not_allowed'; END IF;
  END IF;

  IF btrim(coalesce(p_title, '')) = '' OR char_length(btrim(p_title)) > 120 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF coalesce(p_url, '') !~* '^https?://[^[:space:]]+$' OR char_length(coalesce(p_url, '')) > 500 THEN RAISE EXCEPTION 'invalid_url'; END IF;

  IF p_link_id IS NULL THEN
    INSERT INTO public.project_links(university_id, created_by, group_id, title, url, description)
    VALUES (v_group.university_id, v_actor.id, v_group.id, btrim(p_title), btrim(p_url), left(coalesce(p_description, ''), 300));
    PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, CASE WHEN v_is_staff THEN 'ta' ELSE 'student' END, v_actor.display_name, 'project.link.changed', 'link', NULL, btrim(p_title), true, NULL, jsonb_build_object('title', btrim(p_title), 'url', btrim(p_url)));
  ELSE
    SELECT * INTO v_prev FROM public.project_links WHERE id = p_link_id AND university_id = v_group.university_id AND group_id = v_group.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE public.project_links SET title = btrim(p_title), url = btrim(p_url), description = left(coalesce(p_description, ''), 300) WHERE id = p_link_id;
    PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, CASE WHEN v_is_staff THEN 'ta' ELSE 'student' END, v_actor.display_name, 'project.link.changed', 'link', p_link_id, btrim(p_title), true, jsonb_build_object('title', v_prev.title, 'url', v_prev.url), jsonb_build_object('title', btrim(p_title), 'url', btrim(p_url)));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.delete_project_link(p_group_id uuid, p_link_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor public.profiles := private.project_actor(); v_group public.project_groups; v_dash public.project_dashboards; v_is_staff boolean; v_link public.project_links;
BEGIN
  IF v_actor.id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_group FROM public.project_groups WHERE id = p_group_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_dash FROM public.project_dashboards WHERE id = v_group.dashboard_id AND deleted_at IS NULL FOR UPDATE;
  v_is_staff := private.is_platform_admin() OR (v_dash.university_id = v_actor.university_id AND private.is_offering_staff(v_dash.offering_id));

  IF NOT v_is_staff THEN
    IF v_dash.university_id <> v_actor.university_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_group.leader_member_id IS DISTINCT FROM (SELECT id FROM public.project_group_members WHERE group_id = v_group.id AND profile_id = v_actor.id) THEN RAISE EXCEPTION 'not_leader'; END IF;
    IF NOT private.project_student_content_allowed(v_group, v_dash) THEN RAISE EXCEPTION 'edit_not_allowed'; END IF;
  END IF;

  SELECT * INTO v_link FROM public.project_links WHERE id = p_link_id AND university_id = v_group.university_id AND group_id = v_group.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  DELETE FROM public.project_links WHERE id = v_link.id;
  PERFORM private.project_log(v_dash.university_id, v_dash.id, v_group.id, v_actor.id, CASE WHEN v_is_staff THEN 'ta' ELSE 'student' END, v_actor.display_name, 'project.link.changed', 'link', v_link.id, v_link.title, true, jsonb_build_object('title', v_link.title, 'url', v_link.url, 'deleted', true), NULL);
END $$;

-- ============================================================================
-- SECTION 6: PUBLIC HTTP WRAPPERS (same name, D-k) + NARROW GRANTS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_project_dashboard(p_university_id uuid, p_offering_id uuid, p_section_id uuid, p_title text, p_description text, p_instructions text, p_opens_at timestamptz, p_deadline_at timestamptz, p_late_allowed boolean, p_allow_edit_after_submission boolean, p_allow_member_changes_after_submission boolean, p_require_member_change_approval boolean, p_allow_individual boolean, p_allow_student_groups boolean, p_min_members integer, p_max_members integer, p_group_id_prefix text) RETURNS uuid LANGUAGE sql SET search_path = '' AS $$ SELECT private.create_project_dashboard(p_university_id, p_offering_id, p_section_id, p_title, p_description, p_instructions, p_opens_at, p_deadline_at, p_late_allowed, p_allow_edit_after_submission, p_allow_member_changes_after_submission, p_require_member_change_approval, p_allow_individual, p_allow_student_groups, p_min_members, p_max_members, p_group_id_prefix) $$;
CREATE OR REPLACE FUNCTION public.update_project_dashboard(p_dashboard_id uuid, p_title text, p_description text, p_instructions text, p_late_allowed boolean, p_allow_edit_after_submission boolean, p_allow_member_changes_after_submission boolean, p_require_member_change_approval boolean, p_allow_individual boolean, p_allow_student_groups boolean, p_min_members integer, p_max_members integer, p_group_id_prefix text) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.update_project_dashboard(p_dashboard_id, p_title, p_description, p_instructions, p_late_allowed, p_allow_edit_after_submission, p_allow_member_changes_after_submission, p_require_member_change_approval, p_allow_individual, p_allow_student_groups, p_min_members, p_max_members, p_group_id_prefix) $$;
CREATE OR REPLACE FUNCTION public.set_project_dashboard_status(p_dashboard_id uuid, p_status text) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.set_project_dashboard_status(p_dashboard_id, p_status) $$;
CREATE OR REPLACE FUNCTION public.set_project_deadline(p_dashboard_id uuid, p_opens_at timestamptz, p_deadline_at timestamptz, p_late_allowed boolean) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.set_project_deadline(p_dashboard_id, p_opens_at, p_deadline_at, p_late_allowed) $$;
CREATE OR REPLACE FUNCTION public.duplicate_project_dashboard(p_dashboard_id uuid) RETURNS uuid LANGUAGE sql SET search_path = '' AS $$ SELECT private.duplicate_project_dashboard(p_dashboard_id) $$;
CREATE OR REPLACE FUNCTION public.delete_project_dashboard(p_dashboard_id uuid) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.delete_project_dashboard(p_dashboard_id) $$;
CREATE OR REPLACE FUNCTION public.next_project_group_id(p_dashboard_id uuid) RETURNS text LANGUAGE sql SET search_path = '' AS $$ SELECT private.next_project_group_id(p_dashboard_id) $$;
CREATE OR REPLACE FUNCTION public.create_project_group(p_dashboard_id uuid, p_group_id text, p_project_title text, p_members jsonb) RETURNS uuid LANGUAGE sql SET search_path = '' AS $$ SELECT private.create_project_group(p_dashboard_id, p_group_id, p_project_title, p_members) $$;
CREATE OR REPLACE FUNCTION public.update_project_group(p_group_id uuid, p_project_title text, p_group_label text, p_deadline_override_at timestamptz) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.update_project_group(p_group_id, p_project_title, p_group_label, p_deadline_override_at) $$;
CREATE OR REPLACE FUNCTION public.add_project_group_members(p_group_id uuid, p_members jsonb) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.add_project_group_members(p_group_id, p_members) $$;
CREATE OR REPLACE FUNCTION public.remove_project_group_member(p_group_id uuid, p_member_id uuid) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.remove_project_group_member(p_group_id, p_member_id) $$;
CREATE OR REPLACE FUNCTION public.transfer_project_member(p_member_id uuid, p_target_group_id uuid) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.transfer_project_member(p_member_id, p_target_group_id) $$;
CREATE OR REPLACE FUNCTION public.set_project_group_leader(p_group_id uuid, p_member_id uuid) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.set_project_group_leader(p_group_id, p_member_id) $$;
CREATE OR REPLACE FUNCTION public.archive_project_group(p_group_id uuid) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.archive_project_group(p_group_id) $$;
CREATE OR REPLACE FUNCTION public.delete_project_group(p_group_id uuid) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.delete_project_group(p_group_id) $$;
CREATE OR REPLACE FUNCTION public.request_project_member_change(p_group_id uuid, p_request_type text, p_member jsonb, p_member_id uuid) RETURNS uuid LANGUAGE sql SET search_path = '' AS $$ SELECT private.request_project_member_change(p_group_id, p_request_type, p_member, p_member_id) $$;
CREATE OR REPLACE FUNCTION public.decide_project_member_request(p_request_id uuid, p_approve boolean) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.decide_project_member_request(p_request_id, p_approve) $$;
CREATE OR REPLACE FUNCTION public.submit_project(p_group_id uuid, p_responses jsonb, p_links jsonb) RETURNS uuid LANGUAGE sql SET search_path = '' AS $$ SELECT private.submit_project(p_group_id, p_responses, p_links) $$;
CREATE OR REPLACE FUNCTION public.create_project_review(p_group_id uuid, p_review_type text, p_general_comments text, p_approval_explanation text, p_rejection_reason text, p_required_changes text, p_suggestions text, p_visibility text, p_new_status text) RETURNS uuid LANGUAGE sql SET search_path = '' AS $$ SELECT private.create_project_review(p_group_id, p_review_type, p_general_comments, p_approval_explanation, p_rejection_reason, p_required_changes, p_suggestions, p_visibility, p_new_status) $$;
CREATE OR REPLACE FUNCTION public.update_project_review(p_review_id uuid, p_general_comments text, p_approval_explanation text, p_rejection_reason text, p_required_changes text, p_suggestions text, p_visibility text) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.update_project_review(p_review_id, p_general_comments, p_approval_explanation, p_rejection_reason, p_required_changes, p_suggestions, p_visibility) $$;
CREATE OR REPLACE FUNCTION public.delete_project_review(p_review_id uuid) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.delete_project_review(p_review_id) $$;
CREATE OR REPLACE FUNCTION public.set_project_group_status(p_group_id uuid, p_status text) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.set_project_group_status(p_group_id, p_status) $$;
CREATE OR REPLACE FUNCTION public.upsert_project_link(p_group_id uuid, p_link_id uuid, p_title text, p_url text, p_description text) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.upsert_project_link(p_group_id, p_link_id, p_title, p_url, p_description) $$;
CREATE OR REPLACE FUNCTION public.delete_project_link(p_group_id uuid, p_link_id uuid) RETURNS void LANGUAGE sql SET search_path = '' AS $$ SELECT private.delete_project_link(p_group_id, p_link_id) $$;

REVOKE EXECUTE ON FUNCTION public.create_project_dashboard(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_project_dashboard(uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_project_dashboard_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_project_deadline(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.duplicate_project_dashboard(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_project_dashboard(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_project_group_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_project_group(uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_project_group(uuid, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_project_group_members(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_project_group_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_project_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_project_group_leader(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.archive_project_group(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_project_group(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_project_member_change(uuid, text, jsonb, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_project_member_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_project(uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_project_review(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_project_review(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_project_review(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_project_group_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_project_link(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_project_link(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_project_dashboard(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_dashboard(uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_dashboard_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_deadline(uuid, timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_project_dashboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_dashboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_project_group_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_group(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_group(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_project_group_members(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_project_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_project_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_group_leader(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_project_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_project_member_change(uuid, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_project_member_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_project(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_review(uuid, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_project_review(uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_group_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_project_link(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_link(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION private.create_project_dashboard(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.update_project_dashboard(uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.set_project_dashboard_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.set_project_deadline(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.duplicate_project_dashboard(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_project_dashboard(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.next_project_group_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.create_project_group(uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.update_project_group(uuid, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.add_project_group_members(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.remove_project_group_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.transfer_project_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.set_project_group_leader(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.archive_project_group(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_project_group(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.request_project_member_change(uuid, text, jsonb, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.decide_project_member_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.submit_project(uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.create_project_review(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.update_project_review(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_project_review(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.set_project_group_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.upsert_project_link(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.delete_project_link(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.create_project_dashboard(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.update_project_dashboard(uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.set_project_dashboard_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.set_project_deadline(uuid, timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.duplicate_project_dashboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_project_dashboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.next_project_group_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.create_project_group(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.update_project_group(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION private.add_project_group_members(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.remove_project_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.transfer_project_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.set_project_group_leader(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.archive_project_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_project_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.request_project_member_change(uuid, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.decide_project_member_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.submit_project(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.create_project_review(uuid, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.update_project_review(uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_project_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.set_project_group_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.upsert_project_link(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_project_link(uuid, uuid) TO authenticated;

COMMIT;
