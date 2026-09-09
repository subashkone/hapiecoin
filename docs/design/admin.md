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

# 4c · Promotional Emails (HC-AD-071..085, 124..128)

## 1. Job
Write one message, pick who gets it, see exactly what one recipient will read, send, and afterwards know who received it and who did not. First question on Compose: "Who am I about to email and how many?" answered by the Recipients badge. First question on History: "Did the last campaign deliver?" answered by the Delivered / Failed columns.

## 2. Layout
`/admin/emails`: title row with tabs Compose / History and the amber Send Email (Compose only, HC-AD-128).
Compose, two columns: left "Recipients" card (search, Segment select All / Paid / Free / Expired, Select all (N) / Clear, checkbox list with status badges, "N selected" badge); right the message: Template chips (Weekly report / Plan expiring / New feature), Subject, Message, "Insert:" placeholder chips {{name}} {{email}} {{plan}} {{expiry}} (into the last focused field), "Preview for <first selected>" card, "Test send to me".
History: sticky search + Columns (Segment hideable) + Copy CSV → table Subject · Sent at · Segment · Recipients · Delivered · Failed · Sent by, sortable, newest first → row opens the campaign detail in place: "← Back to campaigns", subject, "Sent <date> · By <name>", tiles Recipients / Delivered / Failed, recipients table Name · Email · Status · Sent at · Error with Copy CSV.
Narrow 390: the two Compose columns stack (recipients first); History table scrolls in its box.

## 3. Hierarchy
Primary: Send Email (header, Compose only). Secondary: Test send to me, Select all, template chips. Delivered counts are plain; Failed turns red only when > 0.

## 4. States
Send disabled until recipients, subject and message are set; the confirm dialog names the count and reminds that placeholders are filled per recipient. Sending shows "Sending…" and the button locks; success toasts "Emails sent · N delivered, M failed" and switches to History; a transport failure toasts "Send failed · Please try again" and records nothing. Empty recipients: "No users match the search." History empty: "No campaigns sent yet." Without a mail transport (dev), the capture mailer records the messages so the History still fills.

## 5. Numbers
Counts as integers; dates en-IN with time; the preview shows the subject and message with placeholders filled from the first selected user, and raw {{placeholder}} tokens highlighted when nobody is selected.

## 6. Interaction
Placeholders: {{name}}, {{email}}, {{plan}} (plan name or "Free"), {{expiry}} (dd Mon yyyy or "no end date"); unknown tokens stay as typed. Insert chips write at the caret of the last focused field, Message by default. Templates fill subject and message and toast; they never send. Test send goes to the acting admin with their own values. History rows are keyboard-reachable (Enter opens the detail).

## 7. Traceability
HC-AD-071..085, HC-AD-124..128. Playwright `admin.spec.ts` "HC-AD-071..085 emails: compose, preview, send, history, detail"; visuals `admin-emails-<theme>.png`, `admin-emails-history-<theme>.png`. Unit: web `emails.test.tsx`; api `routes/emails.test.ts`; schema `emails.test.ts`.

## 8. Real-data check
5 recipients: one screen. 5,000 users: the recipients list is server-searched and capped at 200 rows per query with a "showing 200 of N, refine the search" note; Select all adds only the visible rows; sending 5,000 mails runs sequentially on the API with per-recipient results, so a campaign of that size takes minutes and the button stays locked (noted as GAPS #50: a queue when campaigns grow).

## 9. Generic-pattern check
The preview card exists because placeholders are the one thing admins get wrong; the templates are three because that is what the reference site offers and each is a real use. No open-rate or click tracking: nothing in the product records it, so nothing is shown.

## 10. Confusion check
1. "Did it send to everyone?" → Delivered and Failed are separate columns and the detail lists each failed address with its error.
2. "Will the customer see {{name}}?" → the preview renders the real values; Send confirm repeats that placeholders are filled per recipient.
3. "Is Test send a real send?" → the button says "to me" and the toast names the admin's own address; test sends never appear in History.

## Server rules (ADR-035)
`POST /v1/admin/emails/send` renders placeholders per recipient on the server, sends through the configured mailer one by one, records a campaign row plus one recipient row each (sent / failed with the transport's message), and is audited. Recipient lists come from the same user rows as User Management (status = active / free / expired / deactivated; deactivated accounts are never emailed and are not offered). `POST /v1/admin/emails/test` sends only to the acting admin and records nothing. Message bodies are plain text (no HTML editor yet), which keeps the mail out of the HTML-injection class.
