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
