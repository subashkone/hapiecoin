<script>
/* ===== Market Analytics v2 · shared runtime (window.CG2 = CG.analytics) used by BOTH /analytics and /terminal =====
   Skin: shell tokens only. Charts (timeframes, toggleable legend, crosshair, last-value tags, skeletons), tables
   (sticky/sortable/search/columns/CSV/star/compare), gauges, treemap, donut, watchlist, compare, shared header, palette. */
(function () {
  const CG = window.CG; const M = CG.mock; const F = CG.fmt;
  const A = (window.CG2 = window.CG2 || {}); CG.analytics = A; A.st = A.st || {};
  const bootReal = Date.now();
  A.now = () => new Date(CG.NOW.getTime() + (Date.now() - bootReal));
  const ICON = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.3L12 17.5 6.4 20.4l1.1-6.3L3 9.7l6.2-.9z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.3L12 17.5 6.4 20.4l1.1-6.3L3 9.7l6.2-.9z"/></svg>',
    columns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    caret: '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 17l5-6 4 4 5-8 4 3"/><path d="M3 21h18"/></svg>'
  };
  A.icons = ICON;
  // ---------- theme: the PAGE theme (html.dark via CG.theme) is the only theme; no private toggle or storage ----------
  A.theme = CG.theme;
  A.applyTheme = function () { const t = CG.theme.get(); CG.$$('[data-theme-btn]').forEach((b) => { b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon; b.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'; }); };
  CG.on('theme', A.applyTheme);
  A.applyDensity = function () { const d = CG.state.density || 'comfortable'; CG.$$('.cgx').forEach((el) => el.setAttribute('data-density', d)); };
  CG.on('density', (d) => { if (typeof d === 'string') CG.state.density = d; A.applyDensity(); });
  // ---------- colours: tokens only. price = fg · OI/secondary = curve · up/down = profit/loss · accent marks = primary ----------
  const C = (A.C = { fg: 'hsl(var(--foreground))', curve: 'hsl(var(--curve))', up: 'hsl(var(--profit))', down: 'hsl(var(--loss))', primary: 'hsl(var(--primary))', muted: 'hsl(var(--muted-foreground))', border: 'hsl(var(--border))', warn: 'hsl(var(--warning))', bg: 'hsl(var(--background))', card: 'hsl(var(--card))' });
  A.slot = (i) => [C.fg, C.curve, C.primary, C.warn, C.up, C.down][i % 6];
  // ---------- formatting ----------
  A.price = (p) => { if (p == null || isNaN(p)) return '—'; if (p >= 1000) return '$' + F.num(p, 2); if (p >= 1) return '$' + F.num(p, p >= 100 ? 2 : 3); return '$' + p.toFixed(p >= 0.01 ? 4 : 7).replace(/0+$/, '').replace(/\.$/, ''); };
  A.usd = F.usdCompact;
  A.pct = F.pct;
  A.cls = (v) => (v > 0 ? 'cg2-up' : v < 0 ? 'cg2-down' : 'cg2-dim');
  A.signed = (v, d) => '<span class="' + A.cls(v) + ' mono">' + F.pct(v, d) + '</span>';
  A.signedUsd = (v) => '<span class="' + A.cls(v) + ' mono">' + (v >= 0 ? '+' : '-') + F.usdCompact(Math.abs(v)) + '</span>';
  A.heat = (v, opts) => { opts = opts || {}; if (v == null || isNaN(v)) return '<span class="cg2-heat cg2-dim">—</span>'; const max = opts.max || 5; const a = Math.min(Math.abs(v) / max, 1); const tok = v >= 0 ? '--profit' : '--loss'; const al = v === 0 ? 0.08 : 0.14 + a * 0.76; const col = al > 0.55 ? '#fff' : 'hsl(var(' + tok + '))'; return '<span class="cg2-heat" style="background:hsl(var(' + tok + ')/' + al.toFixed(2) + ');color:' + col + '">' + (opts.fmt ? opts.fmt(v) : F.pct(v, opts.d == null ? 2 : opts.d)) + '</span>'; };
  A.rsiHeat = (v) => { if (v == null) return '<span class="cg2-heat cg2-dim">—</span>'; let tok = null, a = 0; if (v <= 35) { tok = '--profit'; a = Math.min((35 - v) / 15, 1); } else if (v >= 65) { tok = '--loss'; a = Math.min((v - 65) / 15, 1); } if (!tok) return '<span class="cg2-heat" style="background:hsl(var(--muted))">' + v + '</span>'; const al = 0.18 + a * 0.72; return '<span class="cg2-heat" style="background:hsl(var(' + tok + ')/' + al.toFixed(2) + ');color:' + (al > 0.55 ? '#fff' : 'hsl(var(' + tok + '))') + '">' + v + '</span>'; };
  A.icon = (sym) => '<span class="cg2-coin-ic">' + CG.esc(String(sym || '').slice(0, 3)) + '</span>';
  A.asset = (c, opts) => '<span class="cg2-asset">' + (opts && opts.rank ? '<span class="rk">' + c.rank + '</span>' : '') + A.icon(c.symbol) + '<b>' + CG.esc(c.symbol) + '</b>' + (opts && opts.name === false ? '' : '<small>' + CG.esc(c.name) + '</small>') + '</span>';
  A.hm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  A.hms = (iso) => { const d = new Date(iso); return A.hm(iso) + ':' + String(d.getSeconds()).padStart(2, '0'); };
  A.md = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  A.mdt = (iso) => A.md(iso) + ' ' + A.hm(iso);
  A.my = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  A.ago = (iso) => { const s = Math.max(0, Math.round((A.now() - new Date(iso)) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  A.coin = (sym) => M.coins.find((c) => c.symbol === String(sym || '').toUpperCase());
  A.byCap = () => M.coins.slice().sort((a, b) => b.marketCap - a.marketCap);
  A.split = (l, s) => { const t = (l + s) || 1; return '<span class="cg2-split"><i class="l" style="width:' + (l / t * 100).toFixed(1) + '%"></i><i class="s" style="width:' + (s / t * 100).toFixed(1) + '%"></i></span>'; };
  A.tile = (label, value, sub, extra, cls) => '<div class="cg2-tile' + (cls ? ' ' + cls : '') + '"><div class="cg2-tile-l">' + label + '</div><div class="cg2-tile-v">' + value + '</div>' + (sub ? '<div class="cg2-tile-s">' + sub + '</div>' : '') + (extra || '') + '</div>';
  A.panel = (title, sub, body, tools, attrs) => '<div class="cg2-panel" ' + (attrs || '') + '><div class="cg2-ph"><span class="cg2-pt">' + title + '</span>' + (sub ? '<span class="cg2-ps">· ' + sub + '</span>' : '') + (tools ? '<div class="cg2-tools">' + tools + '</div>' : '') + '</div>' + body + '</div>';
  A.chips = (items, cur, attr) => '<div class="cg2-chips">' + items.map((it) => { const v = Array.isArray(it) ? it[0] : it, l = Array.isArray(it) ? it[1] : it; return '<button class="cg2-chip' + (v === cur ? ' on' : '') + '" ' + attr + '="' + CG.esc(v) + '">' + CG.esc(l) + '</button>'; }).join('') + '</div>';
  A.seg = (items, cur, attr) => '<div class="cg2-seg">' + items.map((it) => { const v = Array.isArray(it) ? it[0] : it, l = Array.isArray(it) ? it[1] : it; return '<button class="' + (v === cur ? 'on' : '') + '" ' + attr + '="' + CG.esc(v) + '">' + CG.esc(l) + '</button>'; }).join('') + '</div>';
  const strip = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  A.copy = function (text, msg) { const done = () => CG.toast({ title: msg || 'Copied to clipboard', variant: 'success' }); const legacy = () => { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; } }; const fail = () => CG.toast({ title: 'Copy failed', description: 'Clipboard is not available here', variant: 'destructive' }); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => (legacy() ? done() : fail())); else legacy() ? done() : fail(); };
  // ---------- timeframes: regenerate a mock series for 1D · 7D · 30D · 90D · 1Y, anchored at the current value ----------
  A.TF = { '1D': { n: 24, stepH: 1 }, '7D': { n: 56, stepH: 3 }, '30D': { n: 60, stepH: 12 }, '90D': { n: 90, stepH: 24 }, '180D': { n: 90, stepH: 48 }, '1Y': { n: 73, stepH: 120 } };
  A.TF_ALL = ['1D', '7D', '30D', '90D', '1Y'];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h || 1; };
  A.hash = hash;
  A.tfLabels = function (t, stepH) { const n = t.length; const span = n * stepH; const x = t.map((d) => (stepH < 24 && span <= 24 ? A.hm(d) : stepH >= 120 ? A.my(d) : A.md(d))); const xTip = t.map((d) => (stepH >= 24 ? F.date(d) : A.mdt(d))); return { x, xTip }; };
  // src: { values:[oldest→newest], stepH (source step, hours), end?, additive?, clamp:[lo,hi], keepStep?, iid?(r, mean, i), volMult? }
  A.tfSeries = function (key, tf, src) {
    const spec = A.TF[tf] || A.TF['1D']; const srcStep = src.stepH || 1; const vals = (src.values || []).map(Number);
    let stepH = spec.stepH, n = spec.n;
    if (src.keepStep && (srcStep > stepH || stepH % srcStep !== 0)) { stepH = srcStep; n = Math.max(2, Math.round(spec.n * spec.stepH / srcStep)); }
    const now = A.now(); const t = []; for (let i = 0; i < n; i++) t.push(new Date(now.getTime() - (n - 1 - i) * stepH * 3600000));
    const k = stepH / srcStep; let v;
    if (Number.isInteger(k) && vals.length >= n * k) {
      v = []; for (let i = 0; i < n; i++) { const idx = vals.length - 1 - (n - 1 - i) * k; if (src.iid && k > 1) { let s = 0; for (let j = 0; j < k; j++) s += vals[Math.max(0, idx - j)] || 0; v.push(s); } else v.push(vals[idx]); }
    } else {
      const r = CG.rng(hash(key + '|' + tf + '|' + n)); const end = src.end != null ? src.end : (vals.length ? vals[vals.length - 1] : 0);
      if (src.iid) { const mean = (vals.reduce((s, x) => s + Math.abs(x), 0) / (vals.length || 1)) * k; v = []; for (let i = 0; i < n; i++) v.push(src.iid(r, mean, i)); }
      else {
        let sd; if (vals.length > 2) { const d = []; for (let i = 1; i < vals.length; i++) d.push(src.additive ? vals[i] - vals[i - 1] : vals[i] / (vals[i - 1] || 1) - 1); const m = d.reduce((s, x) => s + x, 0) / d.length; sd = Math.sqrt(d.reduce((s, x) => s + (x - m) * (x - m), 0) / d.length); } else sd = src.additive ? (Math.abs(end) * 0.02 || 0.01) : 0.01;
        sd *= Math.sqrt(k) * (src.volMult || 1); if (!src.additive) sd = Math.min(sd, 0.12);
        v = new Array(n); v[n - 1] = end; for (let i = n - 2; i >= 0; i--) { const step = (r() - 0.5) * 3.4 * sd; let x = src.additive ? v[i + 1] - step : v[i + 1] / (1 + step); if (src.clamp) x = Math.max(src.clamp[0], Math.min(src.clamp[1], x)); v[i] = x; }
      }
    }
    const L = A.tfLabels(t, stepH); return { t, v, x: L.x, xTip: L.xTip, n, stepH };
  };
  // build(tf) → chart spec; the chips re-render into the same host and remember the choice in st.tf[key]
  A.tfChart = function (host, key, st, opts, build) { opts = opts || {}; const tfs = opts.options || A.TF_ALL; st.tf = st.tf || {}; const cur = tfs.includes(st.tf[key]) ? st.tf[key] : (opts.def && tfs.includes(opts.def) ? opts.def : tfs[0]); const spec = build(cur) || {}; spec.tf = { cur, options: tfs, onChange: (tf) => { st.tf[key] = tf; A.tfChart(host, key, st, opts, build); if (opts.onChange) opts.onChange(tf); } }; A.chart(host, spec); return cur; };
  // ---------- sortable / searchable / column-toggle / CSV / star / compare data table ----------
  A.table = function (host, cfg) {
    if (!host) return; const st = (host._cg2t = host._cg2t || {});
    if (host._cg2key !== cfg.key) { host._cg2key = cfg.key; st.sortKey = cfg.sortKey || null; st.dir = cfg.sortDir || 'desc'; st.q = ''; st.hidden = new Set(cfg.cols.filter((c) => c.hidden).map((c) => c.key)); }
    host._cg2cfg = cfg;
    const allCols = () => { const cfg = host._cg2cfg; const extra = []; if (cfg.select) extra.push({ key: '_sel', label: 'Cmp', w: '38px', sort: false, align: 'c', render: (r) => { const sym = cfg.select.get(r); const on = cfg.select.selected().includes(sym); return '<input type="checkbox" class="checkbox" data-sel="' + CG.esc(sym) + '"' + (on ? ' checked' : '') + ' aria-label="Compare ' + CG.esc(sym) + '">'; } }); if (cfg.star) extra.push({ key: '_star', label: '', w: '30px', sort: false, render: (r) => { const sym = cfg.star(r); const on = A.watch.has(sym); return '<button class="cgx-star' + (on ? ' on' : '') + '" data-star="' + CG.esc(sym) + '" title="' + (on ? 'Remove from' : 'Add to') + ' watchlist" aria-label="Toggle watchlist ' + CG.esc(sym) + '">' + (on ? ICON.starOn : ICON.star) + '</button>'; } }); return extra.concat(cfg.cols); };
    const visibleRows = () => { const cfg = host._cg2cfg; let rows = cfg.rows.slice(); const q = (st.q || '').trim().toLowerCase(); if (q) rows = rows.filter((r) => (cfg.searchText ? cfg.searchText(r) : Object.values(r).filter((v) => typeof v === 'string').join(' ')).toLowerCase().includes(q)); if (st.sortKey) { const col = cfg.cols.find((c) => c.key === st.sortKey); const get = (col && col.sortVal) || ((r) => r[st.sortKey]); rows.sort((a, b) => { const x = get(a), y = get(b); const cmp = typeof x === 'string' ? x.localeCompare(y) : (x == null ? -Infinity : x) - (y == null ? -Infinity : y); return st.dir === 'asc' ? cmp : -cmp; }); } return rows; };
    const render = () => {
      const cfg = host._cg2cfg; const cols = allCols().filter((c) => !st.hidden.has(c.key));
      let rows = visibleRows(); const total = rows.length; if (cfg.limit) rows = rows.slice(0, cfg.limit);
      const wantSearch = cfg.search === true || (cfg.search !== false && cfg.rows.length > 15);
      const maxH = cfg.maxH || (cfg.rows.length > 15 && !cfg.limit ? 620 : 0);
      let h = '';
      if (wantSearch || cfg.columns || cfg.csv || cfg.count) h += '<div class="cgx-tbar">' + (wantSearch ? '<div class="cgx-tsearch">' + ICON.search + '<input type="text" class="cgx-tq" placeholder="' + CG.esc(cfg.searchPlaceholder || 'Search…') + '" value="' + CG.esc(st.q || '') + '" aria-label="Search table"></div>' : '') + '<span class="micro cgx-tcount">' + total + (cfg.limit && total > cfg.limit ? ' · top ' + cfg.limit : '') + ' rows</span><span class="cgx-tsp"></span>' + (cfg.columns ? '<button class="btn btn-outline btn-xs" data-cols type="button">' + ICON.columns + 'Columns ' + ICON.caret + '</button>' : '') + (cfg.csv ? '<button class="btn btn-outline btn-xs" data-csv type="button" title="Copy visible rows as CSV">' + ICON.copy + 'CSV</button>' : '') + '</div>';
      h += '<div class="cg2-tbl-wrap"' + (maxH ? ' style="max-height:' + maxH + 'px"' : '') + '><table class="cg2-table"><thead><tr>';
      cols.forEach((c) => { const sorted = st.sortKey === c.key; h += '<th class="' + (c.align === 'r' ? 'r ' : c.align === 'c' ? 'c ' : '') + (c.sort === false ? 'nosort' : '') + (sorted ? ' sorted' : '') + '" data-k="' + (c.sort === false ? '' : c.key) + '"' + (c.w ? ' style="width:' + c.w + '"' : '') + '>' + c.label + (sorted ? '<span class="arr">' + (st.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</th>'; });
      h += '</tr></thead><tbody>';
      if (!rows.length) h += '<tr><td class="cg2-empty" colspan="' + cols.length + '">' + (st.q ? 'No rows match “' + CG.esc(st.q) + '”' : (cfg.empty || 'No data')) + '</td></tr>';
      rows.forEach((r, i) => { const href = cfg.rowHref ? cfg.rowHref(r) : null; h += '<tr' + (href ? ' class="link" data-nav="' + href + '"' : '') + '>'; cols.forEach((c) => { h += '<td class="' + (c.align === 'r' ? 'r' : c.align === 'c' ? 'c' : '') + (c.cls ? ' ' + c.cls(r) : '') + '">' + (c.render ? c.render(r, i) : CG.esc(r[c.key])) + '</td>'; }); h += '</tr>'; });
      h += '</tbody></table></div>' + (cfg.foot || '');
      host.innerHTML = h;
    };
    render(); host._cg2render = render;
    if (!host._cg2bound) {
      host._cg2bound = true;
      host.addEventListener('input', (e) => { const inp = e.target.closest('.cgx-tq'); if (!inp) return; st.q = inp.value; const pos = inp.selectionStart; render(); const again = host.querySelector('.cgx-tq'); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (x) { } } });
      host.addEventListener('change', (e) => { const cb = e.target.closest('[data-sel]'); if (cb) { const cfg = host._cg2cfg; const ok = cfg.select.on(cb.dataset.sel, cb.checked); if (ok === false) cb.checked = !cb.checked; render(); } });
      host.addEventListener('click', (e) => {
        if (e.target.closest('[data-sel],[data-star],.cgx-tbar')) e.stopPropagation();
        const th = e.target.closest('th[data-k]'); if (th && th.dataset.k) { const k = th.dataset.k; if (st.sortKey === k) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sortKey = k; st.dir = 'desc'; } render(); return; }
        const star = e.target.closest('[data-star]'); if (star) { e.preventDefault(); A.watch.toggle(star.dataset.star); render(); return; }
        const cb = e.target.closest('[data-cols]'); if (cb) { const cfg = host._cg2cfg; const m = CG.menu(cb, '<div class="menu-label">Columns</div>' + cfg.cols.map((c) => '<label class="menu-row"><input type="checkbox" class="checkbox" data-col="' + CG.esc(c.key) + '"' + (st.hidden.has(c.key) ? '' : ' checked') + '> ' + CG.esc(strip(c.label) || c.key) + '</label>').join('') + '<div class="menu-sep"></div><button class="menu-item" data-col-reset type="button">Show all columns</button>'); m.addEventListener('change', (ev) => { const x = ev.target.closest('[data-col]'); if (!x) return; if (x.checked) st.hidden.delete(x.dataset.col); else st.hidden.add(x.dataset.col); render(); }); m.addEventListener('click', (ev) => { if (ev.target.closest('[data-col-reset]')) { st.hidden.clear(); render(); } }); return; }
        const cv = e.target.closest('[data-csv]'); if (cv) { const cfg = host._cg2cfg; const cols = allCols().filter((c) => !st.hidden.has(c.key) && c.key[0] !== '_'); const rows = visibleRows(); const cell = (c, r) => { let v = c.csv ? c.csv(r) : null; if (v == null) { const raw = r[c.key]; if (raw != null && typeof raw !== 'object') v = raw; else if (c.sortVal) v = c.sortVal(r); } if (v == null || typeof v === 'object') v = strip(c.render ? c.render(r, 0) : ''); v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; const csv = [cols.map((c) => cell({ csv: () => strip(c.label) || c.key }, {})).join(',')].concat(rows.map((r) => cols.map((c) => cell(c, r)).join(','))).join('\n'); A.copy(csv, 'Copied ' + rows.length + ' rows as CSV' + (typeof cfg.csv === 'string' ? ' · ' + cfg.csv : '')); return; }
      });
      if (cfg.select && !host._cg2cmp) { host._cg2cmp = true; const off = CG.on('compare', () => { if (host.isConnected) render(); else off(); }); }
    }
  };
  // ---------- charts (inline SVG): timeframe chips · toggleable legend · crosshair tooltip · last-value tags · faint h-grid · skeleton ----------
  let uid = 0;
  const nice = (lo, hi, n) => { const span = hi - lo; if (!(span > 0)) return [lo]; const raw = span / n; const mag = Math.pow(10, Math.floor(Math.log10(raw))); const norm = raw / mag; const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10)); return out; };
  A.skeleton = (host, h) => { if (host) host.innerHTML = '<div class="skeleton" style="height:' + (h || 200) + 'px;margin:4px 0"></div>'; };
  A.chart = function (host, o) {
    if (!host) return; host._cg2spec = o;
    if (!host._cg2painted) { host._cg2painted = 1; A.skeleton(host, (o.h || 220) + 26); requestAnimationFrame(() => { if (host.isConnected && host._cg2spec === o) paint(host, o); }); return; }
    paint(host, o);
  };
  function paint(host, o) {
    const hidden = (host._cg2hidden = host._cg2hidden || new Set());
    const w = o.w || host.clientWidth || 720, h = o.h || 220;
    const all = (o.series || []).filter((s) => s && s.data && s.data.length);
    const S = all.filter((s) => !(s.label && hidden.has(s.label)));
    const yf = o.yFmt || F.compact, y2f = o.y2Fmt || F.compact; const fmtOf = (s) => s.fmt || ((s.axis || 'l') === 'r' ? y2f : yf);
    const lastOf = (s) => { for (let i = s.data.length - 1; i >= 0; i--) { const v = s.data[i]; if (v != null && !isNaN(v) && !Array.isArray(v)) return { v, i }; } return null; };
    const tagSeries = o.tags === false ? [] : S.filter((s) => s.type !== 'bar' && s.type !== 'region').slice(0, 3);
    const pad = Object.assign({ t: 12, r: o.rightAxis ? 54 : 12, b: 22, l: 50 }, o.pad || {});
    let maxTag = 0; tagSeries.forEach((s) => { const l = lastOf(s); if (l) maxTag = Math.max(maxTag, String(fmtOf(s)(l.v)).length * 6.4 + 10); }); if (maxTag) pad.r = Math.max(pad.r, Math.round(maxTag) + 4);
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    // toolbar: legend (toggleable) + timeframe chips
    const legendItems = o.legend === false ? [] : all.filter((s) => s.label);
    let tools = '';
    if (legendItems.length > 0 || o.tf) tools = '<div class="cgx-ctools">' + (legendItems.length ? '<div class="cg2-legend">' + legendItems.map((s) => '<button type="button" class="' + (hidden.has(s.label) ? 'off' : '') + '" data-lg="' + CG.esc(s.label) + '" title="Toggle ' + CG.esc(s.label) + '"><i style="background:' + (typeof s.color === 'function' ? (s.legendColor || C.muted) : s.color) + '"></i>' + CG.esc(s.label) + '</button>').join('') + '</div>' : '') + (o.tf ? '<div class="cgx-tf" role="tablist" aria-label="Timeframe">' + o.tf.options.map((t) => '<button type="button" class="' + (t === o.tf.cur ? 'on' : '') + '" data-tf="' + t + '">' + t + '</button>').join('') + '</div>' : '') + '</div>';
    const bind = () => { host.querySelectorAll('[data-lg]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.lg; if (hidden.has(k)) hidden.delete(k); else hidden.add(k); paint(host, host._cg2spec); })); host.querySelectorAll('[data-tf]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tf !== o.tf.cur) o.tf.onChange(b.dataset.tf); })); };
    if (!S.length) { host.innerHTML = tools + '<div class="cgx-empty" style="min-height:' + Math.round(h * 0.6) + 'px;justify-content:center"><b>No data</b>' + (all.length ? 'All series are hidden — click a legend item to show it again' : (o.empty || 'Nothing to plot for this range')) + '</div>'; bind(); return; }
    const n = Math.max(1, ...S.map((s) => s.data.length));
    const barSeries = S.filter((s) => s.type === 'bar'); const hasBars = barSeries.length > 0; const stacked = !!o.stack;
    function ext(axis) {
      let lo = Infinity, hi = -Infinity; const add = (v) => { if (v == null || isNaN(v)) return; if (v < lo) lo = v; if (v > hi) hi = v; };
      const ax = S.filter((s) => (s.axis || 'l') === axis); if (!ax.length && !(o.hlines || []).some((l) => (l.axis || 'l') === axis)) return null;
      if (stacked) { const bs = ax.filter((s) => s.type === 'bar'); for (let i = 0; i < n; i++) { let p = 0, q = 0; bs.forEach((s) => { const v = s.data[i] || 0; if (v >= 0) p += v; else q += v; }); add(p); add(q); } ax.filter((s) => s.type !== 'bar').forEach((s) => s.data.forEach((v) => { if (Array.isArray(v)) { add(v[0]); add(v[1]); } else add(v); })); }
      else ax.forEach((s) => s.data.forEach((v) => { if (Array.isArray(v)) { add(v[0]); add(v[1]); } else add(v); }));
      (o.hlines || []).filter((l) => (l.axis || 'l') === axis).forEach((l) => add(l.y));
      if (!isFinite(lo)) return null;
      if (ax.some((s) => s.type === 'bar') || (axis === 'l' && o.zero)) add(0);
      if (axis === 'l' && o.min != null) lo = Math.min(lo, o.min); if (axis === 'l' && o.max != null) hi = Math.max(hi, o.max);
      const log = axis === 'l' && o.logY;
      if (log) { lo = Math.max(lo, 1e-9); const L = Math.log10(lo), H = Math.log10(hi); const r = (H - L) || 1; return { lo: Math.pow(10, L - r * 0.05), hi: Math.pow(10, H + r * 0.05), log: true }; }
      if (lo === hi) { lo -= Math.abs(lo || 1) * 0.1; hi += Math.abs(hi || 1) * 0.1; }
      const r = hi - lo; const padF = o.tight ? 0 : 0.07;
      return { lo: (lo === 0 || (axis === 'l' && o.min != null)) ? lo : lo - r * padF, hi: (hi === 0 || (axis === 'l' && o.max != null)) ? hi : hi + r * padF, log: false };
    }
    const yl = ext('l') || { lo: 0, hi: 1, log: false }, yr = o.rightAxis ? ext('r') : null;
    const sy = (v, ax) => { const e = ax === 'r' ? (yr || yl) : yl; if (e.log) return pad.t + ph - (Math.log10(Math.max(v, 1e-9)) - Math.log10(e.lo)) / (Math.log10(e.hi) - Math.log10(e.lo)) * ph; return pad.t + ph - (v - e.lo) / (e.hi - e.lo) * ph; };
    const slot = pw / n; const sx = (i) => (hasBars ? pad.l + slot * (i + 0.5) : pad.l + (n === 1 ? pw / 2 : i / (n - 1) * pw));
    const ticksFor = (e, count) => { if (!e) return []; if (e.log) { const out = []; const L = Math.floor(Math.log10(e.lo)), H = Math.ceil(Math.log10(e.hi)); for (let k = L; k <= H; k++) [1, 2, 5].forEach((m) => { const v = m * Math.pow(10, k); if (v >= e.lo && v <= e.hi) out.push(v); }); if (out.length < 3) return nice(e.lo, e.hi, count).filter((v) => v > e.lo && v < e.hi); return out.length > 7 ? out.filter((_, i) => i % 2 === 0) : out; } return nice(e.lo, e.hi, count); };
    const defs = []; let body = '';
    (o.bands || []).forEach((b) => { const y1 = sy(Math.min(b.to, yl.hi)), y2 = sy(Math.max(b.from, yl.lo)); if (y2 > y1) body += '<rect x="' + pad.l + '" y="' + y1.toFixed(1) + '" width="' + pw + '" height="' + (y2 - y1).toFixed(1) + '" style="fill:' + b.color + '"/>'; });
    S.filter((s) => s.type === 'region').forEach((s) => { let top = '', bot = ''; s.data.forEach((v, i) => { top += (i ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(v[1], s.axis).toFixed(1) + ' '; }); for (let i = s.data.length - 1; i >= 0; i--) bot += 'L' + sx(i).toFixed(1) + ' ' + sy(s.data[i][0], s.axis).toFixed(1) + ' '; body += '<path d="' + top + bot + 'Z" style="fill:' + s.color + ';opacity:' + (s.opacity != null ? s.opacity : 0.35) + '"/>'; });
    ticksFor(yl, o.yTicks || 4).forEach((v) => { const y = sy(v); body += '<line class="grid" x1="' + pad.l + '" x2="' + (pad.l + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="ax" x="' + (pad.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + yf(v) + '</text>'; });
    if (yr) ticksFor(yr, 4).forEach((v) => { const y = sy(v, 'r'); body += '<text class="ax" x="' + (pad.l + pw + 6) + '" y="' + (y + 3.5).toFixed(1) + '">' + y2f(v) + '</text>'; });
    const xl = o.x || []; const xstep = Math.max(1, Math.ceil(n / (o.xCount || Math.max(2, Math.floor(pw / 100)))));
    for (let i = 0; i < n; i += xstep) { if (xl[i] == null) continue; body += '<text class="ax" x="' + sx(i).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '">' + CG.esc(xl[i]) + '</text>'; }
    const groupN = stacked ? 1 : barSeries.length; const gw = slot * (o.barW || 0.72); const bw = Math.max(1, gw / (groupN || 1));
    const stackPos = new Array(n).fill(0), stackNeg = new Array(n).fill(0);
    barSeries.forEach((s, si) => { const ax = s.axis || 'l'; for (let i = 0; i < n; i++) { const v = s.data[i]; if (v == null || isNaN(v)) continue; let base = 0; if (stacked) { if (v >= 0) { base = stackPos[i]; stackPos[i] += v; } else { base = stackNeg[i]; stackNeg[i] += v; } } const y1 = sy(base + v, ax), y2 = sy(base, ax); const x = stacked ? sx(i) - bw / 2 : sx(i) - gw / 2 + si * bw; const col = typeof s.color === 'function' ? s.color(v, i) : (v < 0 && s.colorNeg ? s.colorNeg : s.color); body += '<rect x="' + x.toFixed(1) + '" y="' + Math.min(y1, y2).toFixed(1) + '" width="' + Math.max(1, bw - (groupN > 1 ? 1 : 0)).toFixed(1) + '" height="' + Math.max(0.5, Math.abs(y2 - y1)).toFixed(1) + '" style="fill:' + col + '" rx="1"/>'; } });
    let dots = '';
    S.filter((s) => s.type === 'line' || s.type === 'area' || !s.type).forEach((s) => { const ax = s.axis || 'l'; let d = ''; let started = false; let first = -1, last = -1; s.data.forEach((v, i) => { if (v == null || isNaN(v)) { started = false; return; } if (first < 0) first = i; last = i; d += (started ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(v, ax).toFixed(1) + ' '; started = true; }); if (first < 0) return;
      if (s.type === 'area') { const id = 'cg2g' + (++uid); defs.push('<linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:' + s.color + ';stop-opacity:' + (s.fillOpacity != null ? s.fillOpacity : 0.22) + '"/><stop offset="1" style="stop-color:' + s.color + ';stop-opacity:0.01"/></linearGradient>'); const yb = pad.t + ph; body += '<path d="' + d + 'L' + sx(last).toFixed(1) + ' ' + yb + ' L' + sx(first).toFixed(1) + ' ' + yb + 'Z" style="fill:url(#' + id + ')"/>'; }
      body += '<path d="' + d + '" fill="none" style="stroke:' + s.color + ';stroke-width:' + (s.width || 1.5) + (s.dash ? ';stroke-dasharray:' + s.dash : '') + '" stroke-linejoin="round" stroke-linecap="round"/>';
      body += '<circle cx="' + sx(last).toFixed(1) + '" cy="' + sy(s.data[last], ax).toFixed(1) + '" r="2.6" style="fill:' + s.color + '"/>';
      dots += '<circle class="hdot" r="3.2" style="fill:' + s.color + ';stroke:hsl(var(--card));stroke-width:1.5;display:none" data-sl="' + CG.esc(s.label || '') + '"/>'; });
    (o.hlines || []).forEach((l) => { const y = sy(l.y, l.axis); const c = l.color || C.muted; body += '<line x1="' + pad.l + '" x2="' + (pad.l + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" style="stroke:' + c + ';stroke-dasharray:' + (l.dash || '4 3') + ';stroke-width:1"/>' + (l.label ? '<text class="lbl" x="' + (pad.l + 4) + '" y="' + (y - 3).toFixed(1) + '" style="fill:' + c + '">' + CG.esc(l.label) + '</text>' : ''); });
    (o.labels || []).forEach((l) => { body += '<text class="lbl" x="' + sx(l.i).toFixed(1) + '" y="' + (sy(l.y, l.axis) - 5).toFixed(1) + '" text-anchor="middle" style="fill:' + (l.color || C.fg) + '">' + CG.esc(l.text) + '</text>'; });
    // last-value tags at the right edge
    const placed = []; tagSeries.forEach((s) => { const l = lastOf(s); if (!l) return; let y = sy(l.v, s.axis); placed.forEach((py) => { if (Math.abs(py - y) < 16) y = py + (y >= py ? 16 : -16); }); y = Math.max(pad.t + 8, Math.min(pad.t + ph - 8, y)); placed.push(y); const txt = String(fmtOf(s)(l.v)); const tw = Math.round(txt.length * 6.4 + 8); const col = typeof s.color === 'function' ? (s.legendColor || C.muted) : s.color; body += '<g><rect x="' + (pad.l + pw + 3) + '" y="' + (y - 8).toFixed(1) + '" width="' + tw + '" height="16" rx="3" style="fill:' + col + '"/><text class="tag" x="' + (pad.l + pw + 3 + tw / 2).toFixed(1) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="middle" style="fill:hsl(var(--background))">' + CG.esc(txt) + '</text></g>'; });
    body += '<line class="xh" x1="0" x2="0" y1="' + pad.t + '" y2="' + (pad.t + ph) + '" style="opacity:0"/>' + dots;
    host.innerHTML = tools + '<div class="cg2-chart"><svg viewBox="0 0 ' + w + ' ' + h + '" style="height:' + h + 'px" role="img" aria-label="' + CG.esc(o.aria || S.map((s) => s.label).filter(Boolean).join(', ') || 'chart') + '"><defs>' + defs.join('') + '</defs>' + body + '</svg><div class="cg2-tip" hidden></div></div>';
    bind();
    if (o.tooltip === false) return;
    const wrap = host.querySelector('.cg2-chart'), svg = wrap.querySelector('svg'), tip = wrap.querySelector('.cg2-tip'), xh = svg.querySelector('.xh'); const hd = Array.from(svg.querySelectorAll('.hdot'));
    const pts = S.filter((s) => s.type !== 'region'); const lineS = S.filter((s) => s.type === 'line' || s.type === 'area' || !s.type);
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect(); const mx = (e.clientX - r.left) * (w / r.width);
      let i = hasBars ? Math.floor((mx - pad.l) / slot) : Math.round((mx - pad.l) / pw * (n - 1)); i = Math.max(0, Math.min(n - 1, i));
      const x = sx(i); xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.style.opacity = 1;
      lineS.forEach((s, k) => { const d = hd[k]; if (!d) return; const v = s.data[i]; if (v == null || isNaN(v)) { d.style.display = 'none'; return; } d.setAttribute('cx', x); d.setAttribute('cy', sy(v, s.axis)); d.style.display = ''; });
      let t = '<div class="t">' + CG.esc((o.xTip || xl)[i] || '') + '</div>';
      pts.forEach((s) => { const v = s.data[i]; if (v == null || isNaN(v)) return; t += '<div class="s"><span><i style="background:' + (typeof s.color === 'function' ? s.color(v, i) : s.color) + '"></i>' + CG.esc(s.label || '') + '</span><b>' + fmtOf(s)(v) + '</b></div>'; });
      (o.tipExtra ? o.tipExtra(i) : []).forEach((row) => { t += '<div class="s"><span>' + row[0] + '</span><b>' + row[1] + '</b></div>'; });
      tip.innerHTML = t; tip.hidden = false;
      const px = x / w * r.width; const tw = tip.offsetWidth; tip.style.left = (px + 14 + tw > r.width ? Math.max(0, px - tw - 12) : px + 12) + 'px'; tip.style.top = Math.max(0, Math.min(e.clientY - r.top - 12, r.height - tip.offsetHeight)) + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; xh.style.opacity = 0; hd.forEach((d) => (d.style.display = 'none')); });
  }
  // ---------- compact arc gauge with the amber needle ----------
  A.fgSegs = [[0, 25, 'hsl(var(--loss)/.8)'], [25, 45, 'hsl(var(--warning)/.65)'], [45, 55, 'hsl(var(--muted-foreground)/.45)'], [55, 75, 'hsl(var(--profit)/.5)'], [75, 100, 'hsl(var(--profit)/.9)']];
  A.fgColor = (v) => (v < 25 ? C.down : v < 45 ? C.warn : v < 55 ? C.muted : C.up);
  A.gauge = function (host, o) {
    if (!host) return; const min = o.min || 0, max = o.max == null ? 100 : o.max; const v = Math.max(min, Math.min(max, o.value)); const size = o.size || 120; const thick = o.thick || 9; const r = size / 2 - thick / 2 - 3; const cx = size / 2, cy = size / 2 + 3; const segs = o.segs || A.fgSegs;
    const ang = (t) => Math.PI + (t - min) / (max - min) * Math.PI; const pt = (t, rr) => [(cx + rr * Math.cos(ang(t))).toFixed(2), (cy + rr * Math.sin(ang(t))).toFixed(2)];
    let s = '<svg viewBox="0 0 ' + size + ' ' + (size / 2 + 10) + '" style="width:' + size + 'px;height:' + (size / 2 + 10) + 'px" role="img" aria-label="' + CG.esc(o.label || 'gauge') + ' ' + Math.round(v) + '">';
    const [tx1, ty1] = pt(min, r), [tx2, ty2] = pt(max, r); s += '<path d="M' + tx1 + ' ' + ty1 + ' A' + r + ' ' + r + ' 0 0 1 ' + tx2 + ' ' + ty2 + '" fill="none" style="stroke:hsl(var(--muted))" stroke-width="' + thick + '"/>';
    segs.forEach(([a, b, c]) => { const gap = (max - min) * 0.008; const [x1, y1] = pt(a + (a > min ? gap : 0), r), [x2, y2] = pt(b - (b < max ? gap : 0), r); s += '<path d="M' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 0 1 ' + x2 + ' ' + y2 + '" fill="none" style="stroke:' + c + '" stroke-width="' + thick + '"/>'; });
    const [nx, ny] = pt(v, r - thick / 2 - 2); s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx + '" y2="' + ny + '" style="stroke:hsl(var(--primary));stroke-width:2.2" stroke-linecap="round"/><circle cx="' + cx + '" cy="' + cy + '" r="3.2" style="fill:hsl(var(--primary))"/><circle cx="' + cx + '" cy="' + cy + '" r="1.2" style="fill:hsl(var(--card))"/></svg>';
    host.innerHTML = '<div class="cgx-gauge' + (o.cls ? ' ' + o.cls : '') + (o.inline ? ' inline' : '') + '"' + (o.inline ? '' : ' style="width:' + size + 'px"') + '>' + s + '<div class="gt"><div class="gv" style="font-size:' + (o.fontSize || 20) + 'px' + (o.color ? ';color:' + o.color : '') + '">' + (o.valueText != null ? o.valueText : Math.round(v)) + '</div>' + (o.label ? '<div class="gl">' + CG.esc(o.label) + '</div>' : '') + (o.scale ? '<div class="gs"><span>' + CG.esc(o.scale[0]) + '</span><span>' + CG.esc(o.scale[1]) + '</span></div>' : '') + '</div></div>';
  };
  A.treeColor = (chg) => { const a = Math.min(Math.abs(chg) / 6, 1); return 'hsl(var(' + (chg >= 0 ? '--profit' : '--loss') + ')/' + (0.22 + a * 0.6).toFixed(2) + ')'; };
  A.treemap = function (host, o) {
    if (!host) return; const w = o.w || host.clientWidth || 320, h = o.h || 240; const items = o.items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value); const rects = []; const base = o.href || '/analytics/coin/';
    (function split(list, x, y, W, H) { if (!list.length) return; if (list.length === 1) { rects.push(Object.assign({ x, y, w: W, h: H }, list[0])); return; } const total = list.reduce((s, i) => s + i.value, 0); let acc = 0, k = 0; for (; k < list.length - 1; k++) { acc += list[k].value; if (acc >= total / 2) break; } const a = list.slice(0, k + 1), b = list.slice(k + 1); const fa = a.reduce((s, i) => s + i.value, 0) / total; if (W >= H) { split(a, x, y, W * fa, H); split(b, x + W * fa, y, W * (1 - fa), H); } else { split(a, x, y, W, H * fa); split(b, x, y + H * fa, W, H * (1 - fa)); } })(items, 0, 0, w, h);
    let s = '<svg class="cg2-tree" viewBox="0 0 ' + w + ' ' + h + '" style="height:' + h + 'px">';
    rects.forEach((r) => { const big = r.w > 46 && r.h > 30, mid = r.w > 30 && r.h > 16; s += '<g class="cell" data-nav="' + base + CG.esc(r.label) + '"><rect x="' + (r.x + 0.5).toFixed(1) + '" y="' + (r.y + 0.5).toFixed(1) + '" width="' + Math.max(0, r.w - 1).toFixed(1) + '" height="' + Math.max(0, r.h - 1).toFixed(1) + '" rx="2" style="fill:' + A.treeColor(r.chg) + ';stroke:hsl(var(--card));stroke-width:1"><title>' + CG.esc(r.label) + ' · ' + F.pct(r.chg) + ' · ' + F.usdCompact(r.value) + '</title></rect>' + (mid ? '<text x="' + (r.x + r.w / 2).toFixed(1) + '" y="' + (r.y + r.h / 2 + (big ? -2 : 3.5)).toFixed(1) + '" text-anchor="middle" style="font-size:' + (big ? 11.5 : 9.5) + 'px;font-weight:600">' + CG.esc(r.label) + '</text>' : '') + (big ? '<text x="' + (r.x + r.w / 2).toFixed(1) + '" y="' + (r.y + r.h / 2 + 11).toFixed(1) + '" text-anchor="middle" style="font-size:10px;opacity:.85">' + F.pct(r.chg) + '</text>' : '') + '</g>'; });
    host.innerHTML = s + '</svg>';
  };
  A.donut = function (host, o) {
    if (!host) return; const size = o.size || 132, r = size / 2 - 3, ri = r * 0.62, cx = size / 2, cy = size / 2; const total = o.items.reduce((s, i) => s + i.value, 0) || 1; let a0 = -Math.PI / 2;
    let s = '<svg viewBox="0 0 ' + size + ' ' + size + '" style="width:' + size + 'px;height:' + size + 'px;flex-shrink:0">';
    o.items.forEach((it) => { const a1 = a0 + Math.min(0.99999, it.value / total) * Math.PI * 2; const large = a1 - a0 > Math.PI ? 1 : 0; const p = (a, rr) => (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2); s += '<path d="M' + p(a0, r) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p(a1, r) + ' L' + p(a1, ri) + ' A' + ri + ' ' + ri + ' 0 ' + large + ' 0 ' + p(a0, ri) + 'Z" style="fill:' + it.color + ';stroke:hsl(var(--card));stroke-width:1"><title>' + CG.esc(it.label) + ' · ' + (it.value / total * 100).toFixed(1) + '%</title></path>'; a0 = a1; });
    s += '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" style="fill:hsl(var(--foreground));font-size:12px;font-weight:500;font-family:var(--font-mono)">' + CG.esc(o.center || '') + '</text></svg>';
    host.innerHTML = '<div class="cg2-row" style="gap:16px;flex-wrap:nowrap;align-items:center">' + s + '<div class="cg2-donut-legend" style="flex:1;min-width:0">' + o.items.map((it) => '<span><i style="background:' + it.color + '"></i>' + CG.esc(it.label) + '<b>' + (it.value / total * 100).toFixed(1) + '%</b></span>').join('') + '</div></div>';
  };
  A.spark = (data, w, h, color) => { w = w || 80; h = h || 22; if (!data || !data.length) return ''; const lo = Math.min(...data), hi = Math.max(...data); const px = (i) => (i / (data.length - 1) * (w - 3)).toFixed(1), py = (v) => (h - 2 - (v - lo) / ((hi - lo) || 1) * (h - 4)).toFixed(1); const d = data.map((v, i) => (i ? 'L' : 'M') + px(i) + ' ' + py(v)).join(' '); const c = color || C.curve; return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:' + w + 'px;height:' + h + 'px;overflow:visible;display:inline-block;vertical-align:middle"><path d="' + d + '" fill="none" style="stroke:' + c + ';stroke-width:1.4"/><circle cx="' + px(data.length - 1) + '" cy="' + py(data[data.length - 1]) + '" r="2" style="fill:' + c + '"/></svg>'; };
  A.hbars = (rows, opts) => { opts = opts || {}; const max = Math.max(...rows.map((r) => r.value)) || 1; return '<div class="cg2-hbars">' + rows.map((r) => '<div class="cg2-hbar"><span class="truncate" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + CG.esc(r.label) + '</span><span class="bar"><i style="width:' + (r.value / max * 100).toFixed(1) + '%;background:' + (r.color || C.curve) + '"></i></span><span class="v mono">' + (opts.fmt || F.usdCompact)(r.value) + '</span></div>').join('') + '</div>'; };
  // ---------- watchlist (CG.state.watchlist, persisted) ----------
  if (!Array.isArray(CG.state.watchlist)) CG.state.watchlist = ['BTC', 'ETH', 'SOL'];
  A.watch = {
    list: () => (Array.isArray(CG.state.watchlist) ? CG.state.watchlist : (CG.state.watchlist = [])),
    has: (s) => A.watch.list().includes(s),
    toggle(s, silent) { s = String(s || '').toUpperCase(); const l = A.watch.list(); const i = l.indexOf(s); if (i >= 0) l.splice(i, 1); else l.push(s); CG.saveState(); CG.emit('watchlist', l.slice()); if (!silent) CG.toast({ title: i >= 0 ? 'Removed from watchlist' : 'Added to watchlist', description: s + (i >= 0 ? '' : ' · pinned on the Markets Hub and the Terminal dashboard'), variant: i >= 0 ? undefined : 'success' }); return i < 0; },
    add(s) { s = String(s || '').toUpperCase(); if (!A.coin(s)) { CG.toast({ title: 'Unknown coin', description: s, variant: 'destructive' }); return; } if (A.watch.has(s)) CG.toast({ title: s + ' is already on your watchlist' }); else A.watch.toggle(s); },
    strip(host, app) {
      if (!host) return; const base = app === 'terminal' ? '/terminal/coin/' : '/analytics/coin/'; const manage = app === 'terminal' ? '/terminal/spot' : '/analytics/markets'; const where = app === 'terminal' ? 'Spot Markets' : 'the Markets screener';
      const render = () => { const list = A.watch.list().map(A.coin).filter(Boolean);
        let h = '<div class="cgx-watch"><div class="cgx-wh"><span class="micro">Watchlist</span><span class="text-2xs cg2-dim">' + (list.length ? list.length + ' coin' + (list.length > 1 ? 's' : '') + ' · 7D sparkline · click a card to open the coin' : 'empty') + '</span><a class="cg2-link" href="#' + manage + '">Manage in ' + (app === 'terminal' ? 'Spot Markets' : 'Markets') + ' →</a></div>';
        if (!list.length) h += '<div class="cgx-wempty">' + ICON.star + '<span>No coins starred yet — star a row in ' + where + ' to pin it here.</span><a class="btn btn-outline btn-xs" href="#' + manage + '">Open markets</a></div>';
        else h += '<div class="cgx-wrow">' + list.map((c) => { const s = A.tfSeries('px:' + c.symbol, '7D', { values: M.priceHistory(c.symbol, 96).map((p) => p.close), stepH: 1, end: c.price }); return '<a class="cgx-wcard" href="#' + base + c.symbol + '"><div class="sym">' + c.symbol + '<small>' + CG.esc(c.name) + '</small></div><button class="cgx-star on" data-star="' + c.symbol + '" title="Remove from watchlist" type="button">' + ICON.starOn + '</button><div class="row"><span class="px">' + A.price(c.price) + '</span>' + A.heat(c.chg24) + '</div>' + A.spark(s.v, 136, 22, c.chg7d >= 0 ? C.up : C.down) + '</a>'; }).join('') + '</div>';
        host.innerHTML = h + '</div>'; };
      render();
      if (!host._cg2wl) { host._cg2wl = true; host.addEventListener('click', (e) => { const b = e.target.closest('[data-star]'); if (b) { e.preventDefault(); e.stopPropagation(); A.watch.toggle(b.dataset.star); } }); const off = CG.on('watchlist', () => { if (host.isConnected) render(); else off(); }); }
    }
  };
  // ---------- compare (CG.state.compare, up to 3 coins; normalised price + side-by-side stats) ----------
  A.cmp = {
    list: () => (Array.isArray(CG.state.compare) ? CG.state.compare : (CG.state.compare = [])),
    toggle(sym) { sym = String(sym || '').toUpperCase(); const l = A.cmp.list(); const i = l.indexOf(sym); if (i >= 0) l.splice(i, 1); else { if (l.length >= 3) { CG.toast({ title: 'Compare holds up to 3 coins', description: 'Untick one to add ' + sym, variant: 'destructive' }); return false; } l.push(sym); } CG.saveState(); CG.emit('compare', l.slice()); return true; },
    clear() { CG.state.compare = []; CG.saveState(); CG.emit('compare', []); CG.toast({ title: 'Compare cleared' }); },
    panel(host, opts) {
      if (!host) return; opts = opts || {}; const st = (A.st.cmp = A.st.cmp || {});
      const metrics = [['Price', (c) => c.price, (v) => A.price(v)], ['24h %', (c) => c.chg24, (v) => A.heat(v)], ['7d %', (c) => c.chg7d, (v) => A.heat(v, { max: 15 })], ['Market cap', (c) => c.marketCap, F.usdCompact], ['24h volume', (c) => c.volume24h, F.usdCompact], ['Open interest', (c) => c.openInterest, F.usdCompact], ['OI 24h %', (c) => c.oiChg24h, (v) => A.heat(v)], ['Funding', (c) => c.funding, (v) => '<span class="' + A.cls(v) + '">' + F.pct(v, 4) + '</span>'], ['L/S ratio', (c) => c.lsRatio, (v) => F.num(v, 2)], ['Liq 24h', (c) => c.liq24h, F.usdCompact], ['RSI 24h', (c) => c.rsi['24h'], (v) => A.rsiHeat(v)]];
      const render = () => {
        const coins = A.cmp.list().map(A.coin).filter(Boolean);
        if (!coins.length && !opts.force) { host.innerHTML = ''; host.hidden = true; return; }
        host.hidden = false;
        let h = '<div class="cgx-compare"><div class="cg2-ph">' + ICON.compare.replace('<svg', '<svg style="width:14px;height:14px;color:hsl(var(--muted-foreground))"') + '<span class="cg2-pt">Compare</span><span class="cg2-ps">' + (coins.length ? coins.map((c, i) => '<i class="swatch" style="background:' + A.slot(i) + '"></i>' + c.symbol).join(' <span class="cg2-dim">vs</span> ') + ' · normalised to 100 at the start of the range' : 'pick up to 3 coins with the Cmp checkboxes') + '</span><div class="cg2-tools">' + (coins.length ? '<button class="btn btn-ghost btn-xs" data-cmp-clear type="button">Clear</button>' : '') + '</div></div>';
        if (!coins.length) h += '<div class="cgx-chint">' + ICON.compare + 'Tick the <b>Cmp</b> box on up to three rows below to overlay their normalised price (base 100) and compare stats side by side.</div>';
        else { const rows = metrics.map(([label, get, fmt]) => { const vals = coins.map(get); const best = Math.max(...vals); return '<tr><td>' + label + '</td>' + vals.map((v) => '<td class="' + (coins.length > 1 && v === best ? 'best' : '') + '">' + fmt(v) + '</td>').join('') + '</tr>'; }).join(''); h += '<div class="cgx-cgrid"><div class="cg2-pb" data-cmp-chart></div><div class="cg2-tbl-wrap"><table class="cgx-ctable"><thead><tr><th>Metric</th>' + coins.map((c, i) => '<th><span style="color:' + A.slot(i) + '">' + c.symbol + '</span><button class="cgx-x" data-cmp-rm="' + c.symbol + '" title="Remove ' + c.symbol + '" type="button">✕</button></th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>' + (coins.length < 2 ? '<div class="cgx-chint">Add ' + (coins.length === 1 ? 'one or two more coins' : 'more coins') + ' with the Cmp checkboxes to compare — up to 3.</div>' : ''); }
        host.innerHTML = h + '</div>';
        if (coins.length) A.tfChart(host.querySelector('[data-cmp-chart]'), 'cmp', st, { options: ['1D', '7D', '30D', '90D', '1Y'], def: '7D' }, (tf) => { let xs = null; const series = coins.map((c, i) => { const s = A.tfSeries('px:' + c.symbol, tf, { values: M.priceHistory(c.symbol, 96).map((p) => p.close), stepH: 1, end: c.price }); xs = xs || s; const b = s.v[0] || 1; return { type: 'line', label: c.symbol, data: s.v.map((v) => +(v / b * 100).toFixed(2)), color: A.slot(i), fmt: (v) => F.num(v, 1) }; }); return { h: 210, x: xs.x, xTip: xs.xTip, series, yFmt: (v) => F.num(v, 0), hlines: [{ y: 100, color: C.muted, dash: '2 3', label: 'base 100' }] }; });
      };
      render();
      if (!host._cg2cmpb) { host._cg2cmpb = true; host.addEventListener('click', (e) => { if (e.target.closest('[data-cmp-clear]')) A.cmp.clear(); const rm = e.target.closest('[data-cmp-rm]'); if (rm) A.cmp.toggle(rm.dataset.cmpRm); }); const off = CG.on('compare', () => { if (host.isConnected) render(); else off(); }); }
    }
  };
  // ---------- screen registration helper ----------
  A.current = null; A.timers = [];
  A.every = (ms, fn) => { const id = setInterval(fn, ms); A.timers.push(id); return id; };
  A.after = (ms, fn) => { const id = setTimeout(fn, ms); A.timers.push(id); return id; };
  A.clearTimers = () => { A.timers.forEach((id) => { clearInterval(id); clearTimeout(id); }); A.timers = []; };
  A.screen = function (route, def) {
    CG.register(route, {
      init(root, params, query) { if (def.init) def.init(root, params, query); },
      show(root, params, query) { A.clearTimers(); A.applyTheme(); A.applyDensity(); const main = root.querySelector('.cg2-main'); const fn = () => def.render(main, params, query, root); A.current = fn; fn(); },
      hide(root) { A.current = null; A.clearTimers(); if (def.hide) def.hide(root); }
    });
  };
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (A.current) A.current(); }, 220); });
  // ---------- shared header: title · section switcher across BOTH apps · coin search · ← Analyse · theme · palette ----------
  A.TABS = [['Hub', '/analytics/coinglass', 'home'], ['Futures', '/analytics/overview'], ['Markets', '/analytics/markets'], ['Derivatives', '/analytics/derivatives'], ['Options', '/analytics/options'], ['ETF', '/analytics/etf'], ['Liquidations', '/analytics/liquidations'], ['Whales', '/analytics/whales'], ['Sentiment', '/analytics/sentiment']];
  A.TERMINAL = [['Dashboard', '/terminal'], ['Spot Markets', '/terminal/spot'], ['Sectors', '/terminal/sectors/layer-1'], ['Exchanges', '/terminal/exchanges/Binance'], ['Open Interest', '/terminal/derivatives/open-interest'], ['Funding Rates', '/terminal/derivatives/funding'], ['Long / Short', '/terminal/derivatives/long-short'], ['Liquidations', '/terminal/derivatives/liquidations'], ['ETF Flows', '/terminal/etf'], ['Exchange Balance', '/terminal/onchain/exchange-balance'], ['Token Unlocks', '/terminal/onchain/unlocks'], ['Fear & Greed', '/terminal/indicators/fear-greed'], ['BTC Cycle', '/terminal/indicators/cycle']];
  A.openPalette = function () { const P = CG.palette; if (P && typeof P.open === 'function') { P.open(); return; } if (P && typeof P.toggle === 'function') { P.toggle(); return; } document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true })); setTimeout(() => { if (!document.querySelector('.cg-palette, [data-cg-palette], .cg-overlay')) CG.toast({ title: 'Command palette', description: 'Press Ctrl K anywhere to jump to any analytics or terminal page.' }); }, 60); };
  A.header = function (el, app) {
    el.innerHTML = '<header class="cgx-head"><a href="#/analyse" class="cg-logo" title="HapieCoin"><i>C</i>HapieCoin</a><span class="cgx-htitle">Market Analytics</span><a class="cgx-back" href="#/analyse">← Analyse</a>' +
      '<span class="cgx-live hide-sm"><i class="dot dot-live"></i>Live</span><div class="cgx-search">' + ICON.search + '<input type="text" placeholder="Search coin…" aria-label="Search coin" autocomplete="off" spellcheck="false"><div class="cgx-search-dd" hidden></div></div>' +
      '<button class="cgx-kbd" data-palette type="button" title="Command palette (Ctrl K)" aria-label="Open command palette"><span class="kbd">Ctrl</span><span class="kbd">K</span></button>' +
      '<button class="cgx-ibtn" data-theme-btn type="button" aria-label="Toggle theme"></button></header>' +
      '<nav class="cgx-tabs" aria-label="Market analytics sections">' + A.TABS.map((t) => '<a class="cgx-tab' + (t[2] ? ' home' : '') + '" href="#' + t[1] + '" data-path="' + t[1] + '">' + (t[2] ? ICON.home : '') + t[0] + '</a>').join('') + '<button class="cgx-tab term" type="button" data-path="/terminal" data-terminal-menu aria-haspopup="menu">Terminal ' + ICON.caret + '</button><span class="section-tab-indicator"></span></nav>';
    A.applyTheme();
    el.querySelector('[data-theme-btn]').addEventListener('click', () => CG.theme.toggle());
    el.querySelector('[data-palette]').addEventListener('click', A.openPalette);
    el.querySelector('[data-terminal-menu]').addEventListener('click', (e) => { const nav = CG.terminal && CG.terminal.NAV; const pages = nav ? nav.flatMap((g) => g.items.filter((it) => !it.ext).map((it) => [it.name, it.path, g.label])) : A.TERMINAL.map((p) => [p[0], p[1], '']); let grp = null, h = ''; pages.forEach((p) => { if (p[2] && p[2] !== grp) { grp = p[2]; h += '<div class="menu-label">' + CG.esc(grp) + '</div>'; } h += '<a class="menu-item" href="#' + p[1] + '"' + (CG.current.path === p[1] ? ' style="color:hsl(var(--primary))"' : '') + '>' + CG.esc(p[0]) + '</a>'; }); CG.menu(e.currentTarget, (grp ? '' : '<div class="menu-label">Terminal</div>') + h, { align: 'left' }); });
    const inp = el.querySelector('.cgx-search input'), dd = el.querySelector('.cgx-search-dd'); let hl = 0, matches = [];
    const close = () => { dd.hidden = true; };
    const go = (sym) => { inp.value = ''; close(); CG.navigate((app === 'terminal' ? '/terminal/coin/' : '/analytics/coin/') + sym); };
    const render = () => { const q = inp.value.trim().toLowerCase(); matches = q ? M.coins.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).sort((a, b) => (a.symbol.toLowerCase().startsWith(q) ? 0 : 1) - (b.symbol.toLowerCase().startsWith(q) ? 0 : 1) || a.rank - b.rank).slice(0, 8) : A.byCap().slice(0, 8); hl = Math.min(hl, Math.max(0, matches.length - 1)); dd.innerHTML = (matches.length ? matches.map((c, i) => '<button type="button" class="' + (i === hl ? 'hl' : '') + '" data-sym="' + c.symbol + '">' + A.icon(c.symbol) + '<b class="mono">' + c.symbol + '</b><span class="cg2-dim">' + CG.esc(c.name) + '</span>' + (A.watch.has(c.symbol) ? '<span class="cgx-star on" style="opacity:1;width:16px;height:16px">' + ICON.starOn + '</span>' : '') + '<span class="mono" style="margin-left:8px">' + A.price(c.price) + '</span></button>').join('') : '<div class="cg2-empty">No coins match “' + CG.esc(inp.value) + '”</div>') + '<div class="hint">↵ open in ' + (app === 'terminal' ? 'terminal' : 'analytics') + ' · esc</div>'; dd.hidden = false; };
    inp.addEventListener('input', () => { hl = 0; render(); });
    inp.addEventListener('focus', render);
    inp.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(hl + 1, matches.length - 1); render(); } else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(hl - 1, 0); render(); } else if (e.key === 'Enter') { e.preventDefault(); if (matches[hl]) go(matches[hl].symbol); else CG.toast({ title: 'No coins match', description: inp.value, variant: 'destructive' }); } else if (e.key === 'Escape') { close(); inp.blur(); } });
    dd.addEventListener('mousedown', (e) => e.preventDefault());
    dd.addEventListener('click', (e) => { const b = e.target.closest('[data-sym]'); if (b) go(b.dataset.sym); });
    document.addEventListener('mousedown', (e) => { if (!el.contains(e.target)) close(); });
    inp.addEventListener('blur', () => setTimeout(close, 120));
  };
  A.headerUpdate = function (el) {
    const path = CG.current.path; const tabs = CG.$$('.cgx-tab', el); let active = null;
    tabs.forEach((t) => { const p = t.dataset.path; const on = path === p || (p === '/terminal' && path.startsWith('/terminal')) || (p !== '/analytics/coinglass' && p !== '/terminal' && path.startsWith(p + '/')); t.classList.toggle('active', on); if (on) active = t; });
    if (!active && path.startsWith('/analytics/coin/')) { active = tabs.find((t) => t.dataset.path === '/analytics/markets'); if (active) active.classList.add('active'); }
    const ind = el.querySelector('.section-tab-indicator'); const place = () => { if (!ind) return; if (!active) { ind.style.opacity = 0; return; } ind.style.left = active.offsetLeft + 'px'; ind.style.width = active.offsetWidth + 'px'; ind.style.opacity = 1; };
    requestAnimationFrame(place); setTimeout(place, 60);
  };
  CG.chrome['analytics-tabs'] = (el) => A.header(el, 'analytics');
  CG.chrome['analytics-tabs:update'] = A.headerUpdate;
  // ---------- command palette registration (guarded: CG.palette is provided by the chrome part) ----------
  A.commands = [];
  const cmd = (id, label, group, run, keywords) => A.commands.push({ id, label, title: label, name: label, group, section: group, keywords: String(keywords || '').split(/\s+/).filter(Boolean), hint: group, run, action: run, handler: run });
  A.TABS.forEach((t) => cmd('analytics:' + t[1], 'Market Analytics · ' + t[0], 'Market Analytics', () => CG.navigate(t[1]), 'analytics ' + t[0].toLowerCase()));
  A.TERMINAL.forEach((t) => cmd('terminal:' + t[1], 'Terminal · ' + t[0], 'Terminal', () => CG.navigate(t[1]), 'terminal ' + t[0].toLowerCase()));
  cmd('analytics:compare', 'Compare coins…', 'Market Analytics', () => CG.navigate('/analytics/markets?compare=1'), 'compare overlay normalised price');
  ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'PEPE'].forEach((s) => cmd('watch:' + s, 'Add to watchlist → ' + s, 'Watchlist', () => A.watch.add(s), 'watchlist star ' + s.toLowerCase()));
  A.registerPalette = function () { const P = CG.palette; if (!P || A._palDone) return !!A._palDone; try { const reg = ['register', 'add', 'addCommand', 'addCommands'].map((k) => (typeof P[k] === 'function' ? P[k] : null)).find(Boolean); if (reg) { A.commands.forEach((c) => reg.call(P, c)); A._palDone = true; } else if (Array.isArray(P.commands)) { A.commands.forEach((c) => { if (!P.commands.some((x) => x && x.id === c.id)) P.commands.push(c); }); A._palDone = true; } } catch (e) { } return !!A._palDone; };
  CG.commandProviders = CG.commandProviders || []; CG.commandProviders.push(() => A.commands);
  A.registerPalette(); CG.on('palette', A.registerPalette); CG.on('palette-ready', A.registerPalette); document.addEventListener('DOMContentLoaded', () => setTimeout(A.registerPalette, 0));
  A.applyTheme(); A.applyDensity();
})();
</script>
