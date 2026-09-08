# Admin console · design (Phase 4 item 4, 08 Sep 2026)

Builds on the admin shell, rail and table patterns from docs/design/billing.md (ADR-030) and the commissions tab (ADR-031). Tokens per ADR-003; amber is the one primary action per screen. Item 4 ships in three sub-PRs: 4a User Management + RBAC hardening + shared table tools, 4b Banners + the flyer popup, 4c Promotional emails.

# 4a · User Management (HC-AD-086..109, HC-AD-091..098, HC-SH-024)

## 1. Job
Find one user in seconds and see everything the company knows about them, then act (plan, account, role, limits) without leaving the page. First question: "Is this person on a plan and is their account active?" answered by the Plan and Status columns and the drawer pills.

## 2. Layout
Desktop 1440 (`/admin/users`, inside the admin shell):
```
│ User Management · 128 users                                 [Invite user ▲] │
│ [search name or email] [All plans ▾] [All status ▾] [Clear]  128 rows · Columns ▾ · Copy CSV │  ← sticky under the header
│ ☐ | Name ▾ | Email | Plan | Status | Subscribed | Ends | Joined | Referral code | Commission │
│ … 10 rows, 36 px (28 px compact) …                                                           │
│ Page 1 of 13 · 128 users                              [← Previous] [Next →]                  │
│ ▣ 3 selected · Activate · Deactivate · Set plan ▾ · Export CSV · Clear   (floating bar)      │
```
Row click (or Enter) opens the user drawer: a 560 px panel from the right with a scrim; Esc, scrim and × close it, focus is trapped. Header: initials avatar, name, pills (plan, status, admin, deactivated), email · mobile · joined. Tabs Profile / Subscription / Referrals / Limits / Lot sizes / History.
Narrow 390: filters wrap to two rows, the table scrolls in its box with the Name column sticky, the drawer becomes full width, the floating bar is a bottom sheet.

## 3. Hierarchy
Primary: Invite user (page), Set plan (drawer Subscription tab). Secondary: row actions in the drawer (Activate / Deactivate, Make admin / Remove admin, Save limits, Save lot sizes), Copy CSV, Columns. Tertiary: sort indicators, pills. Green only for "Active" status and paid amounts; red only for "Deactivated" / "Expired"; amber for expiring-soon and the primary.

## 4. States
Loading: skeleton rows. Empty (no users at all): "No users yet" with Invite user. Filtered empty: "No users match" with Clear filters. Error: inline with Retry. Drawer loading: skeleton tabs. Mutations: toasts (Updated · name; Invitation sent · email; Plan set · Pro yearly · 3 users). Refusals surface the API's reason (own role, last admin, own account).

## 5. Numbers
Dates as dd Mon yyyy; Ends adds "· N d left" / "Expired N d ago"; amounts ₹ with two decimals (Amount paid = sum of every subscription's paidInr); commission %; validity in days; lot sizes as decimal strings with the asset unit. Referral code mono.

## 6. Interaction
Tab order: Invite → search → selects → Clear → Columns → Copy CSV → header checkbox → rows (each row is focusable; Enter opens the drawer; Space toggles the checkbox) → pager. Sort: click a header toggles ▲/▼; numeric and date columns default to descending. Columns menu stays open while toggling, keeps at least one column, has Reset; the choice is persisted per page in the UI store (`adminCols`). Density follows the existing header toggle (HC-AD-098). Palette (admins only): "Admin: Users", "Admin: Subscription Plans", "Admin: Menu Pricing", "Admin: Coupon Codes", "Admin: User Subscriptions", "Admin: Banners", "Admin: Promotional Emails" (HC-AD-091). Settings gear gains an Admin section with the same seven links (HC-SH-024).

## 7. Traceability
HC-AD-086..109 (except HC-AD-102, see 9), HC-AD-091..098, HC-SH-024. Playwright: `admin.spec.ts` "HC-AD-086..101 users: search, drawer, set plan, invite"; visuals `admin-users-<theme>.png`, `admin-user-drawer-<theme>.png`. Unit: `users.test.tsx`, `table-tools.test.tsx`, api `routes/admin-users.test.ts`, schema `admin.test.ts`.

## 8. Real-data check
10 users: one page, no scroll. 5,000 users: server-side search, filters, sort and paging (10 per page); Copy CSV copies the current page only and says so in the toast ("10 rows · page 1 of 500"); the bulk bar acts on selected rows of the current page. A 40-character name truncates with a title tooltip. A user with no subscription shows "Free plan" and "—" for dates. The layout fails below 900 px when the filter row and the tools cluster compete for one line: the tools cluster wraps under the filters.

## 9. Generic-pattern check
Every column answers a question (who, on what, until when, who referred them); Mobile and Last login are hidden by default because they are rarely the question. One amber action per surface. No impersonation: the reference site's "Impersonate (mock)" only toasts; a real impersonation needs a session-swap design with its own audit trail and is out of scope (recorded in ADR-032). Invite creates the user row and emails a sign-in link; the invited user signs in by OTP, no password is ever set by the admin.

## 10. Confusion check
1. "Did I just deactivate myself?" → the API refuses own-account and own-role changes (409) and the drawer hides those buttons for the acting admin.
2. "Set plan charges the user?" → the Set plan dialog says "Comped by admin · ₹0 · the user pays nothing"; the subscription row records paidInr 0.
3. "Which rows does Export CSV cover?" → the floating bar's Export says "Export N selected"; the toolbar's Copy CSV says "this page".

## Server rules (RBAC hardening, ADR-032)
- Every admin route sits behind `requireAdmin` (server-side; the UI hiding a menu is never the control).
- Role changes: an admin cannot change their own role; the last admin cannot be demoted; a deactivated account cannot be promoted. All role, activation, plan and invite actions write the audit log with before / after.
- Own account: `PATCH /v1/admin/users/{id}` and the bulk routes never deactivate the acting admin.
- Invite: `POST /v1/admin/users/invite` creates the user (role user, referral code generated, emailVerified false) and sends a sign-in invitation through the mailer; 409 on a known email.
- Set plan: `POST /v1/admin/users/{id}/plan` cancels the active subscription and inserts a new one at the plan's interval price with paidInr 0 (admin comp); `POST /v1/admin/users/bulk-plan` does the same for many. Both call `recordReferralCommission` so referrers see the change (₹0 → No Purchase).
- Detail: `GET /v1/admin/users/{id}` returns the row, the active subscription, the plan's default limits, the referral summary with rows, and the last 20 audit entries targeting the user.
