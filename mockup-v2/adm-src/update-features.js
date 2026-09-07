// Updates features/30-account.json and features/40-admin.json for v2: rewords changed behaviour, appends new features ("new": true).
const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '..', 'features');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const save = (f, arr) => fs.writeFileSync(path.join(dir, f), '[\n' + arr.map((e) => '  ' + JSON.stringify(e)).join(',\n') + '\n]\n');
const reword = (arr, featureStart, patch) => { const e = arr.find((x) => x.feature.startsWith(featureStart)); if (!e) { console.warn('not found:', featureStart); return; } Object.assign(e, patch); };
const W = 'working';
// ---------------- 30-account ----------------
let acc = load('30-account.json'); acc = acc.filter((e) => !e.new);
reword(acc, "Page header 'My Subscription", { how: 'Slim v2 title row: title + muted subtitle left, mono status meta (PRO · YEARLY · 116 DAYS LEFT) and the single amber primary action right; hairline underneath', status: W });
reword(acc, 'Current plan rows', { feature: 'Current plan summary strip: Billing / Price / You Pay / Currency / Valid until', how: 'Five-cell mono stat strip under the plan header (micro labels, tabular numbers, struck list price with % off pill, days-left pill); Feature Limits and Plan Features sit side by side below it' });
reword(acc, 'Upgrade button', { how: 'Header primary action reads Upgrade plan (Renew plan on Elite or when expired, Choose a plan with no subscription); it and the outline Upgrade in the current card smooth-scroll to Available Plans, pin the next tier in the diff panel and flash its card' });
reword(acc, 'Plan cards (Free Plan', { feature: 'Plan comparison grid (Free / Basic / Pro / Elite)', how: 'Four hairline cards without shadows in a 4-up comparison grid: micro flag row, name, description, discount price large in mono, list price struck with % off pill, per-month line, mono limit chips, feature bullets and the action button' });
reword(acc, 'Current plan highlight', { how: "The active plan's card gets a 2px amber top rule plus a small amber micro label 'CURRENT PLAN' (no big tag); the Pro card shows a muted 'MOST POPULAR' micro label otherwise" });
reword(acc, 'Razorpay mock checkout window', { how: 'Dark tokenised checkout: panel/raised surfaces, hairlines, mono amount, amber underline on the active method tab (UPI / Card / Netbanking / Wallet), amber Pay button, Cancel, mono SECURED BY RAZORPAY footer and the mock-controls strip' });
reword(acc, 'Invoice download link', { feature: 'Invoice link opens the invoice preview', how: "Mono 'INV-2026-0001' link with an eye icon opens the rendered invoice preview dialog; failed/pending rows show —" });
reword(acc, "Page header 'My Referrals", { how: 'Slim v2 title row with mono meta (20% COMMISSION · 6 REFERRALS) and the amber Share primary action on the right', status: W });
reword(acc, 'Hero card', { feature: "Referral link card 'Get 20% commission on every paid referral'", how: 'Flat hairline card (no gradient): gift icon, headline using referrals.commissionPct, explanatory copy, mono link input, Copy button and the dashed code chip' });
reword(acc, 'Share button', { how: 'Opens the Share dialog (link row + WhatsApp / X / Email message templates); the native navigator.share sheet is offered inside the dialog when the browser supports it' });
reword(acc, 'Referrals table', { how: 'Columns User (mono initials, name + email), Joined (mono), Plan (outline badge + interval), Amount, Commission (mono, right-aligned, green), Status; every header is sortable; default newest first' });
const accNew = [
  ['/subscription', 'My Subscription', "'What changes if I upgrade' diff panel", 'Hovering, focusing or clicking any plan card renders a diff against the current plan for the selected interval: price → price with +/− delta per month/quarter/year, upgrade/downgrade/switch wording, only the changed limits (25 → ∞, ✕ → ✓ in green, regressions in red), a count of unchanged limits and a Subscribe/Activate shortcut; hovering the current plan says so; with nothing hovered it shows the next tier'],
  ['/subscription', 'My Subscription', 'Plan card selection (pin the diff)', 'Clicking a card (not its button) pins it as the compared plan with a subtle ring; clicking again unpins; Enter on a focused card does the same'],
  ['/subscription', 'My Subscription', 'Feature limits matrix', 'Hairline table under the plan grid: rows Paper trades / month, Live trades / month, Strategy templates, Market analytics, Reports export × columns Free / Basic / Pro / Elite with the interval price under each; cells show numbers, ∞, green ✓ or muted ✕; the current plan column is tinted with an amber top rule; follows the billing interval toggle'],
  ['/subscription', 'My Subscription', 'Billing interval tabs restyled', 'Monthly / Quarterly / Yearly as underline tabs (amber underline on the active one) driving plan cards, diff panel and matrix together'],
  ['/subscription', 'My Subscription', 'Payment history status filter chips', 'Mono chips ALL / PAID / PENDING / FAILED with live counts; the active chip inverts; pagination resets; a filtered-empty state offers Show all'],
  ['/subscription', 'My Subscription', 'Payment history Copy CSV', 'Copies the current (filtered) payments as CSV (Date, Plan, Interval, Amount, Coupon, Discount, Tax, Method, Status, Invoice) to the clipboard and toasts the row × column count'],
  ['/subscription', 'My Subscription', 'Invoice preview dialog', 'Rendered tax invoice: HapieCoin letterhead with GSTIN, invoice number and Paid pill, Billed to / Invoice date / Service period, line items (plan · interval, plan discount, coupon, taxable value, CGST 9%, SGST 9%, total) derived from the payment row, footer with invoice and payment ids'],
  ['/subscription', 'My Subscription', 'Invoice Download / Copy as text', "Download (amber) copies a plain-text rendering of the invoice to the clipboard and toasts 'Invoice INV-… downloaded · mock download'; Copy as text copies the same without the download wording"],
  ['/subscription', 'My Subscription', 'Empty states with actions', 'No payments → Browse plans button; filtered-empty → Show all; no subscription → Choose a Plan'],
  ['/subscription', 'My Subscription', 'Row density', "Tables switch between 36px comfortable and 28px compact rows when the chrome emits CG.emit('density', …)"],
  ['/subscription', 'My Subscription', "Palette command 'Subscription → Change plan'", 'Registered with CG.palette when present: navigates to /subscription and triggers the header primary action'],
  ['/referrals', 'My Referrals', 'Earnings by month chart', 'SVG bars per signup month from the referral rows: paid commission solid green, pending as a hatched outline of the same hue (state in shape, not a second colour), faint ₹ grid, mono axis labels, value labels, hover tooltip per bar, legend and a best-month readout; re-renders on resize'],
  ['/referrals', 'My Referrals', 'Stat tiles row', 'Total Referrals / Total Earned / Paid (green) / Pending as four mono stat tiles above the chart, computed from the rows'],
  ['/referrals', 'My Referrals', 'Share dialog with message templates', 'Link row (Copy link, native Share… when supported) plus WhatsApp, X (Twitter) and Email templates that embed the referral link and code; each has a Copy message button with a toast'],
  ['/referrals', 'My Referrals', 'Sortable table headers', 'User, Joined, Plan, Amount, Commission and Status headers sort ascending/descending with a ▲/▼ indicator; numeric/date columns default to descending'],
  ['/referrals', 'My Referrals', 'Referrals Copy CSV', 'Copies the filtered, sorted rows (Name, Email, Joined, Plan, Interval, Amount, Commission, Status) as CSV with a toast'],
  ['/referrals', 'My Referrals', 'Empty states with actions', 'No referrals → Share link button; no results → Clear filters button'],
  ['/referrals', 'My Referrals', "Palette command 'Referrals → Copy link'", 'Registered with CG.palette when present: copies the referral link and toasts'],
  ['/referrals', 'My Referrals', 'Row density', 'Referral table honours the compact density setting (28px rows)']
].map(([route, screen, feature, how]) => ({ route, screen, feature, how, status: W, new: true, evidence: 'v2 improvement' }));
save('30-account.json', acc.concat(accNew));
// ---------------- 40-admin ----------------
let adm = load('40-admin.json'); adm = adm.filter((e) => !e.new);
reword(adm, "'Admin pages' secondary nav bar", { feature: "Admin navigation rail (CG.chrome['admin-nav'])", how: 'On ≥1100px a sticky left rail with an ADMIN micro label, icon + label links (Users · Subscription Plans · Menu Pricing · Coupon Codes · User Subscriptions · Banners · Promotional Emails), live counts per page, amber inset rule on the active item and a footer with the admin email; below 1100px it collapses into a horizontal top bar' });
reword(adm, 'Row click → user detail dialog', { feature: 'Row click → user detail drawer', how: 'Opens a right-hand drawer (see the drawer features below) instead of a dialog; Enter on a focused row does the same; Esc, the scrim or ✕ closes it' });
reword(adm, 'Page title + subtitle', { how: "Slim title row: 'Subscription Plans' / 'Manage subscription tiers and pricing' left, the single amber primary action right, hairline underneath" });
const admNew = [
  ['/admin', 'Admin (index)', "Palette commands 'Admin → …'", 'Seven commands (Users, Plans, Menu Pricing, Coupons, User Subscriptions, Banners, Emails) registered with CG.palette.register when the chrome exposes it'],
  ['/admin', 'Admin (index)', 'Sticky filter row on every page', 'Search + selects + the tools cluster (row count, Columns ▾, Copy CSV) stick under the 50px header while the table scrolls'],
  ['/admin', 'Admin (index)', "Column visibility menu ('Columns ▾')", 'Checkbox menu per table (menu stays open while toggling); at least one column must stay; Reset to default; choices persisted in CG.state.adminCols[page] via CG.saveState()'],
  ['/admin', 'Admin (index)', 'Sortable column headers', 'Sortable columns show a ▲/▼ indicator; click toggles direction; numeric columns default to descending'],
  ['/admin', 'Admin (index)', 'Bulk selection + floating action bar', 'Header checkbox selects every filtered row, row checkboxes toggle one; a floating bar at the bottom shows the count, per-page actions and Clear; selected rows are tinted'],
  ['/admin', 'Admin (index)', 'Copy CSV of the current view', 'Copies the filtered + sorted rows with only the visible (non-action) columns as CSV and toasts rows × columns'],
  ['/admin', 'Admin (index)', 'Improved empty states', 'Icon + one-line hint + primary action (Create … / Invite user / Compose) when there is no data, and a Clear filters action when filters hide everything'],
  ['/admin', 'Admin (index)', 'Row density', "All admin tables switch between 36px and 28px rows on CG.emit('density', …)"],
  ['/admin/users', 'User Management', 'Plan + status filters', 'Plan select (from CG.mock.plans) and status select (Active / Expired / Cancelled / Free / Deactivated) combine with the search'],
  ['/admin/users', 'User Management', 'Bulk actions: Activate / Deactivate / Set plan / Export CSV', 'Activate and Deactivate flip activated for the selection; Set plan opens a menu of plans and moves the users (yearly, dates recomputed); Export CSV copies only the selected rows'],
  ['/admin/users', 'User Management', 'User detail drawer', 'Slides in from the right (560px) with avatar initials, name, plan/status/admin/deactivated pills, email · mobile · joined, and tabs Profile / Subscription / Referrals / Limits / Lot sizes'],
  ['/admin/users', 'User Management', "'Impersonate (mock)' button", 'In the drawer header; toasts that you would now see the app as this user'],
  ['/admin/users', 'User Management', 'Drawer · Profile tab', 'Key/value grid (name, email, mobile, role, joined, last login, referral code, amount paid, account, id) with Copy email and Activate/Deactivate account buttons'],
  ['/admin/users', 'User Management', 'Drawer · Subscription tab', 'Plan, interval, status, subscribed, ends, validity, amount paid, days left plus a Change plan form (plan + interval → Set plan) that updates the user and the table'],
  ['/admin/users', 'User Management', 'Drawer · Referrals tab', 'Referral code, commission %, count and earned, then the referred users table from the commission records or an empty state; link to Commissions'],
  ['/admin/users', 'User Management', 'Drawer · Limits tab', 'Paper / live trading limit form with the plan default in the hint; Save Limits toasts'],
  ['/admin/users', 'User Management', 'Drawer · Lot sizes tab', 'BTC / ETH / XAUT lot size form (validates > 0); saving the demo user also updates CG.state.lotSizes'],
  ['/admin/users', 'User Management', 'Invite user dialog (mock)', 'Header primary action: name, email (validated, must be unique) and plan; creates the user in CG.mock.users and toasts Invitation sent'],
  ['/admin/users', 'User Management', 'Hideable extra columns', 'Mobile and Last login are available in the Columns menu but hidden by default'],
  ['/admin/subscriptions', 'Subscription Plans', 'Search + status filter', 'Filters plans by name/description and Active/Inactive'],
  ['/admin/subscriptions', 'Subscription Plans', 'Bulk Activate / Deactivate', 'Selected plans are toggled and plans:changed is emitted'],
  ['/admin/subscriptions', 'Subscription Plans', 'Limits and Features columns', 'Yearly paper/live limits column, plus a hideable Features column (features · menu items count)'],
  ['/admin/menu-pricing', 'Menu Pricing Master', 'Search, category and status filters', 'Category options are built from the data; all three combine'],
  ['/admin/menu-pricing', 'Menu Pricing Master', 'Bulk Activate / Deactivate', 'Toggles the selected menu items'],
  ['/admin/coupons', 'Coupon Code Master', 'Search, type and status filters', 'Code/description search, Public/Community type, Active / Inactive / Expired status'],
  ['/admin/coupons', 'Coupon Code Master', 'Bulk Activate / Deactivate / Delete', 'Delete asks for confirmation listing the codes, then removes them and emits coupons:changed'],
  ['/admin/user-subscriptions', 'User Subscriptions', 'Users tab bulk Activate / Deactivate', 'Flips the account flag for the selected users; the Account cell is now a clickable status pill'],
  ['/admin/user-subscriptions', 'User Subscriptions', 'Commissions · Paid vs pending by month chart', 'Grouped SVG bars per commission month: paid solid green, pending hatched; ₹ axis, tooltips, legend and a still-pending readout; tiles above, table below'],
  ['/admin/user-subscriptions', 'User Subscriptions', "Commissions bulk 'Mark paid'", 'Select referrers → Mark paid confirms the pending amount and settles them; Bulk pay (header primary) still settles everyone'],
  ['/admin/user-subscriptions', 'User Subscriptions', 'Tabs restyled + header primary', 'Users / Commissions as underline tabs in the title row; Bulk pay is the amber header action on the Commissions tab'],
  ['/admin/banners', 'Banner Master', "'Preview as user' popup", 'Monitor icon per row (and a Preview as user button inside the form using the current values) opens the popup exactly as a logged-in user sees it: image, title, description, Don’t show again, Dismiss and Learn more'],
  ['/admin/banners', 'Banner Master', 'Status + frequency filters', 'Showing now / Active / Inactive and the three frequency rules combine with search'],
  ['/admin/banners', 'Banner Master', 'Bulk Activate / Deactivate', 'Toggles isActive on the selection'],
  ['/admin/emails', 'Promotional Emails', 'Template picker', 'Weekly report / Plan expiring / New feature chips fill subject and message (placeholders included) and toast'],
  ['/admin/emails', 'Promotional Emails', "'Test send to me' button", 'Validates subject/message, shows a sending state and toasts a test email to the admin address with placeholders filled from the admin profile'],
  ['/admin/emails', 'Promotional Emails', 'History sticky search + columns + CSV', 'Campaign history is a grid with subject/segment search, hideable Segment column, sortable headers and Copy CSV; no bulk actions'],
  ['/admin/emails', 'Promotional Emails', 'Recipients Copy CSV', 'Campaign detail copies the per-recipient delivery rows as CSV'],
  ['/admin/emails', 'Promotional Emails', 'Send Email as header primary', 'The amber Send Email button lives in the title row next to the Compose / History tabs and hides on History']
].map(([route, screen, feature, how]) => ({ route, screen, feature, how, status: W, new: true, evidence: 'v2 improvement' }));
save('40-admin.json', adm.concat(admNew));
console.log('30-account:', acc.length, '+', accNew.length, ' 40-admin:', adm.length, '+', admNew.length);
