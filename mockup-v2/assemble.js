// Assembles shell-head.html + core.js + parts/*.html (sorted) + features screen into hapiecoin-v2.html
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const head = fs.readFileSync(path.join(dir, 'shell-head.html'), 'utf8');
const core = fs.readFileSync(path.join(dir, 'core.js'), 'utf8');
const partsDir = path.join(dir, 'parts');
const parts = fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter((f) => f.endsWith('.html')).sort() : [];
let body = '';
for (const f of parts) { body += '\n<!-- ===== part: ' + f + ' ===== -->\n' + fs.readFileSync(path.join(partsDir, f), 'utf8') + '\n'; }
// feature inventory
const featDir = path.join(dir, 'features');
let features = [];
if (fs.existsSync(featDir)) for (const f of fs.readdirSync(featDir).filter((x) => x.endsWith('.json')).sort()) { try { const arr = JSON.parse(fs.readFileSync(path.join(featDir, f), 'utf8')); arr.forEach((x) => (x.group = x.group || f.replace('.json', ''))); features = features.concat(arr); } catch (e) { console.error('bad features json', f, e.message); } }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const byScreen = {};
features.forEach((f) => { const k = (f.route || '?') + '||' + (f.screen || ''); (byScreen[k] = byScreen[k] || []).push(f); });
let featHtml = '<section class="screen" data-route="/features" data-title="Feature Inventory"><div data-cg="app-header"></div><div class="container py-8"><h1>Feature inventory</h1><p class="text-muted mt-2">Every screen, control and behaviour required for HapieCoin (everything the original site offers, plus the v2 additions), and how this mock reproduces it. ' + features.length + ' features across ' + Object.keys(byScreen).length + ' screens. Status: <span class="badge badge-success">working</span> = interactive in this mockup · <span class="badge badge-secondary">static</span> = rendered with mock data only · <span class="badge badge-warning">inferred</span> = behaviour reconstructed from the bundle, not observed.</p><div class="mt-4 flex gap-2 items-center"><input class="input" style="max-width:320px" placeholder="Filter features…" id="feat-filter"><span class="text-muted text-xs" id="feat-count"></span></div><div id="feat-list" class="mt-4">';
Object.keys(byScreen).sort().forEach((k) => { const [route, screen] = k.split('||'); const rows = byScreen[k]; featHtml += '<div class="card mb-4 feat-group"><div class="card-header flex items-center gap-3"><div><div class="card-title">' + esc(screen || route) + '</div><div class="card-desc mono">' + esc(route) + '</div></div><a class="btn btn-outline btn-sm ml-auto" href="#' + esc(route.replace(/:\w+/g, (m) => ({ ':symbol': 'BTC', ':slug': 'layer-1', ':exchange': 'Binance' }[m] || 'x'))) + '">Open screen</a></div><div class="card-content" style="padding-top:0"><table class="table table-compact"><thead><tr><th style="width:32%">Feature</th><th>How it works in the clone</th><th style="width:90px">Status</th></tr></thead><tbody>'; rows.forEach((r) => { featHtml += '<tr class="feat-row"><td><b>' + esc(r.feature) + '</b>' + (r.evidence ? '<div class="text-2xs text-muted">' + esc(r.evidence) + '</div>' : '') + '</td><td class="text-xs">' + esc(r.how || r.notes || '') + '</td><td><span class="badge ' + (r.status === 'working' ? 'badge-success' : r.status === 'inferred' ? 'badge-warning' : 'badge-secondary') + '">' + esc(r.status || 'static') + '</span></td></tr>'; }); featHtml += '</tbody></table></div></div>'; });
featHtml += '</div></div><div data-cg="footer"></div></section><script>CG.register("/features",{init(root){const inp=root.querySelector("#feat-filter"),cnt=root.querySelector("#feat-count");const rows=Array.from(root.querySelectorAll(".feat-row"));const upd=()=>{const q=inp.value.toLowerCase();let n=0;rows.forEach(r=>{const ok=!q||r.textContent.toLowerCase().includes(q);r.style.display=ok?"":"none";if(ok)n++;});root.querySelectorAll(".feat-group").forEach(g=>{g.style.display=Array.from(g.querySelectorAll(".feat-row")).some(r=>r.style.display!=="none")?"":"none";});cnt.textContent=n+" of "+rows.length+" features";};inp.addEventListener("input",upd);upd();}});</script>';
const notFound = body.includes('data-route="*"') ? '' : '<section class="screen" data-route="*" data-title="Not found"><div class="min-h-screen flex items-center justify-center bg-muted"><div class="text-center"><h1 class="text-4xl mb-4">404</h1><p class="text-xl text-muted mb-4">Oops! Page not found</p><a href="#/" class="text-primary" style="text-decoration:underline">Return to Home</a></div></div></section>';
const out = head + '\n<script>\n' + core + '\n</script>\n<div id="cg-app">\n' + body + '\n' + featHtml + '\n' + notFound + '\n</div>\n';
fs.writeFileSync(path.join(dir, 'hapiecoin-v2.html'), out);
fs.writeFileSync(path.join(dir, 'hapiecoin-v2.local.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{color-scheme:dark}body{margin:0;font:14px system-ui,sans-serif;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + out + '</body></html>');
const routeRe = new RegExp('<section(?=[^>]*class="[^"]*screen)[^>]*data-route="([^"]+)"', 'g');
const routes = Array.from(out.matchAll(routeRe)).map((m) => m[1]);
console.log('parts:', parts.join(', '));
console.log('bytes:', out.length, 'screens:', routes.length, 'features:', features.length);
console.log('routes:', routes.join('  '));
