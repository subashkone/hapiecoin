// Generates docs/BACKLOG.md: open roadmap items, every open GAPS row in full, and the mock-only spec rows.
// Run: node spec/gen-backlog.js. Section 1 (roadmap items) is edited here by hand; sections 2 and 3 regenerate
// from GAPS.md and spec/traceability.json.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..") + "/";
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

// every GAPS row whose status does not start with closed / done / fixed / resolved
const gaps = fs
  .readFileSync(root + "GAPS.md", "utf8")
  .split("\n")
  .filter((l) => /^\| [0-9]+ \|/.test(l))
  .map((l) => {
    // a few rows carry an extra column or swap Source and Status, so the status is the cell that reads like one
    const c = l.replace(/\|\s*$/, "").split(" | ").map((x) => x.trim());
    const rest = c.slice(3);
    const si = rest.findIndex((x) => /^(open|closed|fixed|done|partly|resolved)\b/i.test(x));
    const status = si >= 0 ? rest[si] : rest[rest.length - 1] ?? "";
    const source = (si >= 0 ? rest.filter((_, i) => i !== si) : rest.slice(0, -1)).join(" · ");
    return { n: +c[0].replace("|", "").trim(), area: c[1], gap: c[2], source, status };
  })
  .filter((r) => !/^(closed|done|fixed|resolved)/i.test(r.status));
const t = JSON.parse(fs.readFileSync(root + "spec/traceability.json", "utf8"));
const rows = Array.isArray(t) ? t : t.rows || Object.values(t).find(Array.isArray);

// priority: what blocks money, safety or a launch promise first
function priority(g) {
  const s = (g.area + " " + g.gap).toLowerCase();
  if (/security|auth|secret|key|2fa|passkey|second factor|webhook|rate limit|blocker/.test(s)) return "High";
  if (/live|order|trading|fill|drift|settle|margin|position|mindful|resting/.test(s)) return "High";
  if (/analytics|data|feed|binance|okx|etf|unlock|reserve|coingecko|paid|hyperliquid|whale/.test(s)) return "Medium (data)";
  if (/test|flak|e2e|coverage|ci/.test(s)) return "Low (tests)";
  if (/mobile|phone|safari|pwa|install|touch/.test(s)) return "Medium";
  return "Medium";
}
const groups = {};
for (const g of gaps) {
  const a = g.area.split(" (")[0].split(" · ")[0].split(" / ")[0].trim();
  (groups[a] ||= []).push(g);
}

let md = `# HapieCoin backlog (feature freeze, 13 September 2026)

The feature set is frozen at main \`933dcdc\` for the first launch (ADR-090). Everything below is known, recorded, and **not scheduled**: it is the only intake for work after launch. Nothing here is required to go live; the go-live blockers are in [GO-LIVE-READINESS.md](GO-LIVE-READINESS.md).

Three sources, kept in sync with their originals: the roadmap items still open ([ROADMAP.md](ROADMAP.md)), every open review gap in full ([../GAPS.md](../GAPS.md)), and the build-spec rows whose screens exist but whose data feed is not connected ([../spec/traceability.json](../spec/traceability.json)). Regenerate with \`node spec/gen-backlog.js\`.

## 1. Roadmap items not started

| # | Item | What it involves | Why it waits |
|---|---|---|---|
`;
const items = [
  ["13", "Deployment", "Provision the stack per docs/deploy.md: images for web and ingest, secrets, managed Postgres with TimescaleDB, proxy with TLS and WebSocket upgrade, fixed egress IP, uptime checks, backups.", "The user's provider and domain decisions (readiness report §6). This is the go-live item itself, not a feature."],
  ["14", "Delta Exchange India partnership", "Broker-pays or affiliate conversation; the referral and commission machinery already exists.", "A business conversation, no code until terms exist."],
  ["15", "Free vs Pro split and the education funnel", "Tune the plan split to the competitor anchor (₹392–800 / month); an English + Hindi education funnel tied to paper trading.", "Pricing decision by the user; content work."],
  ["16", "Paid-data analytics rows", "ETF flows, exchange reserves, token unlocks, per-coin liquidation history and the other mock-only rows in §3.", "Only with the user's go-ahead on data spend."],
  ["21", "E2 currency", "`Money { amount, ccy }` type, ISO-4217 display list, ECB reference rates via an ingest job (`fx_rates`, `GET /fx`), manual override with a basis badge; billing stays INR.", "Feature freeze. Today INR / USD display with a manual conversion rate already works."],
  ["22", "E3 languages", "next-intl, cookie locale, chrome → dialogs → settings → content; Hindi, Tamil and Telugu together; per-locale assistant match tables.", "Feature freeze."],
  ["23b", "E4 mobile, Capacitor half", "Native shell with push notifications and biometric unlock, Play Store and App Store listings.", "Store accounts from the user; the PWA half (manifest, offline worker, install) shipped in PR #95."],
  ["29", "zod/mini for the schema package + bundle check in CI", "Smaller first-load bundle on /analyse (GAPS #19); make the bundle budget a hard CI check.", "Feature freeze; a warning today, not a failure."],
];
for (const [n, item, what, why] of items) md += `| ${n} | ${esc(item)} | ${esc(what)} | ${esc(why)} |\n`;

const total = fs.readFileSync(root + "GAPS.md", "utf8").split("\n").filter((l) => /^\| [0-9]+ \|/.test(l)).length;
md += `\n## 2. Open review gaps (${gaps.length} of ${total})

Every row is copied in full from GAPS.md so this page stands alone. Priority is a recommendation for after launch: **High** touches money, safety or a promise the product makes; **Medium (data)** needs a data feed or a spend decision; **Low (tests)** is test hygiene.

`;
const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
for (const area of order) {
  md += `### ${area}\n\n| # | Gap | Source | Status | Priority |\n|---|---|---|---|---|\n`;
  for (const g of groups[area]) md += `| ${g.n} | ${esc(g.gap)} | ${esc(g.source)} | ${esc(g.status || "open")} | ${priority(g)} |\n`;
  md += "\n";
}

const stat = rows.filter((r) => r.status === "static");
md += `## 3. Screens built on mock data (${stat.length} spec rows)

These screens render and are tested, but the number they show comes from the mock catalogue until a paid or additional data feed is connected (roadmap 16). They are marked "coming soon" in the product where a whole page is affected.

| ID | Screen | Feature | What is missing |
|---|---|---|---|
`;
for (const r of stat) md += `| ${r.id} | ${esc(r.screen)} | ${esc(r.feature)} | ${esc(r.acceptance)} |\n`;

md += `
## 4. How to use this page

- A launch bug is not backlog: it goes to GAPS.md as a row and gets fixed on a branch.
- To schedule an item, move it back to ROADMAP.md with a number and an owner; leave the GAPS row until the fix merges.
- Regenerate §2 and §3 from GAPS.md and the spec with \`node spec/gen-backlog.js\` rather than editing them here.
`;
fs.writeFileSync(root + "docs/BACKLOG.md", md);
console.log("backlog written:", gaps.length, "open gaps of", total + ",", stat.length, "static rows,", order.length, "areas");
