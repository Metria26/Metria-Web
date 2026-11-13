> Purpose: RPC signatures and transaction boundaries
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

-- Source of truth: supabase/migrations/20261111000000_a_projects_groups.sql (SECTIONS 1-6).
-- All mutations are private SECURITY DEFINER plpgsql functions (empty search_path, caller resolved via
-- private.project_actor() = profiles row for auth.uid(), tenant + role re-verified per call) exposed through
-- public SQL wrappers (D-k). Stable error codes are raised as bare exceptions and mapped to i18n keys in
-- src/features/projects/rules.ts (mapRpcError).

-- Dashboards (staff only; platform admin or offering staff of the dashboard's offering):
--   create_project_dashboard(university_id, offering_id, section_id, title, description, instructions,
--     opens_at, deadline_at, late_allowed, allow_edit_after_submission, allow_member_changes_after_submission,
--     require_member_change_approval, allow_individual, allow_student_groups, min_members, max_members, group_id_prefix) -> uuid
--     Seeds the four default system fields in one transaction.
--   update_project_dashboard(dashboard_id, …same fields…) -> void (group_id_prefix change never renames existing groups)
--   set_project_dashboard_status(dashboard_id, status) -> void (draft/published/closed/archived; guards on staff)
--   set_project_deadline(dashboard_id, opens_at, deadline_at, late_allowed) -> void (deadline must be unique-ish; logs)
--   duplicate_project_dashboard(dashboard_id) -> uuid (draft copy with copied fields; no groups)
--   delete_project_dashboard(dashboard_id) -> void (hard delete cascading module rows; platform audit_log event)
-- Group IDs:
--   next_project_group_id(dashboard_id) -> text — pure preview, consumes nothing (STABLE candidate scan).
-- Group formation (2026-11-13, supabase/migrations/20261113000000_a_projects_section_members.sql):
--   list_project_eligible_students(dashboard_id) -> (profile_id, display_name, roll_no, email) — active students
--     enrolled in the dashboard's section (or offering when section_id is NULL), excluding the caller and students
--     already in a group for the offering; enrolled students read it for published dashboards, staff for any status.
-- Groups & members:
--   create_project_group(dashboard_id, group_id, project_title, members jsonb) -> uuid — student-only (staff raises
--     forbidden); issues the sequential ID under the dashboard row lock from the TA prefix; caller must be the first
--     (leader) member; validates members (enrollment, other-group conflicts, duplicates, size cap). A member item may
--     carry profile_id, in which case name/roll number are derived from profiles instead of client input.
--   update_project_group(group_id, project_title, group_label, deadline_override_at) -> void (staff; ledger rename flow:
--     insert new ledger row, release old with released_at, update group; old ID never reissued)
--   add_project_group_members(group_id, members jsonb) -> void (leader or staff; re-runs full member validation)
--   remove_project_group_member(group_id, member_id) -> void (leader or staff; repositions remaining members)
--   transfer_project_member(member_id, target_group_id) -> void (staff only; size/enrollment re-validated)
--   set_project_group_leader(group_id, member_id) -> void (staff only)
--   set_project_group_status(group_id, status) -> void (staff; status CHECK validated)
--   archive_project_group(group_id) / delete_project_group(group_id) -> void (staff; both release the Group ID)
--   request_project_member_change(group_id, request_type, member jsonb, member_id) -> uuid (leader-only; direct vs
--     approval vs locked decided by dashboard rules)
--   decide_project_member_request(request_id, approve boolean) -> void (staff; applies add/remove atomically on approve)
-- Submissions & links:
--   submit_project(group_id, responses jsonb, links jsonb) -> uuid — versioned insert + fields_snapshot; gates
--     not_published/not_open/deadline_passed/edit_not_allowed; required-field validation (field_required); ≤20 links;
--     resubmission skips open-window/deadline checks when allowed (revision flow).
--   upsert_project_link(group_id, link_id, title, url, description) / delete_project_link(group_id, link_id) -> void
--     (leader within content gate, or staff)
-- Reviews (staff only):
--   create_project_review(group_id, review_type, general_comments, approval_explanation, rejection_reason,
--     required_changes, suggestions, visibility, new_status) -> uuid — approve/reject/request_changes/general; status
--     auto-mapping unless new_status overrides; public reviews notify members (private never).
--   update_project_review(review_id, general_comments, approval_explanation, rejection_reason, required_changes,
--     suggestions, visibility) -> void (append history preserved; is_edited=true)
--   delete_project_review(review_id) -> void (soft delete; history retained for audit)
-- Form builder (staff only) — direct RLS-guarded table writes from server actions (no RPCs):
--   project_dashboard_fields INSERT/UPDATE/DELETE with staff manage policy; system fields keep their type on
--     update and are never deleted by clients (soft-deleted only via staff table access); select needs >=1 option;
--     reorder passes an id array and repositions 0..n-1.
-- Notifications — intentionally NOT implemented (owner request 2026-11-11); no notify RPC exists.

-- Rollback: revoke execute first; preserve append-only audit and financial history.

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
