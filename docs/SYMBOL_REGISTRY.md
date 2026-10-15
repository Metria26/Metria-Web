> Purpose: Canonical symbol inventory
> Audience: founders and implementation agents
> Prerequisites: `docs/00-INDEX.md`, `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Symbol Registry v1

Names in this file are canonical. SQL, API, UI, tests and task cards must use these exact spellings. Registry changes require a reviewed registry delta before dependent implementation.

## Tables by module
### Foundation & Auth
`universities`, `university_domains`, `profiles`, `university_memberships`, `roles`, `permissions`, `role_permissions`, `role_assignments`, `role_assignment_history`, `platform_admins`, `invites`, `platform_settings`, `feature_flags`.

### Core Academics
`departments`, `terms`, `courses`, `course_offerings`, `sections`, `enrollments`, `offering_staff`, `grading_scales`, `assessments`, `marks`, `mark_history`, `import_batches`, `import_rows`, `announcements`.

### Evaluation Booking
`evaluation_periods`, `slots`, `bookings`, `waitlist_entries`, `swap_requests`.

### Marks Objections
`objections`, `objection_messages`.

### Messaging
`conversations`, `conversation_participants`, `messages`, `blocks`, `mutes`, `reports`, `moderation_actions`, `bans`.

### Coursework
`assignments`, `assignment_guides`, `submissions`, `course_info_pages`.

### Timetable & Calendar
`timetable_entries`, `calendar_tokens`.

### TA Features
`ta_reviews`, `ta_review_authors`, `public_profiles`, `review_aggregates`.

### Teacher Reviews
`teacher_reviews`, `teacher_review_authors`.

### Monetization
`ad_networks`, `ad_formats`, `page_types`, `ad_placements`, `ad_config_versions`, `ad_kill_switches`, `sponsors`, `sponsor_creatives`, `sponsor_slots`, `page_visits_raw`, `page_visits_daily`, `attribution_rules`, `earnings_entries`, `revenue_share_models`, `revenue_allocations`, `payout_accounts`, `payouts`, `payout_events`.

### Public SEO & Traffic
`content_pages`, `help_articles`, `redirects`, `seo_overrides`, `calculators`.

### Chatbot
`ai_usage`.

### Notifications & Mobile
`notification_events`, `notification_deliveries`, `notification_preferences`, `push_subscriptions`, `email_log`, `outbox_jobs`, `dead_letters`.

### Platform Admin
`audit_log`, `rate_limit_counters`, `data_deletion_requests`.

### Cross-cutting tables
`audit_log`, `outbox_jobs`, `dead_letters`, `rate_limit_counters`, `data_deletion_requests`, `course_meetings`, `consent_records`, `objection_rate_limits`, `ad_impressions`. Internal (private schema, not API-exposed): `auth_security_events`.

## Shared columns and types
All tenant-owned tables: `id uuid`, `university_id uuid`, `created_at timestamptz`, `updated_at timestamptz`; relevant actor field `created_by uuid`; soft-deletable records `deleted_at timestamptz`. Money: `amount_minor bigint`, `currency_code char(3)`. Core table references include same-tenant composite FK `(university_id, parent_id)`. Core identifiers and tenant IDs are UUID. JSONB is limited to documented `settings`, `metadata`, sanitized rich-text extension points and immutable input snapshots.

## Status domains
Text plus CHECK/lookup: publication (`draft`, `pending_review`, `published`, `unpublished`); booking (`active`, `cancelled`, `completed`); objection (`open`, `under_review`, `resolved`, `rejected`); payout (`pending`, `approved`, `paid`, `failed`, `cancelled`); notification channel (`in_app`, `email`, `web_push`); content moderation (`queued`, `visible`, `hidden`, `removed`); import rows (`ready`, `not_found`, `duplicate`, `invalid`, `applied`, `skipped`).

## Route prefixes
Public `/`, `/about`, `/contact`, `/legal/*`, `/universities/[universitySlug]/*`, `/courses/*`, `/ta/*`, `/guides/*`, `/blog/*`, `/help/*`, `/calculators/*`, `/tools/*`. Auth `/auth/*`. Private `/app/*`; admin `/admin/*`; endpoints `/api/*`. Auth pages are noindex and load no ad scripts.

## Permissions
`platform.manage_universities`, `platform.manage_roles`, `platform.moderate_content`, `platform.manage_ads`, `platform.manage_flags`, `platform.view_audit`, `platform.manage_revenue`, `academic.manage_offering`, `academic.view_offering_analytics`, `marks.manage`, `marks.view_own`, `booking.manage_period`, `booking.manage_own`, `objection.manage_assigned`, `coursework.manage`, `coursework.submit_own`, `messaging.participate`, `review.moderate`, `review.submit`, `calendar.manage_own`. Roles are data scoped to tenant/offering; `platform_admins` grants platform scope.

## Functions and public contracts
Private schema `private`: `current_university_ids()`, `has_role(p_university_id uuid,p_role text)`, `has_permission(p_university_id uuid,p_permission text)` (registry delta 2026-10-15, T-A003: permission check across role_assignments→roles→role_permissions→permissions), `is_offering_staff(p_offering_id uuid)`, `is_enrolled(p_section_id uuid)`, `is_platform_admin()`, `bootstrap_admin_email()`, `record_auth_denial(p_email text,p_event_code text,p_details jsonb)`, `assert_signup_email_allowed()`, `sync_auth_user_profile()`, `book_slot(p_university_id uuid,p_period_id uuid,p_slot_id uuid)`, `cancel_booking(p_booking_id uuid)`, `confirm_mark_import(p_batch_id uuid)` (registry delta 2026-10-15, T-A004: implemented; PostgREST surface is a public wrapper of the same name, D-k), `offering_marksheet(p_offering_id uuid)` (registry delta 2026-10-15, T-A004: student marksheet; class stats + own rank only when cohort >= 5 per D10/P14; HTTP via public wrapper, D-k), `change_mark_from_objection(p_objection_id uuid,p_new_score numeric,p_reason text)`, `request_slot_swap(p_booking_id uuid,p_target_booking_id uuid)`, `respond_slot_swap(p_swap_request_id uuid,p_accept boolean)`, `promote_waitlist(p_slot_id uuid)`, `close_revenue_month(p_university_id uuid,p_month date)`. Note: `current_university_ids()`/`is_platform_admin()`/`has_role()` resolve the caller via `profiles.auth_user_id = auth.uid()` (T-A003 correction; signatures unchanged). Security definer functions set empty search_path, validate caller, and grant only intended roles. Public reads only through named `public_*` views/functions; student records never appear. Auth trigger contract: `platform_settings` key `bootstrap_admin_email` (jsonb string) is exempt from the university-domain allowlist (D20 + founder decision 2026-10-14).

## Feature flag keys
`booking.social.enabled`, `booking.waitlist.enabled`, `messaging.enabled`, `coursework.enabled`, `calendar.enabled`, `calendar.free_busy.enabled`, `ta.reviews.enabled`, `ta.public_profile.enabled`, `ta.eligibility.enabled`, `teacher.reviews.enabled`, `ads.enabled`, `ads.public.enabled`, `ads.private.enabled`, `ads.global_kill`, `analytics.visits.enabled`, `revenue.share.enabled`, `payouts.enabled`, `ta.tools.enabled`, `sharing.enabled`, `chatbot.faq.enabled`, `chatbot.ai.enabled`, `notifications.push.enabled`. P2/P3 flags default off.

## Environment variables
`NEXT_PUBLIC_PRODUCT_NAME`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `SUPABASE_DB_URL`, `BOOTSTRAP_ADMIN_EMAIL`, `RESEND_API_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_GA_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `AD_CONFIG_CACHE_TTL_SECONDS`, `CRON_SECRET`, `CONSENT_POLICY_VERSION`. No secret may be prefixed `NEXT_PUBLIC_`.

## Event names
Audit: `mark.changed`, `role.assignment.changed`, `ad.config.changed`, `ad.kill_switch.changed`, `payout.status.changed`, `moderation.action`, `data.deletion.completed`. Analytics: `page.view`, `calculator.completed`, `share.clicked`, `signup.completed`, `booking.created`, `assignment.submitted`, `ad.slot.rendered`. Notification: `booking.reminder`, `objection.status.changed`, `announcement.published`, `mark.published`, `submission.reviewed`.

## Registry delta protocol
Any later symbol addition or correction must be listed in the generating file's `REGISTRY DELTA`, mirrored here, then checked against all references.

## Self-check
- [x] Purpose, audience, prerequisites, owner lane, and registry version are stated.
- [x] Scope and implementation constraints are explicit.
