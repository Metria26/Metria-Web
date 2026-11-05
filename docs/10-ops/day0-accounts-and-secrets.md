> Purpose: Business account and secret setup
> Audience: founders and coding agents
> Prerequisites: `docs/DECISIONS.md`, `docs/SYMBOL_REGISTRY.md`
> Owner lane: Shared
> Last verified against SYMBOL_REGISTRY version: v1

# Day 0 Accounts and Secrets

Create company-owned Google account, GitHub Organization, Supabase organization, Render (primary hosting), Netlify (fallback), and uptime-monitor (Better Stack; optional UptimeRobot backup) accounts, domain registrar/DNS, Search Console, analytics property, Sentry, Resend, ad publisher accounts, and payout/banking access under business identity. At least two founders have recovery access; enforce MFA and recovery codes in company vault. Do not use personal accounts as sole owner. All services use free tiers; no paid plans.

Inventory secrets by name, owner, environment, rotation date and recovery path: Supabase anon URL/key (public), service-role key (server only), DB URL, bootstrap admin email, Resend key, Sentry DSN, VAPID keys, cron secret, analytics ID, consent policy version, ad provider credentials. Store in a password manager / secrets vault; `.env.example` contains placeholders only. Rotate on personnel change or suspected exposure.

Before production: verify provider current free-tier terms and privacy terms; confirm free-tier quotas cover expected load (DB size, egress, connections, backups where available); configure Google OAuth origins/redirects/domain hook; set Render env vars for production and keep Netlify fallback env vars in sync; allowlist both host URLs in Supabase Auth/Google OAuth if the fallback is retained; DNS SPF/DKIM/DMARC; Sentry scrubbers; Render keep-alive monitor on `https://metria-web.onrender.com/api/health` (3-5 minute interval, alerts to both founders, never `/robots.txt`) plus any separate Supabase inactivity monitor; consent policy; ad category blocks; domain ownership; restore drill. Bootstrap first platform admin once with `BOOTSTRAP_ADMIN_EMAIL`, record actor/time and verify second founder recovery.

## Self-check
- [x] Header and required content are present.
- [x] Naming source and ownership are stated.
