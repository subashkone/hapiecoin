<script>
(function () {
  const CG = window.CG, M = CG.mock, F = CG.fmt, A = window.CG2, C = A.C; const G = M.global;
  const byTimeDesc = (a, b) => new Date(b.time) - new Date(a.time);
  const yPx = (v) => (v >= 1000 ? '$' + F.compact(v) : A.price(v));
  // ============ /analytics/liquidations ============
  const liqWindow = (win) => { const cache = (A._lw = A._lw || {}); if (cache[win]) return cache[win]; const src = M.liqHistory.slice(-win); if (win >= 12) return (cache[win] = src.map((p) => ({ label: A.hm(p.time), tip: A.mdt(p.time), long: p.long, short: p.short }))); const r = CG.rng(900 + win); const out = []; src.forEach((p) => { const t0 = new Date(p.time).getTime(); for (let k = 0; k < 12; k++) { const t = new Date(t0 + k * 300000); out.push({ label: A.hm(t), tip: A.mdt(t), long: p.long / 12 * (0.3 + r() * 1.4), short: p.short / 12 * (0.3 + r() * 1.4) }); } }); return (cache[win] = out); };
  const feedSyms = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'PEPE', 'WIF', 'LINK', 'SUI', 'ARB'];
  const newLiq = () => { const c = A.coin(feedSyms[Math.floor(Math.random() * feedSyms.length)]); return { time: A.now().toISOString(), exchange: ['Binance', 'Binance', 'OKX', 'Bybit'][Math.floor(Math.random() * 4)], symbol: c.symbol, side: Math.random() > 0.5 ? 'long' : 'short', price: c.price * (1 + (Math.random() - 0.5) * 0.01), usd: Math.round(5000 + Math.pow(Math.random(), 3) * 900000), fresh: true }; };
  A.screen('/analytics/liquidations', {
    render(main) {
      const st = (A.st.liq = A.st.liq || { win: 24, minUsd: 0, q: '' }); if (!st.feed) st.feed = M.liqFeed.slice().sort(byTimeDesc);
      const ratio = G.longLiq24h / G.shortLiq24h; const mins = [[0, 'All'], [1000, '$1K'], [10000, '$10K'], [50000, '$50K'], [100000, '$100K'], [500000, '$500K']];
      main.innerHTML =
        '<div class="cg2-tiles three">' +
        A.tile('Long Liquidations', '<span class="cg2-up">' + F.usdCompact(G.longLiq24h) + '</span>', '24h · ' + F.num(G.longLiq24h / G.liq24h * 100, 1) + '% of total', A.split(G.longLiq24h, 0)) +
        A.tile('Short Liquidations', '<span class="cg2-down">' + F.usdCompact(G.shortLiq24h) + '</span>', '24h · ' + F.num(G.shortLiq24h / G.liq24h * 100, 1) + '% of total', A.split(0, G.shortLiq24h)) +
        A.tile('Long / Short Ratio', F.num(ratio, 2), 'Total 24h ' + F.usdCompact(G.liq24h) + ' · top coin ' + G.topLiqCoin, A.split(G.longLiq24h, G.shortLiq24h)) +
        '</div>' +
        A.panel(st.win + 'h Liquidations Over Time', 'Aggregated across Binance · OKX · Bybit', '<div class="cg2-pb" data-chart="liq"></div>', A.chips([[1, '1h'], [4, '4h'], [12, '12h'], [24, '24h']], st.win, 'data-win')) +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Liquidations by Exchange', '24h window', '<div class="cg2-pb" data-ex></div>') +
        A.panel('Top Coins by Liquidation', '24h window · click row for full coin analytics', '<div class="cg2-pb tight" data-top></div>', '<a class="cg2-link" href="#/analytics/markets">View all markets →</a>') +
        '</div>' +
        A.panel('Live Liquidation Feed', 'Binance · refreshes every 12s', '<div class="cg2-feed" data-feed></div>', '<span class="cg2-pulse"></span><span class="cg2-ps">live</span><label class="cg2-ps">Min USD</label><select class="cg2-select" data-min aria-label="Minimum liquidation size">' + mins.map((m) => '<option value="' + m[0] + '"' + (m[0] === st.minUsd ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select>');
      const renderChart = () => { const d = liqWindow(st.win); A.chart(main.querySelector('[data-chart="liq"]'), { h: 230, stack: true, x: d.map((p) => p.label), xTip: d.map((p) => p.tip), series: [{ type: 'bar', label: 'Long Liq', data: d.map((p) => p.long), color: C.up, fmt: F.usdCompact }, { type: 'bar', label: 'Short Liq', data: d.map((p) => p.short), color: C.down, fmt: F.usdCompact }], yFmt: F.usdCompact, tipExtra: (i) => [['Total', F.usdCompact(d[i].long + d[i].short)]] }); };
      renderChart();
      main.querySelector('[data-ex]').innerHTML = A.hbars(M.exchanges.slice().sort((a, b) => b.liq24h - a.liq24h).map((e) => ({ label: e.name, value: e.liq24h })));
      A.table(main.querySelector('[data-top]'), { key: 'liq-top', rows: M.coins, sortKey: 'liq24h', limit: 12, maxH: 360, search: true, searchText: (r) => r.symbol + ' ' + r.name, searchPlaceholder: 'Filter coins…', csv: 'liquidations-by-coin', empty: 'No coins', cols: [{ key: 'symbol', label: 'Coin', render: (r) => A.asset(r, { name: false }) }, { key: 'liq24h', label: 'Total', align: 'r', render: (r) => F.usdCompact(r.liq24h) }, { key: 'longLiq24h', label: 'Long', align: 'r', render: (r) => '<span class="cg2-up">' + F.usdCompact(r.longLiq24h) + '</span>' }, { key: 'shortLiq24h', label: 'Short', align: 'r', render: (r) => '<span class="cg2-down">' + F.usdCompact(r.shortLiq24h) + '</span>' }, { key: 'bias', label: 'L/S Bias', sortVal: (r) => r.longLiq24h / r.liq24h, render: (r) => '<span class="cg2-bias">' + A.split(r.longLiq24h, r.shortLiq24h) + '<span class="mono" style="font-size:10.5px;width:34px;text-align:right">' + F.num(r.longLiq24h / r.liq24h * 100, 0) + '%</span></span>' }], rowHref: (r) => '/analytics/coin/' + r.symbol });
      const renderFeed = () => { const rows = st.feed.filter((r) => r.usd >= st.minUsd).slice(0, 40); const host = main.querySelector('[data-feed]'); if (!rows.length) { host.innerHTML = '<div class="cg2-feed-empty">No liquidations above $' + F.int(st.minUsd) + '</div>'; return; } host.innerHTML = rows.map((r) => '<div class="cg2-feed-row' + (r.fresh ? ' cg2-flash' : '') + '"><span class="mono cg2-dim">' + A.hms(r.time) + '</span><span>' + CG.esc(r.exchange) + '</span><span class="cg2-asset">' + A.icon(r.symbol) + '<b>' + r.symbol + '</b></span><span><span class="cg2-badge ' + r.side + '">' + (r.side === 'long' ? 'Long Liquidated' : 'Short Liquidated') + '</span></span><span class="mono cg2-dim">@ ' + A.price(r.price) + '</span><span class="r" style="font-weight:500">' + F.usdCompact(r.usd) + '</span></div>').join(''); rows.forEach((r) => (r.fresh = false)); };
      renderFeed();
      A.every(12000, () => { st.feed.unshift(newLiq()); if (st.feed.length > 80) st.feed.length = 80; renderFeed(); });
      main.querySelector('[data-min]').addEventListener('change', (e) => { st.minUsd = +e.target.value; renderFeed(); });
      main.onclick = (e) => { const b = e.target.closest('[data-win]'); if (b) { st.win = +b.dataset.win; CG.$$('[data-win]', main).forEach((x) => x.classList.toggle('on', +x.dataset.win === st.win)); main.querySelector('.cg2-pt').textContent = st.win + 'h Liquidations Over Time'; renderChart(); } };
    }
  });
  // ============ /analytics/whales ============
  const newWhale = () => { const t = M.whaleAlerts[Math.floor(Math.random() * M.whaleAlerts.length)]; return Object.assign({}, t, { time: A.now().toISOString(), value: Math.round(1e6 + Math.random() * 12e6), action: Math.random() > 0.4 ? 'opened' : 'closed', side: Math.random() > 0.5 ? 'Long' : 'Short', fresh: true }); };
  A.screen('/analytics/whales', {
    render(main) {
      const st = (A.st.whales = A.st.whales || {}); if (!st.alerts) st.alerts = M.whaleAlerts.slice().sort(byTimeDesc);
      const longs = M.whalePositions.filter((p) => p.side === 'Long'), shorts = M.whalePositions.filter((p) => p.side === 'Short');
      const wi = M.whaleIndex; const wiNow = wi[wi.length - 1].value; const wiLabel = wiNow < 30 ? 'Quiet' : wiNow < 70 ? 'Active' : 'Frenzy';
      main.innerHTML =
        '<div class="cg2-tiles four">' +
        A.tile('Tracked whale longs', '<span class="cg2-up">' + F.usdCompact(longs.reduce((s, p) => s + p.position, 0)) + '</span>', longs.length + ' positions · uPnL ' + A.signedUsd(longs.reduce((s, p) => s + p.upnl, 0))) +
        A.tile('Tracked whale shorts', '<span class="cg2-down">' + F.usdCompact(shorts.reduce((s, p) => s + p.position, 0)) + '</span>', shorts.length + ' positions · uPnL ' + A.signedUsd(shorts.reduce((s, p) => s + p.upnl, 0))) +
        A.tile('Large limit orders', M.largeOrders.length, F.usdCompact(M.largeOrders.reduce((s, o) => s + o.value, 0)) + ' resting · Binance futures') +
        '<div class="cg2-tile"><div class="cg2-tile-l">Whale Index</div><div data-gauge="wi"></div><div class="cg2-tile-s">' + wiLabel + ' · large-trader activity</div></div>' +
        '</div>' +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Hyperliquid Whale Alerts', 'Live large position opens/closes (&gt;$1M)', '<div class="cg2-feed" data-alerts></div>', '<span class="cg2-pulse"></span><span class="cg2-ps">live</span>') +
        A.panel('Whale Index', 'Composite large-trader activity score', '<div class="cg2-pb" data-chart="wi"></div>') +
        '</div>' +
        A.panel('Open Whale Positions', 'Largest open positions on Hyperliquid', '<div class="cg2-pb tight" data-pos></div>') +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Large limit orders', 'Resting buy/sell walls on Binance futures', '<div class="cg2-pb tight" data-orders></div>') +
        A.panel('Exchange BTC Reserves', 'On-chain balances · falling reserves = supply leaving exchanges', '<div class="cg2-pb tight" data-res></div>') +
        '</div>';
      A.gauge(main.querySelector('[data-gauge="wi"]'), { value: wiNow, size: 92, thick: 8, fontSize: 17, inline: true, segs: [[0, 30, 'hsl(var(--muted-foreground)/.35)'], [30, 70, 'hsl(var(--curve)/.6)'], [70, 100, 'hsl(var(--curve))']] });
      const host = main.querySelector('[data-alerts]'); host.innerHTML = '<div class="cg2-feed-empty"><span class="cg2-pulse"></span>Waiting for events…</div>';
      const renderAlerts = () => { host.innerHTML = st.alerts.slice(0, 30).map((a) => '<div class="cg2-feed-row whale' + (a.fresh ? ' cg2-flash' : '') + '"><span class="mono cg2-dim">' + A.hm(a.time) + '</span><span class="mono" style="font-size:11px">' + CG.esc(a.wallet) + '</span><span class="cg2-asset">' + A.icon(a.symbol) + '<b>' + a.symbol + '</b></span><span><span class="cg2-badge ' + a.side.toLowerCase() + '">' + a.side + '</span></span><span class="cg2-dim" style="overflow:hidden;text-overflow:ellipsis">' + a.action + ' ' + a.leverage + '× · entry ' + A.price(a.entry) + '</span><span class="r" style="font-weight:500">' + F.usdCompact(a.value) + '</span></div>').join(''); st.alerts.forEach((a) => (a.fresh = false)); };
      A.after(1500, renderAlerts);
      A.every(20000, () => { st.alerts.unshift(newWhale()); if (st.alerts.length > 60) st.alerts.length = 60; renderAlerts(); });
      A.tfChart(main.querySelector('[data-chart="wi"]'), 'wi', st, {}, (tf) => { const T = A.tfSeries('wi', tf, { values: wi.map((p) => p.value), stepH: 1, additive: true, clamp: [3, 97] }); return { h: 220, min: 0, max: 100, x: T.x, xTip: T.xTip, series: [{ type: 'area', label: 'Whale Index', data: T.v.map((v) => Math.round(v)), color: C.curve, fmt: (v) => String(v) }], yFmt: (v) => String(v), hlines: [{ y: 50, color: 'hsl(var(--muted-foreground)/.6)' }] }; });
      A.table(main.querySelector('[data-pos]'), { key: 'wpos', rows: M.whalePositions, sortKey: 'position', csv: 'whale-positions', cols: [{ key: 'wallet', label: 'Wallet', render: (r) => '<span class="mono">' + CG.esc(r.wallet) + '</span>' }, { key: 'symbol', label: 'Coin', render: (r) => A.asset({ symbol: r.symbol, name: '' }, { name: false }) }, { key: 'side', label: 'Side', align: 'c', render: (r) => '<span class="cg2-badge ' + r.side.toLowerCase() + '">' + r.side + ' ' + r.leverage + '×</span>' }, { key: 'position', label: 'Position', align: 'r', render: (r) => F.usdCompact(r.position) }, { key: 'entry', label: 'Entry', align: 'r', render: (r) => A.price(r.entry) }, { key: 'mark', label: 'Mark', align: 'r', render: (r) => A.price(r.mark) }, { key: 'liqPrice', label: 'Liq Price', align: 'r', render: (r) => '<span class="cg2-warn">' + A.price(r.liqPrice) + '</span>' }, { key: 'upnl', label: 'uPnL', align: 'r', render: (r) => A.signedUsd(r.upnl) }] });
      A.table(main.querySelector('[data-orders]'), { key: 'lorders', rows: M.largeOrders, sortKey: 'time', cols: [{ key: 'time', label: 'Time', sortVal: (r) => new Date(r.time).getTime(), render: (r) => '<span class="mono cg2-dim">' + A.hm(r.time) + '</span>' }, { key: 'exchange', label: 'Exchange' }, { key: 'symbol', label: 'Symbol', render: (r) => '<b class="mono">' + r.symbol + '</b>' }, { key: 'side', label: 'Side', align: 'c', render: (r) => '<span class="cg2-badge ' + r.side.toLowerCase() + '">' + r.side + '</span>' }, { key: 'price', label: 'Limit Price', align: 'r', render: (r) => A.price(r.price) }, { key: 'value', label: 'Value', align: 'r', render: (r) => F.usdCompact(r.value) }, { key: 'status', label: 'Placed', align: 'r', render: (r) => '<span class="cg2-dim">' + A.ago(r.time) + '</span> <span class="cg2-badge ' + (r.status === 'filled' ? 'accent' : 'neutral') + '">' + r.status + '</span>' }] });
      A.table(main.querySelector('[data-res]'), { key: 'res', rows: M.exchanges, sortKey: 'btcBalance', csv: 'exchange-reserves', cols: [{ key: 'name', label: 'Exchange', render: (r) => '<b>' + CG.esc(r.name) + '</b>' }, { key: 'btcBalance', label: 'BTC Balance', align: 'r', render: (r) => F.int(r.btcBalance) + ' BTC' }, { key: 'btcBalanceChg24', label: 'Δ 24h', align: 'r', render: (r) => A.heat(r.btcBalanceChg24, { max: 1.5 }) }, { key: 'btcBalanceChg7d', label: 'Δ 7d', align: 'r', render: (r) => A.heat(r.btcBalanceChg7d, { max: 3 }) }, { key: 'btcBalanceChg30d', label: 'Δ 30d', align: 'r', render: (r) => A.heat(r.btcBalanceChg30d, { max: 6 }) }] });
    }
  });
  // ============ /analytics/sentiment ============
  const RB = { mult: [0.45, 0.6, 0.8, 1.1, 1.45, 1.9, 2.5, 3.3, 4.3, 5.6], colors: ['hsl(240 60% 55%)', 'hsl(200 70% 50%)', 'hsl(170 60% 45%)', 'hsl(140 60% 45%)', 'hsl(80 60% 45%)', 'hsl(35 90% 52%)', 'hsl(20 85% 52%)', 'hsl(5 75% 52%)', 'hsl(0 72% 45%)'], names: ['Basically a Fire Sale', 'BUY!', 'Accumulate', 'Still cheap', 'HODL!', 'Is this a bubble?', 'FOMO intensifies', 'Sell. Seriously, SELL!', 'Maximum Bubble Territory'] };
  const rainbow = () => { const H = M.cycleHistory; const n = H.length; let sx = 0, sy = 0, sxx = 0, sxy = 0; H.forEach((p, i) => { const y = Math.log(p.price); sx += i; sy += y; sxx += i * i; sxy += i * y; }); const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n; const base = H.map((p, i) => Math.exp(a + b * i)); return { base, regions: RB.colors.map((c, k) => ({ type: 'region', color: c, opacity: 0.28, data: base.map((v) => [v * RB.mult[k], v * RB.mult[k + 1]]) })), bandOf: (price, i) => { const r = price / base[i]; let k = 0; while (k < RB.mult.length - 2 && r > RB.mult[k + 1]) k++; return RB.names[k]; } }; };
  A.screen('/analytics/sentiment', {
    render(main) {
      const st = (A.st.sent = A.st.sent || {});
      const fg = M.fearGreedNow; const H = M.cycleHistory; const last = H[H.length - 1]; const Cy = M.cycle; const btc = A.coin('BTC'); const cp = M.coinbasePremium; const cpMax = Math.max(...cp.slice(-24).map((p) => p.premium)); const rb = rainbow(); const band = rb.bandOf(last.price, H.length - 1);
      const checks = [
        { name: 'Pi Cycle Top', sub: '111DMA $' + F.compact(Cy.piCycle.ma111) + ' vs 2×350DMA $' + F.compact(Cy.piCycle.ma350x2), hit: Cy.piCycle.ma111 >= Cy.piCycle.ma350x2, v: F.num(Cy.piCycle.ma111 / Cy.piCycle.ma350x2 * 100, 0) + '% of cross' },
        { name: 'AHR999 > 4', sub: 'Accumulation index', hit: Cy.ahr999 > 4, v: F.num(Cy.ahr999, 2) },
        { name: 'Puell > 4', sub: 'Miner revenue multiple', hit: Cy.puell > 4, v: F.num(Cy.puell, 2) },
        { name: '2Y MA ×5', sub: 'Price vs $' + F.compact(Cy.twoYearMaX5), hit: btc.price > Cy.twoYearMaX5, v: F.num(btc.price / Cy.twoYearMaX5 * 100, 0) + '%' },
        { name: 'Rainbow top band', sub: 'Current band: ' + band, hit: band === RB.names[8], v: band },
        { name: 'RSI 1w > 90', sub: 'BTC weekly RSI', hit: btc.rsi['1w'] > 90, v: String(btc.rsi['1w']) },
        { name: 'F&G > 90', sub: 'Fear & Greed today', hit: fg > 90, v: fg + ' · ' + M.fgLabel(fg) },
        { name: 'Coinbase premium spike', sub: '24h max premium', hit: cpMax > 40, v: (cpMax >= 0 ? '+' : '') + F.num(cpMax, 1) }
      ];
      const hits = checks.filter((c) => c.hit).length;
      main.innerHTML =
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Fear &amp; Greed Index', 'Crypto market sentiment · daily', '<div class="cg2-pb" style="display:grid;grid-template-columns:190px minmax(0,1fr);gap:12px;align-items:center" data-fg><div data-gauge></div><div data-chart="fg"></div></div>') +
        A.panel('Bull Market Peak Indicators', 'Cycle-top signal checklist', '<div class="cg2-check" data-check></div>', '<span class="cg2-badge ' + (hits ? 'short' : 'long') + '">' + hits + ' / ' + checks.length + ' triggered</span>') +
        '</div>' +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Pi Cycle Top Indicator', '111DMA crossing 2×350DMA has marked cycle tops · 180D', '<div class="cg2-pb" data-chart="pi"></div>') +
        A.panel('Bitcoin Rainbow Chart', 'Log-regression valuation bands · 180D', '<div class="cg2-pb" data-chart="rb"></div>') +
        '</div>' +
        '<div class="cg2-grid cg2-grid3">' +
        A.panel('AHR999 Accumulation Index', '&lt; 0.45 bottom zone · &gt; 4 top zone', '<div class="cg2-pb" data-chart="ahr"></div>') +
        A.panel('Puell Multiple', 'Miner revenue vs 365d average', '<div class="cg2-pb" data-chart="puell"></div>') +
        A.panel('2-Year MA Multiplier', 'Buy below 2Y MA · sell above 2Y MA ×5 · 180D', '<div class="cg2-pb" data-chart="ma2"></div>') +
        '</div>' +
        A.panel('Coinbase Premium', 'US institutional spot pressure vs Binance', '<div class="cg2-pb" data-chart="cp"></div>') +
        A.panel('RSI Screener', 'Multi-timeframe relative strength · green = oversold, red = overbought', '<div class="cg2-pb tight" data-rsi></div>');
      A.gauge(main.querySelector('[data-gauge]'), { value: fg, size: 170, thick: 11, color: A.fgColor(fg), label: M.fgLabel(fg), scale: ['extreme fear', 'extreme greed'] });
      const fgh = M.fearGreed;
      A.tfChart(main.querySelector('[data-chart="fg"]'), 'fg', st, { options: ['7D', '30D', '90D', '1Y'], def: '90D' }, (tf) => { const T = A.tfSeries('fg', tf, { values: fgh.map((p) => p.value), stepH: 24, keepStep: true, additive: true, clamp: [5, 95] }); return { h: 170, min: 0, max: 100, tight: true, x: T.x, xTip: T.xTip, series: [{ type: 'area', label: 'Index', data: T.v.map(Math.round), color: C.curve, fmt: (v) => v + ' · ' + M.fgLabel(v) }], bands: [{ from: 0, to: 25, color: 'hsl(var(--loss)/.12)' }, { from: 25, to: 45, color: 'hsl(var(--warning)/.08)' }, { from: 55, to: 75, color: 'hsl(var(--profit)/.07)' }, { from: 75, to: 100, color: 'hsl(var(--profit)/.14)' }], yFmt: (v) => String(v), pad: { l: 34 } }; });
      main.querySelector('[data-check]').innerHTML = checks.map((c) => '<div class="cg2-check-row' + (c.hit ? ' hit' : '') + '"><span class="dot"></span><span><b>' + CG.esc(c.name) + '</b><div class="sub">' + CG.esc(c.sub) + '</div></span><span class="v">' + CG.esc(c.v) + '</span><span class="cg2-badge ' + (c.hit ? 'short' : 'neutral') + '">' + (c.hit ? 'Hit' : 'Not hit') + '</span></div>').join('');
      const xd = H.map((p) => A.md(p.date)); const pf = (v) => '$' + F.compact(v); const daily = { stepH: 24, keepStep: true }; const cyc = { options: ['30D', '90D', '180D'], def: '180D' };
      A.chart(main.querySelector('[data-chart="pi"]'), { h: 220, logY: true, x: xd, series: [{ type: 'line', label: 'Price', data: H.map((p) => p.price), color: C.fg, width: 1.2, fmt: pf }, { type: 'line', label: '111DMA', data: H.map((p) => p.ma111), color: C.curve, fmt: pf }, { type: 'line', label: '350DMA×2', data: H.map((p) => p.ma350x2), color: C.down, dash: '4 3', fmt: pf }], yFmt: pf });
      A.chart(main.querySelector('[data-chart="rb"]'), { h: 220, logY: true, x: xd, series: rb.regions.concat([{ type: 'line', label: 'Price', data: H.map((p) => p.price), color: C.fg, width: 1.4, fmt: pf }]), yFmt: pf, tipExtra: (i) => [['Band', rb.bandOf(H[i].price, i)]] });
      A.tfChart(main.querySelector('[data-chart="ahr"]'), 'ahr', st, cyc, (tf) => { const T = A.tfSeries('ahr', tf, Object.assign({ values: H.map((p) => p.ahr999), clamp: [0.2, 6] }, daily)); return { h: 180, logY: true, x: T.x, xTip: T.xTip, series: [{ type: 'area', label: 'AHR999', data: T.v.map((v) => +v.toFixed(2)), color: C.curve, fmt: (v) => F.num(v, 2) }], hlines: [{ y: 0.45, label: '0.45 bottom', color: C.up }, { y: 4, label: '4 top', color: C.down }], yFmt: (v) => F.num(v, 2), pad: { l: 40 } }; });
      A.tfChart(main.querySelector('[data-chart="puell"]'), 'puell', st, cyc, (tf) => { const T = A.tfSeries('puell', tf, Object.assign({ values: H.map((p) => p.puell), clamp: [0.3, 6] }, daily)); return { h: 180, logY: true, x: T.x, xTip: T.xTip, series: [{ type: 'area', label: 'Puell', data: T.v.map((v) => +v.toFixed(2)), color: C.fg, fillOpacity: 0.12, fmt: (v) => F.num(v, 2) }], hlines: [{ y: 0.5, label: '0.5 bottom', color: C.up }, { y: 4, label: '4 top', color: C.down }], yFmt: (v) => F.num(v, 2), pad: { l: 40 } }; });
      A.chart(main.querySelector('[data-chart="ma2"]'), { h: 180, logY: true, x: xd, series: [{ type: 'line', label: 'Price', data: H.map((p) => p.price), color: C.fg, width: 1.2, fmt: pf }, { type: 'line', label: '2Y MA', data: H.map((p) => p.ma2y), color: C.up, fmt: pf }, { type: 'line', label: '2Y MA ×5', data: H.map((p) => p.ma2yX5), color: C.down, fmt: pf }], yFmt: pf });
      A.tfChart(main.querySelector('[data-chart="cp"]'), 'cp', st, { options: ['1D', '7D', '30D'], def: '1D' }, (tf) => { const T = A.tfSeries('cp', tf, { values: cp.map((p) => p.premium), stepH: 1, additive: true, clamp: [-90, 90] }); return { h: 180, x: T.x, xTip: T.xTip, series: [{ type: 'bar', label: 'Premium', data: T.v.map((v) => +v.toFixed(1)), color: C.up, colorNeg: C.down, legendColor: C.up, fmt: (v) => (v >= 0 ? '+$' : '-$') + F.num(Math.abs(v), 1) }], yFmt: (v) => (v >= 0 ? '$' : '-$') + Math.abs(v) }; });
      const rsiCol = (tf) => ({ key: 'rsi_' + tf, label: 'RSI ' + tf, align: 'c', sortVal: (r) => r.rsi[tf], csv: (r) => r.rsi[tf], render: (r) => A.rsiHeat(r.rsi[tf]) });
      A.table(main.querySelector('[data-rsi]'), { key: 'rsi', rows: A.byCap().slice(0, 25), sortKey: 'rank', sortDir: 'asc', maxH: 520, search: true, searchText: (r) => r.symbol + ' ' + r.name, searchPlaceholder: 'Search coin…', columns: true, csv: 'rsi-screener', star: (r) => r.symbol, cols: [{ key: 'rank', label: 'Coin', render: (r) => A.asset(r, { rank: true }) }, { key: 'price', label: 'Price', align: 'r', render: (r) => A.price(r.price) }, rsiCol('15m'), rsiCol('1h'), rsiCol('4h'), rsiCol('12h'), rsiCol('24h'), rsiCol('1w')], rowHref: (r) => '/analytics/coin/' + r.symbol });
    }
  });
  // ============ /analytics/coin/:symbol ============
  A.screen('/analytics/coin/:symbol', {
    render(main, params, query, root) {
      const c = A.coin(params.symbol); if (!c) { CG.toast({ title: 'Unknown coin', description: params.symbol + ' is not tracked · showing the markets screener', variant: 'destructive' }); CG.navigate('/analytics/markets', { replace: true }); return; }
      document.title = c.symbol + ' · Market Analytics · HapieCoin';
      const st = (A.st.coin = A.st.coin || {});
      const S = A.coinSeries(c.symbol); const ls = S.ls[S.ls.length - 1]; const px = S.price; const xl = px.map((p) => A.hm(p.time)), xt = px.map((p) => A.mdt(p.time)); const livePx = CG.ASSETS[c.symbol] ? CG.ASSETS[c.symbol].price : c.price;
      const sectorName = { 'layer-1': 'Layer 1', 'layer-2': 'Layer 2', defi: 'DeFi', memes: 'Memes', other: 'Other' }[c.sector];
      const starBtn = () => '<button class="cg2-chip star' + (A.watch.has(c.symbol) ? ' on' : '') + '" data-star="' + c.symbol + '" type="button" title="Toggle watchlist">' + (A.watch.has(c.symbol) ? A.icons.starOn + 'Watching' : A.icons.star + 'Watch') + '</button>';
      main.innerHTML =
        '<a class="cgx-back" style="align-self:flex-start;padding-left:0" href="#/analytics/markets">← Back to markets</a>' +
        '<div class="cg2-coin-hero">' + A.icon(c.symbol) + '<div><h2>' + c.symbol + ' <span class="cg2-dim" style="font-weight:400">' + CG.esc(c.name) + '</span></h2><div class="cg2-row" style="gap:6px;margin-top:4px"><span class="cg2-badge neutral">Rank #' + c.rank + '</span><span class="cg2-badge accent">' + sectorName + '</span><span class="cg2-badge neutral">' + c.symbol + 'USDT · perp</span><span data-starhost>' + starBtn() + '</span><button class="cg2-chip" data-cmp type="button" title="Add to compare and open the Markets screener">' + A.icons.compare + 'Compare</button></div></div><div style="margin-left:auto;text-align:right"><div class="px" data-live-px>' + A.price(livePx) + '</div><div>' + A.heat(c.chg24) + ' <span class="cg2-dim" style="font-size:11px">24h</span></div></div></div>' +
        '<div class="cg2-tiles six">' +
        A.tile('Open Interest', F.usdCompact(c.openInterest), 'Δ24h ' + A.signed(c.oiChg24h) + ' · 1h ' + A.signed(c.oiChg1h)) +
        A.tile('24h Volume', F.usdCompact(c.volume24h), 'Vol/OI ' + F.num(c.volume24h / c.openInterest, 2) + '×') +
        A.tile('Funding (avg)', '<span class="' + A.cls(c.funding) + '">' + F.pct(c.funding, 4) + '</span>', 'OI-weighted · 8h') +
        A.tile('Long/Short', '<span class="' + (ls >= 1 ? 'cg2-up' : 'cg2-down') + '">' + F.num(ls, 2) + '</span>', '<span class="cg2-up">L ' + F.num(ls / (1 + ls) * 100, 1) + '%</span> <span class="cg2-down">S ' + F.num(100 / (1 + ls), 1) + '%</span>', A.split(ls, 1)) +
        A.tile('Liquidations 24h', F.usdCompact(c.liq24h), '<span class="cg2-up mono">L ' + F.usdCompact(c.longLiq24h) + '</span><span class="cg2-down mono">S ' + F.usdCompact(c.shortLiq24h) + '</span>', A.split(c.longLiq24h, c.shortLiq24h)) +
        A.tile('Market Cap', F.usdCompact(c.marketCap), 'Dominance ' + F.num(c.marketCap / G.totalMarketCap * 100, 2) + '%') +
        '</div>' +
        '<div class="cg2-grid cg2-grid2">' +
        A.panel('Price &amp; Open Interest', c.symbol + 'USDT · perp', '<div class="cg2-pb" data-chart="pxoi"></div>') +
        A.panel('Long / Short Ratio', 'global accounts', '<div class="cg2-pb" data-chart="ls"></div>') +
        A.panel('Liquidations', 'Long Liq / Short Liq', '<div class="cg2-pb" data-chart="liq"></div>') +
        A.panel('OI-Weighted Funding', '8h · %', '<div class="cg2-pb" data-chart="fund"></div>') +
        '</div>' +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Taker Buy / Sell Volume', 'hourly · USDT perp · 48h', '<div class="cg2-pb" data-chart="taker"></div>') +
        A.panel('Liquidation Heatmap', 'long vs short · price levels ±5% · last 12h', '<div class="cg2-pb" data-lheat></div>') +
        '</div>' +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Markets by Exchange', c.symbol + ' perpetual · OI share', '<div class="cg2-pb tight" data-mkts></div>') +
        A.panel('Funding by Exchange', 'current · predicted · next settlement', '<div class="cg2-pb tight" data-fund-ex></div>') +
        '</div>';
      const pxVals = px.map((p) => p.close);
      A.tfChart(main.querySelector('[data-chart="pxoi"]'), 'pxoi', st, {}, (tf) => { const P = A.tfSeries('px:' + c.symbol, tf, { values: pxVals, stepH: 1, end: livePx }); const O = A.tfSeries('oi:' + c.symbol, tf, { values: S.oi, stepH: 1 }); return { h: 220, rightAxis: true, x: P.x, xTip: P.xTip, series: [{ type: 'area', label: 'Open Interest', data: O.v, color: C.curve, fmt: F.usdCompact }, { type: 'line', label: 'Price', axis: 'r', data: P.v, color: C.fg, fmt: A.price }], yFmt: F.usdCompact, y2Fmt: yPx }; });
      A.tfChart(main.querySelector('[data-chart="ls"]'), 'ls', st, {}, (tf) => { const T = A.tfSeries('ls:' + c.symbol, tf, { values: S.ls, stepH: 1, clamp: [0.4, 3] }); return { h: 220, x: T.x, xTip: T.xTip, series: [{ type: 'line', label: 'L/S Ratio', data: T.v.map((v) => +v.toFixed(2)), color: C.curve, fmt: (v) => F.num(v, 2) }], hlines: [{ y: 1, label: '1.00' }], yFmt: (v) => F.num(v, 2) }; });
      A.tfChart(main.querySelector('[data-chart="liq"]'), 'liq', st, {}, (tf) => { const iid = (r, mean) => mean * (0.35 + r() * 1.3); const L = A.tfSeries('liq-l:' + c.symbol, tf, { values: S.liq.map((p) => p.long), stepH: 1, iid }); const Sh = A.tfSeries('liq-s:' + c.symbol, tf, { values: S.liq.map((p) => p.short), stepH: 1, iid }); return { h: 220, stack: true, x: L.x, xTip: L.xTip, series: [{ type: 'bar', label: 'Long Liq', data: L.v, color: C.up, fmt: F.usdCompact }, { type: 'bar', label: 'Short Liq', data: Sh.v, color: C.down, fmt: F.usdCompact }], yFmt: F.usdCompact }; });
      A.tfChart(main.querySelector('[data-chart="fund"]'), 'fund', st, { options: ['7D', '30D', '90D', '1Y'], def: '30D' }, (tf) => { const T = A.tfSeries('fund:' + c.symbol, tf, { values: S.funding, stepH: 8, keepStep: true, additive: true, clamp: [-0.1, 0.1] }); return { h: 220, x: T.x, xTip: T.xTip, series: [{ type: 'bar', label: 'Funding', data: T.v.map((v) => +v.toFixed(4)), color: C.up, colorNeg: C.down, legendColor: C.up, fmt: (v) => F.pct(v, 4) }], yFmt: (v) => F.num(v, 3) + '%' }; });
      const tk = S.taker.slice(-48);
      A.chart(main.querySelector('[data-chart="taker"]'), { h: 200, x: xl.slice(-48), xTip: xt.slice(-48), series: [{ type: 'bar', label: 'Taker Buy', data: tk.map((t) => t.buy), color: 'hsl(var(--profit)/.8)', fmt: F.usdCompact }, { type: 'bar', label: 'Taker Sell', data: tk.map((t) => -t.sell), color: 'hsl(var(--loss)/.8)', fmt: (v) => F.usdCompact(Math.abs(v)) }], stack: true, yFmt: (v) => F.usdCompact(Math.abs(v)), tipExtra: (i) => [['Net', A.signedUsd(tk[i].buy - tk[i].sell)]] });
      // liquidation heatmap grid
      const r = CG.rng(c.symbol.charCodeAt(0) * 91 + c.rank); const levels = []; for (let k = 5; k >= -5; k--) if (k !== 0) levels.push(k); let hm = '<div class="cg2-lheat" style="grid-template-columns:64px repeat(12,minmax(0,1fr))">';
      levels.forEach((k) => { const lvl = c.price * (1 + k / 100); hm += '<div class="lab">' + (lvl >= 1000 ? '$' + F.compact(lvl) : A.price(lvl)) + '</div>'; for (let h = 0; h < 12; h++) { const inten = Math.pow(r(), 1.6) * (1 - Math.abs(k) / 8) + (Math.abs(k) <= 2 ? 0.25 : 0); const v = k > 0 ? 'var(--loss)' : 'var(--profit)'; hm += '<div style="background:hsl(' + v + '/' + (0.08 + Math.min(inten, 1) * 0.85).toFixed(2) + ')" title="' + (k > 0 ? 'Short' : 'Long') + ' liquidation level ' + (k > 0 ? '+' : '') + k + '% · ' + F.usdCompact(inten * c.liq24h / 12) + '"></div>'; } });
      hm += '<div></div>'; for (let h = 11; h >= 0; h--) { const t = new Date(A.now().getTime() - h * 3600000); hm += '<div class="xlab">' + (h % 2 === 1 ? '' : A.hm(t)) + '</div>'; }
      main.querySelector('[data-lheat]').innerHTML = hm + '</div><div class="cg2-legend" style="padding-top:8px"><span><i style="background:hsl(var(--loss)/.8)"></i>Short liquidation levels (above price)</span><span><i style="background:hsl(var(--profit)/.8)"></i>Long liquidation levels (below price)</span></div>';
      const rr = CG.rng(c.rank * 17 + 5); const mk = M.exchanges.filter((e) => e.name !== 'Deribit').map((e) => ({ exchange: e.name, oi: c.openInterest * e.oiShare * (0.8 + rr() * 0.4), vol: c.volume24h * e.oiShare * (0.7 + rr() * 0.6), funding: +(c.funding + (rr() - 0.5) * 0.01).toFixed(4) })); const oiTot = mk.reduce((s, m) => s + m.oi, 0); mk.forEach((m) => (m.share = m.oi / oiTot));
      A.table(main.querySelector('[data-mkts]'), { key: 'mk-' + c.symbol, rows: mk, sortKey: 'oi', csv: c.symbol + '-markets', cols: [{ key: 'exchange', label: 'Exchange', render: (m) => '<b>' + m.exchange + '</b>' }, { key: 'oi', label: 'Open Interest', align: 'r', render: (m) => F.usdCompact(m.oi) }, { key: 'vol', label: '24h Vol', align: 'r', render: (m) => F.usdCompact(m.vol) }, { key: 'share', label: 'OI Share', align: 'r', render: (m) => '<span class="cg2-bias" style="width:110px;justify-content:flex-end"><span class="cg2-split" style="max-width:60px"><i class="l" style="width:' + (m.share * 100).toFixed(1) + '%;background:hsl(var(--curve))"></i></span><span class="mono" style="font-size:10.5px;width:40px;text-align:right">' + F.num(m.share * 100, 1) + '%</span></span>' }, { key: 'funding', label: 'Funding', align: 'r', render: (m) => '<span class="' + A.cls(m.funding) + '">' + F.pct(m.funding, 4) + '</span>' }] });
      const nowT = A.now(); const nextF = new Date(Math.ceil(nowT.getTime() / 28800000) * 28800000); const mins = Math.max(1, Math.round((nextF - nowT) / 60000));
      A.table(main.querySelector('[data-fund-ex]'), { key: 'fx-' + c.symbol, rows: mk, sortKey: 'funding', csv: c.symbol + '-funding', cols: [{ key: 'exchange', label: 'Exchange', render: (m) => '<b>' + m.exchange + '</b>' }, { key: 'funding', label: 'Funding rate', align: 'r', render: (m) => A.heat(m.funding, { max: 0.03, fmt: (v) => F.pct(v, 4) }) }, { key: 'pred', label: 'Predicted', align: 'r', sortVal: (m) => m.funding * 1.05, render: (m) => '<span class="' + A.cls(m.funding) + '">' + F.pct(m.funding * 1.05, 4) + '</span>' }, { key: 'apr', label: 'APR', align: 'r', sortVal: (m) => m.funding * 3 * 365, render: (m) => F.pct(m.funding * 3 * 365, 1) }, { key: 'next', label: 'Next funding', align: 'r', sort: false, render: () => '<span class="cg2-dim">' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm</span>' }] });
      main.onclick = (e) => { const s = e.target.closest('[data-star]'); if (s) { A.watch.toggle(c.symbol); main.querySelector('[data-starhost]').innerHTML = starBtn(); return; } if (e.target.closest('[data-cmp]')) { if (A.cmp.list().includes(c.symbol) || A.cmp.toggle(c.symbol) !== false) CG.navigate('/analytics/markets?compare=1'); } };
      if (!root._tick) { root._tick = CG.on('tick', () => { const el = root.querySelector('[data-live-px]'); const cur = CG.current.params && CG.current.params.symbol; if (el && cur && CG.ASSETS[cur.toUpperCase()]) { el.textContent = A.price(CG.ASSETS[cur.toUpperCase()].price); el.classList.remove('cg2-flash'); void el.offsetWidth; el.classList.add('cg2-flash'); } }); }
    }
  });
})();
</script>
