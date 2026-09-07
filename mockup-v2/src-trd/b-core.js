/* ===== area 21 · trading panels runtime · v2 (Obsidian Desk) ===== */
(function () {
  'use strict';
  const F = CG.fmt, M = CG.mock, ST = CG.state, esc = CG.esc, h = CG.h;
  const T = (CG.trading = CG.trading || {});
  const AN = (CG.analyse = CG.analyse || {});
  const defaults = { legs: [], name: '', strategyId: null, asset: ST.asset, expiry: ST.expiry, targetDays: 0, targetPrice: null, mode: 'live' };
  Object.keys(defaults).forEach((k) => { if (AN[k] === undefined) AN[k] = defaults[k]; });
  if (!Array.isArray(AN.legs)) AN.legs = [];
  const PAGE = 5;
  const S = { root: null, panels: {}, els: {}, selfManaged: false, subTab: 'builder', basket: false, dirty: false, editing: null, tplCat: 'All', tplOutlook: null, tplExpiry: AN.expiry, myTab: 'DRAFT', mySearch: '', paperSearch: '', paperPage: 1, paperSort: 'pnl', liveSearch: '', livePage: 1, liveSort: 'pnl', jFilter: 'All', jSearch: '', details: null, chain: null, brokerId: null, density: ST.density === 'compact' ? 'compact' : 'comfortable' };
  T._state = S;
  let seq = 310, orderSeq = 88200, alertSeq = 0, clipSeq = 0;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // ---------- icons (inline SVG only) ----------
  const svg = (d, sz, sw) => '<svg width="' + (sz || 14) + '" height="' + (sz || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    sqoff: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H10"/>'),
    refresh: svg('<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>'),
    search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 13),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 12, 2.2),
    bolt: svg('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
    plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>', 14, 2.4),
    layers: svg('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>', 22, 1.6),
    gear: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', 16),
    chevL: svg('<path d="m15 18-6-6 6-6"/>', 16, 2.2), chevR: svg('<path d="m9 18 6-6-6-6"/>', 16, 2.2),
    up: svg('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', 11, 2.4), down: svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', 11, 2.4),
    check: svg('<path d="M5 13l4 4L19 7"/>', 16, 3),
    bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 13),
    warn: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 14),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', 14),
    copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 13),
    pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 12),
    book: svg('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>', 22, 1.6),
    chart: svg('<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>', 13)
  };
  // ---------- helpers ----------
  const money = (n, d) => F.money(n, d == null ? 2 : d);
  const smoney = (n, d) => F.signedMoney(n, d == null ? 2 : d);
  const lotOf = (asset) => (ST.lotSizes && ST.lotSizes[asset]) || CG.ASSETS[asset].lot;
  const spot = (asset) => CG.ASSETS[asset || AN.asset].price;
  const byId = (id) => M.strategies.find((s) => s.id === id);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const nowIso = () => new Date(CG.NOW.getTime() + (Date.now() % 3600000)).toISOString();
  const expLabel = (code) => (!code || code === 'PERP') ? 'Perpetual' : code;
  const fmtK = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 });
  function expPretty(code) { if (!code || code === 'PERP') return 'Perpetual'; const d = F.expiryDate(code); if (isNaN(d)) return code; return String(d.getUTCDate()).padStart(2, '0') + ' ' + MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); }
  function fmtDate(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fmtShort(d) { const x = new Date(d); return String(x.getDate()).padStart(2, '0') + ' ' + MON[x.getMonth()]; }
  function dteOf(code) { return (!code || code === 'PERP') ? 0 : F.dte(code); }
  function quoteLeg(leg, asset) { if (leg.type === 'FUTURE') { const p = spot(asset); return { mark: p, bid: p, ask: p, markIv: 0, delta: 1 }; } return CG.quote(asset, leg.expiry, leg.strike, leg.type); }
  function currentPrice(leg, asset) { const q = quoteLeg(leg, asset); if (ST.pnlBasis && ST.pnlBasis !== 'mark') return leg.side === 'BUY' ? q.bid : q.ask; return q.mark; }
  function legPnl(leg, asset) { const q = lotOf(asset) * (leg.lots || 1); const sign = leg.side === 'BUY' ? 1 : -1; const entry = leg.entryPremium != null ? leg.entryPremium : leg.price; if (leg.status === 'SQUARED_OFF') { const ex = leg.exitPremium != null ? leg.exitPremium : entry; return { pnl: (ex - entry) * q * sign, current: ex, entry, realized: true }; } const cur = currentPrice(leg, asset); leg.currentPrice = cur; return { pnl: (cur - entry) * q * sign, current: cur, entry, realized: false }; }
  function recalc(s) { let u = 0, r = 0; (s.legs || []).forEach((l) => { const p = legPnl(l, s.asset); if (p.realized) r += p.pnl; else u += p.pnl; }); s.unrealizedPnl = +u.toFixed(2); s.realizedPnl = +r.toFixed(2); s.totalPnl = +(u + r).toFixed(2); s.legsCount = s.legs.length; return s; }
  function daysOf(s) { if (!s.startedAt) return s.daysTracked || 0; const end = s.closedAt ? new Date(s.closedAt) : CG.NOW; return Math.max(0, Math.floor((end - new Date(s.startedAt)) / 86400000)); }
  function openLegs(s) { return (s.legs || []).filter((l) => l.status !== 'SQUARED_OFF'); }
  function pushHistory(s) { s.pnlHistory = s.pnlHistory || []; const d = CG.NOW.toISOString().slice(0, 10); const last = s.pnlHistory[s.pnlHistory.length - 1]; if (last && last.date === d) last.pnl = s.totalPnl; else s.pnlHistory.push({ date: d, pnl: s.totalPnl }); }
  function moneyness(leg, asset) { if (leg.type === 'FUTURE') return ''; const sp = spot(asset), step = CG.ASSETS[asset].step; if (Math.abs(leg.strike - sp) <= step / 2) return 'ATM'; const itm = leg.type === 'CALL' ? leg.strike < sp : leg.strike > sp; return itm ? 'ITM' : 'OTM'; }
  function symbolOf(type, asset, strike, expiry) { return type === 'FUTURE' ? CG.ASSETS[asset].futSymbol + (expiry === 'PERP' ? '' : '-' + expiry) : (type === 'CALL' ? 'C-' : 'P-') + asset + '-' + strike + '-' + expiry; }
  function normLeg(raw, asset) { asset = asset || raw.asset || AN.asset; const type = String(raw.type || raw.optionType || 'CALL').toUpperCase(); const sideRaw = String(raw.side || raw.action || 'BUY').toUpperCase(); const side = sideRaw === 'SELL' ? 'SELL' : 'BUY'; const expiry = raw.expiry || (type === 'FUTURE' ? 'PERP' : (AN.expiry || ST.expiry)); const strike = type === 'FUTURE' ? null : +(raw.strike || raw.strikePrice); const q = type === 'FUTURE' ? { mark: spot(asset), markIv: 0 } : CG.quote(asset, expiry, strike, type); const price = raw.price != null ? +raw.price : q.mark; return { id: raw.id || CG.newLegId(), type, side, strike, expiry, lots: Math.max(1, Math.round(+(raw.lots || raw.quantity || 1))), price, entryPremium: raw.entryPremium != null ? +raw.entryPremium : price, currentPrice: q.mark, exitPremium: raw.exitPremium != null ? raw.exitPremium : null, iv: raw.iv != null ? raw.iv : q.markIv, status: raw.status || 'OPEN', isAdjustment: !!raw.isAdjustment, symbol: raw.symbol || symbolOf(type, asset, strike, expiry), unit: 'LOTS', customPrice: !!raw.customPrice }; }
  const cloneLeg = (l) => Object.assign({}, l);
  const entryPriced = (l) => Object.assign(cloneLeg(l), { price: l.entryPremium != null ? l.entryPremium : l.price });
  function isActiveEdit() { return !!(S.editing && (S.editing.status === 'PAPER' || S.editing.status === 'LIVE')); }
  function limitCheck(n) { n = n || 1; if (isActiveEdit()) { const active = AN.legs.filter((l) => l.status !== 'SQUARED_OFF').length; if (active + n > 10) { CG.toast({ title: 'Limit Reached', description: 'Maximum 10 active legs allowed per strategy', variant: 'destructive' }); return false; } return true; } if (AN.legs.length + n > 8) { CG.toast({ title: 'Limit Reached', description: 'Maximum 8 legs allowed for new strategy', variant: 'destructive' }); return false; } return true; }
  function remainingSlots() { return isActiveEdit() ? Math.max(0, 10 - AN.legs.filter((l) => l.status !== 'SQUARED_OFF').length) : Math.max(0, 8 - AN.legs.length); }
  function legsChanged() { if (AN.legs.length) S.legsAsset = AN.asset; CG.emit('analyse:legs-changed', AN.legs); renderBuilder(); }
  function legDesc(l) { return l.side + ' ' + (l.type === 'FUTURE' ? l.symbol : l.type + ' ' + Number(l.strike).toLocaleString('en-US')) + ' · ' + expLabel(l.expiry); }
  function brokerOf(id) { return M.brokers.find((x) => x.id === id) || M.brokers.find((x) => x.isDefault) || M.brokers[0]; }
  function brokerName(id) { const b = brokerOf(id); return b ? b.name : 'Delta Exchange'; }
  function brokerShort(b) { return b ? b.name.replace('Delta Exchange', 'Delta') : 'Delta'; }
  /* per-leg greeks at the current spot (per contract, unsigned) */
  function legGreeks(leg, asset) { const A = CG.ASSETS[asset]; const sp = spot(asset); if (leg.type === 'FUTURE') return { delta: 1, gamma: 0, theta: 0, vega: 0 }; const T0 = Math.max(dteOf(leg.expiry), 0) / 365; const s = (leg.iv || CG.pricing.smile(leg.strike, sp, A.iv) * 100) / 100; return CG.pricing.greeks(sp, leg.strike, T0, s, leg.type === 'CALL'); }
  /* exchange fee estimate: notional × fee%, capped at cap% of premium, + GST (per leg) */
  function feeFor(legs, asset, broker) { const b = broker || brokerOf(S.brokerId); const lot = lotOf(asset); const sp = spot(asset); let fee = 0, gst = 0; const per = legs.map((l) => { const q = (l.lots || 1) * lot; const notional = sp * q; const prem = (l.price || 0) * q; let f = notional * (b.feePercentage / 100); if (l.type !== 'FUTURE') f = Math.min(f, prem * (b.feeCapPercentage / 100)); const g = f * (b.gstPercentage / 100); fee += f; gst += g; return { id: l.id, fee: f, gst: g }; }); return { fee, gst, total: fee + gst, per, broker: b, legs: legs.length }; }
  function modePill(s) { const st = typeof s === 'string' ? s : s.status; if (st === 'LIVE') return '<span class="trd-mode-pill live" title="Live · real orders on the exchange"><i></i>Live</span>'; if (st === 'PAPER') return '<span class="trd-mode-pill paper" title="Paper · simulated at live prices"><i></i>Paper</span>'; if (st === 'ARCHIVED') return '<span class="trd-mode-pill arch">Archived</span>'; return '<span class="trd-mode-pill draft">Draft</span>'; }
  const statusBadge = modePill;
  function sideBadge(side) { return '<span class="trd-side ' + (side === 'BUY' ? 'buy' : 'sell') + '">' + side + '</span>'; }
  function typeBadge(type) { return '<span class="trd-type ' + (type === 'CALL' ? 'call' : type === 'PUT' ? 'put' : 'fut') + '">' + type + '</span>'; }
  function pnlClass(n) { return n >= 0 ? 'text-profit' : 'text-loss'; }
  function insCell(l, asset) { const closed = l.status === 'SQUARED_OFF'; const sub = l.type === 'FUTURE' ? ['perp future'] : [l.type.toLowerCase(), dteOf(l.expiry) + 'd', moneyness(l, asset)]; if (l.isAdjustment) sub.push('adj'); if (closed) sub.push('closed'); return '<div class="trd-ins"><b>' + esc(l.symbol || symbolOf(l.type, asset, l.strike, l.expiry)) + '</b><small>' + esc(sub.filter(Boolean).join(' · ')) + '</small></div>'; }
  function guessTemplate(legs) { const n = legs.length; if (n === 1) return legs[0].type === 'FUTURE' ? 'Futures' : (legs[0].side === 'BUY' ? 'Buy ' : 'Sell ') + (legs[0].type === 'CALL' ? 'Call' : 'Put'); if (n === 2) { const [a, b] = legs; if (a.type === b.type && a.type !== 'FUTURE') { if (a.side !== b.side) { const buy = a.side === 'BUY' ? a : b, sell = a.side === 'BUY' ? b : a; if (a.type === 'CALL') return buy.strike < sell.strike ? 'Bull Call Spread' : 'Bear Call Spread'; return buy.strike > sell.strike ? 'Bear Put Spread' : 'Bull Put Spread'; } } else if (a.strike === b.strike && a.side === b.side) return a.side === 'BUY' ? 'Long Straddle' : 'Short Straddle'; return 'Custom Spread'; } return n > 2 ? 'Multi-leg Strategy' : 'Custom Strategy'; }
  function createStrategy(o) { const id = 's_' + (++seq); const s = { id, name: o.name, asset: o.asset, status: o.status, tradingMode: o.tradingMode || null, templateName: o.templateName || guessTemplate(o.legs), createdAt: nowIso(), startedAt: o.startedAt || null, daysTracked: 0, brokerId: o.brokerId || null, legs: o.legs.map((l) => Object.assign(cloneLeg(l), { entryPremium: l.entryPremium != null ? l.entryPremium : l.price })), realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0, pnlHistory: [], tags: [], notes: '' }; M.strategies.unshift(s); recalc(s); return s; }
  function quotaOk(mode) { const sub = M.subscription || {}; const key = mode === 'live' ? 'live_trading' : 'paper_trading'; const lim = +((sub.featureLimits || {})[key] || 0); const used = +((sub.usage || {})[key] || 0); if (lim > 0 && used >= lim) { const msg = (mode === 'live' ? 'Live' : 'Paper') + ' Trading Limit reached for your plan'; if (CG.chrome && typeof CG.chrome.upgradeRequired === 'function') CG.chrome.upgradeRequired(msg); else CG.toast({ title: 'Upgrade Required', description: msg + ' · Subscribe Here → /subscription', variant: 'destructive' }); return false; } return true; }
  function bumpUsage(mode, n) { const sub = M.subscription; if (!sub) return; sub.usage = sub.usage || {}; const key = mode === 'live' ? 'live_trading' : 'paper_trading'; sub.usage[key] = (sub.usage[key] || 0) + (n || 1); }
  function seedLive() { if (M.strategies.some((s) => s.id === 's_310')) return; const asset = 'ETH', expiry = '25SEP26'; const mk = (type, side, strike, lots) => normLeg({ type, side, strike, expiry, lots }, asset); const s = { id: 's_310', name: 'ETH Bear Call Spread · live', asset, status: 'LIVE', tradingMode: 'LIVE', templateName: 'Bear Call Spread', createdAt: '2026-09-06T11:05:00', startedAt: '2026-09-06T11:06:00', daysTracked: 0, brokerId: 'br_1', orderBatchId: 'batch_81', legs: [mk('CALL', 'SELL', 2500, 3), mk('CALL', 'BUY', 2560, 3)], realizedPnl: 0, unrealizedPnl: 0, pnlHistory: [] }; s.orders = [{ legIdx: 0, legId: s.legs[0].id, status: 'filled', orderId: 'DX-88140', fill: s.legs[0].price }, { legIdx: 1, legId: s.legs[1].id, status: 'failed', orderId: null, fill: null, retries: 2, error: 'Order placement failed' }]; const at = M.strategies.findIndex((x) => x.id === 's_304'); M.strategies.splice(at >= 0 ? at + 1 : 0, 0, s); M.strategies.forEach((x) => { if (x.orders) x.orders.forEach((o) => { if (!o.legId && x.legs[o.legIdx]) o.legId = x.legs[o.legIdx].id; }); }); /* journal seed: tags / notes on the archived trades */ const a = byId('s_308'); if (a && !a.tags) { a.tags = ['range']; a.notes = 'Sold the wings a touch early; IV crush after the 22 Aug print did most of the work.'; } const b = byId('s_309'); if (b && !b.tags) { b.tags = ['earnings', 'hedge']; b.notes = 'Straddle sold into the ETF headline; got run over on the call side.'; } M.strategies.forEach((x) => { if (!Array.isArray(x.tags)) x.tags = []; if (x.notes == null) x.notes = ''; }); }
  function orderFor(s, leg, idx) { if (!s.orders) return null; return s.orders.find((o) => o.legId === leg.id) || s.orders.find((o) => o.legIdx === idx && !o.legId) || null; }
  function pager(page, total, key) { const pages = Math.max(1, Math.ceil(total / PAGE)); if (pages <= 1) return ''; return '<div class="trd-pager"><button class="btn btn-outline btn-xs" data-act="' + key + '-prev"' + (page <= 1 ? ' disabled' : '') + '>' + I.chevL + ' Previous</button><span class="micro">Page ' + page + ' of ' + pages + '</span><button class="btn btn-outline btn-xs" data-act="' + key + '-next"' + (page >= pages ? ' disabled' : '') + '>Next ' + I.chevR + '</button></div>'; }
  function searchBox(placeholder, value, act) { return '<div class="trd-search">' + I.search + '<input class="input input-sm" placeholder="' + esc(placeholder) + '" value="' + esc(value) + '" data-act="' + act + '" aria-label="' + esc(placeholder) + '">' + (value ? '<button class="trd-icon-btn trd-clear" data-act="' + act + '-clear" title="Clear search">' + I.x + '</button>' : '') + '</div>'; }
  function stepper(val, act, disabled) { return '<span class="trd-step"><button type="button" data-act="' + act + '-dec" title="−1 lot"' + (disabled ? ' disabled' : '') + '>−</button><input type="number" min="1" step="1" data-act="' + act + '" value="' + val + '"' + (disabled ? ' disabled' : '') + ' aria-label="Lots"><button type="button" data-act="' + act + '-inc" title="+1 lot"' + (disabled ? ' disabled' : '') + '>+</button></span>'; }
  function noteBox(kind, title, text, extra) { const ico = kind === 'destructive' ? I.warn : kind === 'warning' ? I.warn : I.info; return '<div class="alert alert-' + kind + ' trd-alert mt-2">' + ico + '<div>' + (title ? '<b>' + title + '</b>' : '') + '<div class="text-xs' + (title ? ' mt-1' : '') + '">' + text + '</div>' + (extra || '') + '</div></div>'; }
  function dateLabel(days) { const d = new Date(CG.NOW.getTime() + days * 86400000); return (days === 0 ? 'today · ' : DAYS[d.getDay()] + ' ') + d.getDate() + ' ' + MON[d.getMonth()]; }
  /* payoff sketch: expiry curve with green fill above zero / red fill below (used by templates and the details mini chart) */
  function payoffSvg(r, opts) { opts = opts || {}; const W = opts.w || 100, H = opts.h || 40; const lab = !!opts.labels; const pad = opts.pad || 3; const mL = lab ? 6 : pad, mR = mL, mT = lab ? 18 : pad, mB = lab ? 14 : pad; const pts = r.points.map((p) => p.pnlExpiry); const xs = r.points.map((p) => p.price); let min = Math.min(0, ...pts), max = Math.max(0, ...pts); if (max - min < 1e-6) { max = 1; min = -1; } const rng = max - min; const id = 'trdc' + (++clipSeq); const X = (i) => (mL + (W - mL - mR) * i / (pts.length - 1)); const Y = (v) => (mT + (H - mT - mB) * (1 - (v - min) / rng)); const ly = (y0, above) => above ? (y0 - 5 < mT + 8 ? y0 + 11 : y0 - 5) : (y0 + 11 > H - mB - 2 ? y0 - 5 : y0 + 11); const d = pts.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' '); const z = Y(0).toFixed(1); const area = d + ' L' + X(pts.length - 1).toFixed(1) + ' ' + z + ' L' + X(0).toFixed(1) + ' ' + z + ' Z'; let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="' + (opts.cls || 'trd-tpl-svg') + '" preserveAspectRatio="' + (opts.par || 'none') + '" aria-hidden="true"><defs><clipPath id="' + id + 'a"><rect x="0" y="0" width="' + W + '" height="' + z + '"/></clipPath><clipPath id="' + id + 'b"><rect x="0" y="' + z + '" width="' + W + '" height="' + (H - z) + '"/></clipPath></defs>'; if (opts.grid) { [0.25, 0.5, 0.75].forEach((f) => { const y = (mT + (H - mT - mB) * f).toFixed(1); s += '<line x1="' + mL + '" x2="' + (W - mR) + '" y1="' + y + '" y2="' + y + '" stroke="hsl(var(--border))" stroke-width="1"/>'; }); } s += '<line x1="' + mL + '" x2="' + (W - mR) + '" y1="' + z + '" y2="' + z + '" stroke="hsl(var(--muted-foreground))" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" opacity=".7"/>'; s += '<path d="' + area + '" fill="hsl(var(--profit))" opacity=".18" clip-path="url(#' + id + 'a)"/><path d="' + area + '" fill="hsl(var(--loss))" opacity=".18" clip-path="url(#' + id + 'b)"/>'; s += '<path d="' + d + '" fill="none" stroke="hsl(var(--foreground))" stroke-width="' + (opts.sw || 1.6) + '" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'; const xi = (px) => (px - xs[0]) / (xs[xs.length - 1] - xs[0]) * (pts.length - 1); if (opts.spot) { const x = X(xi(r.spot)).toFixed(1); s += '<line x1="' + x + '" x2="' + x + '" y1="' + mT + '" y2="' + (H - mB) + '" stroke="hsl(var(--spot))" stroke-width="1.2" vector-effect="non-scaling-stroke"/>'; if (lab) s += '<text x="' + x + '" y="' + (mT - 5) + '" text-anchor="middle" fill="hsl(var(--spot))" font-size="9" font-weight="500">SPOT ' + fmtK(r.spot) + '</text>'; } if (lab) { (r.breakevens || []).forEach((be) => { const i = xi(be); if (i < 0 || i > pts.length - 1) return; const x = X(i).toFixed(1); s += '<line x1="' + x + '" x2="' + x + '" y1="' + mT + '" y2="' + (H - mB) + '" stroke="hsl(var(--muted-foreground))" stroke-dasharray="4 3" stroke-width="1" vector-effect="non-scaling-stroke"/><text x="' + x + '" y="' + (H - mB - 4) + '" text-anchor="middle" font-size="9">BE ' + fmtK(be) + '</text>'; }); const last = pts[pts.length - 1], first = pts[0]; s += '<text x="' + (W - mR - 3) + '" y="' + ly(Y(last), last >= 0).toFixed(1) + '" text-anchor="end" font-size="9" fill="hsl(var(--' + (last >= 0 ? 'profit' : 'loss') + '))">' + (isFinite(r.maxProfit) && last >= 0 ? 'max ' : '') + smoney(last) + '</text><text x="' + (mL + 3) + '" y="' + ly(Y(first), first >= 0).toFixed(1) + '" font-size="9" fill="hsl(var(--' + (first >= 0 ? 'profit' : 'loss') + '))">' + smoney(first) + '</text>'; const lo = xs[0], hi = xs[xs.length - 1]; [0, 0.25, 0.5, 0.75, 1].forEach((f) => { s += '<text x="' + X(f * (pts.length - 1)).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="' + (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '" font-size="8.5">' + fmtK(lo + (hi - lo) * f) + '</text>'; }); } return s + '</svg>'; }
  function sparkline(s) { const pts = (s.pnlHistory || []).map((p) => p.pnl); pts.push(s.totalPnl); if (pts.length < 2) pts.unshift(0); const W = 150, H = 28, pad = 2; const min = Math.min(0, ...pts), max = Math.max(0, ...pts); const rng = (max - min) || 1; const x = (i) => (pad + (W - 2 * pad) * i / (pts.length - 1)).toFixed(1); const y = (v) => (pad + (H - 2 * pad) * (1 - (v - min) / rng)).toFixed(1); const d = pts.map((v, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(v)).join(' '); const last = pts[pts.length - 1]; const c = last >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'; return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="trd-spark" aria-label="P&L sparkline" title="P&L history · ' + pts.length + ' points"><line x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="hsl(var(--border))" stroke-dasharray="2 3"/><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.4" stroke-linejoin="round"/><circle cx="' + x(pts.length - 1) + '" cy="' + y(last) + '" r="2.4" fill="' + c + '"/></svg>'; }
  // ======================================================================
  // BUILDER + TICKET
  // ======================================================================
  function activeLegs() { return AN.legs.filter((l) => l.status !== 'SQUARED_OFF'); }
  function ticketData() {
    const legs = activeLegs(); if (!legs.length) return null; const asset = AN.asset, lot = lotOf(asset), sp = spot(asset);
    let r; try { r = CG.analyze(legs, asset); } catch (e) { return null; }
    const qty = Math.max(...legs.map((l) => l.lots || 1)) * lot; const net = r.netPremium; const perUnit = qty ? net / qty : 0; const fees = feeFor(legs, asset);
    const tp = AN.targetPrice || sp; const td = Math.min(AN.targetDays || 0, r.maxDte); let pt = null; try { pt = CG.analyze(legs, asset, { targetDays: td, min: tp, max: tp + 1e-6, points: 2 }).points[0]; } catch (e) { }
    const strikes = legs.filter((l) => l.type !== 'FUTURE').map((l) => l.strike); const uniq = Array.from(new Set(strikes)); const width = uniq.length >= 2 ? Math.max(...uniq) - Math.min(...uniq) : null;
    const debit = net < 0; const total = debit ? -(Math.abs(net) + fees.total) : net - fees.total;
    return { r, net, perUnit, qty, fees, total, debit, tp, td, pnlTarget: pt ? pt.pnlTarget : null, width, strikes: uniq.length, margin: r.margin, sp, lot, legs };
  }
  T.ticket = ticketData;
  function ticketHtml(t) {
    if (!t) return '';
    const A = AN.asset; const cur = ST.currency === 'INR' ? '₹' : '$';
    const maxLossEq = t.debit && isFinite(t.r.maxLoss) && Math.abs(Math.abs(t.r.maxLoss) - Math.abs(t.net)) < 0.02;
    const b = t.fees.broker;
    return '<div class="trd-ticket" data-ticket>' +
      '<div><span class="micro">Premium at mark</span><div class="v ' + (t.net >= 0 ? 'text-profit' : '') + '">' + (t.net >= 0 ? '+' : '−') + money(Math.abs(t.net)) + '</div><div class="s">' + F.num(Math.abs(t.perUnit), 1) + ' / ' + esc(A) + ' × ' + F.num(t.qty, 3) + ' ' + esc(A) + '</div></div>' +
      '<div><span class="micro">Fees · est.</span><div class="v">' + money(t.fees.total) + '</div><div class="s">taker · ' + plural(t.fees.legs, 'leg') + ' · ' + esc(brokerShort(b)) + ' ' + b.feePercentage + '%' + (b.gstPercentage ? ' + GST' : '') + '</div></div>' +
      '<div><span class="micro">' + (t.total < 0 ? 'Total debit' : 'Total credit') + '</span><div class="v">' + money(Math.abs(t.total)) + '</div><div class="s">' + (maxLossEq ? '= max loss · fees incl.' : 'incl. fees' + (t.debit ? '' : ' · net of fees')) + '</div></div>' +
      '<div><span class="micro">P&amp;L at target</span><div class="v ' + (t.pnlTarget == null ? '' : pnlClass(t.pnlTarget)) + '">' + (t.pnlTarget == null ? '—' : smoney(t.pnlTarget)) + '</div><div class="s">' + fmtK(t.tp) + ' · ' + dateLabel(t.td) + '</div></div>' +
      '<div><span class="micro">Margin est.</span><div class="v">' + money(t.margin) + '</div><div class="s">' + (t.r.pop == null ? 'exchange est.' : 'POP ' + Math.round(t.r.pop * 100) + '% · R:R ' + (t.r.rewardRisk == null ? (isFinite(t.r.maxProfit) ? '—' : '∞') : '1 : ' + t.r.rewardRisk.toFixed(2))) + '</div></div>' +
      '<div><span class="micro">Width</span><div class="v">' + (t.width == null ? '—' : fmtK(t.width)) + '</div><div class="s">' + (t.strikes >= 2 ? plural(t.strikes, 'strike') + (t.width ? ' · ' + F.num(t.width / t.sp * 100, 1) + '% of spot' : '') : t.strikes === 1 ? 'single strike' : 'futures only') + '</div></div>' +
      '</div>';
  }
  function netLineHtml(t) { if (!t) return ''; const g = t.r.greeks; return '<div class="trd-b-net" data-net><span>Lot = ' + t.lot + ' ' + esc(AN.asset) + '</span><span>Net ' + (t.net >= 0 ? 'credit' : 'debit') + ' <b>' + F.num(Math.abs(t.perUnit), 1) + ' / ' + esc(AN.asset) + '</b> → <b class="' + (t.net >= 0 ? 'text-profit' : '') + '">' + money(Math.abs(t.net)) + '</b></span><span>Net Δ <b>' + F.signed(g.delta, 4) + '</b></span><span>Net Θ/day <b class="' + pnlClass(g.theta) + '">' + smoney(g.theta) + '</b></span><span>Net ν/1% <b>' + smoney(g.vega) + '</b></span></div>'; }
  function renderTicket() { const el = S.els.builder; if (!el) return; const t = ticketData(); const tk = el.querySelector('[data-ticket]'); if (tk) { if (t) tk.outerHTML = ticketHtml(t); else tk.remove(); } const nl = el.querySelector('[data-net]'); if (nl) { if (t) nl.outerHTML = netLineHtml(t); else nl.remove(); } const mg = el.querySelector('[data-margin]'); if (mg) mg.textContent = t ? money(t.margin) : '—'; }
  function renderSubInfo() { const p = S.panels.strategy; const n = p && p.querySelector('[data-trd-subinfo]'); if (!n) return; const legs = AN.legs; const exps = Array.from(new Set(legs.filter((l) => l.type !== 'FUTURE').map((l) => l.expiry))); n.innerHTML = legs.length ? '<span class="micro">' + plural(legs.length, 'leg') + '</span>' + (exps.length ? '<span class="micro">·</span><span class="micro">' + exps.map((e) => expPretty(e) + ' · ' + dteOf(e) + 'd').join(' / ') + '</span>' : '') + (S.editing ? '<span class="micro">·</span><span class="micro">' + esc(S.editing.status.toLowerCase()) + '</span>' : '') : '<span class="micro">no legs</span>'; }
  function renderBuilder() {
    const el = S.els.builder; if (!el) return; renderSubInfo();
    const legs = AN.legs, asset = AN.asset, active = isActiveEdit(), ed = S.editing; const rem = remainingSlots(); const limitTitle = active ? 'Maximum 10 active legs reached' : 'Maximum 8 fresh legs reached';
    const exps = Array.from(new Set(legs.filter((l) => l.type !== 'FUTURE').map((l) => l.expiry)));
    let html = '<div class="trd-b" data-tour="strategy-legs">';
    html += '<div class="trd-b-head"><span class="micro">Builder</span><input class="trd-name" data-act="name" placeholder="Untitled strategy" value="' + esc(AN.name || '') + '" maxlength="80" aria-label="Strategy name" title="Strategy name · click to edit">' + (ed ? modePill(ed) + '<span class="trd-tag" title="Loaded strategy">' + esc(ed.id) + '</span>' : (legs.length ? '<span class="trd-tag" title="Detected structure">' + esc(guessTemplate(legs)) + '</span>' : '')) + '<span class="trd-right"><span class="micro">' + esc(asset) + (exps.length ? ' · ' + exps.map((e) => expPretty(e) + ' · ' + dteOf(e) + 'd').join(' / ') : '') + '</span></span></div>';
    html += '<div class="trd-b-tools"><button class="trd-pmode ' + (AN.mode === 'live' ? (ST.liveFeed === false ? 'wait' : 'live') : 'custom') + '" data-act="pmode" title="' + (AN.mode === 'live' ? 'Live prices from Delta Exchange (auto-updated). Paper trade will use these prices.' : 'Static/custom prices (editable). Paper trade will use your entered prices.') + '"><i></i>' + (AN.mode === 'live' ? (ST.liveFeed === false ? 'Connecting...' : 'Live price') : 'Custom price') + '</button>';
    html += '<label class="trd-basket" title="' + (S.basket ? 'Basket on: quantity and custom-price changes apply to every leg' : 'Basket off: each leg keeps its own quantity and price') + '"><span class="switch' + (S.basket ? ' on' : '') + '" data-act="basket" role="switch" aria-checked="' + S.basket + '"></span>Basket</label>';
    html += '<span class="trd-right"><button class="btn btn-ghost btn-xs" data-act="new" title="Start a new strategy">' + I.plus + ' New</button><button class="btn btn-ghost btn-xs" data-act="clear" title="Remove all legs">' + I.x + ' Clear</button></span></div>';
    if (!legs.length) {
      html += '<div class="trd-empty"><div class="trd-empty-ico">' + I.layers + '</div><b>No legs added</b><p>Start building your strategy by adding option or futures legs</p><div class="trd-empty-actions"><button class="btn btn-primary btn-sm" data-act="chain" data-tour="add-leg-button" title="Select option from live options chain">' + I.bolt + ' Select from Options Chain</button><button class="btn btn-outline btn-sm" data-act="future" title="Add Futures Contract">' + I.plus + ' USD Future</button></div><div class="trd-empty-or micro">or use a strategy template</div><div class="mt-1"><button class="btn btn-ghost btn-xs" data-act="goto-templates">Browse Templates →</button></div></div>';
    } else {
      html += '<div class="trd-legs-wrap"><table class="trd-legs"><thead><tr><th class="l">Side</th><th class="l">Instrument</th><th>Lots</th><th>IV</th><th>Price</th><th title="Position delta per contract">Δ</th><th title="Theta per ' + esc(asset) + ' per day (position sign)">Θ</th><th></th></tr></thead><tbody>';
      legs.forEach((l) => {
        const closed = l.status === 'SQUARED_OFF'; const locked = active && ed.legs.some((x) => x.id === l.id); const g = closed ? null : legGreeks(l, asset); const sg = l.side === 'BUY' ? 1 : -1;
        html += '<tr data-leg="' + l.id + '"' + (closed ? ' class="closed"' : '') + '>';
        html += '<td class="l"><button class="trd-side ' + (l.side === 'BUY' ? 'buy' : 'sell') + '" data-act="side"' + (locked ? ' disabled title="Side cannot change on an active leg"' : ' title="Click to toggle Buy / Sell"') + '>' + l.side + '</button></td>';
        html += '<td class="l">' + insCell(l, asset) + '</td>';
        html += '<td>' + stepper(l.lots, 'qty', closed) + '</td>';
        html += '<td>' + (l.type === 'FUTURE' ? '—' : F.num(l.iv || quoteLeg(l, asset).markIv, 1) + '%') + '</td>';
        if (AN.mode === 'custom' && !closed) html += '<td><input type="number" step="0.1" class="input trd-price-in" data-act="price" value="' + (+l.price).toFixed(1) + '" title="Click to edit custom price" aria-label="Custom price"></td>';
        else html += '<td><span class="trd-price" data-price="' + l.id + '" title="' + (closed ? 'Exit price' : 'Live price from Delta Exchange') + '">' + F.num(closed ? (l.exitPremium != null ? l.exitPremium : l.price) : l.price, 1) + '</span></td>';
        html += '<td class="' + (g ? (sg * (l.type === 'PUT' ? -1 : 1) * Math.abs(g.delta) >= 0 ? 'text-profit' : 'text-loss') : 'text-muted') + '">' + (g ? F.signed(sg * g.delta, 2) : '—') + '</td>';
        html += '<td class="' + (g ? (-sg * g.theta >= 0 ? 'text-profit' : 'text-loss') : 'text-muted') + '">' + (g ? (l.type === 'FUTURE' ? '0.0' : F.signed(sg * g.theta, 1)) : '—') + '</td>';
        html += '<td>' + (locked && !closed ? '<button class="trd-x warn" data-act="sqoff" title="Square off this leg">' + I.sqoff + '</button>' : locked ? '' : '<button class="trd-x" data-act="del" title="Delete this leg">✕</button>') + '</td></tr>';
      });
      html += '</tbody></table></div>';
      html += '<div class="trd-add-row"><button class="btn btn-outline btn-xs" data-act="chain" data-tour="add-leg-button" title="' + (rem ? 'Select option from live options chain' : limitTitle) + '"' + (rem ? '' : ' disabled') + '>' + I.bolt + ' Select from Chain</button><button class="btn btn-outline btn-xs" data-act="future" title="' + (rem ? 'Add Futures Contract' : limitTitle) + '"' + (rem ? '' : ' disabled') + '>' + I.plus + ' Future</button><span class="micro" style="margin-left:auto">' + (rem === 0 ? 'Leg limit reached' : rem + ' more ' + (rem === 1 ? 'leg' : 'legs') + ' allowed') + '</span></div>';
      const t = ticketData(); html += netLineHtml(t) + ticketHtml(t);
    }
    const t2 = legs.length ? ticketData() : null;
    html += '<div class="trd-b-actions"><button class="btn btn-outline btn-sm" data-act="save">' + (ed ? 'Update' : 'Save draft') + '</button><button class="btn btn-ghost btn-sm" data-act="save-trade" title="Name it, then choose paper or live">Save &amp; trade</button><span class="trd-right"><button class="btn btn-primary btn-sm" data-act="paper" data-tour="paper-trade-button">Paper trade <kbd>P</kbd></button><button class="btn btn-outline btn-sm" data-act="live">Live trade</button></span></div>';
    html += '<div class="trd-b-net" style="justify-content:flex-end;padding-top:6px"><span>Margin est. <b data-margin>' + (t2 ? money(t2.margin) : '—') + '</b> · fees incl.</span></div></div>';
    el.innerHTML = html;
  }
  function bindBuilder() {
    const el = S.els.builder;
    CG.delegate(el, 'click', '[data-act]', (e, t) => {
      const act = t.dataset.act; const tr = t.closest('tr[data-leg]'); const leg = tr ? AN.legs.find((l) => l.id === tr.dataset.leg) : null;
      if (act === 'pmode') { T.setPriceMode(AN.mode === 'live' ? 'custom' : 'live'); }
      else if (act === 'basket') { S.basket = !S.basket; CG.toast({ title: S.basket ? 'Basket on' : 'Basket off', description: S.basket ? 'Quantity and custom-price changes apply to every leg' : 'Each leg keeps its own quantity and price' }); renderBuilder(); }
      else if (act === 'new') { T.newStrategy(); }
      else if (act === 'clear') { T.clearLegs(); }
      else if (act === 'chain') { T.openChainModal(); }
      else if (act === 'future') { T.openFutureDialog(); }
      else if (act === 'goto-templates') { T.setSubTab('templates'); }
      else if (act === 'side' && leg) { leg.side = leg.side === 'BUY' ? 'SELL' : 'BUY'; S.dirty = true; legsChanged(); }
      else if ((act === 'qty-inc' || act === 'qty-dec') && leg) { setLots(leg, (leg.lots || 1) + (act === 'qty-inc' ? 1 : -1)); }
      else if (act === 'del' && leg) { T.removeLeg(leg.id); }
      else if (act === 'sqoff' && leg && S.editing) { T.openSquareOff(S.editing.id, leg.id); }
      else if (act === 'save') { T.saveCurrent(); }
      else if (act === 'save-trade') { if (!AN.legs.length) return CG.toast({ title: 'No legs', description: 'Add at least one leg to trade', variant: 'destructive' }); T.openSaveDialog('trade', (s) => T.openTradeMode({ strategy: s, fromBuilder: true })); }
      else if (act === 'paper') { T.beginTrade('paper'); }
      else if (act === 'live') { T.beginTrade('live'); }
    });
    el.addEventListener('input', (e) => { const t = e.target; if (t.dataset.act === 'name') { AN.name = t.value; S.dirty = true; } });
    el.addEventListener('change', (e) => {
      const t = e.target; const tr = t.closest('tr[data-leg]'); const leg = tr ? AN.legs.find((l) => l.id === tr.dataset.leg) : null; if (!leg) return;
      if (t.dataset.act === 'qty') { setLots(leg, +t.value); }
      else if (t.dataset.act === 'price') { const v = Math.max(0, +t.value || 0); if (S.basket) AN.legs.forEach((l) => { if (l.status !== 'SQUARED_OFF') { l.price = v; l.customPrice = true; } }); else { leg.price = v; leg.customPrice = true; } S.dirty = true; legsChanged(); }
    });
    el.addEventListener('keydown', (e) => { if (e.target.dataset && e.target.dataset.act === 'name' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); T.saveCurrent(); } });
  }
  function setLots(leg, v) { v = Math.max(1, Math.round(v || 1)); if (S.basket) AN.legs.forEach((l) => { if (l.status !== 'SQUARED_OFF') l.lots = v; }); else leg.lots = v; S.dirty = true; legsChanged(); }
  function tickBuilder() { if (!S.els.builder || !AN.legs.length) return; if (AN.mode !== 'live') { renderTicket(); return; } let changed = false; AN.legs.forEach((l) => { if (l.customPrice || l.status === 'SQUARED_OFF') return; const np = quoteLeg(l, AN.asset).mark; if (np === l.price) return; const dir = np > l.price ? 'up' : 'down'; l.price = np; changed = true; const cell = S.els.builder.querySelector('[data-price="' + l.id + '"]'); if (cell) { cell.textContent = F.num(np, 1); cell.classList.remove('flash-up', 'flash-down'); void cell.offsetWidth; cell.classList.add('flash-' + dir); cell.title = 'Price updated by live feed'; } }); renderTicket(); if (changed) CG.emit('analyse:legs-changed', AN.legs); }
  // public builder API (unchanged from v1)
  T.addLeg = function (raw, opts) { opts = opts || {}; if (!limitCheck(1)) return null; const leg = normLeg(raw, AN.asset); if (isActiveEdit()) leg.isAdjustment = true; AN.legs.push(leg); S.dirty = true; legsChanged(); if (!opts.silent) CG.toast({ title: 'Leg Added', description: legDesc(leg) }); CG.emit('cg-tour:leg-added', leg); return leg; };
  T.addLegs = function (raws, opts) { opts = opts || {}; if (!raws.length) return []; if (!limitCheck(raws.length)) return []; const out = raws.map((r) => { const leg = normLeg(r, AN.asset); if (isActiveEdit()) leg.isAdjustment = true; AN.legs.push(leg); return leg; }); S.dirty = true; legsChanged(); if (!opts.silent) CG.toast({ title: out.length > 1 ? 'Legs Added' : 'Leg Added', description: out.length > 1 ? plural(out.length, 'leg') + ' added to the strategy' : legDesc(out[0]) }); CG.emit('cg-tour:leg-added', out[0]); return out; };
  T.beginTrade = function (mode) { if (!AN.legs.length) return CG.toast({ title: 'No legs', description: 'Add at least one leg to trade', variant: 'destructive' }); if (!(AN.name || '').trim()) { T.openSaveDialog('trade', (s) => T.openTradeMode({ mode, strategy: s, fromBuilder: true })); return; } CG.emit('cg-tour:save-dialog-open'); T.openTradeMode({ mode, strategy: S.editing || null, fromBuilder: true }); };
  T.removeLeg = function (id) { const i = AN.legs.findIndex((l) => l.id === id); if (i < 0) return; AN.legs.splice(i, 1); S.dirty = true; legsChanged(); };
  T.clearLegs = function () { if (!AN.legs.length) { CG.toast({ title: 'No legs', description: 'Nothing to clear' }); return; } AN.legs = []; S.dirty = true; legsChanged(); CG.toast({ title: 'Cleared', description: 'All legs removed' }); };
  T.newStrategy = function () { AN.legs = []; AN.name = ''; AN.strategyId = null; S.editing = null; S.dirty = false; AN.mode = 'live'; legsChanged(); CG.toast({ title: 'New strategy', description: 'Builder reset · add legs from the chain or a template' }); };
  T.setPriceMode = function (mode) { AN.mode = mode === 'custom' ? 'custom' : 'live'; if (AN.mode === 'live') AN.legs.forEach((l) => { l.customPrice = false; if (l.status !== 'SQUARED_OFF') l.price = quoteLeg(l, AN.asset).mark; }); renderBuilder(); CG.emit('analyse:legs-changed', AN.legs); CG.toast({ title: AN.mode === 'live' ? 'Live price' : 'Custom price', description: AN.mode === 'live' ? 'Live prices from Delta Exchange (auto-updated). Paper trade will use these prices.' : 'Static/custom prices (editable). Paper trade will use your entered prices.' }); };
  T.setSubTab = function (name) { S.subTab = name === 'templates' ? 'templates' : 'builder'; const p = S.panels.strategy; if (!p) return; CG.$$('[data-trd-subtab]', p).forEach((b) => b.classList.toggle('active', b.dataset.trdSubtab === S.subTab)); CG.$$('[data-trd-sub]', p).forEach((d) => { d.hidden = d.dataset.trdSub !== S.subTab; }); if (S.subTab === 'templates') renderTemplates(); else renderBuilder(); };
  T.loadStrategy = function (id, opts) { opts = opts || {}; const s = typeof id === 'string' ? byId(id) : id; if (!s) return; if (!s.legs || !s.legs.length) { CG.toast({ title: 'No legs', description: 'This strategy has no legs to load', variant: 'destructive' }); return; } AN.legs = s.legs.map(cloneLeg); AN.name = s.name; AN.asset = s.asset; AN.strategyId = s.id; AN.expiry = (s.legs.find((l) => l.type !== 'FUTURE') || {}).expiry || AN.expiry; S.editing = s; S.dirty = false; AN.mode = (s.status === 'PAPER' || s.status === 'LIVE') ? 'live' : AN.mode; legsChanged(); CG.emit('analyse:set-tab', 'strategy'); T.setSubTab('builder'); if (!opts.silent) CG.toast({ title: 'Strategy', description: 'Loaded strategy: ' + s.name }); };
  T.loadTemplate = function (tpl) { if (typeof tpl === 'string') tpl = CG.TEMPLATES.find((t) => t.name === tpl); if (!tpl) return; AN.legs = CG.templateLegs(tpl, AN.asset, S.tplExpiry || AN.expiry).map((l) => Object.assign(l, { entryPremium: l.price, unit: 'LOTS', customPrice: false, exitPremium: null })); AN.name = tpl.name; AN.strategyId = null; S.editing = null; S.dirty = true; legsChanged(); T.setSubTab('builder'); CG.toast({ title: 'Strategy', description: 'Loaded strategy: ' + tpl.name }); };
  function toStratLeg(l) { const c = cloneLeg(l); if (c.entryPremium == null) c.entryPremium = c.price; return c; }
  T.saveCurrent = function () { if (!AN.legs.length) return CG.toast({ title: 'No legs', description: 'Add at least one leg', variant: 'destructive' }); if (S.editing) { if (!S.dirty && S.editing.name === (AN.name || '').trim()) return CG.toast({ title: 'No changes', description: 'No new or modified legs to save' }); if (!(AN.name || '').trim()) return T.openSaveDialog('draft'); return T.saveDraft(AN.name.trim()); } T.openSaveDialog('draft'); };
  T.saveDraft = function (name) {
    name = (name || AN.name || '').trim(); if (!name) return null; AN.name = name;
    let s = S.editing;
    if (s) { if (isActiveEdit()) { const fresh = AN.legs.filter((l) => !s.legs.some((x) => x.id === l.id)); if (!fresh.length && s.name === name) { CG.toast({ title: 'No new legs', description: 'All legs are already saved' }); return s; } fresh.forEach((l) => s.legs.push(Object.assign(toStratLeg(l), { isAdjustment: true }))); } else { s.legs = AN.legs.map(toStratLeg); s.asset = AN.asset; s.templateName = guessTemplate(s.legs); } s.name = name; s.updatedAt = nowIso(); recalc(s); S.dirty = false; CG.toast({ title: 'Saved', description: name + ' updated' }); }
    else { s = createStrategy({ name, asset: AN.asset, legs: AN.legs, status: 'DRAFT' }); S.editing = s; AN.strategyId = s.id; S.dirty = false; CG.toast({ title: 'Saved', description: name + ' saved as draft' }); }
    AN.legs = s.legs.map(cloneLeg); legsChanged(); renderTemplates(); portfolioChanged(); return s;
  };
  // ======================================================================
  // TEMPLATES (28) · outlook ranking · MY TEMPLATES
  // ======================================================================
  const CATS = ['All', 'Bullish', 'Bearish', 'Neutral', 'Others'];
  const OUTLOOKS = ['Bullish', 'Bearish', 'Neutral', 'Volatile'];
  function tplEval(tpl) {
    let legs, r; try { legs = CG.templateLegs(tpl, AN.asset, S.tplExpiry || AN.expiry); r = CG.analyze(legs, AN.asset, { points: 81 }); } catch (e) { return null; }
    const sp = r.spot; const at = (x) => { const i = Math.round(Math.max(0, Math.min(1, (x / sp - 0.8) / 0.4)) * 80); return r.points[i].pnlExpiry; };
    const up = at(sp * 1.06), dn = at(sp * 0.94), flat = at(sp), bigUp = at(sp * 1.14), bigDn = at(sp * 0.86);
    const fits = { Bullish: up > 0 && up >= flat - 1e-9 && dn <= 0, Bearish: dn > 0 && dn >= flat - 1e-9 && up <= 0, Neutral: flat > 0 && up < flat - 1e-9 && dn < flat - 1e-9, Volatile: bigUp > 0 && bigDn > 0 };
    const pop = r.pop == null ? 0 : r.pop; const rr = r.rewardRisk; const rrScore = rr == null ? (isFinite(r.maxProfit) ? 0 : 0.5) : Math.min(rr, 3) / 3;
    return { legs, r, pop, rr, fits, score: pop * 0.6 + rrScore * 0.4 };
  }
  function rrLabel(ev) { if (!ev) return '—'; if (ev.rr == null) return isFinite(ev.r.maxProfit) ? '—' : '∞'; return '1 : ' + (ev.rr >= 10 ? ev.rr.toFixed(0) : ev.rr.toFixed(1)); }
  function myList() { const st = S.myTab; const q = S.mySearch.trim().toLowerCase(); return M.strategies.filter((s) => s.status === st).filter((s) => !q || s.name.toLowerCase().includes(q) || s.asset.toLowerCase().includes(q) || (s.templateName || '').toLowerCase().includes(q)); }
  function renderTemplates() {
    const el = S.els.templates; if (!el) return;
    let html = '<div class="trd-t"><div class="trd-t-bar"><div class="trd-chips">' + CATS.map((c) => '<button class="trd-chip' + (S.tplCat === c ? ' active' : '') + '" data-act="cat" data-cat="' + c + '">' + (c === 'All' ? '' : '<i class="trd-chip-dot trd-cat-' + c + '"></i>') + c + '</button>').join('') + '</div><select class="select select-sm" data-act="tpl-expiry" title="Expiry used when loading a template" aria-label="Template expiry">' + CG.EXPIRIES.map((e) => '<option value="' + e + '"' + (e === (S.tplExpiry || AN.expiry) ? ' selected' : '') + '>' + expPretty(e) + ' · ' + dteOf(e) + 'd</option>').join('') + '</select></div>';
    html += '<div class="trd-t-bar"><span class="micro">Recommended for outlook</span><div class="trd-chips">' + OUTLOOKS.map((o) => '<button class="trd-chip' + (S.tplOutlook === o ? ' active' : '') + '" data-act="outlook" data-outlook="' + o + '" title="Rank templates that profit in a ' + o.toLowerCase() + ' market by POP and reward : risk">' + o + '</button>').join('') + (S.tplOutlook ? '<button class="trd-chip" data-act="outlook" data-outlook="" title="Clear outlook ranking">' + I.x + ' Clear</button>' : '') + '</div></div>';
    const evs = new Map(); CG.TEMPLATES.forEach((t) => evs.set(t.name, tplEval(t)));
    let list = CG.TEMPLATES.filter((t) => S.tplCat === 'All' || t.category === S.tplCat);
    if (S.tplOutlook) { list = list.filter((t) => { const ev = evs.get(t.name); return ev && ev.fits[S.tplOutlook]; }).sort((a, b) => evs.get(b.name).score - evs.get(a.name).score); html += '<div class="trd-outlook-note">' + I.chart + '<span>' + list.length + ' of ' + CG.TEMPLATES.length + ' templates profit in a <b>' + S.tplOutlook.toLowerCase() + '</b> market at the current ' + esc(AN.asset) + ' chain · ranked by POP × reward : risk</span></div>'; }
    if (!list.length) html += '<div class="empty"><b>No templates match</b>Try another category or outlook</div>';
    else html += '<div class="trd-tpl-grid">' + list.map((t, i) => { const ev = evs.get(t.name); return '<button class="trd-tpl-card" data-act="tpl" data-name="' + esc(t.name) + '" title="' + esc(t.description) + (ev ? ' · POP ' + Math.round(ev.pop * 100) + '% · R:R ' + rrLabel(ev) : '') + '">' + (S.tplOutlook ? '<span class="trd-rank">#' + (i + 1) + '</span>' : '') + (ev ? payoffSvg(ev.r) : '<div class="trd-tpl-svg"></div>') + '<span class="trd-tpl-name">' + esc(t.name) + '</span><span class="trd-tpl-meta"><span>POP <b>' + (ev ? Math.round(ev.pop * 100) + '%' : '—') + '</b></span><span>R:R <b>' + rrLabel(ev) + '</b></span></span><span class="trd-tpl-cat trd-cat-' + t.category + '">' + t.category + '</span></button>'; }).join('') + '</div>';
    const rows = myList(); const tabName = S.myTab === 'DRAFT' ? 'draft' : 'archived';
    html += '<div class="trd-my"><div class="trd-my-head"><b>My Templates</b><div class="flex items-center gap-2"><div class="trd-my-tabs"><button class="' + (S.myTab === 'DRAFT' ? 'active' : '') + '" data-act="my-tab" data-tab="DRAFT">Draft Strategies</button><button class="' + (S.myTab === 'ARCHIVED' ? 'active' : '') + '" data-act="my-tab" data-tab="ARCHIVED">Archived Strategies</button></div><button class="trd-icon-btn" data-act="my-refresh" title="Refresh strategies">' + I.refresh + '</button></div></div>';
    html += '<div class="flex gap-2 mb-2">' + searchBox('Search ' + tabName + ' strategies...', S.mySearch, 'my-search') + '</div>';
    if (!rows.length) html += '<div class="empty">' + (S.myTab === 'DRAFT' ? (S.mySearch ? '<b>No matching strategies</b>Try a different search' : '<b>No draft strategies</b>Create a strategy to see it here') : (S.mySearch ? '<b>No matching strategies</b>Try a different search' : '<b>No archived strategies</b>Archived strategies will appear here')) + '</div>';
    else html += '<div class="trd-list">' + rows.map((s) => { recalc(s); const arch = s.status === 'ARCHIVED'; return '<div class="trd-card" data-id="' + s.id + '"><div class="trd-card-top"><div><div class="trd-card-name">' + esc(s.name) + ' ' + modePill(s) + (arch && s.tradingMode ? '<span class="trd-tag">was ' + (s.tradingMode === 'LIVE' ? 'live' : 'paper') + '</span>' : '') + '</div><div class="trd-card-meta"><span class="trd-tag">' + s.asset + '</span><span><b>' + s.legs.length + '</b> legs</span><span>' + esc(s.templateName || '') + '</span><span>' + (arch && s.closedAt ? 'closed ' + fmtDate(s.closedAt) : 'created ' + fmtDate(s.createdAt)) + '</span></div></div>' + (arch ? '<div class="trd-card-pnl"><div class="big ' + pnlClass(s.totalPnl) + '">' + smoney(s.totalPnl) + '</div><div class="sub">realised</div></div>' : '') + '</div><div class="trd-card-actions"><button class="btn btn-outline" data-act="my-load" title="Load legs into the builder">Load</button>' + (arch ? '<button class="btn btn-outline" data-act="my-details">View Details</button>' : '<button class="btn btn-primary" data-act="my-activate" title="Start paper or live trading">Activate</button><button class="btn btn-outline" data-act="my-archive" title="Move to Archived Strategies">Archive</button>') + '<span class="trd-right"><button class="btn btn-ghost text-loss" data-act="my-delete">Delete</button></span></div></div>'; }).join('') + '</div>';
    html += '</div></div>';
    el.innerHTML = html;
  }
  function bindTemplates() {
    const el = S.els.templates;
    CG.delegate(el, 'click', '[data-act]', (e, t) => {
      const act = t.dataset.act; const card = t.closest('[data-id]'); const s = card ? byId(card.dataset.id) : null;
      if (act === 'cat') { S.tplCat = t.dataset.cat; renderTemplates(); }
      else if (act === 'outlook') { S.tplOutlook = t.dataset.outlook || null; if (S.tplOutlook) S.tplCat = 'All'; renderTemplates(); }
      else if (act === 'tpl') { T.loadTemplate(t.dataset.name); }
      else if (act === 'my-tab') { S.myTab = t.dataset.tab; S.mySearch = ''; renderTemplates(); }
      else if (act === 'my-refresh') { M.strategies.forEach(recalc); renderTemplates(); CG.toast({ title: 'Refreshed', description: 'Strategy data has been updated' }); }
      else if (act === 'my-search-clear') { S.mySearch = ''; renderTemplates(); }
      else if (act === 'my-load' && s) { T.loadStrategy(s.id); }
      else if (act === 'my-details' && s) { T.openDetails(s.id); }
      else if (act === 'my-activate' && s) { T.openTradeMode({ strategy: s, source: 'activate' }); }
      else if (act === 'my-archive' && s) { T.archiveStrategy(s.id); }
      else if (act === 'my-delete' && s) { T.deleteStrategy(s.id); }
    });
    el.addEventListener('input', (e) => { const t = e.target; if (t.dataset.act === 'my-search') { S.mySearch = t.value; const pos = t.selectionStart; renderTemplates(); const n = el.querySelector('[data-act="my-search"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } });
    el.addEventListener('change', (e) => { const t = e.target; if (t.dataset.act === 'tpl-expiry') { S.tplExpiry = t.value; renderTemplates(); } });
  }
  T.archiveStrategy = function (id) { const s = byId(id); if (!s) return; s.status = 'ARCHIVED'; s.closedAt = s.closedAt || nowIso(); if (S.editing === s) { S.editing = null; AN.strategyId = null; renderBuilder(); } renderAll(); CG.emit('analyse:strategies-changed', s); CG.toast({ title: 'Archived', description: s.name + ' moved to Archived Strategies' }); };
  T.deleteStrategy = async function (id, opts) { opts = opts || {}; const s = byId(id); if (!s) return; const ok = await CG.modal.confirm({ title: 'Delete Strategy', description: opts.short ? 'Delete ' + s.name + '? This cannot be undone.' : 'Are you sure you want to delete ' + s.name + '? This action cannot be undone.', confirmText: 'Delete', variant: 'destructive' }); if (!ok) return; const i = M.strategies.indexOf(s); if (i >= 0) M.strategies.splice(i, 1); if (S.editing === s) { S.editing = null; AN.strategyId = null; } if (S.details && S.details.id === id) S.details.close(); renderAll(); CG.emit('analyse:strategies-changed', s); CG.toast({ title: 'Deleted', description: s.name + ' has been deleted' }); };
  T.getPanels = () => S.panels;
  // ======================================================================
  // PORTFOLIO AGGREGATION · CG.portfolio
  // ======================================================================
  const PF = (CG.portfolio = CG.portfolio || {});
  PF.cache = null;
  function prevDayPnl(s) { const today = CG.NOW.toISOString().slice(0, 10); const hist = s.pnlHistory || []; for (let i = hist.length - 1; i >= 0; i--) if (hist[i].date < today) return hist[i].pnl; return 0; }
  PF.compute = function () {
    const active = M.strategies.filter((s) => s.status === 'PAPER' || s.status === 'LIVE');
    let netDelta = 0, netGamma = 0, netTheta = 0, netVega = 0, marginUsed = 0, dayPnl = 0, unrealized = 0, realized = 0, openPnl = 0; const by = [];
    active.forEach((s) => {
      recalc(s); const open = openLegs(s); let g = { delta: 0, gamma: 0, theta: 0, vega: 0 }, mg = 0;
      if (open.length) { try { const r = CG.analyze(open.map(entryPriced), s.asset); g = r.greeks; mg = r.margin; } catch (e) { } }
      netDelta += g.delta; netGamma += g.gamma; netTheta += g.theta; netVega += g.vega; marginUsed += mg; unrealized += s.unrealizedPnl; realized += s.realizedPnl; openPnl += s.totalPnl;
      const dp = s.totalPnl - prevDayPnl(s); dayPnl += dp;
      by.push({ id: s.id, name: s.name, status: s.status, asset: s.asset, pnl: s.totalPnl, unrealized: s.unrealizedPnl, realized: s.realizedPnl, dayPnl: +dp.toFixed(2), delta: +g.delta.toFixed(6), gamma: +g.gamma.toFixed(8), theta: +g.theta.toFixed(4), vega: +g.vega.toFixed(4), margin: +mg.toFixed(2), openLegs: open.length, legs: s.legs.length });
    });
    M.strategies.filter((s) => s.status === 'ARCHIVED').forEach((s) => { realized += s.realizedPnl || 0; });
    const data = { open: active.length, netDelta: +netDelta.toFixed(6), netGamma: +netGamma.toFixed(8), netTheta: +netTheta.toFixed(4), netVega: +netVega.toFixed(4), marginUsed: +marginUsed.toFixed(2), marginTotal: +(((M.wallet && M.wallet.available) || 0) + marginUsed).toFixed(2), dayPnl: +dayPnl.toFixed(2), unrealized: +unrealized.toFixed(2), realized: +realized.toFixed(2), openPnl: +openPnl.toFixed(2), byStrategy: by, at: Date.now() };
    PF.cache = data; return data;
  };
  PF.strategyPnl = function (id) { const s = byId(id); if (!s) return null; recalc(s); return s.totalPnl; };
  PF.strategy = function (id) { const s = byId(id); if (!s) return null; recalc(s); return { id: s.id, name: s.name, status: s.status, asset: s.asset, pnl: s.totalPnl, unrealized: s.unrealizedPnl, realized: s.realizedPnl }; };
  function portfolioChanged() { const d = PF.compute(); CG.emit('portfolio-changed', d); return d; }
  PF.refresh = portfolioChanged;
  // ======================================================================
  // ALERTS HOOK · CG.alerts.openNew or a local mini-dialog storing into CG.mock.alerts
  // ======================================================================
  T.openAlert = function (id) {
    const s = byId(id); if (!s) return null;
    if (CG.alerts && typeof CG.alerts.openNew === 'function') { CG.alerts.openNew({ type: 'pnl', kind: 'pnl', strategyId: s.id, name: s.name, asset: s.asset }); return null; }
    recalc(s); let op = s.totalPnl >= 0 ? '>=' : '<='; const def = Math.abs(s.totalPnl) < 1 ? (op === '>=' ? 5 : -5) : +(s.totalPnl * (op === '>=' ? 1.5 : 1.5)).toFixed(2);
    const el = h('<div class="trd-dlg"><div class="cg-dialog-body"><div class="trd-al-cur"><span>Current P&amp;L</span><b class="' + pnlClass(s.totalPnl) + '">' + smoney(s.totalPnl) + '</b><span>' + modePill(s) + '</span></div><div class="grid grid-2 gap-3"><div class="field"><label class="label">Condition</label><select class="select" data-op><option value=">="' + (op === '>=' ? ' selected' : '') + '>P&amp;L rises to or above</option><option value="<="' + (op === '<=' ? ' selected' : '') + '>P&amp;L falls to or below</option></select></div><div class="field"><label class="label">Value (' + (ST.currency === 'INR' ? '₹' : '$') + ')</label><input type="number" step="0.5" class="input mono" data-val value="' + def + '"><div class="hint">Evaluated on every price tick</div></div></div><div class="field"><label class="label">Notify</label><label class="trd-check"><input type="checkbox" class="checkbox" checked disabled style="margin-top:2px"><div><b>In-app toast</b><span>Fires once, then the alert disarms</span></div></label></div></div><div class="cg-dialog-foot"><button class="btn btn-outline" data-cg-close>Cancel</button><button class="btn btn-primary" data-go>' + I.bell + ' Set alert</button></div></div>');
    const hd = CG.modal.open(el, { title: 'Set alert', description: s.name + ' · P&L alert' });
    el.querySelector('[data-go]').addEventListener('click', () => { const v = +el.querySelector('[data-val]').value; if (isNaN(v)) return CG.toast({ title: 'Value required', description: 'Enter a P&L value', variant: 'destructive' }); op = el.querySelector('[data-op]').value; if (!Array.isArray(M.alerts)) M.alerts = []; const a = { id: 'al_' + (++alertSeq) + '_' + Date.now().toString(36), type: 'pnl', kind: 'pnl', strategyId: s.id, name: s.name, asset: s.asset, op, value: v, armed: true, state: 'armed', channels: ['push'], createdAt: nowIso(), lastValue: null, triggeredAt: null }; M.alerts.push(a); CG.emit('alerts-changed', M.alerts); hd.close(); CG.toast({ title: 'Alert set', description: s.name + ' · P&L ' + (op === '>=' ? '≥' : '≤') + ' ' + smoney(v), variant: 'success' }); });
    return hd;
  };
  /* local evaluation only when the chrome alerts engine is absent */
  function evalLocalAlerts() { if (CG.alerts || !Array.isArray(M.alerts)) return; M.alerts.forEach((a) => { if (!a.armed || a.type !== 'pnl' || !a.strategyId) return; const p = PF.strategyPnl(a.strategyId); if (p == null) return; a.lastValue = p; const hit = a.op === '<=' ? p <= a.value : p >= a.value; if (hit) { a.armed = false; a.state = 'triggered'; a.triggeredAt = nowIso(); CG.toast({ title: 'Alert · ' + a.name, description: 'P&L ' + smoney(p) + ' crossed ' + smoney(a.value), variant: 'success', duration: 5000 }); CG.emit('alerts-changed', M.alerts); } }); }
  // ======================================================================
  // PALETTE COMMANDS
  // ======================================================================
  function goTab(name, then) { const run = () => { CG.emit('analyse:set-tab', name); if (then) then(); }; if (CG.current && CG.current.path === '/analyse') run(); else { CG.navigate('/analyse'); setTimeout(run, 60); } }
  T.commands = function () {
    const cmds = [
      { id: 'trd-new', label: 'New strategy', group: 'Trading', keywords: 'builder reset', run: () => goTab('strategy', () => T.newStrategy()) },
      { id: 'trd-save', label: 'Save draft', group: 'Trading', keywords: 'strategy', run: () => goTab('strategy', () => T.saveCurrent()) },
      { id: 'trd-paper', label: 'Paper trade current strategy', group: 'Trading', keywords: 'simulate', run: () => goTab('strategy', () => T.beginTrade('paper')) },
      { id: 'trd-open-paper', label: 'Open Paper trades', group: 'Trading', keywords: 'positions', run: () => goTab('paper') },
      { id: 'trd-open-live', label: 'Open Live trades', group: 'Trading', keywords: 'positions exchange', run: () => goTab('live') },
      { id: 'trd-open-journal', label: 'Open Journal', group: 'Trading', keywords: 'trade log history', run: () => goTab('journal') }
    ];
    CG.TEMPLATES.forEach((t) => cmds.push({ id: 'trd-tpl-' + t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: 'Load template → ' + t.name, group: 'Templates', keywords: t.category.toLowerCase() + ' ' + t.description, run: () => goTab('strategy', () => T.loadTemplate(t.name)) }));
    return cmds;
  };
  function registerPalette() { const P = CG.palette; if (!P || S.paletteDone) return false; const fn = typeof P.register === 'function' ? P.register : typeof P.add === 'function' ? P.add : typeof P.addCommand === 'function' ? P.addCommand : null; if (!fn) return false; const cmds = T.commands(); let ok = 0; cmds.forEach((c) => { try { fn.call(P, c); ok++; } catch (e) { } }); S.paletteDone = ok > 0; return S.paletteDone; }
  T.registerPalette = registerPalette;
  // ---------- density ----------
  function applyDensity(v) { S.density = v === 'compact' ? 'compact' : 'comfortable'; const on = S.density === 'compact'; Object.keys(S.panels).forEach((k) => { if (S.panels[k]) S.panels[k].classList.toggle('trd-compact', on); }); document.body.classList.toggle('trd-compact', on); }
  // expose helpers for the other pieces of this file (and the tour)
  T._h = { F, M, ST, esc, h, I, S, AN, money, smoney, lotOf, spot, byId, plural, nowIso, expLabel, expPretty, fmtDate, fmtShort, fmtK, dteOf, quoteLeg, currentPrice, legPnl, recalc, daysOf, openLegs, pushHistory, moneyness, normLeg, cloneLeg, entryPriced, isActiveEdit, limitCheck, remainingSlots, legsChanged, legDesc, brokerOf, brokerName, brokerShort, feeFor, legGreeks, statusBadge, modePill, sideBadge, typeBadge, insCell, pnlClass, createStrategy, quotaOk, bumpUsage, seedLive, orderFor, pager, searchBox, stepper, noteBox, dateLabel, payoffSvg, sparkline, renderBuilder, bindBuilder, tickBuilder, renderTicket, renderTemplates, bindTemplates, toStratLeg, portfolioChanged, evalLocalAlerts, applyDensity, registerPalette, nextOrderId: () => 'DX-' + (++orderSeq) };
  function renderAll() { renderBuilder(); renderTemplates(); if (T._renderPaper) T._renderPaper(); if (T._renderLive) T._renderLive(); if (T._renderJournal) T._renderJournal(); portfolioChanged(); }
  T._renderAll = renderAll;
