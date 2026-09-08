# Billing, plans and admin · design (Phase 4 item 1, 08 Sep 2026)

Reference patterns reused from `mockup-v2/parts/30-account.html` (sub-current-grid, sub-limit, sub-matrix, sub-diff) and `40-admin.html` (adm-filters, adm-table-wrap, adm-bulkbar, switch, cg-dialog). Tokens per ADR-003; amber for the one primary action only.

## 1. Job
**My Subscription**: tell the trader in two seconds *what plan they are on, when it ends, and what they can still do this month*; then let them change plan. First question: "Am I about to lose live trading?" answered by the status badge + days-left pill in the header.
**Admin plans / pricing / user subscriptions**: let an admin change what customers can do without touching code. First question: "Which plans are live and what do they cost?"

## 2. Layout
Desktop 1440 (`/account/subscription`, inside the app shell; scrolls as one page):
```
┌ header + plan banner (existing) ─────────────────────────────────────────────┐
│ My Subscription · Choose a plan to unlock features                            │
│ ┌ current plan card ─────────────────────────┐ ┌ Feature limits ────────────┐ │
│ │ Pro  [ACTIVE · 23d left]      Renew Upgrade│ │ paper_trading 14 / 25 ▮▮▮░ │ │
│ │ Billing Price YouPay Currency Valid until  │ │ live_trading   ∞           │ │
│ └────────────────────────────────────────────┘ │ alerts  Not included ↑     │ │
│                                                └────────────────────────────┘ │
│ Plan features (bullets)                                                       │
│ Available plans   [Monthly | Quarterly | Yearly]                              │
│ ┌ Free ┐ ┌ Basic ┐ ┌ Pro (current, amber top rule) ┐ ┌ Elite ┐               │
│ ─ What changes if I upgrade → Elite: rows + price delta (pinned by click) ─   │
│ Feature limits matrix (rows × plans, current column tinted)                   │
└───────────────────────────────────────────────────────────────────────────────┘
```
Narrow 390: cards stack; the plan grid becomes a horizontal scroll row of 260 px cards; the matrix scrolls in its own `overflow-x` box with the first column sticky; the summary strip wraps to 2 + 3 cells.
Admin (`/admin/*`): sticky left rail ≥ 1100 px (Users · Subscription Plans · Menu Pricing · Coupon Codes · User Subscriptions · Banners · Promotional Emails, live counts, admin email footer); below 1100 px a horizontal tab bar. Page = title + subtitle, filters row (search, status), bulk bar when rows are ticked, one hairline table, dialogs for create / edit.

## 3. Hierarchy
Primary (amber, one per screen): "Upgrade" on the current card (or "Subscribe" on the recommended plan when free); admin "+ New Plan" / "+ New Item". Secondary: interval toggle, Renew, plan card actions, table switches. Tertiary: mono stat strips, limit chips, matrix. Green/red only for status badges (Active / Expired) and the account Active / Deactive toggle; never for prices.

## 4. States
Loading: skeleton card + three grey lines, no spinner text. Empty: "No Active Subscription · You are on the free plan · [See plans]"; admin tables: "No Plans Yet · + Create Plan", "No users found". Error: inline hairline error with Retry, banner untouched. Stale: n/a (no WS). Plan banner: free / active (dismissable) / expiring soon (≤ 7 d) / expired, exactly HC-SH-050..053. Upgrade Required dialog: message + "Subscribe Here →" (goes to /account/subscription) + Dismiss. Light and dark from tokens; the current-plan tint uses `--accent` at 8 %.

## 5. Numbers
Prices in ₹ INR (plans are priced in INR by the admin), tabular mono, right-aligned; list price struck with "-N %" pill next to the discount price; per-interval price shows "≈ ₹x / month". Limits: integer per month, 0 = "∞ Unlimited" (matches the reference), missing key = "Not included". Usage: "14 used · 3 of 25 used · 12 %"; the month is the calendar month in UTC. Days left: `ceil` to the day, "Soon" under 7 days, "Expired N d ago". Validity in the admin table is an integer of days; editing it recomputes `expiresAt = startsAt + days`.

