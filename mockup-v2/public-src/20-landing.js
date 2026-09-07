/* ===== 10-public · icons, copy, terminal mock, landing page, footer chrome ===== */
(function () {
  const esc = CG.esc, F = CG.fmt;
  const svg = (paths, extra) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '>' + paths + '</svg>';
  const I = {
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 14.2 13.3H1.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 7.2v6" stroke="currentColor" stroke-width="1.7"/></svg>',
    arrow: svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
    arrowleft: svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
    chevdown: svg('<path d="m6 9 6 6 6-6"/>'),
    chevleft: svg('<path d="m15 18-6-6 6-6"/>'),
    chevright: svg('<path d="m9 18 6-6-6-6"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
    checkcircle: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    xcircle: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
    layers: svg('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
    activity: svg('<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>'),
    coins: svg('<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>'),
    shield: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
    barchart: svg('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16h8"/><path d="M7 11h12"/><path d="M7 6h3"/>'),
    zap: svg('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
    trending: svg('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
    trendingdown: svg('<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>'),
    crosshair: svg('<circle cx="12" cy="12" r="10"/><path d="M22 12h-4"/><path d="M6 12H2"/><path d="M12 6V2"/><path d="M12 22v-4"/>'),
    gitbranch: svg('<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
    radio: svg('<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>'),
    globe: svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
    flame: svg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
    wallet: svg('<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>'),
    settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    mail: svg('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'),
    chat: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
    lock: svg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
    eye: svg('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
    eyeoff: svg('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>'),
    user: svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    phone: svg('<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>'),
    tag: svg('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'),
    key: svg('<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>'),
    zoomin: svg('<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>'),
    zoomout: svg('<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    grid: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
    bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    command: svg('<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>'),
    book: svg('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>'),
    share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>'),
    sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
    delta: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#f7931a"/><path d="M12 4.5 4.5 19.5h15L12 4.5z" fill="#fff"/><path d="M12 10.5 8.5 17.5h7L12 10.5z" fill="#1d9d5a"/></svg>'
  };
  CG.pubIcons = I;
  CG.pubFillIcons = function (root) { CG.$$('[data-pub-icon]', root).forEach((el) => { if (!el.firstElementChild) el.innerHTML = I[el.dataset.pubIcon] || ''; }); };

  // ---------- landing copy (verbatim from the production bundle) ----------
  const HERO_BULLETS = ['Real-time Options Chain with Live Greeks', '28 Pre-built Strategy Templates', 'Risk-free Paper Trading Mode', 'Interactive P&L Payoff Diagrams', 'WebSocket Streaming Prices', 'Multi-leg Strategy Builder'];
  const STATS = [{ icon: 'layers', value: '28', label: 'Built-in Strategies' }, { icon: 'activity', value: 'Real-time', label: 'Greeks & IV' }, { icon: 'coins', value: '2', label: 'Assets Supported' }, { icon: 'shield', value: 'Paper', label: 'Trading' }];
  const WITHOUT = ['Guessing strike prices blindly', 'No real-time Greeks or IV data', 'Manual P&L tracking on spreadsheets', 'No way to test strategies risk-free', 'Scattered tools across platforms'];
  const WITH = ['ATM detection + full options chain', 'Live Delta, Gamma, Theta, Vega & IV', 'Automated P&L with payoff charts', 'Free paper trading with live prices', 'All-in-one analytics dashboard'];
  const TABS = [
    { icon: 'barchart', title: 'Real-time Options Chain', mock: 'chain', bullets: ['Live Greeks: Delta, Gamma, Theta, Vega', 'Implied Volatility & Open Interest', 'Bid/Ask spreads with depth', 'WebSocket streaming updates'] },
    { icon: 'zap', title: 'Strategy Builder & Payoff', mock: 'builder', bullets: ['Build multi-leg strategies visually', 'Interactive P&L payoff charts', 'Max profit, max loss & breakevens', '28 pre-built strategy templates'] },
    { icon: 'shield', title: 'Paper & Live Trading', mock: 'trading', bullets: ['Risk-free paper trading mode', 'Real-time P&L tracking', 'Position management & adjustments', 'One-click live execution via Delta'] }
  ];
  const CAPS = [
    { icon: 'activity', title: 'Live Greeks & IV', desc: 'Delta, Gamma, Theta, Vega — all updated in real-time with sub-second WebSocket streaming for precise risk assessment.', large: true },
    { icon: 'crosshair', title: 'ATM Detection', desc: 'Auto-detect at-the-money strikes for quick strategy setup.' },
    { icon: 'gitbranch', title: 'Multi-leg Strategies', desc: 'Build complex spreads, strangles, iron condors & more.' },
    { icon: 'radio', title: 'WebSocket Prices', desc: 'Sub-second price updates via WebSocket streaming for lightning-fast decisions.' },
    { icon: 'shield', title: 'Risk Management', desc: 'Max profit, max loss, breakeven analysis, and comprehensive risk metrics — everything you need to manage exposure with confidence.', large: true },
    { icon: 'globe', title: 'Multiple Assets', desc: 'Trade BTC, ETH & XAUT options on Delta Exchange.' }
  ];
  const FEATURE_LIST = [
    { icon: 'barchart', title: 'Options Analytics', features: ['Real-time Options Chain with live bid/ask prices', 'Full Greeks display — Delta, Gamma, Theta, Vega, Rho', 'Implied Volatility (IV) calculations', 'ATM (At-The-Money) strike auto-detection', 'Open Interest & Volume analysis', 'Multi-expiry support with quick switching'] },
    { icon: 'gitbranch', title: 'Strategy Builder', features: ['Multi-leg strategy construction (up to 4 legs)', 'Pre-built strategy templates (Straddle, Strangle, Spreads…)', 'Payoff diagram with breakeven visualization', 'Max Profit / Max Loss / Risk-Reward ratio', 'Custom strike & expiry selection per leg', 'Save & load strategies for later analysis'] },
    { icon: 'wallet', title: 'Paper Trading', features: ['Simulated order execution with live market prices', 'Track P&L in real-time without real capital', 'Position management — view, modify & square-off', 'Order history with entry / exit details', 'Exchange charges & fee simulation', 'Practice strategies risk-free before going live'] },
    { icon: 'activity', title: 'Live Market Data', features: ['WebSocket streaming for sub-second price updates', 'BTC, ETH & XAUT futures price with 24h change', 'Live P&L tracking on open positions', 'Connection status indicators', 'Automatic reconnection on network drops', 'Binance & Delta Exchange data feeds'] },
    { icon: 'shield', title: 'Risk Management', features: ['Position-level & portfolio-level risk metrics', 'Breakeven price calculation', 'Probability of profit estimation', 'Max drawdown & exposure analysis', 'Lot size & margin calculator', 'Currency conversion (USD / INR)'] },
    { icon: 'settings', title: 'Platform & Settings', features: ['Dark / Light theme toggle', 'API key management for Delta Exchange', 'Exchange charge configuration', 'Custom lot size settings', 'User profile & subscription management', 'Mobile-responsive design'] }
  ];
  const WHATS_NEW = [
    { icon: 'grid', title: 'Scenario matrix', desc: 'P&L by price × date in one colour-scaled table — the most-used paid feature, now first-class in the Scenarios tab.' },
    { icon: 'sliders', title: 'Vol & Structure tabs', desc: 'IV smile, term structure, open-interest walls and max pain for the selected expiry, right beside the chain.' },
    { icon: 'bell', title: 'Alerts', desc: 'Price, IV rank and strategy P&L alerts evaluated on every tick — delivered by push, email or Telegram.' },
    { icon: 'command', title: 'Command palette', desc: 'Ctrl K anywhere: jump to a screen, switch asset, toggle theme or density, arm an alert. Press ? for every shortcut.' },
    { icon: 'book', title: 'Journal', desc: 'Every paper and live trade with notes, tags and outcome — searchable, filterable and exportable.' },
    { icon: 'share', title: 'Share links', desc: 'Share a strategy as a link with legs, payoff and scenario matrix embedded for review.' }
  ];
  const EXCH = [{ name: 'Delta Exchange', status: 'live', mark: 'Δ', cls: 'delta' }, { name: 'CoinDCX', status: 'coming', mark: 'DCX', cls: 'dcx' }, { name: 'CoinSwitch', status: 'coming', mark: 'CS', cls: 'cs' }, { name: 'Mudrex', status: 'coming', mark: 'M', cls: 'mdx' }];
  CG.mock.landing = { heroBullets: HERO_BULLETS, stats: STATS, without: WITHOUT, with: WITH, tabs: TABS, capabilities: CAPS, featureList: FEATURE_LIST, whatsNew: WHATS_NEW, exchanges: EXCH };

  // ---------- terminal mock (real data from CG.chain / CG.analyze) ----------
  let termSeq = 0;
  const expL = (code) => { const m = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(code || ''); return m ? m[1] + ' ' + m[2][0] + m[2].slice(1).toLowerCase() : String(code || ''); };
  const px = (A) => F.num(A.price, A.price > 1000 ? 1 : 2);
  function termLegs(asset, expiry, tplName, lots) { try { const tpl = CG.TEMPLATES.find((t) => t.name === tplName) || CG.TEMPLATES[2]; return CG.templateLegs(tpl, asset, expiry).map((l) => Object.assign(l, { lots: lots || 10 })); } catch (e) { return []; } }
  function termAnalyze(legs, asset, opts) { try { return legs.length ? CG.analyze(legs, asset, opts) : null; } catch (e) { return null; } }
  function termStats(asset) { try { if (CG.chrome && CG.chrome.marketStats) return CG.chrome.marketStats(asset); } catch (e) { } const A = CG.ASSETS[asset]; return { atmIv: A.iv * 100, ivRank: 39, expectedMove: A.price * A.iv * Math.sqrt(19 / 365), expiry: CG.state.expiry }; }
  function termTop(asset) {
    const A = CG.ASSETS[asset]; const s = termStats(asset);
    return '<div class="pub-term-top"><span class="brand">' + I.logo + 'HapieCoin <em>Analyse</em></span><span class="seg">' + Object.keys(CG.ASSETS).map((k) => '<b class="' + (k === asset ? 'on' : '') + '">' + k + '</b>').join('') + '</span><span class="kv"><span class="micro dim">Futures</span><b class="big" data-t-price>' + px(A) + ' <em class="' + (A.chg24 >= 0 ? 'up' : 'dn') + '">' + F.pct(A.chg24) + '</em></b></span><span class="kv"><span class="micro dim">ATM IV</span><b>' + F.num(s.atmIv, 1) + '% <em>IV rank ' + s.ivRank + '</em></b></span><span class="kv"><span class="micro dim">Exp. move · ' + esc(expL(s.expiry)) + '</span><b>± ' + F.num(s.expectedMove, 0) + ' <em>1σ</em></b></span><span class="sp"></span><span class="feed"><i></i>Live <em class="dim" style="font-style:normal;letter-spacing:0;text-transform:none">84 ms</em></span><kbd class="kbd">Ctrl</kbd><kbd class="kbd">K</kbd></div>';
  }
  function termChainRows(asset, expiry, n, legs) {
    let ch = null; try { ch = CG.chain(asset, expiry); } catch (e) { return ''; }
    const rows = ch.rows; const mid = rows.findIndex((r) => r.atm); const maxOi = Math.max(1, ...rows.map((r) => Math.max(r.call.oi, r.put.oi)));
    const legAt = (k, type) => (legs || []).find((l) => l.strike === k && l.type === type);
    let h = '<div class="grp"><span><b>Calls</b> · ITM shaded</span><span class="s">' + esc(expL(expiry)) + '</span><span class="p">Δ per contract · <b>Puts</b></span></div>';
    h += '<div class="row h"><span>Δ</span><span>OI</span><span>Mark/IV</span><span class="k">Strike</span><span>Mark/IV</span><span>OI</span><span>Δ</span></div>';
    for (let i = -Math.floor(n / 2); i <= Math.floor(n / 2); i++) {
      const r = rows[mid + i]; if (!r) continue; const lc = legAt(r.strike, 'CALL'), lp = legAt(r.strike, 'PUT'); const ic = r.itmCall ? ' itm' : '', ip = r.itmPut ? ' itm' : '';
      h += '<div class="row' + (r.atm ? ' atm' : '') + '"><span class="' + ic + '">' + r.call.delta.toFixed(2) + '</span><span class="oi c' + ic + '">' + F.compact(r.call.oi) + '<i style="width:' + Math.round(r.call.oi / maxOi * 34) + 'px"></i></span><span class="' + ic + (lc ? ' leg' + (lc.side === 'SELL' ? ' s' : '') : '') + '">' + F.num(r.call.mark, 1) + '<em>' + r.call.markIv.toFixed(1) + '%</em></span><span class="k">' + F.int(r.strike) + (r.atm ? '<em style="color:hsl(var(--primary))">ATM</em>' : '') + '</span><span class="' + ip + (lp ? ' leg' + (lp.side === 'SELL' ? ' s' : '') : '') + '">' + F.num(r.put.mark, 1) + '<em>' + r.put.markIv.toFixed(1) + '%</em></span><span class="oi p' + ip + '">' + F.compact(r.put.oi) + '<i style="width:' + Math.round(r.put.oi / maxOi * 34) + 'px"></i></span><span class="' + ip + '">' + r.put.delta.toFixed(2) + '</span></div>';
    }
    const sumC = rows.reduce((s, r) => s + r.call.oi, 0), sumP = rows.reduce((s, r) => s + r.put.oi, 0);
    h += '<div class="cfoot"><span>Σ Call OI <b>' + F.compact(sumC) + '</b></span><span>Σ Put OI <b>' + F.compact(sumP) + '</b></span><span>PCR <b>' + (sumP / sumC).toFixed(2) + '</b></span><span>Max pain <b>' + F.int(ch.atm) + '</b></span><span class="r">' + n + ' of ' + rows.length + ' strikes · hover a row for B / S</span></div>';
    return h;
  }
  function termExpiries(expiry) { return '<div class="exp">' + CG.EXPIRIES.slice(0, 8).map((e) => '<span class="' + (e === expiry ? 'on' : '') + '">' + esc(expL(e)) + '<i>' + F.dte(e) + 'd</i></span>').join('') + '</div>'; }
  function termLegsTable(legs, asset, r, full) {
    const A = CG.ASSETS[asset]; const lot = CG.state.lotSizes[asset] || A.lot; const name = (CG.chrome && CG.chrome.strategyName) ? CG.chrome.strategyName(legs, null) : 'Strategy';
    let h = '<div class="b-head"><span class="micro dim">Builder</span><h4>' + esc(name) + '</h4><span class="tag">Template</span><span class="r micro dim">' + esc(expL(legs[0].expiry)) + ' · ' + F.dte(legs[0].expiry) + 'd · ' + legs.length + ' legs</span></div>';
    h += '<div class="legs"><span class="hd l">Side</span><span class="hd l">Instrument</span><span class="hd">Lots</span><span class="hd">IV</span><span class="hd">Price</span><span class="hd">Δ</span><span class="hd">Θ</span>';
    legs.forEach((l) => { let g = { delta: 0, theta: 0 }; try { g = CG.pricing.greeks(A.price, l.strike, Math.max(F.dte(l.expiry), 0.2) / 365, l.iv / 100, l.type === 'CALL'); } catch (e) { } h += '<span class="l side ' + (l.side === 'BUY' ? 'up' : 'dn') + '">' + l.side + '</span><span class="l">' + esc(l.symbol || (l.type[0] + '-' + asset + '-' + l.strike)) + '</span><span>' + l.lots + '</span><span>' + F.num(l.iv, 1) + '%</span><span>' + F.num(l.price, 1) + '</span><span>' + g.delta.toFixed(2) + '</span><span class="' + (g.theta * (l.side === 'BUY' ? 1 : -1) >= 0 ? 'up' : 'dn') + '">' + F.num(g.theta * (l.side === 'BUY' ? 1 : -1), 1) + '</span>'; });
    h += '</div>';
    if (r) h += '<div class="b-net"><span>Lot = ' + lot + ' ' + asset + '</span><span>Net ' + (r.netPremium >= 0 ? 'credit' : 'debit') + ' <b class="num" style="color:hsl(var(--foreground))">' + F.usd(Math.abs(r.netPremium)) + '</b></span><span>Net Δ <b class="num">' + F.signed(r.greeks.delta, 4) + '</b></span><span>Net Θ/day <b class="num">' + F.signedMoney(r.greeks.theta) + '</b></span></div>';
    if (full) h += '<div class="b-act"><b class="gh">Save draft</b><b class="pri">Paper trade</b><b>Live trade</b><span class="r micro dim">Margin est. ' + (r ? F.usd(r.margin) : '—') + '</span></div>';
    return h;
  }
  function termTiles(r) {
    if (!r) return '';
    const mp = isFinite(r.maxProfit) ? '+' + F.usd(r.maxProfit) : 'Unlimited', ml = isFinite(r.maxLoss) ? '-' + F.usd(Math.abs(r.maxLoss)) : 'Unlimited';
    const be = r.breakevens[0]; const pop = r.pop == null ? '—' : Math.round(r.pop * 100) + '%';
    return '<div class="tiles"><div class="tile"><span class="micro dim">Max profit</span><div class="v up">' + mp + '</div><span class="s">at expiry</span></div><div class="tile"><span class="micro dim">Max loss</span><div class="v dn">' + ml + '</div><span class="s">' + (isFinite(r.maxLoss) ? 'capped' : 'open-ended') + '</span></div><div class="tile"><span class="micro dim">Breakeven</span><div class="v">' + (be ? F.int(be) : '—') + '</div><span class="s">' + (be ? F.pct((be / r.spot - 1) * 100, 1) + ' from spot' : 'none') + '</span></div><div class="tile"><span class="micro dim">POP</span><div class="v">' + pop + '</div><span class="s">' + (r.rewardRisk ? 'R:R 1 : ' + F.num(1 / r.rewardRisk, 2) : 'prob. of profit') + '</span></div></div>';
  }
  function termPayoffSvg(r, asset, legs, w, h) {
    if (!r) return '';
    const pts = r.points; const minX = pts[0].price, maxX = pts[pts.length - 1].price;
    let ymin = Infinity, ymax = -Infinity; pts.forEach((p) => { ymin = Math.min(ymin, p.pnlExpiry, p.pnlTarget); ymax = Math.max(ymax, p.pnlExpiry, p.pnlTarget); }); if (ymin > 0) ymin = 0; if (ymax < 0) ymax = 0; const pad = (ymax - ymin) * 0.14 || 1; ymin -= pad; ymax += pad;
    const m = { l: 24, r: 6, t: 12, b: 12 }; const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const X = (v) => m.l + (v - minX) / (maxX - minX) * pw, Y = (v) => m.t + (ymax - v) / (ymax - ymin) * ph; const y0 = Y(0);
    const path = (k) => pts.map((p, i) => (i ? 'L' : 'M') + X(p.price).toFixed(1) + ' ' + Y(p[k]).toFixed(1)).join(' ');
    const area = path('pnlExpiry') + ' L' + X(maxX).toFixed(1) + ' ' + y0.toFixed(1) + ' L' + X(minX).toFixed(1) + ' ' + y0.toFixed(1) + ' Z';
    const id = 'pubt' + (termSeq++);
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-label="Payoff diagram"><defs><clipPath id="' + id + 'a"><rect x="0" y="0" width="' + w + '" height="' + y0.toFixed(1) + '"/></clipPath><clipPath id="' + id + 'b"><rect x="0" y="' + y0.toFixed(1) + '" width="' + w + '" height="' + (h - y0).toFixed(1) + '"/></clipPath></defs>';
    for (let i = 0; i <= 4; i++) { const v = ymax - (ymax - ymin) * i / 4; const y = Y(v); s += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (m.l + pw) + '" y2="' + y.toFixed(1) + '" stroke="hsl(var(--border))"/><text x="' + (m.l - 3) + '" y="' + (y + 2.5).toFixed(1) + '" text-anchor="end">' + (v >= 0 ? '+' : '-') + Math.round(Math.abs(v)) + '</text>'; }
    const step = (maxX - minX) / 4; for (let i = 0; i <= 4; i++) { const v = minX + step * i; s += '<line x1="' + X(v).toFixed(1) + '" y1="' + m.t + '" x2="' + X(v).toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="hsl(var(--border))" stroke-dasharray="1 3"/><text x="' + X(v).toFixed(1) + '" y="' + (h - 2) + '" text-anchor="middle">' + F.compact(v).replace(/\.\d+K/, 'K') + '</text>'; }
    const a = Math.max(X(r.spot - r.sd), m.l), b = Math.min(X(r.spot + r.sd), m.l + pw); if (b > a) s += '<rect x="' + a.toFixed(1) + '" y="' + m.t + '" width="' + (b - a).toFixed(1) + '" height="' + ph + '" fill="hsl(var(--muted-foreground))" opacity=".07"/>';
    try { const ch = CG.chain(asset, legs[0].expiry); const mx = Math.max(1, ...ch.rows.map((rw) => Math.max(rw.call.oi, rw.put.oi))); ch.rows.forEach((rw) => { if (rw.strike < minX || rw.strike > maxX) return; const x = X(rw.strike); const hc = rw.call.oi / mx * ph * 0.28, hp = rw.put.oi / mx * ph * 0.28; s += '<rect x="' + (x - 2.4).toFixed(1) + '" y="' + (m.t + ph - hc).toFixed(1) + '" width="2" height="' + hc.toFixed(1) + '" fill="hsl(var(--muted-foreground))" opacity=".18"/><rect x="' + (x + 0.4).toFixed(1) + '" y="' + (m.t + ph - hp).toFixed(1) + '" width="2" height="' + hp.toFixed(1) + '" fill="hsl(var(--muted-foreground))" opacity=".18"/>'; }); } catch (e) { }
    s += '<line x1="' + m.l + '" y1="' + y0.toFixed(1) + '" x2="' + (m.l + pw) + '" y2="' + y0.toFixed(1) + '" stroke="hsl(var(--muted-foreground))"/>';
    s += '<path d="' + area + '" fill="hsl(var(--profit))" opacity=".18" clip-path="url(#' + id + 'a)"/><path d="' + area + '" fill="hsl(var(--loss))" opacity=".18" clip-path="url(#' + id + 'b)"/>';
    s += '<path d="' + path('pnlExpiry') + '" fill="none" stroke="hsl(var(--foreground))" stroke-width="1.4" stroke-linejoin="round"/><path d="' + path('pnlTarget') + '" fill="none" stroke="hsl(var(--curve))" stroke-width="1.4"/>';
    r.breakevens.forEach((be) => { if (be < minX || be > maxX) return; s += '<line x1="' + X(be).toFixed(1) + '" y1="' + m.t + '" x2="' + X(be).toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="hsl(var(--muted-foreground))" stroke-dasharray="3 2"/><text x="' + (X(be) + 3).toFixed(1) + '" y="' + (m.t + ph - 3) + '">BE ' + F.int(be) + '</text>'; });
    const sx = X(r.spot); s += '<line x1="' + sx.toFixed(1) + '" y1="' + m.t + '" x2="' + sx.toFixed(1) + '" y2="' + (m.t + ph) + '" stroke="hsl(var(--spot))" stroke-width="1.2"/><rect x="' + (sx - 26).toFixed(1) + '" y="' + (m.t - 10) + '" width="52" height="10" rx="1" fill="hsl(var(--spot))"/><text x="' + sx.toFixed(1) + '" y="' + (m.t - 2.6) + '" text-anchor="middle" style="fill:hsl(var(--primary-foreground));font-weight:500;letter-spacing:.08em">SPOT ' + F.int(r.spot) + '</text>';
    if (isFinite(r.maxProfit) && r.maxProfit > 0) s += '<text x="' + (m.l + pw) + '" y="' + (Y(r.maxProfit) - 3).toFixed(1) + '" text-anchor="end" style="fill:hsl(var(--profit))">max +' + Math.round(r.maxProfit) + '</text>';
    if (isFinite(r.maxLoss) && r.maxLoss < 0) s += '<text x="' + (m.l + 3) + '" y="' + (Y(r.maxLoss) - 3).toFixed(1) + '" style="fill:hsl(var(--loss))">max ' + Math.round(r.maxLoss) + '</text>';
    return s + '</svg>';
  }
  function termMatrix(legs, asset, r) {
    if (!r) return ''; const dte = Math.max(1, r.maxDte); const days = [0, Math.round(dte * 0.33), Math.round(dte * 0.66), dte]; const prices = [1.04, 1.02, 1, 0.98, 0.96].map((k) => r.spot * k);
    const cells = prices.map((S) => days.map((d) => { try { return CG.analyze(legs, asset, { targetDays: d, min: S, max: S + 1, points: 2 }).points[0].pnlTarget; } catch (e) { return 0; } }));
    const mx = Math.max(1, ...cells.flat().map(Math.abs));
    let h = '<div class="mtx-hd"><span class="micro dim">Scenarios</span>P&L by price × date<span class="r micro dim"><span><i style="background:hsl(var(--profit))"></i>profit</span><span><i style="background:hsl(var(--loss))"></i>loss</span></span></div><div class="mtx" style="grid-template-columns:52px repeat(' + days.length + ',1fr)"><span class="hh"></span>' + days.map((d, i) => '<span class="hh ' + (i === 1 ? 'tg' : '') + '">' + (d === 0 ? 'Today' : d === dte ? 'Expiry' : '+' + d + 'd') + '</span>').join('');
    prices.forEach((S, i) => { h += '<span class="rh">' + (Math.abs(S - r.spot) < 1 ? 'ATM ' : '') + F.int(S) + '</span>' + cells[i].map((v) => '<span style="background:hsl(var(--' + (v >= 0 ? 'profit' : 'loss') + ')/' + (0.12 + Math.abs(v) / mx * 0.5).toFixed(2) + ')">' + (v >= 0 ? '+' : '') + F.num(v, 1) + '</span>').join(''); });
    return h + '</div>';
  }
  function termGreeks(r) { if (!r) return ''; return '<div class="greeks"><span class="gk"><span class="micro dim">Net Δ</span><b>' + F.signed(r.greeks.delta, 4) + '</b></span><span class="gk"><span class="micro dim">Net Γ</span><b>' + r.greeks.gamma.toExponential(1) + '</b></span><span class="gk"><span class="micro dim">Net Θ/day</span><b class="' + (r.greeks.theta >= 0 ? 'up' : 'dn') + '">' + F.signedMoney(r.greeks.theta) + '</b></span><span class="gk"><span class="micro dim">Net ν / 1% IV</span><b class="' + (r.greeks.vega >= 0 ? 'up' : 'dn') + '">' + F.signedMoney(r.greeks.vega) + '</b></span><span class="gk"><span class="micro dim">Margin est.</span><b>' + F.usd(r.margin) + '</b></span></div>'; }
  function termFoot() {
    let d = null; try { if (CG.chrome && CG.chrome.portfolioData) d = CG.chrome.portfolioData(); } catch (e) { }
    const open = (CG.mock.strategies || []).filter((s) => s.status === 'PAPER' || s.status === 'LIVE'); const n = d ? d.strategies : open.length; const al = CG.alerts ? CG.alerts.counts().armed : 3;
    return '<div class="pub-term-foot"><span><span class="micro dim">Portfolio</span><b>' + n + ' strategies</b></span><span><span class="micro dim">Net Δ</span><b class="' + (d && d.netDelta < 0 ? 'dn' : 'up') + '">' + (d ? F.signed(d.netDelta, 2) : '+2.44') + '</b></span><span><span class="micro dim">Margin used</span><b>' + (d ? F.usd(d.marginUsed, 0) + ' / ' + F.usd(d.marginTotal, 0) : '$312 / $1,312') + '</b></span><span><span class="micro dim">Day P&L</span><b class="' + (d && d.dayPnl < 0 ? 'dn' : 'up') + '">' + (d ? F.signedMoney(d.dayPnl) : '+$18.40') + '</b></span><span><span class="micro dim">Alerts</span><b>' + al + ' armed</b></span><span><span class="micro dim">Basis</span><b>' + (CG.state.pnlBasis === 'bid_ask' ? 'bid/ask' : 'mark') + '</b> · <span class="micro dim">CCY</span><b>' + CG.state.currency + '</b></span></div>';
  }
  function termPnlSvg(w, h) {
    const S = (CG.mock.strategies || []).find((s) => s.pnlHistory && s.pnlHistory.length > 8) || null; const vals = S ? S.pnlHistory.map((p) => p.pnl) : [0, 1, 2, 1.5, 3, 4, 3.5, 5];
    const mn = Math.min(0, ...vals), mx = Math.max(0.1, ...vals); const X = (i) => 20 + i / (vals.length - 1) * (w - 26), Y = (v) => h - 12 - (v - mn) / (mx - mn) * (h - 22);
    const line = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '">'; for (let i = 0; i <= 3; i++) { const v = mx - (mx - mn) * i / 3; s += '<line x1="20" y1="' + Y(v).toFixed(1) + '" x2="' + (w - 6) + '" y2="' + Y(v).toFixed(1) + '" stroke="hsl(var(--border))"/><text x="17" y="' + (Y(v) + 2.5).toFixed(1) + '" text-anchor="end">' + (v >= 0 ? '+' : '') + v.toFixed(0) + '</text>'; }
    s += '<line x1="20" y1="' + Y(0).toFixed(1) + '" x2="' + (w - 6) + '" y2="' + Y(0).toFixed(1) + '" stroke="hsl(var(--muted-foreground))"/><path d="' + line + ' L' + X(vals.length - 1).toFixed(1) + ' ' + Y(0).toFixed(1) + ' L20 ' + Y(0).toFixed(1) + ' Z" fill="hsl(var(--profit))" opacity=".14"/><path d="' + line + '" fill="none" stroke="hsl(var(--foreground))" stroke-width="1.4"/><circle cx="' + X(vals.length - 1).toFixed(1) + '" cy="' + Y(vals[vals.length - 1]).toFixed(1) + '" r="2.2" fill="hsl(var(--profit))"/><text x="' + (X(vals.length - 1) - 4).toFixed(1) + '" y="' + (Y(vals[vals.length - 1]) - 5).toFixed(1) + '" text-anchor="end" style="fill:hsl(var(--profit))">' + F.signedMoney(vals[vals.length - 1]) + '</text></svg>';
    return s;
  }
  function pubTerminal(kind, opts) {
    opts = opts || {}; const asset = opts.asset || 'BTC'; const expiry = CG.EXPIRIES.includes(CG.state.expiry) ? CG.state.expiry : CG.EXPIRIES[5];
    const legs = termLegs(asset, expiry, opts.template || 'Bull Call Spread', 10); const r = termAnalyze(legs, asset, { points: 81, targetDays: Math.max(1, Math.round(F.dte(expiry) / 2)) });
    const open = (CG.mock.strategies || []).filter((s) => s.status === 'PAPER' || s.status === 'LIVE');
    const ltabs = (on) => '<div class="tabs">' + [['chain', 'Chain'], ['builder', 'Builder', legs.length], ['paper', 'Paper', open.filter((s) => s.status === 'PAPER').length], ['live', 'Live', open.filter((s) => s.status === 'LIVE').length], ['journal', 'Journal']].map(([k, t, c]) => '<b class="' + (k === on ? 'on' : '') + '">' + t + (c ? '<em>' + c + '</em>' : '') + '</b>').join('') + '<span class="r"><span class="micro dim">Lot ' + (CG.state.lotSizes[asset] || CG.ASSETS[asset].lot) + ' ' + asset + '</span><span class="micro dim">Basis ' + (CG.state.pnlBasis === 'bid_ask' ? 'bid/ask' : 'mark') + '</span></span></div>';
    const rtabs = (on) => '<div class="tabs">' + ['Payoff', 'Scenarios', 'Greeks', 'Vol', 'Structure', 'Ladder'].map((t) => '<b class="' + (t === on ? 'on' : '') + '">' + t + '</b>').join('') + '<span class="r micro dim">' + (r ? esc((CG.chrome && CG.chrome.strategyName) ? CG.chrome.strategyName(legs, null) : 'Bull Call Spread') + ' · 10 lots' : '') + '</span></div>';
    const chartHd = '<div class="chart-hd"><span class="micro dim">Payoff</span><span><i></i>At expiry</span><span><i class="c"></i>On ' + esc(expL(expiry)).replace(/^\d+ /, (d) => String(Math.max(1, +d - Math.round(F.dte(expiry) / 2))) + ' ') + '</span><span class="chips"><b class="on">OI</b><b class="on">±SD</b><b>IV −5%</b></span></div>';
    let left, right;
    if (kind === 'builder') {
      left = ltabs('builder') + termExpiries(expiry) + '<div class="sect">Strategy legs</div><div class="builder" style="margin-top:0;border-top:0;background:transparent;padding-top:2px">' + termLegsTable(legs, asset, r, true) + '</div><div class="sect">Templates · 28</div><div class="chips">' + ['Bull Call Spread', 'Iron Condor', 'Long Straddle', 'Short Strangle', 'Bear Put Spread', 'Iron Butterfly', 'Jade Lizard', 'Long Call Butterfly', 'Strip', 'Strap'].map((t, i) => '<b class="' + (i === 0 ? 'on' : '') + '">' + t + '</b>').join('') + '</div>';
      right = rtabs('Payoff') + termTiles(r) + chartHd + '<div class="chart">' + termPayoffSvg(r, asset, legs, 300, 118) + '</div>' + termGreeks(r);
    } else if (kind === 'trading') {
      const W = CG.mock.wallet || { available: 1000, marginUsed: 312.4, equity: 1330.28 };
      left = ltabs('paper') + '<div class="pos h"><span>Strategy</span><span>Mode</span><span class="num">Legs</span><span class="num">Days</span><span class="num">P&L</span></div>' + open.concat((CG.mock.strategies || []).filter((s) => s.status === 'ARCHIVED')).slice(0, 8).map((s) => '<div class="pos"><span>' + esc(s.name) + '</span><span class="tag ' + (s.status === 'LIVE' ? 'live' : '') + '">' + (s.status === 'LIVE' ? 'Live' : s.status === 'ARCHIVED' ? 'Closed' : 'Paper') + '</span><span class="num">' + s.legs.length + '</span><span class="num">' + s.daysTracked + 'd</span><span class="num ' + (s.totalPnl >= 0 ? 'up' : 'dn') + '">' + F.signedMoney(s.totalPnl) + '</span></div>').join('') + '<div class="cfoot"><span>Open <b>' + open.length + '</b></span><span>Realised <b class="up">+' + F.usd(open.reduce((a, s) => a + s.realizedPnl, 0)) + '</b></span><span>Unrealised <b class="up">+' + F.usd(open.reduce((a, s) => a + s.unrealizedPnl, 0)) + '</b></span><span class="r">Stop · square off · adjust</span></div>';
      right = rtabs('Greeks').replace('>Greeks<', '>Portfolio<') + '<div class="wallet"><div class="tile"><span class="micro dim">Available</span><div class="v">' + F.usd(W.available) + '</div><span class="s">Delta wallet</span></div><div class="tile"><span class="micro dim">Margin used</span><div class="v">' + F.usd(W.marginUsed) + '</div><span class="s">' + Math.round(W.marginUsed / (W.available + W.marginUsed) * 100) + '% of balance</span></div><div class="tile"><span class="micro dim">Equity</span><div class="v up">' + F.usd(W.equity) + '</div><span class="s">mark basis</span></div></div><div class="chart-hd"><span class="micro dim">P&L history</span><span><i></i>Cumulative</span></div><div class="chart">' + termPnlSvg(300, 120) + '</div>' + termGreeks(r);
    } else {
      left = ltabs('chain') + termExpiries(expiry) + termChainRows(asset, expiry, opts.rows || 11, legs) + '<div class="builder">' + termLegsTable(legs, asset, r, true) + '</div>';
      right = rtabs('Payoff') + termTiles(r) + chartHd + '<div class="chart">' + termPayoffSvg(r, asset, legs, 300, 118) + '</div>' + termMatrix(legs, asset, r);
    }
    return '<div class="pub-term" data-term="' + kind + '">' + termTop(asset) + '<div class="pub-term-body"><div class="pub-term-left">' + left + '</div><div class="pub-term-right">' + right + '</div></div>' + termFoot() + '</div>';
  }
  CG.pubTerminal = pubTerminal; CG.pubMock = pubTerminal;

  // ---------- landing screen ----------
  let landingRoot = null, tabIdx = 0, tabProg = 0, tabTimer = null, pendingScroll = null;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function renderHero(root) {
    CG.$('#pub-hero-bullets', root).innerHTML = HERO_BULLETS.map((b) => '<div>' + I.checkcircle + '<span>' + esc(b) + '</span></div>').join('');
    CG.$('#pub-hero-visual', root).innerHTML = pubTerminal('chain', { rows: 11 });
  }
  function renderStats(root) { CG.$('#pub-stats', root).innerHTML = STATS.map((s) => '<div class="pub-stat"><div class="pub-stat-ic">' + I[s.icon] + '</div><div><div class="pub-stat-v" data-count="' + esc(s.value) + '">' + esc(s.value) + '</div><div class="pub-stat-l">' + esc(s.label) + '</div></div></div>').join(''); }
  function animateCounts(root) {
    CG.$$('[data-count]', root).forEach((el) => { const target = parseInt(el.dataset.count, 10); if (isNaN(target) || el.dataset.done) return; el.dataset.done = '1'; if (reduceMotion) return; const t0 = performance.now(); const step = (t) => { const k = Math.min(1, (t - t0) / 1200); el.textContent = Math.round(target * k); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); });
  }
  function renderNew(root) { CG.$('#pub-new', root).innerHTML = WHATS_NEW.map((n) => '<div class="pub-new-item"><div class="ic">' + I[n.icon] + '</div><div><b>' + esc(n.title) + '<span class="tag">new</span></b><p>' + esc(n.desc) + '</p></div></div>').join(''); }
  function sparkSvg(A) { const vals = CG.series(40, A.price, 0.012, A.symbol.length * 977 + 13); const k = A.price / vals[vals.length - 1]; const v = vals.map((x) => x * k); const mn = Math.min(...v), mx = Math.max(...v); const X = (i) => i / (v.length - 1) * 200, Y = (x) => 30 - (x - mn) / (mx - mn || 1) * 26; const up = v[v.length - 1] >= v[0]; const line = v.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(x).toFixed(1)).join(' '); return '<svg viewBox="0 0 200 34" preserveAspectRatio="none"><path d="' + line + ' L200 34 L0 34 Z" fill="hsl(var(--' + (up ? 'profit' : 'loss') + '))" opacity=".12"/><path d="' + line + '" fill="none" stroke="hsl(var(--' + (up ? 'profit' : 'loss') + '))" stroke-width="1.3"/><circle cx="200" cy="' + Y(v[v.length - 1]).toFixed(1) + '" r="2" fill="hsl(var(--' + (up ? 'profit' : 'loss') + '))"/></svg>'; }
  function tileHtml(A) { const up = A.chg24 >= 0; return '<div class="pub-tile" data-sym="' + A.symbol + '"><div class="pub-tile-head"><div class="flex items-center gap-2"><div class="pub-tile-ic">' + esc(A.icon) + '</div><div><div class="pub-tile-sym">' + A.symbol + 'USD</div><div class="pub-tile-name">' + esc(A.name) + ' · perpetual</div></div></div><span class="pub-tile-chg ' + (up ? 'up' : 'down') + '" data-chg>' + F.pct(A.chg24) + '</span></div><div class="pub-tile-price" data-price>' + F.num(A.price) + '</div><div class="pub-tile-spark">' + sparkSvg(A) + '</div><div class="pub-tile-hl"><span>H <span data-high>' + F.num(A.high) + '</span></span><span>L <span data-low>' + F.num(A.low) + '</span></span><span>IV <span>' + F.num(A.iv * 100, 1) + '%</span></span></div></div>'; }
  function renderTiles(root) { CG.$('#pub-tiles', root).innerHTML = ['BTC', 'ETH', 'XAUT'].map((s) => { const A = CG.ASSETS[s]; if (A.open == null) A.open = A.price / (1 + A.chg24 / 100); return tileHtml(A); }).join(''); }
  function updateTiles(root) {
    ['BTC', 'ETH', 'XAUT'].forEach((s) => { const A = CG.ASSETS[s]; const el = CG.$('.pub-tile[data-sym="' + s + '"]', root); if (!el) return; if (A.open == null) A.open = A.price / (1 + A.chg24 / 100); if (A.price > A.high) A.high = A.price; if (A.price < A.low) A.low = A.price; const chg = (A.price / A.open - 1) * 100; const p = CG.$('[data-price]', el); p.textContent = F.num(A.price); p.classList.remove('flash-up', 'flash-down'); void p.offsetWidth; p.classList.add(A.prev != null && A.price < A.prev ? 'flash-down' : 'flash-up'); const c = CG.$('[data-chg]', el); c.textContent = F.pct(chg); c.classList.toggle('up', chg >= 0); c.classList.toggle('down', chg < 0); CG.$('[data-high]', el).textContent = F.num(A.high); CG.$('[data-low]', el).textContent = F.num(A.low); });
    const tp = CG.$('#pub-hero-visual [data-t-price]', root); if (tp) { const A = CG.ASSETS.BTC; tp.innerHTML = px(A) + ' <em class="' + (A.chg24 >= 0 ? 'up' : 'dn') + '">' + F.pct(A.chg24 + (A.open ? (A.price / A.open - 1) * 100 : 0)) + '</em>'; }
  }
  function renderWhy(root) { CG.$('#pub-why', root).innerHTML = '<table><thead><tr><th class="no">' + I.xcircle + 'Without HapieCoin</th><th class="yes">' + I.checkcircle + 'With HapieCoin</th></tr></thead><tbody>' + WITHOUT.map((t, i) => '<tr><td class="no"><span>' + I.xcircle + esc(t) + '</span></td><td class="yes"><span>' + I.checkcircle + esc(WITH[i]) + '</span></td></tr>').join('') + '</tbody></table>'; }
  function renderTabs(root) { CG.$('#pub-ftabs', root).innerHTML = TABS.map((t, i) => '<button type="button" role="tab" class="pub-ftab' + (i === tabIdx ? ' active' : '') + '" data-tab="' + i + '" aria-selected="' + (i === tabIdx) + '">' + I[t.icon] + esc(t.title) + '<span class="pub-ftab-prog"></span></button>').join(''); renderTabPanel(root); }
  function renderTabPanel(root) { const t = TABS[tabIdx]; CG.$('#pub-fpanel', root).innerHTML = '<div class="pub-fpanel-mock">' + pubTerminal(t.mock) + '</div><div class="pub-fdesc"><h3><span class="pub-fdesc-ic">' + I[t.icon] + '</span>' + esc(t.title) + '</h3><ul>' + t.bullets.map((b) => '<li>' + I.checkcircle + '<span>' + esc(b) + '</span></li>').join('') + '</ul></div>'; }
  function selectTab(root, i, manual) { tabIdx = i; tabProg = 0; CG.$$('.pub-ftab', root).forEach((b, j) => { b.classList.toggle('active', j === i); b.setAttribute('aria-selected', j === i); CG.$('.pub-ftab-prog', b).style.width = '0'; }); renderTabPanel(root); if (manual) startRotate(root); }
  function startRotate(root) { stopRotate(); if (reduceMotion) return; tabTimer = setInterval(() => { if (document.hidden || !root.classList.contains('active')) return; tabProg += 100 / (8000 / 50); if (tabProg >= 100) { selectTab(root, (tabIdx + 1) % TABS.length); return; } const b = CG.$$('.pub-ftab', root)[tabIdx]; if (b) CG.$('.pub-ftab-prog', b).style.width = tabProg + '%'; }, 50); }
  function stopRotate() { clearInterval(tabTimer); tabTimer = null; }
  function renderCaps(root) { CG.$('#pub-caps', root).innerHTML = CAPS.map((c) => '<div class="pub-cap' + (c.large ? ' large' : '') + '"><div class="pub-cap-ic">' + I[c.icon] + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.desc) + '</p></div>').join(''); }
  function renderAnalytics(root) {
    const G = CG.mock.global || {}; const stats = [{ label: '24H Total Liq', value: F.usdCompact(G.liq24h), icon: 'activity', cls: 'c-primary' }, { label: 'Long Liq', value: F.usdCompact(G.longLiq24h), icon: 'trendingdown', cls: 'c-loss' }, { label: 'Short Liq', value: F.usdCompact(G.shortLiq24h), icon: 'trending', cls: 'c-profit' }, { label: 'Top Coin', value: G.topLiqCoin || '—', icon: 'flame', cls: 'c-orange' }];
    CG.$('#pub-an-stats', root).innerHTML = stats.map((s) => '<div class="pub-an-stat"><div class="pub-an-stat-head"><span>' + esc(s.label) + '</span><span class="' + s.cls + '">' + I[s.icon] + '</span></div><div class="pub-an-stat-v ' + s.cls + '">' + esc(s.value) + '</div></div>').join('');
    const hist = (CG.mock.liqHistory || []).slice(-40); const max = Math.max(1, ...hist.map((h) => h.long + h.short));
    CG.$('#pub-an-bars', root).innerHTML = hist.map((h, i) => { const tot = h.long + h.short; const pct = Math.max(8, Math.round(tot / max * 100)); return '<i class="' + (h.long > h.short ? 'l' : '') + '" style="height:' + pct + '%;animation-delay:' + (i * 20) + 'ms" title="' + F.time(h.time) + ' · Long ' + F.usdCompact(h.long) + ' · Short ' + F.usdCompact(h.short) + '"></i>'; }).join('');
  }
  function renderList(root) { CG.$('#pub-list', root).innerHTML = FEATURE_LIST.map((c) => '<div class="pub-list-card"><h3><span>' + I[c.icon] + '</span>' + esc(c.title) + '</h3><ul>' + c.features.map((f) => '<li>' + I.check + '<span>' + esc(f) + '</span></li>').join('') + '</ul></div>').join(''); }
  function renderExch(root) { CG.$('#pub-exch', root).innerHTML = EXCH.map((e) => '<div class="pub-exch-card ' + e.status + '"><div class="pub-exch-logo-wrap"><div class="pub-exch-logo ' + e.cls + '">' + esc(e.mark) + '</div>' + (e.status === 'live' ? '<span class="pub-exch-live"><i></i>Live</span>' : '<span class="micro">Coming soon</span>') + '</div><h3>' + esc(e.name) + '</h3>' + (e.status === 'live' ? '<span class="badge badge-success">Connected via API</span>' : '<span class="badge badge-outline">Coming Soon</span>') + '</div>').join(''); }
  function updateAuthState(root) { const on = !!CG.state.loggedIn; CG.$('[data-pub-guest]', root).hidden = on; CG.$('[data-pub-user]', root).hidden = !on; }
  function updateThemeIcon(root) { const b = CG.$('[data-pub-theme]', root); if (b) b.innerHTML = CG.theme.get() === 'dark' ? I.sun : I.moon; }
  function scrollToAnchor(key) { const root = landingRoot; if (!root) return; const el = CG.$('[data-anchor="' + key + '"]', root); if (!el) return; el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); }
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-scroll]'); if (!a) return; e.preventDefault(); const key = a.dataset.scroll; if (CG.current.path !== '/') { pendingScroll = key; CG.navigate('/'); } else scrollToAnchor(key); });

  CG.register('/', {
    init(root) {
      landingRoot = root; CG.pubFillIcons(root);
      renderHero(root); renderStats(root); renderNew(root); renderTiles(root); renderWhy(root); renderTabs(root); renderCaps(root); renderAnalytics(root); renderList(root); renderExch(root); updateThemeIcon(root); updateAuthState(root);
      CG.$('[data-pub-theme]', root).addEventListener('click', () => CG.theme.toggle());
      const pal = CG.$('[data-pub-palette]', root); if (pal) pal.addEventListener('click', () => { if (CG.palette) CG.palette.open(); else CG.toast({ title: 'Command palette', description: 'Press Ctrl K inside the app.' }); });
      CG.delegate(root, 'click', '.pub-ftab', (e, b) => selectTab(root, +b.dataset.tab, true));
      CG.on('theme', () => updateThemeIcon(root));
      CG.on('auth', () => updateAuthState(root));
      CG.on('tick', () => { if (root.classList.contains('active')) updateTiles(root); });
      const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) { animateCounts(root); io.disconnect(); } }, { rootMargin: '-50px' }) : null;
      if (io) io.observe(CG.$('#pub-stats', root)); else animateCounts(root);
    },
    show(root) {
      updateAuthState(root); updateThemeIcon(root); updateTiles(root); startRotate(root);
      if (pendingScroll) { const k = pendingScroll; pendingScroll = null; setTimeout(() => scrollToAnchor(k), 60); }
    },
    hide() { stopRotate(); }
  });

  // ---------- shared footer chrome (used by every screen that has <div data-cg="footer">) ----------
  CG.chrome['footer'] = function (el) {
    el.innerHTML = '<footer class="pub-footer"><div class="pub-wrap"><div class="pub-footer-grid"><div class="pub-footer-brand"><a href="#/" class="pub-logo"><span class="pub-logo-mark">' + I.logo + '</span>HapieCoin</a><p>Professional-grade crypto options analytics platform. Trade smarter with real-time data.</p></div><div><h4>Quick Links</h4><ul><li><a href="#features" data-scroll="features">Features</a></li><li><a href="#prices" data-scroll="prices">Markets</a></li><li><a href="#exchanges" data-scroll="exchanges">Exchanges</a></li><li><a href="#whats-new" data-scroll="whats-new">What\'s new in v2</a></li></ul></div><div><h4>Legal</h4><ul><li><a href="#/privacy">Privacy Policy</a></li><li><a href="#/terms">Terms of Service</a></li><li><a href="#/disclaimer">Disclaimer</a></li></ul></div><div><h4>Contact Us</h4><ul><li><a href="mailto:support@hapiecoin.com">' + I.mail + 'support@hapiecoin.com</a></li><li><a href="https://wa.me/919684022369" target="_blank" rel="noopener noreferrer"><span class="text-profit" style="display:inline-flex">' + I.chat + '</span>+91 96840 22369</a></li></ul></div></div><div class="pub-footer-bottom"><span>© ' + CG.NOW.getFullYear() + ' HapieCoin. All rights reserved.</span><span>Options on Delta Exchange India · Not financial advice · v2</span></div></div></footer>';
  };
})();
