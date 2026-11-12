> Purpose: End-user guides for the Projects & Group Management module
> Audience: TAs, students, platform admins
> Prerequisites: `docs/01-product/modules/projects.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Projects & Group Management — User Guides

Three guides: [TA](#ta-guide), [Student](#student-guide), [Platform Admin](#admin-guide). All actions happen inside the app under `/app/projects` — nothing requires SQL, emails, or file uploads (links only, by design).

---

## TA Guide

You manage project dashboards for the offerings you are staff on. Everything else (students, groups, submissions) stays invisible until you publish.

### 1. Create a dashboard
1. Sidebar → **Projects** → **New dashboard**.
2. Pick the **course offering** (and optionally a **section**), enter a **title**, description and instructions.
3. Set the **Group ID prefix** (e.g. `COAL_P1`). Group IDs are then issued automatically: `COAL_P1_01`, `COAL_P1_02`, … You can always type a manual ID later, but automatic ones are sequential and unique per dashboard.
4. Set **team size** (min/max members) and the toggles:
   - *Allow individual (one-member) projects*
   - *Let students create their own groups*
   - *Allow edits after submission*
   - *Allow member changes after submission* (+ *require TA approval* for the request flow)
5. Save. The dashboard is a **draft** — students cannot see it yet.

### 2. Build the submission form (Manage → Settings & form builder)
- The four default fields — **Project Title, Project Idea / Description, Problem Statement, Proposed Solution** — are always present. You can reorder them (↑/↓), make them required/optional, or disable them, but never delete them.
- Add custom fields: **short text, long text, URL, number, or select** (select needs comma-separated options).
- The **student preview** at the bottom shows exactly what students will fill in.
- Editing the form later never corrupts earlier submissions — each submission stores its own snapshot of the form.

### 3. Lifecycle controls (dashboard overview page)
| Button | Effect |
|---|---|
| **Publish** | Students in the section see the dashboard and can start |
| **Unpublish** | Back to draft (students lose access) |
| **Close submissions** | Freezes new submissions; reopening is one click |
| **Archive / Unarchive** | Hides from students without deleting anything |
| **Duplicate** | Creates a fresh draft copy (fields copied, no groups) |
| **Delete** | Permanent. Groups, submissions and reviews are removed — **Group IDs are never reused** afterwards |
| **Preview next Group ID** | Shows what the next auto-issued ID will be, without consuming it |

Deadlines: set **Opens at / Deadline** (+ *allow late submissions*) on the same page. Deadlines are enforced on the server — students cannot submit late unless you allow it. For a single group, set a per-group extension from its group page.

### 4. Groups table (dashboard → Groups)
- **Search** by Group ID, project title or member names; **filter by status**; **sort**; pagination.
- Select rows with the checkboxes → **Export selected** (or **Export all**) to **Excel `.xlsx`**: sheet 1 *Group Overview*, sheet 2 *Member Details*, formatted headers with filters.
- **Create a group** yourself: title + optional manual Group ID + members (the first listed member becomes leader). Use this when students should not self-organize.

### 5. Manage one group (group detail page)
- **Members**: add one-by-one or paste a list (`Name, REG-NUMBER` per line — a live preview validates it). Remove, **transfer** to another group, or **make leader**.
- **Member-change requests**: when approval is required, requests queue here — **Approve & apply** or **Decline**.
- **Reviews**: choose type — *Approve* (explanation), *Reject* (reason required), *Request changes* (required changes), or *General feedback* — and optionally set the project status manually (otherwise it follows the review type). Mark a review **private** for TA-only notes; students only ever see *public* reviews.
- **History is never overwritten**: editing a review marks it "edited"; deleting hides it from students but keeps it for audit.
- **Status control**: set the project status manually, **archive**, or **delete** the group (its ID stays reserved forever).
- **Keeping up with activity**: there are no emails or push notifications in this module yet — check the **Groups** table (pending member requests are flagged on the dashboard card) and each group's **History** section for what changed.

---

## Student Guide

### 1. Find your dashboard
**Projects** in the sidebar lists the project dashboards for your course sections — published ones are open, closed ones are read-only.

### 2. Create your group (if your TA allowed it)
1. Open the dashboard → **Create your group**.
2. You are automatically the **leader**.
3. Add teammates by **name + registration number** — one per row, or paste a list (you'll see a preview before submitting).
4. Your **Group ID** is assigned automatically from your TA's prefix (e.g. `COAL_P1_03`). You never pick it.

Rules the system enforces for you: you must be enrolled in the section, you can only be in **one group per course**, duplicates and wrong registration numbers are rejected, and the team must respect the size limits.

If your TA did not enable self-organized groups, they create your group for you — you'll simply see **My group** on the dashboard.

### 3. Your group page (My group) — six sections
1. **Project Overview** — Group ID, current status badges, and your **effective deadline** (including any TA extension).
2. **My Group / Members** — everyone with the leader badge. Depending on the TA's settings you can add/remove members directly, must **request TA approval**, or member changes are locked after submission.
3. **Project Details** — fill in the submission form your TA built (the fields may differ per dashboard). Submit, and resubmit if the TA requests changes. After the deadline you can only submit if late submissions are allowed.
4. **Project Links** — add up to 20 links (title + `https://…` URL + optional note). No file uploads — everything is a link.
5. **TA Reviews & Feedback** — your TA's public reviews: approvals with explanations, rejections with reasons, required changes, and general feedback. You never see private TA notes.
6. **Activity History** — a timeline of student-visible events for your group (created, submitted, reviewed, status changed…).

### 4. What the statuses mean
| Status | Meaning |
|---|---|
| Draft | Group exists, nothing submitted yet |
| Submitted | Your submission is with the TA |
| Under review | TA is looking at it |
| Revision required | Fix the listed "required changes" and resubmit |
| Approved → In progress → Completed | Approved milestones |
| Rejected | See the rejection reason in feedback |
| Archived | Group archived by the TA (read-only) |

**Keeping up with activity**: the module has no notifications yet — the **Activity History** section on your group page is the timeline to watch, and your TA will tell you in class or via announcements when to check for feedback.

---

## Admin Guide

Platform admins get the same dashboard/group controls as TAs, across **all universities**, via the same `/app/projects` routes — no separate console and no SQL for day-to-day operations.

- **Visibility**: every project dashboard is readable and manageable (`project_dashboard_manageable` includes platform admins), including drafts other staff haven't published.
- **Deletions are audited**: deleting a dashboard writes a `project.dashboard.deleted` event to the platform `audit_log` (with the group count at deletion time). Group IDs from that dashboard remain permanently reserved in `project_group_id_ledger`.
- **Append-only history**: activity logs cannot be edited or deleted by any client (privileges revoked at the table level); review deletions are soft (history preserved). This is what you audit against.
- **Data surface** (for support work): `project_dashboards`, `project_dashboard_fields`, `project_group_id_ledger`, `project_groups`, `project_group_members`, `project_member_requests`, `project_submissions`, `project_submission_responses`, `project_links`, `project_reviews`, `project_activity_logs` — all tenant-scoped with RLS.
- **Support scenarios**:
  - *"Student can't see the dashboard"* → check it is **published** and the student is enrolled in the dashboard's offering/section.
  - *"Wrong group ID was issued"* → IDs are never reused; use the group's **update** flow to reassign a new (manual) ID and release the old one.
  - *"Lost review"* → deleted reviews remain in the table (`deleted_at` set); nothing is destroyed.

## Self-check
- [x] Header and audience are stated.
- [x] Scope, tests, and operational constraints are present.