## 6. Interaction
Tab order: header actions → interval toggle → plan cards (each card one focus stop, Enter selects and pins the diff) → matrix. Palette: "Subscription → Change plan" (HC-AC-066), "Admin → Subscription Plans" (admin only). No new shortcuts. Admin inline edits: click → number input, Enter saves, Escape / blur cancels (HC-AD-046). Bulk bar appears only when ≥ 1 row is ticked and names the count.

## 7. Traceability
HC-AC-001..015, 056..059, 064..066; HC-SH-050..054; HC-AD-001..028, 042..051, 110..114, 117, 120. Playwright: `account.spec.ts` "HC-AC-003 current plan card and limits", "HC-AC-013 interval toggle and diff panel", "HC-SH-054 upgrade required"; `admin.spec.ts` "HC-AD-006 plans table and dialog", "HC-AD-044 user subscriptions inline edit"; visuals `account-subscription-<theme>.png`, `admin-plans-<theme>.png`, `admin-users-<theme>.png`.

## 8. Real-data check
4 plans is the design case; 10 plans wrap the grid to two rows of four and the matrix scrolls horizontally with the sticky first column. 500 users paginate at 10 per page with the count in the pager; search is server-side. A ₹1,29,999 price (Indian grouping) fits the mono cell at 15 px. Long plan names truncate with a title tooltip at 28 characters. Breakpoint that fails: the five-cell summary strip below 520 px; fix is the 2 + 3 wrap.

## 9. Generic-pattern check
The four plan cards are the comparison the trader asked for, not decoration; the current one differs (top rule, tint, "Current plan" chip, action reads "Manage"). One amber action per screen. No icons except the rail's nav glyphs and the admin table's pencil / limits / lot-size actions, each with a title. The diff panel exists only when a non-current plan is pinned.

## 10. Confusion check
1. "Is my plan active?" → the badge shows the state word and the days-left pill sits beside it; the banner repeats it.
2. "Which price will I pay?" → one price large (discounted), the list price struck, and the interval toggle names the period; the breakdown dialog lists tax before the total.
3. "Does 0 mean nothing or unlimited?" → 0 is rendered as "∞ Unlimited" everywhere and the admin dialog says "0 = unlimited" beside the input; a feature the plan lacks says "Not included".

# Referrals and commissions · design (Phase 4 item 3, 08 Sep 2026)

Reuses the v2 mock's account patterns (ref card, stat tiles, sub-matrix table, cg-dialog) and the admin table / bulkbar patterns above. Tokens per ADR-003; amber only for Share (trader) and Bulk pay (admin).

## 1. Job
**My Referrals**: in two seconds the trader sees *how much they have earned and what is still pending*, then gets the link to share. First question: "Did anyone I invited pay, and did I get paid?" answered by the Paid / Pending tiles.
**Admin · Commissions**: settle what is owed. First question: "How much is pending right now?" answered by the Pending tile.

## 2. Layout
Desktop 1440 (`/referrals`, app shell, one scrolling page):
```
│ My Referrals · Share & Earn        20% COMMISSION · 6 REFERRALS      [Share ▲] │
│ ┌ link card ───────────────────────────────┐ ┌ How it works ──────────────────┐ │
│ │ 🎁 Get 20 % on every paid referral       │ │ 1 Share your link              │ │
│ │ [https://hapiecoin.com/auth?ref=CODE][Copy]│ 2 Friend signs up and buys     │ │
│ │ Code: ┆ REFABC1234 ┆ (click copies)       │ │ 3 Earn 20 % · Pending → Paid   │ │
│ └──────────────────────────────────────────┘ └────────────────────────────────┘ │
│ Total referrals 6 · Total earned ₹1,234.00 · Paid ₹900.00 · Pending ₹334.00     │
│ Earnings by month  ▮▮ ▮░ ▮▮▮  (paid solid, pending hatched)                     │
│ [search] [status ▾] [plan ▾] Date [from] [to] [Clear]            [Copy CSV]     │
│ User ▾ | Joined ▾ | Plan | Amount | Commission | Status   (10 rows, pager)       │
```
Narrow 390: link card and How-it-works stack; tiles wrap 2 × 2; chart keeps its own `overflow-x`; the table scrolls in its box with the User column sticky; filters wrap to two rows.
Admin Commissions tab (inside User Subscriptions): tiles row → filters (search referrer, month, Clear) → bulk bar when rows are ticked → table → chart below the table.

