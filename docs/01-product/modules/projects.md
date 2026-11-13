> Purpose: Module requirements and acceptance criteria
> Audience: founders and coding agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared (added by owner request 2026-11-11)
> Last verified against SYMBOL_REGISTRY version: v1

# Projects & Group Management

Feature IDs: 15.1-15.8 (traceability delta 2026-11-11). Phase: P2. Owner lane: Shared — TA console features in the staff app shell, student features in the student app shell.

## User stories
- Given a TA of a course offering, when they create a project dashboard, then they configure the submission form, deadlines, team-size rules, and the Group ID prefix; the dashboard is `draft` until explicitly published.
- Given a published dashboard, when a student opens it, then they create their own group by picking classmates enrolled in the dashboard's section (if the TA allowed student groups) or see their existing group — never another tenant's or another section's content. TAs do not create groups.
- Given a group, when members change after submission, then the dashboard's `allow_member_changes_after_submission` / `require_member_change_approval` rules decide whether edits are direct, TA-approved, or locked.
- Given any caller from another tenant or role, when they guess an identifier, then they receive no row or mutation and learn nothing about the target.

## Screens, routes and rendering
Private views under `/app/projects/*` (`/app/projects`, `/app/projects/new`, `/app/projects/[dashboardId]`, `/[dashboardId]/manage`, `/[dashboardId]/groups`, `/[dashboardId]/groups/[groupId]`, `/[dashboardId]/my-group`) plus the staff-only export endpoint `/api/projects/export`. All are authenticated, `noindex`, mobile-first with loading/empty/error states. Students see Project Overview, My Group, Project Details, Project Links, TA Reviews & Feedback, and Activity History sections for their own group only. Excel export is always `.xlsx` (never CSV) with "Group Overview" and "Member Details" sheets, styled frozen headers, filters and wrapped text.

## Data and authorization
Tables: `project_dashboards`, `project_dashboard_fields`, `project_group_id_ledger`, `project_groups`, `project_group_members`, `project_member_requests`, `project_submissions`, `project_submission_responses`, `project_links`, `project_reviews`, `project_activity_logs`. Every table has tenant scope, RLS enabled and forced, tenant-leading indexes and touch triggers. All mutations go through `private` RPCs behind public wrappers; the server action layer re-checks role/permission and revalidates paths. Students never read TA settings, private review notes (`visibility='private'`), non-student-visible activity rows, or other groups' members. `project_activity_logs` is append-only for clients (UPDATE/DELETE revoked).

## Group IDs and deadlines
Group IDs derive from the TA-controlled prefix (`COAL_P1` → `COAL_P1_01`, `COAL_P1_02`, …) issued transactionally under the dashboard row lock; only students create groups, so IDs are never typed by hand. Issued IDs are recorded in `project_group_id_ledger`; deleting or archiving a group releases its ID with `released_at` but the ID is never reissued; changing the prefix never renames existing groups. `next_project_group_id` previews the next ID without consuming it. Deadlines are enforced server-side (`not_open`, `deadline_passed`, `dashboard_closed`), with per-group `deadline_override_at` extensions and `late_allowed`.

## UX, audit and analytics
All inputs are Zod-validated at the server boundary. Group formation belongs to students: the creator is the leader and teammates are picked from the section roster returned by `list_project_eligible_students` (no typed names or roll numbers); every member is re-validated in SQL by `profile_id` (name/roll number derived from profiles, duplicates, enrollment, other-group conflicts, size caps). Staff no longer create groups — they manage, transfer and archive existing ones, and staff bulk member paste is previewed client-side and re-validated per member. The four default system fields (Project Title, Project Idea / Description, Problem Statement, Proposed Solution) are reorderable, required-toggleable and disableable but never deletable; every submission stores a `fields_snapshot` so later form edits never corrupt history. Reviews are `approve`/`reject`/`request_changes`/`general` with public and private visibility, append-only history, and edit/delete with audit trail. TA analytics are computed from real rows only (no fabricated numbers). In-app notifications are intentionally not implemented (owner request 2026-11-11 — the platform has no notification engine); the activity log is the user-facing history.

## Ads, SEO and feature flags
Module pages are private (`/app/*`): noindex, no ad scripts. No public whitelisted surface is added. The module has no dedicated feature flag; dashboard publication state is the access gate.

## Acceptance and tests
Given staff and students of the seeded offering (and a second tenant), when select/insert/update/delete run against all 11 tables, then pgTAP proves authorized operations succeed and unauthorized/cross-tenant operations fail (`supabase/tests/projects.rls.test.sql`, 33 assertions, including student-only group creation from roster profile ids). Unit tests cover validation, error mapping, bulk parsing and gating rules (`src/features/projects/validation.test.ts`). Playwright is not wired for this module yet.

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
