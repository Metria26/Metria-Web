# Metria — User Guide for the Platform Administrator

This guide explains how to use the Metria administration console. It is written for the platform administrator account — the one account that can open the console. No technical knowledge is needed for the day-to-day actions described here.

Current version of the app: October 2026.

---

## 1. Who can use the console

- Only **platform administrators** can open the console. If anyone else tries, they are sent back to the normal app.
- The console is dedicated to **advertising controls**: feature flags, kill switches, placements, ad networks and configuration versions.
- Other platform tools (for example approving new accounts or assigning TA/teacher roles) are **not part of the console yet** and are currently handled outside the app. See section 10.

---

## 2. Signing in and opening the console

1. Sign in at the normal sign-in page with the platform administrator Google account.
2. You land on the regular app dashboard. There is **no menu link to the console yet**.
3. Open the admin console by adding `/admin/ads` to the site address (for example, `https://your-site/admin/ads`) and pressing Enter.
4. Bookmark that address for quick access.

If you are signed in but not recognised as a platform administrator, the console redirects you to the normal dashboard.

---

## 3. What the console looks like

The page is titled **Ads administration** and contains five cards, in this order:

1. **Feature flags**
2. **Kill switches**
3. **Placements**
4. **Ad networks**
5. **Configuration versions**

Every change is applied immediately (within seconds), writes an audit event automatically, and refreshes the page. There is no separate "save" step.

---

## 4. Feature flags

This card has four switches. Each shows an **On** / **Off** badge and an **Enable** or **Disable** button.

| Flag | What it controls |
| --- | --- |
| **Ads enabled (master switch)** — `ads.enabled` | Turns ads on or off across the whole platform. |
| **Ad units on public pages** — `ads.public.enabled` | Ads on public pages (landing, about, legal pages). |
| **Sponsor units on authenticated pages** — `ads.private.enabled` | Sponsor units inside the signed-in app (dashboard, course, marks, booking pages). |
| **Global kill (emergency off)** — `ads.global_kill` | Emergency stop. Checked before any kill-switch row. |

**Current production setup:** the first three are **On** and the global kill is **Off**. Ads are intentionally live in production — do not turn them off unless you are responding to an emergency.

Useful details:

- A flag that is missing from the list behaves as **Off** (the system fails closed).
- The **master switch** and the **global kill flag** both stop network ads. The kill flag is the fastest emergency control.
- Killing ad units does **not** affect sponsor units (direct sponsor content is separate).

To change one: click **Enable** or **Disable** next to the flag, and confirm the badge changes.

---

## 5. Kill switches

This card contains:

- **Global kill switch** — blocks all network ad units platform-wide until released.
- **One row per ad network** — for example, Adsterra.

Controls:

- **Kill** — blocks that network's ad units.
- **Release** — allows them again.

Order of precedence: the `ads.global_kill` flag is checked first, then the global kill-switch row, then per-network rows. If any of them is active, the ads they cover stay blocked.

Use **Kill** for a single problematic network, and the **global** control when you want every network stopped at once. Remember to **Release** once the issue is resolved.

---

## 6. Placements

This card lists every ad placement as a table:

- **Slot** — the placement's position name (e.g. `dashboard-top`). An **Auth page** badge means the placement is on a signed-in page.
- **Page type**, **Network**, **Format**, **Priority** — what the placement serves and where.
- **State** — On / Off.
- **Actions** — **Enable** or **Disable**.

A placement serves an ad unit only while:

1. the placement itself is enabled,
2. its page type is enabled and is not an authenticated page for network units, and
3. its network is enabled and not killed.

If an ad disappears from a page, check the placement, then the network, then the kill switches — in that order.

---

## 7. Ad networks

This card lists the advertising networks with:

- An **On** / **Off** badge.
- An **Enable** or **Disable** button.

Currently the approved network is **Adsterra**. Disabling it stops its units everywhere (the placement and kill-switch rules still apply).

Note: network scripts are heavily restricted, so a network unit may appear as a reserved (empty) ad box until its scripts are enabled for a page. This is expected behaviour, not a fault.

---

## 8. Configuration versions

This card lets you keep a history of the ad setup.

- The header shows either **"Live registry (nothing published yet)"** or **"Current version: N"**.
- **Publish snapshot** — freezes the current flags, kill switches, placements and networks into a new numbered version. Publish after a round of changes you want to keep as a reference point.
- The list below shows published versions with their UTC date and time; the newest is marked **Latest**.
- **Roll back** next to any older version — restores that version's configuration by appending it as a **new** version. Nothing is edited in place, so history is never lost.

Good practice: publish a version before and after any significant change, and after an incident is resolved.

---

## 9. Emergency playbook

**Stop all network ad units immediately**

1. Open **/admin/ads**.
2. In **Kill switches**, click **Kill** on the global switch (or turn on the `ads.global_kill` flag in Feature flags).
3. Reload a public page to confirm the ad boxes are gone.
4. Investigate, then click **Release** / disable the kill flag when it is safe.

**Pause one network**

1. In **Kill switches**, click **Kill** next to that network, or
2. In **Ad networks**, click **Disable** next to it.

**Pause one placement**

1. In **Placements**, click **Disable** on that row.

**Pause ads only on public pages**

1. In **Feature flags**, disable **Ad units on public pages**.

**After an incident**

1. Restore the intended state (ads on, kill switches released).
2. Publish a configuration snapshot so the good state is recorded.

---

## 10. What the console does not manage yet

- **Account activation** — new users sign in with their university Google account but their access may wait for activation. There is no approval screen in the console yet; activation is currently handled by the platform operator outside the app.
- **Roles (student / TA / teacher)** — course-staff permissions are assigned outside the console today. If a TA cannot create courses or enter marks, their role/staff access needs to be set up by the operator.
- **Terms** — terms (e.g. "Fall 2026") are created outside the app; course staff need at least one term to open an offering.
- **Audit log viewer** — every console change already writes an audit entry, but there is no screen to browse them yet.
- **Feature flags beyond the four ads switches** — other product flags are not shown in this console.

If you are the operator as well as the administrator: new accounts, roles and terms are currently set up directly in the platform's database tools. Treat that as a back-office task, not something end users can do.

---

## 11. Common messages

| Message | What it means / what to do |
| --- | --- |
| You are redirected to the dashboard | You are not signed in as a platform administrator. Use the correct account. |
| **"You do not have permission to do that."** | Your admin session expired or the account lost admin access. Sign in again; if it persists, check the administrator account. |
| **"Check the form values and try again."** | A control sent an invalid value — reload the page and retry. |
| **"That configuration version already exists."** | Two publishes raced. Reload and publish again. |
| **"That item no longer exists."** | The placement/network was removed elsewhere. Reload the page. |
| **"Something went wrong. Try again."** | Temporary failure. The change may still have applied — reload the console and verify before retrying. |
| Ads still visible after killing | Check in this order: placement is On, network is On, kill switches released, and the `ads.global_kill` flag is Off. Then hard-refresh the page. |
| No ad boxes at all | Check the master switch and the two surface flags; a missing flag counts as Off. |

---

## 12. Quick reference

| Task | Where | Button |
| --- | --- | --- |
| Turn all ads on/off | Feature flags | **Enable** / **Disable** on "Ads enabled" |
| Emergency stop | Kill switches | **Kill** (global), then **Release** |
| Pause one network | Kill switches or Ad networks | **Kill** / **Disable** |
| Pause one ad position | Placements | **Disable** on the row |
| Save the current setup | Configuration versions | **Publish snapshot** |
| Restore an old setup | Configuration versions | **Roll back** on that version |