## 3. Hierarchy
Primary: Share (trader), Bulk pay (admin). Secondary: Copy, Copy CSV, table sort headers, Mark Paid / View. Tertiary: tiles, chart, code chip. Green only for commission amounts and the Paid badge; amber for the Pending badge; grey for No Purchase.

## 4. States
Loading: skeleton card + tiles. Empty: "No referrals yet · Share your link to start earning" with a Share button; filtered-out: "No results found" with Clear filters; admin: "No commissions found". Error: inline with Retry (HC-AC-055 asks for a toast; the page also keeps its header so nothing is blank). Light and dark from tokens; the hatched pending bars use a pattern, not a second colour.

## 5. Numbers
All ₹ INR, mono, right-aligned, two decimals on money (₹1,234.00, Indian grouping); counts without decimals; commission % from the referrer's `commissionPct` (admin-set, default 0 → the page says "Ask for your commission rate" instead of "0 %"). Joined = the referred user's sign-up date (dd MMM yyyy, UTC). Month buckets by the commission's `createdAt` (UTC). Sorting: dates and money default descending, text ascending.

## 6. Interaction
Tab order: Share → link input (click selects all) → Copy → code chip → filters → table headers (Enter toggles sort) → pager. Palette: "Referrals: copy link" (HC-AC-073). Share dialog: link row with Copy link and "Share…" (native `navigator.share` when present), three message templates each with Copy message. Admin: tick rows → bulk bar "Mark paid"; Mark Payment dialog defaults to Paid; Not Paid requires a reason; proof URL must be http(s).

## 7. Traceability
HC-AC-037..055, 067..074; HC-AD-052..058, 118, 119. Playwright: `account.spec.ts` "HC-AC-038 / 043 / 050 / 069 link card, tiles, filters and the Share dialog" and "HC-AC-051 no referrals"; `admin.spec.ts` "HC-AD-052..058 / 118 commissions: tiles, View, Mark Paid, Bulk pay"; visuals `account-referrals-<theme>.png`, `account-referrals-share-<theme>.png`, `admin-commissions-<theme>.png`, `admin-commissions-mark-<theme>.png` (visual.spec.ts). Unit: `referrals.test.tsx`, `admin.test.tsx` (commissions), `shell.test.tsx` (palette copy link), api `routes/referrals.test.ts`, schema `referrals.test.ts`.

## 8. Real-data check
0 referrals: card + empty state, chart hidden. 500 referrals: server-side pagination at 10, filters server-side, chart limited to the last 12 months. A ₹1,29,999.00 commission fits the mono cell at 13 px. Long names truncate at 28 characters with a title tooltip. Breakpoint that fails: the six-column table below 640 px; fix is the sticky first column plus horizontal scroll.

## 9. Generic-pattern check
Four tiles answer four different questions (count, earned, paid, pending), not decoration. One amber action per screen. The gift icon is the only icon and marks the share card. The chart shows state through shape (solid vs hatched), not a second colour.

## 10. Confusion check
1. "Is Pending money I already have?" → the tile label reads "Pending · not yet paid out" and the How-it-works note explains Pending → Paid on settlement.
2. "Which link do I share?" → one link input, one Copy, the code chip explains it is the same code in the link.
3. "No Purchase vs Pending" → No Purchase is grey and reads "signed up, no plan yet"; Pending is amber with the amount.

