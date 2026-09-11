// Generates the HapieCoin build specification: security design, phases, and a requirements traceability matrix
// derived from the v2 feature inventory (every feature gets an ID, phase, owner, test type, acceptance criterion).
const fs = require('fs');
const path = require('path');
const dir = __dirname; const featDirRoot = process.argv[2] || path.join(dir, '..', 'mockup-v2');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const areaMeta = {
  '00-chrome': { name: 'App shell, settings, tour, assistant, palette, alerts', owner: 'Platform engineer', prefix: 'SH' },
  '10-public': { name: 'Public site & authentication', owner: 'Platform engineer', prefix: 'PB' },
  '20-analyse': { name: 'Workspace: chain & analysis pane', owner: 'Workspace engineer', prefix: 'WS' },
  '21-trading': { name: 'Builder, paper & live trading, journal', owner: 'Trading engineer', prefix: 'TR' },
  '30-account': { name: 'Subscription & referrals', owner: 'Platform engineer', prefix: 'AC' },
  '40-admin': { name: 'Admin console', owner: 'Platform engineer', prefix: 'AD' },
  '50-analytics': { name: 'Market Analytics app', owner: 'Analytics engineer', prefix: 'MA' },
  '60-terminal': { name: 'Market Analytics terminal', owner: 'Analytics engineer', prefix: 'MT' }
};
const phases = [
  { id: 1, name: 'Foundation', weeks: '1.5', scope: 'Monorepo, CI with budgets, design tokens and component library, auth (email OTP, Google, passkeys), Delta adapter, market-data gateway with one live chain, pricing package validated against Delta Greeks, security baseline (headers, CSP, rate limits, secrets vault).', exit: 'Sign in works end to end; one live BTC chain streams through the gateway; pricing tests pass; security scan clean.' },
  { id: 2, name: 'Workspace parity', weeks: '2.5', scope: 'Options chain driven by the instrument list (irregular strikes), synchronised calls/puts scrolling with fixed strike column, column settings, builder, 28 templates, payoff chart with layers and sliders, Greeks, ladder, settings dialogs, save/draft.', exit: 'Every WS/TR feature marked phase 2 has a passing acceptance test; visual diff against the v2 mock within tolerance; 55 fps under 100 ticks in 5 s.' },
  { id: 3, name: 'Paper & live trading', weeks: '2', scope: 'Paper engine with fees, adjustments, square off, partial exit, stop; Delta credential vault, order preview with margin, batch placement, exit orders, private feed, positions, retry; trading safeguards and audit log.', exit: 'A paper trade and a live trade (testnet) complete end to end; kill switch and limits verified; audit log records every trading action.' },
  { id: 4, name: 'Accounts, billing, admin, public site', weeks: '1.5', scope: 'Plans with feature limits, Razorpay checkout with webhook signature verification, coupons, referrals and commissions, admin console with RBAC and bulk actions, public pages, legal pages, share pages with OG images, assistant, tour.', exit: 'A new user can sign up, pay, and be entitled; admin cannot be reached by a non-admin session; all AC/AD/PB tests pass.' },
  { id: 5, name: 'Analytics & differentiators', weeks: '2.5', scope: 'Snapshotter and IV history; Market Analytics app and terminal; Scenarios, Vol and Structure tabs; strike finder; alerts (push, email, Telegram); journal; portfolio bar; command palette and shortcuts; share links.', exit: 'All MA/MT tests pass; new-feature tests pass; alert delivery verified on all three channels.' },
  { id: 6, name: 'Backtesting, second venue, hardening', weeks: '2', scope: 'Replay engine over snapshots; Deribit adapter; mobile layout; load test at 2,000 sockets; penetration test and fixes; accessibility audit; usability sessions with real traders.', exit: 'Backtest reproduces a recorded paper trade; load and pen tests signed off; WCAG AA on both themes.' }
];
function phaseFor(f) {
  if (f.phase) return f.phase; // explicit override for features delivered outside the area's default phase
  const a = f.area; const isNew = !!f.new; const txt = ((f.feature || '') + ' ' + (f.screen || '')).toLowerCase();
  if (a === '10-public') return /auth|sign|otp|password|login|sso|delta/.test(txt) ? 1 : 4;
  if (a === '00-chrome') { if (/palette|alert|shortcut|portfolio|density|explain/.test(txt) || isNew) return 5; if (/api settings|credential|exchange|wallet|lot size|p&l settings|currency|profile|logout|header|theme/.test(txt)) return 1; return 4; }
  if (a === '20-analyse') return isNew || /scenario|vol |smile|term structure|iv rank|structure|max pain|gex|share|find|palette|keyboard/.test(txt) ? 5 : 2;
  if (a === '21-trading') { if (isNew || /journal|alert|ticket|rank|portfolio|palette/.test(txt)) return 5; if (/paper|live|square|exit|stop|adjust|retry|order|trade mode|preview|details/.test(txt)) return 3; return 2; }
  if (a === '30-account' || a === '40-admin') return 4;
  return 5;
}
function testType(f) {
  if (f.test) return f.test; // infra rows name their own evidence (unit tests, no screen)
  const txt = ((f.feature || '') + ' ' + (f.how || '')).toLowerCase();
  const t = [];
  if (/greek|payoff|breakeven|pop|margin|premium|iv|delta|theta|scenario|max pain|gex|p&l|fee/.test(txt)) t.push('unit (pricing)');
  if (f.status === 'working') t.push('e2e (Playwright)'); else t.push('visual (screenshot diff)');
  if (/api|order|payment|razorpay|coupon|referral|admin|credential|login|otp|alert/.test(txt)) t.push('api contract');
  if (/credential|api key|password|otp|payment|admin|order|live/.test(txt)) t.push('security');
  return t.join(' · ');
}
function acceptance(f) {
  const how = (f.how || f.notes || '').trim();
  const base = how ? how.replace(/\s+/g, ' ') : 'Behaves as in the v2 mock.';
  return (f.status === 'inferred' ? 'CONFIRM WITH PRODUCT OWNER first (behaviour inferred from the original bundle). Then: ' : '') + base;
}
let features = [];
for (const file of fs.readdirSync(path.join(featDirRoot, 'features')).filter((x) => x.endsWith('.json')).sort()) { const arr = JSON.parse(fs.readFileSync(path.join(featDirRoot, 'features', file), 'utf8')); arr.forEach((x) => (x.area = file.replace('.json', ''))); features = features.concat(arr); }
const counters = {};
const rows = features.map((f) => { const m = areaMeta[f.area]; counters[m.prefix] = (counters[m.prefix] || 0) + 1; const id = 'HC-' + m.prefix + '-' + String(counters[m.prefix]).padStart(3, '0'); return { id, area: f.area, areaName: m.name, owner: m.owner, route: f.route, screen: f.screen, feature: f.feature, status: f.status, isNew: !!f.new, phase: phaseFor(f), test: testType(f), acceptance: acceptance(f), evidence: f.evidence || '' }; });
const ovPath = path.join(dir, 'decisions-overrides.json'); if (fs.existsSync(ovPath)) { const ov = JSON.parse(fs.readFileSync(ovPath, 'utf8')); rows.forEach((r) => { if (ov[r.id]) { r.status = ov[r.id].status || r.status; r.acceptance = ov[r.id].acceptance || r.acceptance; r.decided = true; } }); }
fs.writeFileSync(path.join(dir, 'traceability.json'), JSON.stringify(rows, null, 1));
const csv = ['id,phase,owner,area,route,screen,feature,status,new,test,acceptance'].concat(rows.map((r) => [r.id, r.phase, r.owner, r.areaName, r.route, r.screen, r.feature, r.status, r.isNew ? 'yes' : 'no', r.test, r.acceptance].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))).join('\n');
fs.writeFileSync(path.join(dir, 'traceability.csv'), csv);
const byPhase = {}; rows.forEach((r) => (byPhase[r.phase] = (byPhase[r.phase] || 0) + 1));
const byStatus = {}; rows.forEach((r) => (byStatus[r.status] = (byStatus[r.status] || 0) + 1));
const security = [
  ['Authentication & sessions', 'Better Auth with email OTP, Google and passkeys. Sessions in httpOnly, Secure, SameSite=Lax cookies (no tokens in localStorage, unlike the original). Session rotation on privilege change, device list with revoke, OTP rate limits (5 per 15 min per email and per IP), lockout with backoff.'],
  ['Exchange API keys', 'Delta API key and secret encrypted at rest with AES-256-GCM under a key held in a KMS (never in the database or code); decrypted only inside the trading service at order time; never returned to the browser (masked last 4); IP allow-list enforced at Delta; keys revocable in one click; scope check that the key has trading but not withdrawal permission.'],
  ['Trading safeguards', 'Every live order: server-side margin check, sanity band against mark price (reject fills more than 5% away), per-user max notional and max legs, idempotency key so a retried request cannot double-place, explicit confirmation dialog, account-level kill switch, and an append-only audit log (who, what, when, from where) for every trading and admin action.'],
  ['API hardening', 'Zod validation on every input, generated OpenAPI as the contract, rate limiting in Redis per user and per IP, CSRF protection via SameSite cookies plus Origin checks, RBAC enforced on the server for admin routes (the UI hiding a menu is never the control), uniform error envelopes that never leak stack traces.'],
  ['Payments', 'Razorpay order amounts computed server-side from the plan and validated coupon (client sends only plan and coupon code), webhook signature verification, idempotent entitlement grants, refunds and cancellations recorded in the audit log.'],
  ['Transport & browser', 'TLS everywhere with HSTS, strict Content-Security-Policy (no inline scripts, allow-listed hosts), Subresource Integrity on third-party scripts, secure headers (X-Frame-Options, Referrer-Policy, Permissions-Policy), WebSocket origin checks and per-connection subscription limits at the gateway.'],
  ['Data protection', 'Least-privilege database roles per service, encrypted backups with tested restore, PII minimisation (mobile number optional), export and delete-my-data endpoints for DPDP/GDPR, log scrubbing of secrets and PII before Sentry.'],
  ['Supply chain & CI', 'Pinned lockfile, Dependabot, npm audit and secret scanning on every PR, SBOM generated at build, OWASP ZAP baseline scan against the preview deploy in CI, Semgrep rules for the OWASP Top 10, dependency licence check.'],
  ['Operations', 'Cloudflare WAF and DDoS in front, OpenTelemetry traces, alerts on auth anomalies (OTP floods, impossible travel), incident runbook, quarterly key rotation, threat model (STRIDE per component) kept in the repo and reviewed at the end of every phase; independent penetration test before launch.'],
];
const html = `<title>HapieCoin Build Specification</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&display=swap">
<style>
:root{--bg:#F5F6F8;--surface:#fff;--ink:#16202B;--ink2:#46546A;--ink3:#76839A;--line:#D9DFE7;--accent:#B9791A;--accentbg:#FBF1DC;--ok:#1B8A55;--okbg:#E3F3EA;--warn:#B06A00;--warnbg:#FBF1DC;--mutebg:#ECEFF3;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0D1117;--surface:#151B23;--ink:#E6EBF2;--ink2:#AEB9C7;--ink3:#7D8A9A;--line:#27313D;--accent:#EBB35A;--accentbg:#2B2113;--ok:#3DC27B;--okbg:#132A1E;--warn:#E8A23B;--warnbg:#2B2113;--mutebg:#1B232D;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0D1117;--surface:#151B23;--ink:#E6EBF2;--ink2:#AEB9C7;--ink3:#7D8A9A;--line:#27313D;--accent:#EBB35A;--accentbg:#2B2113;--ok:#3DC27B;--okbg:#132A1E;--warn:#E8A23B;--warnbg:#2B2113;--mutebg:#1B232D;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:14.5px;line-height:1.55}
header{background:var(--surface);border-bottom:1px solid var(--line)}header .in{max-width:1220px;margin:0 auto;padding:36px 28px 26px}
h1{font-family:"Bricolage Grotesque",sans-serif;font-size:38px;margin:0 0 8px;letter-spacing:-.02em}h2{font-family:"Bricolage Grotesque",sans-serif;font-size:24px;margin:0 0 12px;padding-top:34px;border-top:1px solid var(--line)}h3{font-size:16px;margin:20px 0 8px;font-weight:600}
p{margin:0 0 12px;max-width:72ch}.dek{color:var(--ink2);margin:0}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600;display:block;margin-bottom:6px}
.kpis{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}.kpi{border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:10px 14px;min-width:140px}.kpi b{display:block;font-family:"IBM Plex Mono",monospace;font-size:22px}.kpi span{font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em}
.wrap{max-width:1220px;margin:0 auto;padding:10px 28px 80px;display:grid;grid-template-columns:230px minmax(0,1fr);gap:40px}nav{position:sticky;top:16px;align-self:start;font-size:13px}nav a{display:block;color:var(--ink2);text-decoration:none;padding:5px 0 5px 10px;border-left:2px solid var(--line)}nav a:hover{color:var(--ink);border-color:var(--accent)}
table{border-collapse:collapse;width:100%;font-size:13px;background:var(--surface);border:1px solid var(--line)}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}th{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);font-weight:500;position:sticky;top:0;background:var(--surface)}.tw{overflow-x:auto;max-height:70vh;overflow-y:auto;border:1px solid var(--line);border-radius:8px}
.mono{font-family:"IBM Plex Mono",monospace;font-size:12px}.st{font-family:"IBM Plex Mono",monospace;font-size:11px;padding:2px 7px;border-radius:4px;white-space:nowrap}.st.working{background:var(--okbg);color:var(--ok)}.st.static{background:var(--mutebg);color:var(--ink2)}.st.inferred{background:var(--warnbg);color:var(--warn)}.st.confirmed{background:var(--accentbg);color:var(--accent)}.new{font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--accent);border:1px solid var(--accent);border-radius:3px;padding:0 4px;margin-left:4px}
.phase{display:grid;grid-template-columns:110px 1fr;gap:14px;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:8px;margin-bottom:10px}.phase .w{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--accent);font-weight:600}.phase .w small{display:block;color:var(--ink3);font-weight:400}.phase h4{margin:0 0 4px;font-size:15px}.phase p{margin:0 0 6px;max-width:none}.phase .exit{font-size:13px;color:var(--ink2)}.phase .exit b{color:var(--ink)}
.sec{display:grid;grid-template-columns:220px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}.sec b{font-weight:600}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.filters input,.filters select{font:inherit;font-size:13px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}
ol,ul{max-width:76ch}li{margin:4px 0}
@media (max-width:900px){.wrap{grid-template-columns:1fr}nav{display:none}.phase,.sec{grid-template-columns:1fr}}
</style>
<header><div class="in"><span class="eyebrow">Build specification · HapieCoin</span><h1>HapieCoin Build Specification</h1><p class="dek">How the real product will be built and verified so that nothing found on the original, and nothing added in v2, is lost: security design, delivery phases with exit criteria, and a requirements traceability matrix in which every feature has an ID, a phase, an owner, a test type and an acceptance criterion.</p>
<div class="kpis"><div class="kpi"><b>${rows.length}</b><span>traceable features</span></div><div class="kpi"><b>${phases.length}</b><span>phases</span></div><div class="kpi"><b>${byStatus.working || 0}</b><span>proven in mock</span></div><div class="kpi"><b>${byStatus.confirmed || 0}</b><span>owner-confirmed decisions</span></div><div class="kpi"><b>${byStatus.inferred || 0}</b><span>still to confirm</span></div><div class="kpi"><b>${rows.filter((r) => r.isNew).length}</b><span>new in v2</span></div></div></div></header>
<div class="wrap"><nav><a href="#process">How implementation is driven</a><a href="#testing">Test strategy</a><a href="#security">Security design</a><a href="#phases">Phases & exit criteria</a><a href="#matrix">Traceability matrix</a></nav><main>
<section id="process"><h2>How implementation is driven</h2>
<ol><li><b>Every feature is an ID.</b> The matrix below gives each of the ${rows.length} inventoried features a stable ID (for example HC-WS-041). Each ID becomes a tracked issue with its acceptance criterion and test type before any code is written for it.</li>
<li><b>Phases have exit gates, not dates.</b> A phase closes only when every ID assigned to it has a passing automated test, the visual diff against the v2 mock is within tolerance, and the security checklist for that phase is signed. Estimates are planning aids.</li>
<li><b>Specialised agents own packages, not screens.</b> Platform, Workspace, Trading, Analytics, Market-data and Pricing engineers work in isolated worktrees; a QA agent owns the test suites and the performance budgets; a reviewer agent reviews every pull request; the architect integrates. No agent merges its own work.</li>
<li><b>Two sources of truth.</b> The v1 clone answers "what did the original do"; the v2 mock answers "what should HapieCoin look and feel like". Both stay published for the whole build.</li>
<li><b>Inferred items are decided before they are built.</b> The 11 behaviours reconstructed from the original's bundle were reviewed on 07 Sep 2026 and decided (status 'confirmed', decisions in decisions-overrides.json and ADR-010); ${byStatus.inferred || 0} remain open.</li>
<li><b>Gaps are welcome.</b> Anything found in review (such as the strike ladder and the synchronised chain scroll already logged in GAPS.md) is added as a new ID with its own test. The matrix grows; it never silently shrinks.</li>
<li><b>Weekly demo on a deployed preview</b>, with the matrix filtered to that week's IDs, so progress is checked against the list rather than against impressions.</li></ol></section>
<section id="testing"><h2>Test strategy</h2>
<div class="sec"><b>Unit (pricing & domain)</b><span>Black-76 prices and Greeks checked against Delta's published Greeks on live tickers, property-based tests (put-call parity, monotonicity in IV), payoff and breakeven invariants, POP bounds, fee and margin formulas, strategy rules (leg limits, adjustments).</span></div>
<div class="sec"><b>API contract</b><span>Generated OpenAPI is the contract; every route has schema tests, auth tests (anonymous, user, admin), rate-limit tests and negative cases; gateway messages tested against the shared Zod schemas.</span></div>
<div class="sec"><b>End to end (Playwright)</b><span>One flow per user journey: sign up and verify, build from template, add legs from the chain, save, paper trade, view details, square off, stop, live order preview on testnet, subscribe with coupon, referral, admin CRUD, alerts, journal, share link, command palette, keyboard chain navigation, synchronised chain scroll, irregular strike ladders per expiry.</span></div>
<div class="sec"><b>Visual regression</b><span>Screenshot diff of every route in both themes against the v2 mock baseline; any change above tolerance requires explicit approval in the pull request.</span></div>
<div class="sec"><b>Performance</b><span>CI budgets: workspace route at most 350 KB gzipped, LCP under 1.2 s on throttled 4G, chain tick to paint under 8 ms, 55 fps under a recorded 100-tick burst, gateway load test at 2,000 sockets.</span></div>
<div class="sec"><b>Accessibility</b><span>axe checks on every route, keyboard reachability test for every control, contrast checks in both themes, focus-visible audit.</span></div>
<div class="sec"><b>Security</b><span>Semgrep and dependency audit per PR, ZAP baseline against previews, authorisation matrix tests (every admin and trading route × every role), secret-handling tests (keys never serialised to the client), independent penetration test before launch.</span></div>
<div class="sec"><b>Usability</b><span>Moderated sessions with three to four real options traders at the end of phase 2 and phase 5; findings become new IDs.</span></div></section>
<section id="security"><h2>Security design</h2>${security.map((s) => '<div class="sec"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>').join('')}</section>
<section id="phases"><h2>Phases & exit criteria</h2>${phases.map((p) => '<div class="phase"><div class="w">Phase ' + p.id + '<small>~' + p.weeks + ' weeks · ' + (byPhase[p.id] || 0) + ' features</small></div><div><h4>' + esc(p.name) + '</h4><p>' + esc(p.scope) + '</p><div class="exit"><b>Exit gate:</b> ' + esc(p.exit) + '</div></div></div>').join('')}</section>
<section id="matrix"><h2>Traceability matrix</h2><p>Filter by phase, area, status or text. The same data ships as <span class="mono">traceability.csv</span> and <span class="mono">traceability.json</span> in the project folder for import into an issue tracker.</p>
<div class="filters"><input id="q" placeholder="Search feature, screen, route…"><select id="ph"><option value="">All phases</option>${phases.map((p) => '<option value="' + p.id + '">Phase ' + p.id + ' · ' + esc(p.name) + '</option>').join('')}</select><select id="ar"><option value="">All areas</option>${Object.keys(areaMeta).map((a) => '<option value="' + a + '">' + esc(areaMeta[a].name) + '</option>').join('')}</select><select id="stt"><option value="">All statuses</option><option>working</option><option>static</option><option>inferred</option><option>confirmed</option></select><label style="font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="nw">new in v2 only</label><span id="cnt" style="font-size:12px;color:var(--ink3);align-self:center"></span></div>
<div class="tw"><table id="mx"><thead><tr><th>ID</th><th>Ph.</th><th>Owner</th><th>Screen · route</th><th>Feature</th><th>Mock</th><th>Tests</th><th>Acceptance criterion</th></tr></thead><tbody>${rows.map((r) => '<tr data-ph="' + r.phase + '" data-ar="' + r.area + '" data-st="' + r.status + '" data-new="' + (r.isNew ? 1 : 0) + '"><td class="mono">' + r.id + '</td><td class="mono">' + r.phase + '</td><td style="font-size:12px">' + esc(r.owner) + '</td><td style="font-size:12px">' + esc(r.screen) + '<div class="mono" style="color:var(--ink3)">' + esc(r.route) + '</div></td><td><b>' + esc(r.feature) + '</b>' + (r.isNew ? '<span class="new">NEW</span>' : '') + '</td><td><span class="st ' + r.status + '">' + r.status + '</span></td><td style="font-size:12px">' + esc(r.test) + '</td><td style="font-size:12.5px">' + esc(r.acceptance) + '</td></tr>').join('')}</tbody></table></div></section>
</main></div>
<script>(function(){var q=document.getElementById('q'),ph=document.getElementById('ph'),ar=document.getElementById('ar'),st=document.getElementById('stt'),nw=document.getElementById('nw'),cnt=document.getElementById('cnt');var rows=Array.prototype.slice.call(document.querySelectorAll('#mx tbody tr'));function upd(){var s=q.value.toLowerCase(),n=0;rows.forEach(function(r){var ok=(!ph.value||r.dataset.ph===ph.value)&&(!ar.value||r.dataset.ar===ar.value)&&(!st.value||r.dataset.st===st.value)&&(!nw.checked||r.dataset.new==='1')&&(!s||r.textContent.toLowerCase().indexOf(s)>=0);r.style.display=ok?'':'none';if(ok)n++;});cnt.textContent=n+' of '+rows.length;}[q,ph,ar,st,nw].forEach(function(e){e.addEventListener('input',upd);e.addEventListener('change',upd);});upd();})();</script>`;
fs.writeFileSync(path.join(dir, 'hapiecoin-build-spec.html'), html);
console.log('rows', rows.length, 'byPhase', byPhase, 'byStatus', byStatus);
