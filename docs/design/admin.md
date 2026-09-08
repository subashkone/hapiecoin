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

# 4b · Banners and the flyer popup (HC-AD-059..070, 121, 122; HC-SH-055, 056)

## 1. Job
**Banner Master**: schedule a promotional popup and know whether it is showing right now. First question: "Which banners are live today?" answered by the Schedule column (Showing now / Scheduled / Ended / Hidden) and the "Showing now" filter.
**Flyer popup**: a trader landing on /analyse sees the live announcements once, at the frequency the admin chose, and can get on with trading in one click.

## 2. Layout
Admin (`/admin/banners`): header with count and "+ New Banner" (amber) → sticky filters (search, schedule, frequency, Clear, count, Copy CSV) → table Image (thumbnail 64×34) / Title + description + link / Frequency / Window (start → end) / Schedule / Active switch / Actions (Preview, Edit, Delete). Dialog: Title, Description, Link URL, Frequency, Starts, Ends, Image file input with live preview and "leave empty to keep current" on edit, Active switch, footer Cancel / Create Banner | Save Changes, plus "Preview as user" using the current values.
Flyer (`/analyse`): a 520 px dialog: image (16:9, object-cover), "Announcement · 1 of N" eyebrow, title, description, window line, footer row Previous · dots · Next, frequency label, "Don't show again" (per banner), "View" when the banner has a link (hapiecoin.com links navigate in place, others open a new tab), Dismiss.
Narrow 390: the admin table scrolls in its box (Title sticky); the flyer is full width with the image on top.

## 3. Hierarchy
Admin primary: + New Banner. Flyer primary: View (only when a link exists), otherwise Dismiss is the only button. The Active switch is the one green/red element in the table; Schedule badges are grey except "Showing now" (green outline).

## 4. States
Admin: skeleton, "No Banners · Create your first banner" with + Create Banner, filtered empty with Clear filters, error "Couldn't load banners" with Retry (HC-AD-070). Image rules on the client before upload: only images, 5 MB or smaller; the API repeats both checks (HC-AD-066). Flyer: not shown when nothing is live; toast "No active flyers" when opened from the palette with nothing live.

## 5. Numbers
Window dates dd Mon yyyy; image size shown as KB / MB with one decimal in the table; frequency in words (Every visit, Once per session, Once a day).

## 6. Interaction
Frequency (HC-SH-056): every_time shows on each visit to /analyse; once_per_session once per browser session (sessionStorage); once_per_day once per calendar day (localStorage). "Don't show again" hides that banner for good on this browser (localStorage). The carousel shows every live banner whose rule says show; arrows and dots cycle; Esc, scrim, Dismiss close. Palette "Show announcements" reopens every live banner regardless of rules. The flyer closes on route change.

## 7. Traceability
HC-AD-059..070 (067 stays "confirmed": no gradient fallback in the product), HC-AD-121, HC-AD-122, HC-SH-055, HC-SH-056. Playwright `admin.spec.ts` "HC-AD-059..069 banners: create, preview, switch, delete" and `analyse.spec.ts` "HC-SH-055 flyer carousel"; visuals `admin-banners-<theme>.png`, `analyse-flyer-<theme>.png`. Unit: web `banners.test.tsx`, `FlyerPopup.test.tsx`; api `routes/banners.test.ts`; schema `banners.test.ts`.

## 8. Real-data check
0 banners: empty state, no flyer. 40 banners: the table lists them all (no paging yet; noted for later), the flyer only shows the live ones. A 5 MB PNG uploads as a 6.7 MB JSON body under the route's 7 MB body limit; a 6 MB file is refused on the client before any request. Long titles clamp to two lines in the flyer.

## 9. Generic-pattern check
The thumbnail column earns its place because admins recognise banners by picture. One amber action per surface. No auto-rotating carousel: the trader moves it.

## 10. Confusion check
1. "Is this banner live?" → Schedule column and the Showing now filter, not the Active switch alone.
2. "Will my users see it again?" → the frequency label sits in the flyer footer and in the table.
3. "Did the image upload?" → the dialog previews the chosen file and the table thumbnail comes from the stored bytes, not the local file.

## Server rules (ADR-033)
Images are stored in Postgres (`banners.image` bytea, ≤ 5 MB, PNG / JPEG / WebP / GIF) and served from `GET /v1/banners/{id}/image?v=<updatedAt>` with a private one-day cache; list and admin JSON never carry bytes. Writes take a data URL (JSON) under a 7 MB body limit; the API re-checks type and decoded size. Admin CRUD is audited (create, update, delete). `GET /v1/banners` returns only banners in the "showing" state so the client never decides the schedule.
