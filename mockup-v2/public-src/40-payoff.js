/* ===== 10-public · /payoff-preview (restyled: amber spot pill, blue target curve, ink expiry line, faint OI bars) ===== */
(function () {
  const I = CG.pubIcons, esc = CG.esc, F = CG.fmt;
  const SPOT = 100000;
  function expiryIn(days) { for (let d = days - 2; d <= days + 2; d++) { const iso = new Date(CG.NOW.getTime() + d * 86400000).toISOString().slice(0, 10); if (F.dte(iso) === days) return iso; } return new Date(CG.NOW.getTime() + days * 86400000).toISOString().slice(0, 10); }
  const EXP = expiryIn(30);
  const L = (type, action, strike, price, iv) => ({ type, action, strike, price, iv });
  function oiRebased(spot, step, n) { const rows = CG.chain('BTC', CG.state.expiry).rows; const mid = Math.floor(rows.length / 2); const out = []; for (let t = -n; t <= n; t++) { const r = rows[Math.max(0, Math.min(rows.length - 1, mid + t))]; out.push({ strike: spot + t * step, callOi: r.call.oi, putOi: r.put.oi }); } return out; }
  function oiFromChain(lo, hi) { const rows = CG.chain('BTC', CG.state.expiry).rows.filter((r) => r.strike >= lo && r.strike <= hi).map((r) => ({ strike: r.strike, callOi: r.call.oi, putOi: r.put.oi })); return rows.length ? rows : oiRebased(78000, 1000, 9); }
  const PRESETS = [
    { name: 'Iron Condor', spot: SPOT, legs: [L('PE', 'B', 90000, 200, 55), L('PE', 'S', 95000, 800, 50), L('CE', 'S', 105000, 800, 50), L('CE', 'B', 110000, 200, 55)], oi: () => oiRebased(SPOT, 1000, 15) },
    { name: 'Long Call (Unlimited)', spot: SPOT, legs: [L('CE', 'B', 100000, 1500, 55)], oi: () => oiRebased(SPOT, 1000, 15) },
    { name: 'Short Strangle (Both Unlimited)', spot: SPOT, legs: [L('PE', 'S', 95000, 800, 50), L('CE', 'S', 105000, 800, 50)], oi: () => oiRebased(SPOT, 1000, 15) },
    { name: 'Wide chain, narrow leg (BTC 78k, chain 69k-87k)', spot: 78000, legs: [L('CE', 'B', 78000, 1200, 55)], oi: () => oiFromChain(69000, 87000) }
  ];
  CG.mock.payoffPresets = PRESETS;
  const LAYERS = [['expiry', 'Expiry P&L'], ['target', 'Target Date P&L'], ['fill', 'Profit / Loss Fill'], ['oi', 'Open Interest'], ['sd', 'SD Bands'], ['be', 'Breakevens']];
  const LEGEND = [{ key: 'expiry', label: 'On Expiry', sw: '<i style="border-top-color:hsl(var(--foreground))"></i>' }, { key: 'target', label: 'On Target Date', sw: '<i style="border-top-color:hsl(var(--curve))"></i>' }, { key: 'fill', label: 'Profit', sw: '<i class="dot" style="background:hsl(var(--profit)/.35)"></i>' }, { key: 'fill', label: 'Loss', sw: '<i class="dot" style="background:hsl(var(--loss)/.35)"></i>' }, { key: 'oi', label: 'Call OI', sw: '<i class="dot" style="background:hsl(var(--muted-foreground)/.5)"></i>' }, { key: 'oi', label: 'Put OI', sw: '<i class="dot" style="background:hsl(var(--muted-foreground)/.25)"></i>' }];
  let pRoot = null; const st = { preset: PRESETS[0], zoom: 1, day: 15, target: SPOT, layers: { expiry: true, target: true, fill: true, oi: true, sd: true, be: true }, geom: null };
  const kf = (v) => { const k = v / 1000; return '$' + (k >= 100 ? k.toFixed(0) : k.toFixed(1)) + 'k'; };
  const yf = (v) => { const a = Math.abs(v); const sgn = v < 0 ? '-' : ''; if (a >= 1000) { const k = a / 1000; return sgn + '$' + (k >= 100 ? k.toFixed(0) : k.toFixed(1)) + 'k'; } return sgn + '$' + Math.round(a); };
  const sk = (v) => (v >= 0 ? '+' : '-') + '$' + F.compact(Math.abs(v));
  const oif = (v) => (v >= 1000 ? Math.round(v / 1000) + 'K' : Math.round(v));
  function compute() {
    const P = st.preset; const lotSize = CG.state.lotSizes.BTC || CG.ASSETS.BTC.lot; const lots = 1 / lotSize;
    const legs = P.legs.map((l) => ({ type: l.type === 'CE' ? 'CALL' : 'PUT', side: l.action === 'B' ? 'BUY' : 'SELL', strike: l.strike, expiry: EXP, lots, price: l.price, iv: l.iv }));
    const range = 0.18 / st.zoom; const min = P.spot * (1 - range), max = P.spot * (1 + range);
    const res = CG.analyze(legs, 'BTC', { spot: P.spot, targetDays: st.day, min, max, points: 241 });
    const at = (S) => { const r = CG.analyze(legs, 'BTC', { spot: P.spot, targetDays: st.day, min: S, max: S + 1, points: 2 }); return { exp: r.points[0].pnlExpiry, tgt: r.points[0].pnlTarget }; };
    const sigma = legs.reduce((s, l) => s + l.iv, 0) / legs.length / 100; const tDays = st.day > 0 ? st.day : res.maxDte; const k = sigma * Math.sqrt(tDays / 365);
    const sd = { m2: P.spot * Math.exp(-2 * k), m1: P.spot * Math.exp(-k), p1: P.spot * Math.exp(k), p2: P.spot * Math.exp(2 * k), days: tDays, byExpiry: st.day <= 0 };
    return { res, legs, min, max, at, maxDte: res.maxDte, sd, pts: res.points };
  }
  function draw() {
    if (!pRoot) return; const C = compute(); renderSd(C); renderSummary(C); renderSliders(C); renderLegend();
    const wrap = CG.$('#pub-pp-svgwrap', pRoot); const W = Math.max(wrap.clientWidth || 0, 420), H = Math.max(wrap.clientHeight || 0, 240);
    const P = st.preset; const pts = C.pts; const m = { l: 58, r: 46, t: 34, b: 24 }; const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xs = (S) => m.l + (S - C.min) / (C.max - C.min) * pw;
    const useT = st.layers.target && st.day < C.maxDte;
    let ymin = Infinity, ymax = -Infinity; pts.forEach((p) => { ymin = Math.min(ymin, p.pnlExpiry, useT ? p.pnlTarget : p.pnlExpiry); ymax = Math.max(ymax, p.pnlExpiry, useT ? p.pnlTarget : p.pnlExpiry); });
    if (ymin > 0) ymin = 0; if (ymax < 0) ymax = 0; const pad = (ymax - ymin) * 0.1 || 1; ymin -= pad; ymax += pad;
    const ys = (v) => m.t + (ymax - v) / (ymax - ymin) * ph; const y0 = ys(0);
    const withCross = (key) => { const out = []; for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (i) { const q = pts[i - 1]; if ((q[key] < 0 && p[key] > 0) || (q[key] > 0 && p[key] < 0)) { const t = q[key] / (q[key] - p[key]); out.push({ price: q.price + t * (p.price - q.price), v: 0 }); } } out.push({ price: p.price, v: p[key] }); } return out; };
    const linePath = (arr) => arr.map((p, i) => (i ? 'L' : 'M') + xs(p.price).toFixed(1) + ' ' + ys(p.v).toFixed(1)).join(' ');
    const expArr = withCross('pnlExpiry'); const tgtArr = pts.map((p) => ({ price: p.price, v: p.pnlTarget }));
    const areaPath = linePath(expArr) + ' L' + xs(C.max).toFixed(1) + ' ' + y0.toFixed(1) + ' L' + xs(C.min).toFixed(1) + ' ' + y0.toFixed(1) + ' Z';
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" font-family="var(--font-mono)" font-size="10">';
    s += '<defs><clipPath id="pub-pp-ca"><rect x="0" y="0" width="' + W + '" height="' + y0.toFixed(1) + '"/></clipPath><clipPath id="pub-pp-cb"><rect x="0" y="' + y0.toFixed(1) + '" width="' + W + '" height="' + (H - y0).toFixed(1) + '"/></clipPath><clipPath id="pub-pp-plot"><rect x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '"/></clipPath></defs>';
    s += '<rect x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '" fill="hsl(var(--background))"/>';
    if (st.layers.sd) { const a = Math.max(xs(C.sd.m1), m.l), b = Math.min(xs(C.sd.p1), m.l + pw); if (b > a) s += '<rect x="' + a.toFixed(1) + '" y="' + m.t + '" width="' + (b - a).toFixed(1) + '" height="' + ph + '" fill="hsl(var(--muted-foreground))" opacity=".07"/>'; [[C.sd.m1, '-1σ'], [C.sd.p1, '+1σ']].forEach(([v, l]) => { if (v >= C.min && v <= C.max) s += '<line x1="' + xs(v).toFixed(1) + '" y1="' + m.t + '" x2="' + xs(v).toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="hsl(var(--muted-foreground))" stroke-dasharray="2 3" opacity=".7"/><text x="' + (xs(v) + (l[0] === '-' ? -4 : 4)).toFixed(1) + '" y="' + (m.t + 12) + '" text-anchor="' + (l[0] === '-' ? 'end' : 'start') + '" font-size="9" fill="hsl(var(--muted-foreground))">' + l + ' ' + kf(v) + '</text>'; }); }
    for (let i = 0; i <= 4; i++) { const v = ymax - (ymax - ymin) * i / 4; const y = ys(v); s += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (m.l + pw) + '" y2="' + y.toFixed(1) + '" stroke="hsl(var(--border))"/><text x="' + (m.l - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" fill="hsl(var(--muted-foreground))">' + yf(v) + '</text>'; }
    const span = C.max - C.min; const raw = span / 9; const mag = Math.pow(10, Math.floor(Math.log10(raw))); const nice = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= raw); for (let v = Math.ceil(C.min / nice) * nice; v <= C.max + 1e-9; v += nice) { const x = xs(v); s += '<line x1="' + x.toFixed(1) + '" y1="' + m.t + '" x2="' + x.toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="hsl(var(--border))" stroke-dasharray="1 3"/><text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" fill="hsl(var(--muted-foreground))">' + kf(v) + '</text>'; }
    s += '<line x1="' + m.l + '" y1="' + y0.toFixed(1) + '" x2="' + (m.l + pw) + '" y2="' + y0.toFixed(1) + '" stroke="hsl(var(--muted-foreground))"/>';
    if (st.layers.fill && st.layers.expiry) s += '<path d="' + areaPath + '" fill="hsl(var(--profit))" opacity=".18" clip-path="url(#pub-pp-ca)"/><path d="' + areaPath + '" fill="hsl(var(--loss))" opacity=".18" clip-path="url(#pub-pp-cb)"/>';
    if (st.layers.oi) { const oi = P.oi(); const maxOi = Math.max(1, ...oi.map((o) => Math.max(o.callOi, o.putOi))); const bh = ph * 0.25; oi.filter((o) => o.strike >= C.min && o.strike <= C.max).forEach((o) => { const x = xs(o.strike); const hc = o.callOi / maxOi * bh, hp = o.putOi / maxOi * bh; s += '<rect x="' + (x - 5).toFixed(1) + '" y="' + (m.t + ph - hc).toFixed(1) + '" width="4" height="' + hc.toFixed(1) + '" fill="hsl(var(--muted-foreground))" opacity=".3"><title>' + F.int(o.strike) + ' · Call OI ' + F.int(o.callOi) + '</title></rect><rect x="' + (x + 1).toFixed(1) + '" y="' + (m.t + ph - hp).toFixed(1) + '" width="4" height="' + hp.toFixed(1) + '" fill="hsl(var(--muted-foreground))" opacity=".16"><title>' + F.int(o.strike) + ' · Put OI ' + F.int(o.putOi) + '</title></rect>'; }); s += '<text x="' + (m.l + pw + 6) + '" y="' + (m.t + ph - bh + 3).toFixed(1) + '" fill="hsl(var(--muted-foreground))">' + oif(maxOi) + '</text><text x="' + (m.l + pw + 6) + '" y="' + (m.t + ph - bh * 0.4 + 3).toFixed(1) + '" fill="hsl(var(--muted-foreground))">' + oif(maxOi * 0.4) + '</text>'; }
    if (st.layers.expiry) s += '<path d="' + linePath(expArr) + '" fill="none" stroke="hsl(var(--foreground))" stroke-width="1.6" stroke-linejoin="round"/>';
    if (useT) s += '<path d="' + linePath(tgtArr) + '" fill="none" stroke="hsl(var(--curve))" stroke-width="1.6" clip-path="url(#pub-pp-plot)"/>';
    if (st.layers.be) C.res.breakevens.forEach((b) => { if (b >= C.min && b <= C.max) s += '<line x1="' + xs(b).toFixed(1) + '" y1="' + m.t + '" x2="' + xs(b).toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="hsl(var(--muted-foreground))" stroke-dasharray="4 3"/><text x="' + (xs(b) + 4).toFixed(1) + '" y="' + (m.t + ph - 6) + '" font-size="9" fill="hsl(var(--foreground))">BE ' + F.int(b) + '</text>'; });
    if (st.target !== P.spot && st.target >= C.min && st.target <= C.max) { const v = C.at(st.target); s += '<line x1="' + xs(st.target).toFixed(1) + '" y1="' + m.t + '" x2="' + xs(st.target).toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="hsl(var(--curve))" stroke-dasharray="2 3" opacity=".8"/><circle cx="' + xs(st.target).toFixed(1) + '" cy="' + ys(useT ? v.tgt : v.exp).toFixed(1) + '" r="3.5" fill="hsl(var(--background))" stroke="hsl(var(--curve))" stroke-width="1.6"/><text x="' + (xs(st.target) + 6).toFixed(1) + '" y="' + (ys(useT ? v.tgt : v.exp) - 6).toFixed(1) + '" font-size="9" fill="hsl(var(--curve))">' + sk(useT ? v.tgt : v.exp) + ' @ ' + F.int(st.target) + '</text>'; }
    const sx = xs(P.spot); s += '<line x1="' + sx.toFixed(1) + '" y1="' + m.t + '" x2="' + sx.toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="hsl(var(--spot))" stroke-width="1.4"/><g transform="translate(' + (sx - 48).toFixed(1) + ',' + (m.t - 22) + ')"><rect width="96" height="16" rx="2" fill="hsl(var(--spot))"/><text x="48" y="11.5" text-anchor="middle" font-size="9" font-weight="600" letter-spacing=".08em" fill="hsl(var(--primary-foreground))">SPOT $' + F.num(P.spot, 0) + '</text></g>';
    s += '<g id="pub-pp-cross" style="display:none"><line data-cl x1="0" y1="' + m.t + '" x2="0" y2="' + (m.t + ph) + '" stroke="hsl(var(--foreground))" opacity=".45"/><circle data-ce r="3.5" fill="hsl(var(--foreground))" stroke="hsl(var(--background))" stroke-width="1.5"/><circle data-ct r="3.5" fill="hsl(var(--curve))" stroke="hsl(var(--background))" stroke-width="1.5"/></g>';
    s += '</svg>';
    const old = wrap.querySelector('svg'); if (old) old.remove(); wrap.insertAdjacentHTML('afterbegin', s);
    st.geom = { xs, ys, pts, min: C.min, max: C.max, m, W, H, pw, useT };
  }
  function renderSd(C) { const d = C.sd; CG.$('#pub-pp-sd', pRoot).innerHTML = '<div>-2SD<b>' + kf(d.m2) + '</b></div><div>-1SD<b>' + kf(d.m1) + '</b></div><div class="cur">Current<b>' + kf(st.preset.spot) + '</b><span class="sub">Expected move by ' + (d.byExpiry ? 'expiry' : 'target date') + ' (' + d.days + 'd)</span></div><div>+1SD<b>' + kf(d.p1) + '</b></div><div>+2SD<b>' + kf(d.p2) + '</b></div>'; }
  function renderSummary(C) { const v = C.at(st.target); const pct = (st.target / st.preset.spot - 1) * 100; const dl = st.day > 0 ? st.day + 'D' : 'Today'; const pos = v.exp >= 0; CG.$('#pub-pp-summary', pRoot).innerHTML = '<span>@ <span class="t">' + kf(st.target) + '</span> <span class="' + (pct >= 0 ? 'text-profit' : 'text-loss') + '">(' + F.pct(pct, 1) + ')</span></span><span>' + dl + ': <b class="' + (v.tgt >= 0 ? 'text-profit' : 'text-loss') + '">' + sk(v.tgt) + '</b></span><span>Expiry: <b class="' + (pos ? 'text-profit' : 'text-loss') + '">' + sk(v.exp) + '</b></span><span class="pub-pp-pill ' + (pos ? 'profit' : 'loss') + '">' + (pos ? I.trending : I.trendingdown) + (pos ? 'Profit' : 'Loss') + ': $' + F.compact(Math.abs(v.exp)) + '</span>'; }
  function dayLabel(d) { const dt = new Date(CG.NOW.getTime() + d * 86400000); const wd = dt.toLocaleDateString('en-US', { weekday: 'short' }); const dd = String(dt.getDate()).padStart(2, '0'); const mo = dt.toLocaleDateString('en-US', { month: 'short' }); return wd + ', ' + dd + ' ' + mo + ' ' + F.time(dt); }
  function renderSliders(C) {
    const t = CG.$('#pub-pp-target', pRoot); t.min = Math.round(C.min); t.max = Math.round(C.max); t.step = 100; t.value = st.target; CG.$('#pub-pp-target-val', pRoot).textContent = kf(st.target); CG.$('#pub-pp-target-min', pRoot).textContent = kf(C.min); CG.$('#pub-pp-target-max', pRoot).textContent = kf(C.max);
    const pct = (st.target / st.preset.spot - 1) * 100; const chip = CG.$('#pub-pp-pct', pRoot); chip.textContent = F.pct(pct, 1); chip.classList.toggle('up', pct >= 0); chip.classList.toggle('down', pct < 0);
    const d = CG.$('#pub-pp-day', pRoot); d.min = 0; d.max = C.maxDte; d.step = 1; d.value = st.day; CG.$('#pub-pp-day-val', pRoot).textContent = dayLabel(st.day); CG.$('#pub-pp-day-max', pRoot).textContent = 'Expiry (' + F.date(new Date(CG.NOW.getTime() + C.maxDte * 86400000), { day: '2-digit', month: 'short' }) + ')';
    CG.$('#pub-pp-zoomlbl', pRoot).textContent = Math.round(st.zoom * 100) + '%';
  }
  function renderLegend() { CG.$('#pub-pp-legend', pRoot).innerHTML = LEGEND.map((l) => '<span class="pub-pp-lg' + (st.layers[l.key] ? '' : ' off') + '" data-legend="' + l.key + '" title="Toggle ' + esc(l.label) + '">' + l.sw + esc(l.label) + '</span>').join(''); }
  function renderPop() { CG.$('#pub-pp-pop', pRoot).innerHTML = '<h4>Chart Layers</h4>' + LAYERS.map((l) => '<label><span>' + esc(l[1]) + '</span><span class="switch' + (st.layers[l[0]] ? ' on' : '') + '" data-layer="' + l[0] + '" role="switch" aria-checked="' + !!st.layers[l[0]] + '"></span></label>').join(''); }
  function renderPresets() { CG.$('#pub-pp-presets', pRoot).innerHTML = PRESETS.map((p, i) => '<button type="button" class="btn btn-sm ' + (st.preset === p ? 'btn-secondary' : 'btn-outline') + '" data-preset="' + i + '"' + (st.preset === p ? ' style="box-shadow:inset 0 0 0 1px hsl(var(--foreground)/.5)"' : '') + '>' + esc(p.name) + '</button>').join(''); }
  function hover(e) {
    const g = st.geom; if (!g) return; const wrap = CG.$('#pub-pp-svgwrap', pRoot); const r = wrap.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const tip = CG.$('#pub-pp-tip', pRoot); const cross = CG.$('#pub-pp-cross', pRoot);
    if (x < g.m.l || x > g.m.l + g.pw) { tip.hidden = true; if (cross) cross.style.display = 'none'; return; }
    const price = g.min + (x - g.m.l) / g.pw * (g.max - g.min); let idx = 0, best = Infinity; g.pts.forEach((p, i) => { const d = Math.abs(p.price - price); if (d < best) { best = d; idx = i; } }); const p = g.pts[idx]; const px = g.xs(p.price);
    if (cross) { cross.style.display = ''; const cl = cross.querySelector('[data-cl]'); cl.setAttribute('x1', px); cl.setAttribute('x2', px); const ce = cross.querySelector('[data-ce]'); ce.setAttribute('cx', px); ce.setAttribute('cy', g.ys(p.pnlExpiry)); ce.style.display = st.layers.expiry ? '' : 'none'; const ct = cross.querySelector('[data-ct]'); ct.setAttribute('cx', px); ct.setAttribute('cy', g.ys(p.pnlTarget)); ct.style.display = g.useT ? '' : 'none'; }
    tip.hidden = false; tip.innerHTML = '<b>$' + F.num(p.price, 0) + '</b><span>Expiry: <em class="' + (p.pnlExpiry >= 0 ? 'text-profit' : 'text-loss') + '" style="font-style:normal">' + sk(p.pnlExpiry) + '</em></span><span>' + (st.day > 0 ? st.day + 'D' : 'Today') + ': <em class="' + (p.pnlTarget >= 0 ? 'text-profit' : 'text-loss') + '" style="font-style:normal">' + sk(p.pnlTarget) + '</em></span>';
    const tw = tip.offsetWidth || 120; tip.style.left = (x + 14 + tw > r.width ? x - tw - 14 : x + 14) + 'px'; tip.style.top = Math.max(4, Math.min(y - 20, r.height - 70)) + 'px';
  }
  CG.register('/payoff-preview', {
    init(root) {
      pRoot = root; CG.pubFillIcons(root); renderPresets(); renderPop(); renderLegend();
      CG.delegate(root, 'click', '[data-preset]', (e, b) => { st.preset = PRESETS[+b.dataset.preset]; st.target = st.preset.spot; st.zoom = 1; st.day = 15; renderPresets(); draw(); });
      CG.delegate(root, 'click', '[data-pp-zoom]', (e, b) => { const k = b.dataset.ppZoom; st.zoom = k === 'in' ? Math.min(4, st.zoom * 1.25) : k === 'out' ? Math.max(0.5, st.zoom / 1.25) : 1; const range = 0.18 / st.zoom; st.target = Math.max(st.preset.spot * (1 - range), Math.min(st.preset.spot * (1 + range), st.target)); draw(); });
      const pop = CG.$('#pub-pp-pop', root); CG.delegate(root, 'click', '[data-pp-layers]', () => { pop.hidden = !pop.hidden; });
      document.addEventListener('mousedown', (e) => { if (!pop.hidden && !e.target.closest('.pub-pp-layers-wrap')) pop.hidden = true; });
      CG.delegate(root, 'click', '[data-layer]', (e, sw) => { e.preventDefault(); const k = sw.dataset.layer; st.layers[k] = !st.layers[k]; sw.classList.toggle('on', st.layers[k]); sw.setAttribute('aria-checked', st.layers[k]); draw(); });
      CG.delegate(root, 'click', '[data-legend]', (e, el) => { const k = el.dataset.legend; st.layers[k] = !st.layers[k]; renderPop(); draw(); });
      const tgt = CG.$('#pub-pp-target', root); tgt.addEventListener('input', () => { st.target = +tgt.value; draw(); });
      CG.delegate(root, 'click', '[data-pp-target]', (e, b) => { const g = st.geom || { min: st.preset.spot * .82, max: st.preset.spot * 1.18 }; st.target = Math.max(g.min, Math.min(g.max, st.target + (b.dataset.ppTarget === '+' ? 500 : -500))); draw(); });
      const day = CG.$('#pub-pp-day', root); day.addEventListener('input', () => { st.day = +day.value; draw(); });
      CG.delegate(root, 'click', '[data-pp-day]', (e, b) => { const max = +CG.$('#pub-pp-day', root).max || 30; st.day = Math.max(0, Math.min(max, st.day + (b.dataset.ppDay === '+' ? 1 : -1))); draw(); });
      const wrap = CG.$('#pub-pp-svgwrap', root); wrap.addEventListener('mousemove', hover); wrap.addEventListener('mouseleave', () => { CG.$('#pub-pp-tip', root).hidden = true; const c = CG.$('#pub-pp-cross', root); if (c) c.style.display = 'none'; });
      let rt = null; window.addEventListener('resize', () => { if (!root.classList.contains('active')) return; clearTimeout(rt); rt = setTimeout(draw, 80); });
      CG.on('theme', () => { if (root.classList.contains('active')) draw(); });
    },
    show() { requestAnimationFrame(draw); setTimeout(draw, 120); }
  });
})();
