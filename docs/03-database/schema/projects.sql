> Purpose: Tenant schema DDL
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

-- Source of truth: supabase/migrations/20261111000000_a_projects_groups.sql (apply first; NOT executed against the remote yet).
-- Twelve tenant tables, all with RLS ENABLED + FORCED, touch triggers, tenant-leading indexes and
-- (university_id, parent_id) composite foreign keys. Summary of the contract:

-- project_dashboards: per-offering (optional section) dashboard; status CHECK ('draft','published','closed','archived');
--   timing opens_at/deadline_at + late_allowed; rules allow_edit_after_submission, allow_member_changes_after_submission,
--   require_member_change_approval, allow_individual, allow_student_groups; min/max members; group_id_prefix (<=32 chars)
--   and group_id_seq counter (CHECK max>=min).
-- project_dashboard_fields: ordered (position) form fields; field_type CHECK ('short_text','long_text','url','number','select');
--   is_system + kind CHECK ('project_title','project_idea','problem_statement','proposed_solution') for the four default
--   fields (never deletable, only disable); select requires cardinality(options) >= 1; soft-deletable.
-- project_group_id_ledger: one row per issued Group ID per dashboard (UNIQUE(university_id,dashboard_id,group_id),
--   format CHECK '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'); released_at marks deletion/archive releases; IDs are never reissued.
-- project_groups: dashboard-scoped; group_id FK -> ledger (composite, ON DELETE RESTRICT); status CHECK 9 values
--   ('draft','submitted','under_review','revision_required','approved','in_progress','completed','rejected','archived');
--   submission_status CHECK ('not_submitted','submitted','resubmitted','late'); leader_member_id, submitted_at,
--   latest_submission_id, deadline_override_at (per-group extension); archived_at/deleted_at lifecycle.
-- project_group_members: profile_id nullable (TA may add unresolved names? no — resolve fails hard; nullable only for
--   SET NULL on profile deletion); name/reg_no NOT NULL, position ordering, member_role/responsibilities.
-- project_member_requests: 'add'/'remove' requests with payload jsonb, member_id FK, requested_by/decided_by/decided_at;
--   status CHECK ('pending','applied','rejected').
-- project_submissions: versioned (UNIQUE(university_id,group_id,version) starting at 1), fields_snapshot jsonb,
--   submitted_by/submitted_at, late flag.
-- project_submission_responses: one row per field per submission (UNIQUE(university_id,submission_id,field_id)).
-- project_links: title/url/description only — no file uploads; URL format enforced in RPC (^https?://).
-- project_reviews: review_type CHECK ('approve','reject','request_changes','general'); review_status CHECK
--   ('approved','rejected','revision_required','unchanged'); visibility CHECK ('public','private'); reviewer_id/name;
--   is_edited; deleted_at soft delete keeps history.
-- project_activity_logs: dashboard FK NOT NULL, group FK nullable; actor_id/actor_role/actor_name, action, entity_type/
--   entity_id/entity_label, student_visible, prev_values/new_values jsonb (audit trail). Client UPDATE/DELETE revoked.
-- project_notifications: intentionally NOT implemented (owner request 2026-11-11 — no platform notification engine).

-- Rollback only in a later expand/contract migration after consumers and data retention obligations are cleared.

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
