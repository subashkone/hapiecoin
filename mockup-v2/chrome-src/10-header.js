const CG = window.CG; if (!CG) return;
const st = CG.state, M = CG.mock, F = CG.fmt, esc = CG.esc, h = CG.h;
const CH = (CG.chrome = CG.chrome || {});
// ---------- inline icons (lucide-style paths) ----------
const PATHS = {
  chevron: 'm6 9 6 6 6-6', left: 'm15 18-6-6 6-6', right: 'm9 18 6-6-6-6', x: 'M18 6 6 18M6 6l12 12', check: 'M20 6 9 17l-5-5',
  wifi: 'M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0', wifioff: 'M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20',
  plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z', wallet: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  chart: 'M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3', moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z', sun: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01', gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', card: 'M2 5h20v14H2zM2 10h20', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  key: 'm21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4', dollar: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', layers: 'm12 2 10 5-10 5L2 7l10-5ZM2 17l10 5 10-5M2 12l10 5 10-5', percent: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', tag: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42zM7.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z',
  image: 'M3 5h18v14H3zM21 15l-5-5L5 21M9 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z', mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 3-10 7L2 7', whatsapp: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  plus: 'M5 12h14M12 5v14', edit: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6', refresh: 'M21 12a9 9 0 1 1-6.219-8.56M21 3v6h-6', send: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z', chat: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z', external: 'M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5',
  rocket: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5', diamond: 'M6 3h12l4 6-10 13L2 9Z M2 9h20M10 3l-2 6 4 13M14 3l2 6-4 13', lightning: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z', alert: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z', crown: 'm2 4 3 12h14l3-12-6 7-4-7-4 7-6-7ZM3 20h18', bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  search: 'm21 21-4.34-4.34M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', rows: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM21 9H3M21 15H3', keyboard: 'M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', command: 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3',
  trending: 'M16 7h6v6M22 7l-8.5 8.5-5-5L2 17', activity: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2', sparkles: 'M9.94 14.34 12 22l2.06-7.66L22 12l-7.94-2.34L12 2l-2.06 7.66L2 12z', arrow: 'M5 12h14M12 5l7 7-7 7', pause: 'M6 4h4v16H6zM14 4h4v16h-4z', play: 'm6 3 14 9-14 9z', home: 'm3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z', pie: 'M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1zM21.21 15.89A10 10 0 1 1 8 2.83', terminal: 'm4 17 6-6-6-6M12 19h8', book: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20', briefcase: 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M2 9h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'
};
const I = (name, size) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + ' aria-hidden="true"><path d="' + (PATHS[name] || '') + '"/></svg>';
CH.icon = I;
const MARK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 14.2 13.3H1.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 7.2v6" stroke="currentColor" stroke-width="1.7"/></svg>';
CH.mark = MARK;
const AV_ICON = { rocket: 'rocket', diamond: 'diamond', lightning: 'lightning' };
const avatarSvg = (name, size) => I(AV_ICON[name] || 'rocket', size);
const basePrice = {}; Object.keys(CG.ASSETS).forEach((k) => (basePrice[k] = CG.ASSETS[k].price));
const chg24 = (A) => A.chg24 + (A.price / basePrice[A.symbol] - 1) * 100;
const priceStr = (A) => F.num(A.price, A.price > 1000 ? 1 : 2);
const themeTitle = () => (CG.theme.get() === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
const expLabel = (code) => { const m = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(code || ''); return m ? m[1] + ' ' + m[2][0] + m[2].slice(1).toLowerCase() : String(code || ''); };
CH.expiryLabel = expLabel;
const curExpiry = () => (CG.analyse && CG.analyse.expiry && CG.EXPIRIES.includes(CG.analyse.expiry) ? CG.analyse.expiry : st.expiry);
// ---------- density ----------
document.documentElement.dataset.density = st.density === 'compact' ? 'compact' : 'comfortable';
CH.setDensity = function (v, quiet) {
  v = v === 'compact' ? 'compact' : 'comfortable'; st.density = v; CG.saveState(); document.documentElement.dataset.density = v; CG.emit('density', v); headers.forEach(renderHeader);
  if (!quiet) CG.toast({ title: 'Density: ' + v, description: v === 'compact' ? 'Dense 28px rows in chains, tables and lists.' : 'Comfortable 36px rows.' });
};
CH.toggleDensity = () => CH.setDensity(st.density === 'compact' ? 'comfortable' : 'compact');
// ---------- market stats (ATM IV, IV rank, expected move) ----------
M.ivRange = M.ivRange || { BTC: [0.30, 0.62], ETH: [0.40, 0.85], XAUT: [0.12, 0.30] };
function marketStats(asset, expiry) {
  asset = asset || (CG.analyse && CG.analyse.asset) || st.asset; const A = CG.ASSETS[asset] || CG.ASSETS.BTC; expiry = expiry || curExpiry();
  const ext = CG.analyse && CG.analyse.stats;
  if (ext && ext.atmIv != null && (!ext.asset || ext.asset === asset)) {
    const iv = ext.atmIv <= 1.5 ? ext.atmIv * 100 : ext.atmIv; const rank = ext.ivRank == null ? null : (ext.ivRank <= 1 ? Math.round(ext.ivRank * 100) : Math.round(ext.ivRank));
    const ex = ext.expiry || expiry; const em = ext.expectedMove != null ? ext.expectedMove : A.price * (iv / 100) * Math.sqrt(Math.max(F.dte(ex), 0.5) / 365);
    return { atmIv: iv, ivRank: rank == null ? rankFor(asset, iv) : rank, expectedMove: em, expiry: ex, dte: F.dte(ex), source: 'analyse' };
  }
  let atmIv = A.iv * 100;
  try { const ch = CG.chain(asset, expiry); const row = ch.rows.find((r) => r.atm) || ch.rows[Math.floor(ch.rows.length / 2)]; if (row) atmIv = (row.call.markIv + row.put.markIv) / 2; } catch (e) { }
  const dte = Math.max(F.dte(expiry), 0.5);
  return { atmIv, ivRank: rankFor(asset, atmIv), expectedMove: A.price * (atmIv / 100) * Math.sqrt(dte / 365), expiry, dte, source: 'chain' };
}
function rankFor(asset, ivPct) { const A = CG.ASSETS[asset] || CG.ASSETS.BTC; const rg = M.ivRange[asset] || [A.iv * 0.7, A.iv * 1.45]; return Math.round(Math.max(0, Math.min(100, (ivPct / 100 - rg[0]) / (rg[1] - rg[0]) * 100))); }
CH.marketStats = marketStats;
// ---------- app header ----------
const headers = [];
let liveConnecting = false, feedMs = 84;
function segHtml() { return '<div class="cgc-seg" role="tablist" aria-label="Asset" data-tour="asset-select">' + Object.values(CG.ASSETS).map((A) => '<button role="tab" aria-selected="' + (A.symbol === st.asset) + '" class="' + (A.symbol === st.asset ? 'on' : '') + '" data-act="asset" data-sym="' + A.symbol + '" title="' + esc(A.name) + ' · ' + priceStr(A) + '">' + A.symbol + '</button>').join('') + '</div>'; }
function statsHtml(A) {
  const s = marketStats(A.symbol);
  return '<div class="cgc-kv cgc-iv"><span class="micro">ATM IV</span><span class="v"><span data-atmiv>' + F.num(s.atmIv, 1) + '%</span><span class="dim">IV rank <span data-ivrank>' + s.ivRank + '</span></span></span></div>' +
    '<div class="cgc-kv cgc-em"><span class="micro">Exp. move · <span data-em-exp>' + esc(expLabel(s.expiry)) + '</span></span><span class="v"><span data-em>± ' + F.num(s.expectedMove, 0) + '</span><span class="dim">1σ</span></span></div>';
}
function feedHtml() { const cls = liveConnecting ? 'wait' : st.liveFeed ? 'on' : 'off'; const txt = liveConnecting ? 'Connecting' : st.liveFeed ? 'Feed live' : 'Feed paused'; return '<button class="cgc-feed ' + cls + '" data-act="live" title="' + (st.liveFeed ? 'Live futures prices from Delta Exchange · click to pause' : 'Live feed paused · click to connect') + '"><i></i><span data-feed-txt>' + txt + '</span><span class="ms" data-feed-ms>' + (st.liveFeed && !liveConnecting ? '· ' + feedMs + ' ms' : '') + '</span></button>'; }
function rightTools(logged) {
  const alerts = CG.alerts ? CG.alerts.counts() : { armed: 0, triggered: 0 };
  const bell = '<button class="cgc-ibtn" data-act="alerts" title="Alerts · ' + alerts.armed + ' armed" aria-label="Alerts">' + I('bell') + (alerts.armed || alerts.triggered ? '<span class="cgc-badge ' + (alerts.triggered ? 'hot' : '') + '" data-alert-count>' + (alerts.triggered || alerts.armed) + '</span>' : '') + '</button>';
  const dens = '<button class="cgc-ibtn" data-act="density" title="Density: ' + (st.density === 'compact' ? 'compact · click for comfortable' : 'comfortable · click for compact') + '" aria-label="Toggle density">' + I('rows') + '</button>';
  const theme = '<button class="cgc-ibtn" data-act="theme" title="' + themeTitle() + '" aria-label="' + themeTitle() + '">' + I(CG.theme.get() === 'dark' ? 'sun' : 'moon') + '</button>';
  const cmd = '<button class="cgc-cmdk" data-act="palette" data-tour="command-palette" title="Command palette (Ctrl K)" aria-label="Command palette"><kbd class="kbd">Ctrl</kbd><kbd class="kbd">K</kbd><span class="txt">Command</span></button>';
  const gear = '<button class="cgc-ibtn" data-act="settings" data-tour="settings-menu" title="Settings" aria-label="Settings">' + I('gear') + '</button>';
  const av = '<button class="cgc-avatar" data-act="account" title="' + esc(M.user.name) + '" aria-label="Account">' + avatarSvg(M.user.avatar) + '</button>';
  return logged ? bell + dens + theme + cmd + gear + av : theme + cmd + '<a class="btn btn-primary btn-sm" href="#/auth">Sign in</a>';
}
function renderHeader(H) {
  const el = H.el; const A = CG.ASSETS[st.asset] || CG.ASSETS.BTC; const admin = CG.auth.isAdmin(); const logged = !!st.loggedIn;
  const brand = (sub, href) => '<a href="#' + href + '" class="cgc-brand" title="HapieCoin">' + MARK + '<span>HapieCoin</span>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</a>' + (admin ? '<a class="cgc-admin" href="#/admin/users" title="Admin console">Admin</a>' : '');
  let html;
  if (H.variant === 'analyse') {
    const c = chg24(A);
    html = '<header class="cg-header cgc-header cgc-analyse">' + brand('Analyse', '/analyse') + segHtml() +
      '<div class="cgc-kv cgc-venue"><span class="micro">Venue</span><span class="v" style="font-family:var(--font-body)">Delta India</span></div><span class="cgc-vdiv"></span>' +
      '<div class="cgc-kv"><span class="micro">Futures · ' + A.symbol + 'USD</span><span class="v big"><span data-price>' + priceStr(A) + '</span><span data-chg class="' + (c >= 0 ? 'text-profit' : 'text-loss') + '">' + F.pct(c) + '</span><span class="dim">24h</span></span></div>' +
      statsHtml(A) + '<span class="cgc-spacer"></span>' + feedHtml() + '<span class="cgc-vdiv"></span>' +
      '<button class="cgc-chip ' + (st.exchangeConnected ? 'on' : '') + '" data-act="exchange" title="' + (st.exchangeConnected ? 'Connected · Delta Exchange · click for API settings' : 'Exchange not connected · click to connect') + '">' + I('plug') + '<span class="txt">' + (st.exchangeConnected ? 'Connected' : 'Not connected') + '</span></button>' +
      (st.exchangeConnected ? '<button class="cgc-chip on mono" data-act="wallet" title="Delta Exchange wallet · click to refresh">' + I('wallet') + F.usd(M.wallet.available) + '</button>' : '') +
      rightTools(true) + '</header>';
  } else {
    const p = (CG.current && CG.current.path) || '';
    const tab = (href, label, on) => '<a href="#' + href + '" class="' + (on ? 'active' : '') + '">' + label + '</a>';
    const nav = logged ? '<nav class="cgc-tabs" aria-label="Primary">' + tab('/analyse', 'Analyse', p === '/analyse') + tab('/analytics', 'Market Analytics', p.startsWith('/analytics') || p.startsWith('/terminal')) + tab('/subscription', 'Subscription', p.startsWith('/subscription')) + tab('/referrals', 'Referrals', p.startsWith('/referrals')) + (admin ? tab('/admin/users', 'Admin', p.startsWith('/admin')) : '') + '</nav>' : '<nav class="cgc-tabs" aria-label="Primary">' + tab('/', 'Home', p === '/') + tab('/analytics', 'Market Analytics', p.startsWith('/analytics')) + '</nav>';
    html = '<header class="cg-header cgc-header cgc-default">' + brand('', logged ? '/analyse' : '/') + nav + '<span class="cgc-spacer"></span>' + rightTools(logged) + '</header>';
  }
  el.innerHTML = html;
  if (H.variant === 'analyse' && H.section && !H.section.querySelector('[data-cg="plan-banner"]')) { const b = h('<div data-cg="plan-banner"></div>'); el.appendChild(b); CH['plan-banner'](b, H.section); b.dataset.cgDone = '1'; }
}
function updatePrice(H) {
  if (H.variant !== 'analyse') return; const A = CG.ASSETS[st.asset] || CG.ASSETS.BTC; const pe = H.el.querySelector('[data-price]'), ce = H.el.querySelector('[data-chg]'); if (!pe) return;
  const up = A.prev == null ? null : A.price >= A.prev; pe.textContent = priceStr(A); pe.classList.remove('flash-up', 'flash-down'); void pe.offsetWidth; if (up != null) pe.classList.add(up ? 'flash-up' : 'flash-down');
  const c = chg24(A); ce.textContent = F.pct(c); ce.className = c >= 0 ? 'text-profit' : 'text-loss';
  const ms = H.el.querySelector('[data-feed-ms]'); if (ms && st.liveFeed && !liveConnecting) ms.textContent = '· ' + feedMs + ' ms';
  updateStats(H);
}
function updateStats(H) {
  if (H.variant !== 'analyse') return; const A = CG.ASSETS[st.asset] || CG.ASSETS.BTC; const s = marketStats(A.symbol); const q = (sel) => H.el.querySelector(sel);
  const a = q('[data-atmiv]'); if (a) a.textContent = F.num(s.atmIv, 1) + '%'; const r = q('[data-ivrank]'); if (r) r.textContent = s.ivRank; const e = q('[data-em]'); if (e) e.textContent = '± ' + F.num(s.expectedMove, 0); const x = q('[data-em-exp]'); if (x) x.textContent = expLabel(s.expiry);
}
function updateBadge() { headers.forEach((H) => { const b = H.el.querySelector('[data-act="alerts"]'); if (!b) return; const c = CG.alerts ? CG.alerts.counts() : { armed: 0, triggered: 0 }; let badge = b.querySelector('.cgc-badge'); if (!c.armed && !c.triggered) { if (badge) badge.remove(); return; } if (!badge) { badge = h('<span class="cgc-badge" data-alert-count></span>'); b.appendChild(badge); } badge.textContent = c.triggered || c.armed; badge.classList.toggle('hot', !!c.triggered); b.title = 'Alerts · ' + c.armed + ' armed' + (c.triggered ? ' · ' + c.triggered + ' triggered' : ''); }); }
CH.setAsset = function (sym, quiet) { if (!CG.ASSETS[sym] || st.asset === sym) return; st.asset = sym; CG.saveState(); CG.emit('asset', sym); if (!quiet) CG.toast({ title: CG.ASSETS[sym].name + ' (' + sym + ')', description: 'Futures ' + priceStr(CG.ASSETS[sym]) + ' · chain, builder and payoff switched.' }); };
function headerAction(H, act, btn) {
  switch (act) {
    case 'theme': CG.theme.toggle(); break;
    case 'settings': CH.openSettingsMenu(btn); break;
    case 'account': CH.openAccountMenu(btn); break;
    case 'asset': if (btn.dataset.sym) CH.setAsset(btn.dataset.sym); else CH.openAssetMenu(btn); break;
    case 'live': if (st.liveFeed) { st.liveFeed = false; CG.saveState(); CG.emit('live-feed', false); headers.forEach(renderHeader); CG.toast({ title: 'Feed paused', description: 'Futures prices will not update until you reconnect.' }); } else { st.liveFeed = true; liveConnecting = true; CG.saveState(); headers.forEach(renderHeader); setTimeout(() => { liveConnecting = false; feedMs = Math.round(60 + Math.random() * 60); headers.forEach(renderHeader); CG.emit('live-feed', true); CG.toast({ title: 'Feed live', description: 'Connected to Delta Exchange live prices · ' + feedMs + ' ms.', variant: 'success' }); }, 900); } break;
    case 'exchange': CH.openSettings('api'); break;
    case 'wallet': CH.openWalletPopover(btn); break;
    case 'market': CG.navigate('/analytics'); break;
    case 'currency': CH.toggleCurrency(); break;
    case 'tour': CH.startTour(); break;
    case 'alerts': if (CG.alerts) CG.alerts.open(); break;
    case 'density': CH.toggleDensity(); break;
    case 'palette': if (CG.palette) CG.palette.toggle(); break;
  }
}
CH.toggleCurrency = function () { st.currency = st.currency === 'INR' ? 'USD' : 'INR'; CG.saveState(); CG.emit('currency-settings-changed', st.currency); CG.emit('currency', st.currency); CG.toast({ title: 'Display currency: ' + st.currency, description: st.currency === 'INR' ? 'All calculated values (P&L, Margin, Net Premium) will be displayed in Indian Rupees (₹)' : 'All calculated values (P&L, Margin, Net Premium) will be displayed in US Dollars ($)' }); };
CH['app-header'] = function (el, sectionEl) {
  const route = (sectionEl && sectionEl.dataset.route) || ''; const variant = el.dataset.variant || (route === '/analyse' || route.startsWith('/analyse/') ? 'analyse' : 'default');
  const H = { el, section: sectionEl, variant }; headers.push(H); renderHeader(H);
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && el.contains(b)) { e.preventDefault(); headerAction(H, b.dataset.act, b); } });
};
CH['app-header:update'] = function (el) { const H = headers.find((x) => x.el === el); if (H && H.variant !== 'analyse') renderHeader(H); };
CH.rerenderHeaders = () => headers.forEach(renderHeader);
['auth', 'asset', 'currency-settings-changed', 'theme', 'exchange-changed', 'profile-updated', 'density'].forEach((ev) => CG.on(ev, () => headers.forEach(renderHeader)));
['analyse:stats', 'analyse:expiry', 'expiry', 'lot-sizes-changed'].forEach((ev) => CG.on(ev, () => headers.forEach(updateStats)));
CG.on('alerts-changed', updateBadge); CG.on('alert-triggered', updateBadge);
CG.on('tick', () => { feedMs = Math.max(38, Math.min(160, Math.round(feedMs + (Math.random() - 0.5) * 30))); headers.forEach(updatePrice); });
// ---------- asset menu / wallet popover / account menu ----------
CH.openAssetMenu = function (anchor) {
  const m = CG.menu(anchor, '<div class="menu-label">Select asset</div>' + Object.values(CG.ASSETS).map((A) => '<button class="menu-item cgc-assetrow ' + (A.symbol === st.asset ? 'sel' : '') + '" data-sym="' + A.symbol + '"><span class="cgc-coin ' + A.symbol + '">' + esc(A.icon) + '</span><span><b>' + esc(A.name) + '</b> <span class="text-muted">(' + A.symbol + ')</span></span><span class="cgc-px">' + priceStr(A) + '</span></button>').join(''), { align: 'left' });
  m.classList.add('cgc-menu'); m.addEventListener('click', (e) => { const b = e.target.closest('[data-sym]'); if (!b) return; CH.setAsset(b.dataset.sym); });
};
CH.openWalletPopover = function (anchor) {
  const W = M.wallet; const m = CG.menu(anchor, '<div class="menu-label">Delta Exchange wallet</div><div class="cgc-kv-row"><span>Available</span><b>' + F.usd(W.available) + '</b></div><div class="cgc-kv-row"><span>Margin Used</span><b>' + F.usd(W.marginUsed) + '</b></div><div class="cgc-kv-row"><span>Total Equity</span><b>' + F.usd(W.equity) + '</b></div><div class="menu-sep"></div><button class="menu-item" data-refresh>' + I('refresh') + 'Click to refresh</button>');
  m.classList.add('cgc-menu'); m.addEventListener('click', (e) => { if (e.target.closest('[data-refresh]')) { W.marginUsed = +(W.marginUsed * (1 + (Math.random() - 0.5) * 0.02)).toFixed(2); W.equity = +(W.available + W.marginUsed + 17.88).toFixed(2); CG.emit('broker-balance-changed', W); headers.forEach(renderHeader); CG.toast({ title: 'Balance refreshed', description: 'Wallet: ' + F.usd(W.available) + ' available · ' + F.usd(W.equity) + ' equity' }); } });
};
CH.openAccountMenu = function (anchor) {
  const m = CG.menu(anchor, '<div class="cgc-menu-user"><b>' + esc(M.user.name) + '</b><span>' + esc(M.user.email) + '</span></div><div class="menu-label">Account</div><button class="menu-item" data-act="profile">' + I('user') + 'My Profile</button><a class="menu-item" href="#/subscription">' + I('card') + 'My Subscription</a><a class="menu-item" href="#/referrals">' + I('users') + 'My Referrals</a><div class="menu-sep"></div><button class="menu-item danger" data-act="logout">' + I('logout') + 'Logout</button>');
  m.classList.add('cgc-menu'); m.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) menuAction(b.dataset.act); });
};
