<style>
.cg2-tiles.five{grid-template-columns:repeat(5,minmax(0,1fr))}
.cg2-tiles.four{grid-template-columns:repeat(4,minmax(0,1fr))}
.cg2-tiles.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.cg2-tiles.six{grid-template-columns:repeat(6,minmax(0,1fr))}
@media (max-width:1100px){.cg2-tiles.five,.cg2-tiles.six{grid-template-columns:repeat(3,minmax(0,1fr))}.cg2-tiles.four{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.cg2-tiles.five,.cg2-tiles.four,.cg2-tiles.three,.cg2-tiles.six{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cg2-gl-row{display:grid;grid-template-columns:minmax(0,1fr) 84px 76px;align-items:center;gap:8px;padding:0 12px;height:32px;border-bottom:1px solid hsl(var(--border)/.7);font-size:11.5px;cursor:pointer}
.cg2-gl-row:hover{background:hsl(var(--muted)/.6)}
.cg2-gl-row:last-child{border-bottom:0}
.cg2-gl-row .r{text-align:right}
.cg2-gl-row.hd{cursor:default;height:26px;font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:hsl(var(--muted-foreground))}
.cg2-gl-row.hd:hover{background:transparent}
.cg2-lsbar{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;font-size:11px}
.cg2-lsbar .r{text-align:right}
</style>
<script>
(function () {
  const CG = window.CG, M = CG.mock, F = CG.fmt, A = window.CG2, C = A.C; A.st = A.st || {};
  const G = M.global;
  const oiChg24 = () => { const oh = M.oiHistory; return (oh[oh.length - 1].oi / oh[oh.length - 25].oi - 1) * 100; };
  const btcLs = () => M.lsHistory[M.lsHistory.length - 1].global;
  const gainers = () => M.coins.slice().sort((a, b) => b.chg24 - a.chg24);
  const losers = () => M.coins.slice().sort((a, b) => a.chg24 - b.chg24);
  const rsiLabel = (v) => (v < 30 ? 'oversold' : v > 70 ? 'overbought' : 'neutral');
  const altLabel = (v) => (v <= 25 ? 'Bitcoin Season' : v >= 75 ? 'Altcoin Season' : 'Neutral · mixed');
  const heatCells = () => A.byCap().slice(0, 24).map((c) => ({ label: c.symbol, value: c.marketCap, chg: c.chg24 }));
  const etfRows = (n) => M.etfFlows.slice(-n).reverse();
  const SEARCH = { search: true, searchText: (r) => r.symbol + ' ' + r.name, searchPlaceholder: 'Search coin…' };
  A.derivCols = () => [
    { key: 'rank', label: 'Assets', sortVal: (r) => -r.rank, render: (r) => A.asset(r, { rank: true }) },
    { key: 'price', label: 'Price', align: 'r', render: (r) => A.price(r.price) },
    { key: 'chg24', label: 'Price 24h%', align: 'r', render: (r) => A.heat(r.chg24) },
    { key: 'funding', label: 'Funding', align: 'r', render: (r) => '<span class="' + A.cls(r.funding) + '">' + F.pct(r.funding, 4) + '</span>' },
    { key: 'volume24h', label: 'Volume 24h', align: 'r', render: (r) => F.usdCompact(r.volume24h) },
    { key: 'marketCap', label: 'Market Cap', align: 'r', render: (r) => F.usdCompact(r.marketCap) },
    { key: 'oiChg1h', label: 'OI 1h%', align: 'r', render: (r) => A.heat(r.oiChg1h, { max: 2 }) },
    { key: 'oiChg24h', label: 'OI 24h%', align: 'r', render: (r) => A.heat(r.oiChg24h) },
    { key: 'liq24h', label: 'Liquidation 24h', align: 'r', render: (r) => F.usdCompact(r.liq24h) }
  ];
  const spotCols = () => [
    { key: 'rank', label: 'Assets', sortVal: (r) => -r.rank, render: (r) => A.asset(r, { rank: true }) },
    { key: 'price', label: 'Price', align: 'r', render: (r) => A.price(r.price) },
    { key: 'chg24', label: 'Price 24h%', align: 'r', render: (r) => A.heat(r.chg24) },
    { key: 'volume24h', label: 'Volume 24h', align: 'r', render: (r) => F.usdCompact(r.volume24h) },
    { key: 'marketCap', label: 'Market Cap', align: 'r', render: (r) => F.usdCompact(r.marketCap) },
    { key: 'chg1h', label: '1h%', align: 'r', render: (r) => A.heat(r.chg1h, { max: 1.5 }) },
    { key: 'chg4h', label: '4h%', align: 'r', render: (r) => A.heat(r.chg4h, { max: 3 }) },
    { key: 'chg7d', label: '7d%', align: 'r', render: (r) => A.heat(r.chg7d, { max: 15 }) }
  ];
  const categories = () => { const names = { 'layer-1': 'Layer 1', 'layer-2': 'Layer 2', defi: 'DeFi', memes: 'Memes', other: 'Other' }; const by = {}; M.coins.forEach((c) => { const k = c.sector; const g = (by[k] = by[k] || { key: k, name: names[k] || k, coins: 0, marketCap: 0, volume24h: 0, chgSum: 0, openInterest: 0, top: null }); g.coins++; g.marketCap += c.marketCap; g.volume24h += c.volume24h; g.openInterest += c.openInterest; g.chgSum += c.chg24; if (!g.top || c.marketCap > g.top.marketCap) g.top = c; }); return Object.values(by).map((g) => Object.assign(g, { avgChg: g.chgSum / g.coins })).sort((a, b) => b.marketCap - a.marketCap); };
  // ============ /analytics/coinglass · Markets Hub ============
  A.screen('/analytics/coinglass', {
    render(main) {
      const st = (A.st.home = A.st.home || { tab: 'Derivatives', gl: 'gainers' });
      const oiC = oiChg24(); const ls = btcLs(); const longPct = ls / (1 + ls) * 100; const fg = M.fearGreedNow; const exBal24 = M.exchanges.reduce((s, e) => s + e.btcBalanceChg24 * e.oiShare, 0) / M.exchanges.reduce((s, e) => s + e.oiShare, 0);
      main.innerHTML =
        '<div class="cg2-tiles five">' +
        A.tile('Open Interest', F.usdCompact(G.totalOi), 'OI Change 24h ' + A.signed(oiC)) +
        A.tile('Liquidation (24h)', F.usdCompact(G.liq24h), '<span class="cg2-up mono">L ' + F.usdCompact(G.longLiq24h) + '</span><span class="cg2-down mono">S ' + F.usdCompact(G.shortLiq24h) + '</span>', A.split(G.longLiq24h, G.shortLiq24h)) +
        A.tile('AVG RSI', G.avgRsi, '<span class="cg2-badge ' + (G.avgRsi < 30 ? 'long' : G.avgRsi > 70 ? 'short' : 'neutral') + '">' + rsiLabel(G.avgRsi) + '</span><span>Top 100 · 24h</span>') +
        '<div class="cg2-tile"><div class="cg2-tile-l">Altcoin Season Index</div><div data-gauge="alt"></div><div class="cg2-tile-s">' + altLabel(G.altSeason) + '</div></div>' +
        A.tile('Gold Futures', '$' + F.num(G.gold, 1), '<span class="mono cg2-dim">GC=F</span>' + A.signed(G.goldChg)) +
        A.tile('U.S. Dollar Index', F.num(G.dxy, 2), '<span class="mono cg2-dim">DX-Y.NYB</span>' + A.signed(G.dxyChg)) +
        A.tile('Bitcoin Dominance', F.num(G.btcDominance, 1) + '%', 'ETH ' + F.num(G.ethDominance, 1) + '% · Total cap ' + F.usdCompact(G.totalMarketCap)) +
        A.tile('Bitcoin Exchange Balance', F.compact(G.btcExchangeBalance) + ' BTC', 'Δ 24h ' + A.signed(exBal24) + ' · ' + M.exchanges.length + ' exchanges') +
        '<div class="cg2-tile"><div class="cg2-tile-l">Fear &amp; Greed Index</div><div data-gauge="fg"></div><div class="cg2-tile-s" style="color:' + A.fgColor(fg) + '">' + M.fgLabel(fg) + '</div></div>' +
        '<div class="cg2-tile"><div class="cg2-tile-l">Long/Short <span style="text-transform:none;letter-spacing:0">· BTC · Global accounts</span></div><div class="cg2-lsbar"><span class="cg2-up mono">Long ' + F.num(longPct, 1) + '%</span><span class="mono" style="font-weight:500">Ratio ' + F.num(ls, 2) + '</span><span class="cg2-down mono r">Short ' + F.num(100 - longPct, 1) + '%</span></div>' + A.split(longPct, 100 - longPct) + '</div>' +
        '</div>' +
        '<div data-watch></div>' +
        '<div class="cg2-grid cg2-grid-main">' +
        '<div class="cg2-panel"><div class="cg2-ph" style="padding:6px 8px">' + A.seg(['Derivatives', 'Spot', 'Stock', 'Categories', 'Token Unlock', 'Memes', 'L1L2'], st.tab, 'data-tab') + '<div class="cg2-tools"><span class="cg2-ps" data-count></span></div></div><div class="cg2-pb tight" data-main-table></div></div>' +
        '<div class="cg2-col">' +
        A.panel('Gainers &amp; Losers', '24h', '<div class="cg2-pb tight" data-gl></div>', A.seg([['gainers', 'Top Gainers'], ['losers', 'Top Losers']], st.gl, 'data-gl-tab')) +
        A.panel('Heatmap (24h)', 'market cap · 24h change', '<div class="cg2-pb" data-heat></div>') +
        A.panel('Total Bitcoin Spot ETF Net Inflow', 'daily · USD', '<div class="cg2-pb tight" data-etf></div><div class="cg2-note">' + M.etfs.length + ' BTC ETFs tracked<a class="cg2-link" href="#/analytics/etf">View all →</a></div>') +
        '</div></div>';
      A.gauge(main.querySelector('[data-gauge="alt"]'), { value: G.altSeason, size: 92, thick: 8, fontSize: 17, inline: true, segs: [[0, 25, 'hsl(var(--curve)/.8)'], [25, 75, 'hsl(var(--muted-foreground)/.4)'], [75, 100, 'hsl(var(--profit)/.8)']] });
      A.gauge(main.querySelector('[data-gauge="fg"]'), { value: fg, size: 92, thick: 8, fontSize: 17, inline: true, color: A.fgColor(fg) });
      A.watch.strip(main.querySelector('[data-watch]'), 'analytics');
      const renderMain = () => {
        const host = main.querySelector('[data-main-table]'); const cnt = main.querySelector('[data-count]');
        if (st.tab === 'Stock' || st.tab === 'Token Unlock') { host.innerHTML = '<div class="cg2-coming"><b>Cryptocurrency Data Analysis</b>Coming soon</div>'; cnt.textContent = ''; return; }
        if (st.tab === 'Categories') { const rows = categories(); cnt.textContent = rows.length + ' categories'; A.table(host, { key: 'cat', rows, sortKey: 'marketCap', csv: 'categories', cols: [{ key: 'name', label: 'Category', render: (r) => '<b>' + r.name + '</b>' }, { key: 'coins', label: 'Coins', align: 'r' }, { key: 'marketCap', label: 'Market Cap', align: 'r', render: (r) => F.usdCompact(r.marketCap) }, { key: 'volume24h', label: 'Volume 24h', align: 'r', render: (r) => F.usdCompact(r.volume24h) }, { key: 'openInterest', label: 'Open Interest', align: 'r', render: (r) => F.usdCompact(r.openInterest) }, { key: 'avgChg', label: 'Avg 24h%', align: 'r', render: (r) => A.heat(r.avgChg) }, { key: 'top', label: 'Top coin', sort: false, render: (r) => A.asset(r.top, { name: false }) }], rowHref: (r) => (r.key === 'other' ? '/analytics/markets' : '/analytics/markets?category=' + r.key) }); return; }
        let rows = A.byCap(); if (st.tab === 'Memes') rows = rows.filter((c) => c.sector === 'memes'); if (st.tab === 'L1L2') rows = rows.filter((c) => c.sector === 'layer-1' || c.sector === 'layer-2');
        cnt.textContent = rows.length + ' assets';
        A.table(host, Object.assign({ key: 'home-' + st.tab, rows, sortKey: 'marketCap', cols: st.tab === 'Spot' ? spotCols() : A.derivCols(), rowHref: (r) => '/analytics/coin/' + r.symbol, star: (r) => r.symbol, columns: true, csv: 'markets-hub-' + st.tab.toLowerCase(), maxH: 640 }, SEARCH));
      };
      const renderGl = () => { const list = (st.gl === 'gainers' ? gainers() : losers()).slice(0, 8); main.querySelector('[data-gl]').innerHTML = '<div class="cg2-gl-row hd"><span>Asset</span><span class="r">Price</span><span class="r">Chg%</span></div>' + list.map((c) => '<div class="cg2-gl-row" data-nav="/analytics/coin/' + c.symbol + '">' + A.asset(c, { name: false }) + '<span class="r mono">' + A.price(c.price) + '</span><span class="r">' + A.heat(c.chg24) + '</span></div>').join(''); };
      renderMain(); renderGl();
      A.treemap(main.querySelector('[data-heat]'), { items: heatCells(), h: 230 });
      A.table(main.querySelector('[data-etf]'), { key: 'home-etf', rows: etfRows(8), cols: [{ key: 'date', label: 'Date', render: (r) => A.md(r.date) }, { key: 'flow', label: 'Total', align: 'r', render: (r) => A.signedUsd(r.flow) }] });
      main.onclick = (e) => { const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; CG.$$('[data-tab]', main).forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab)); renderMain(); return; } const g = e.target.closest('[data-gl-tab]'); if (g) { st.gl = g.dataset.glTab; CG.$$('[data-gl-tab]', main).forEach((b) => b.classList.toggle('on', b.dataset.glTab === st.gl)); renderGl(); } };
    }
  });
  // ============ /analytics/overview · Futures ============
  A.screen('/analytics/overview', {
    render(main) {
      const st = (A.st.overview = A.st.overview || {});
      const oiC = oiChg24(); const ls = btcLs(); const longPct = ls / (1 + ls) * 100; const fg = M.fearGreedNow; const btc = A.coin('BTC'), eth = A.coin('ETH');
      main.innerHTML =
        '<div class="cg2-tiles four">' +
        A.tile('Open Interest', F.usdCompact(G.totalOi), 'All exchanges' + A.signed(oiC)) +
        A.tile('24h Volume', F.usdCompact(G.totalVol24h), 'Futures · all exchanges') +
        A.tile('Liquidations 24h', F.usdCompact(G.liq24h), '<span class="cg2-up mono">L ' + F.usdCompact(G.longLiq24h) + '</span><span class="cg2-down mono">S ' + F.usdCompact(G.shortLiq24h) + '</span>', A.split(G.longLiq24h, G.shortLiq24h)) +
        A.tile('Fear &amp; Greed', '<span style="color:' + A.fgColor(fg) + '">' + fg + '</span>', M.fgLabel(fg)) +
        A.tile('BTC Price', A.price(CG.ASSETS.BTC.price), A.signed(btc.chg24) + '24h', '', 'cg2-live-btc') +
        A.tile('ETH Price', A.price(CG.ASSETS.ETH.price), A.signed(eth.chg24) + '24h', '', 'cg2-live-eth') +
        A.tile('BTC Dominance', F.num(G.btcDominance, 1) + '%', 'ETH ' + F.num(G.ethDominance, 1) + '%') +
        A.tile('Long/Short Ratio', F.num(ls, 2), 'BTC global · <span class="cg2-up">L ' + F.num(longPct, 1) + '%</span> <span class="cg2-down">S ' + F.num(100 - longPct, 1) + '%</span>', A.split(longPct, 100 - longPct)) +
        '</div>' +
        '<div class="cg2-grid cg2-grid2">' +
        A.panel('BTC Price &amp; Open Interest', 'aggregated · all exchanges', '<div class="cg2-pb" data-chart="oi"></div>') +
        A.panel('BTC Long / Short Ratio', 'global accounts', '<div class="cg2-pb" data-chart="ls"></div>') +
        '</div>' +
        '<div class="cg2-grid cg2-grid3">' +
        A.panel('Fear &amp; Greed Index', 'daily', '<div class="cg2-pb" style="display:flex;flex-direction:column;align-items:center;gap:8px" data-fg></div>') +
        A.panel('Top Gainers (24h)', '', '<div class="cg2-pb tight" data-gainers></div>') +
        A.panel('Top Losers (24h)', '', '<div class="cg2-pb tight" data-losers></div>') +
        '</div>' +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Heatmap (24h)', 'top 24 by market cap', '<div class="cg2-pb" data-heat></div>') +
        A.panel('Total Bitcoin Spot ETF Net Inflow', 'daily · USD', '<div class="cg2-pb tight" data-etf></div><div class="cg2-note">' + M.etfs.length + ' BTC ETFs tracked<a class="cg2-link" href="#/analytics/etf">View all →</a></div>') +
        '</div>' +
        '<div class="cg2-dim" style="font-size:11px;text-align:center">Data via Coinglass · auto-refreshing every 60s</div>';
      const oh = M.oiHistory;
      A.tfChart(main.querySelector('[data-chart="oi"]'), 'oi', st, {}, (tf) => { const S = A.tfSeries('g-oi', tf, { values: oh.map((p) => p.oi), stepH: 1 }); const P = A.tfSeries('g-px', tf, { values: oh.map((p) => p.price), stepH: 1 }); return { h: 230, rightAxis: true, x: S.x, xTip: S.xTip, series: [{ type: 'area', label: 'Open Interest', data: S.v, color: C.curve, fmt: F.usdCompact }, { type: 'line', label: 'BTC Price', axis: 'r', data: P.v, color: C.fg, fmt: (v) => '$' + F.num(v, 0) }], yFmt: F.usdCompact, y2Fmt: (v) => '$' + F.compact(v) }; });
      A.tfChart(main.querySelector('[data-chart="ls"]'), 'ls', st, {}, (tf) => { const S = A.tfSeries('g-ls', tf, { values: M.lsHistory.map((p) => p.global), stepH: 1, clamp: [0.5, 2.5] }); const lp = S.v.map((g) => +(g / (1 + g) * 100).toFixed(1)); return { h: 230, stack: true, tight: true, x: S.x, xTip: S.xTip, series: [{ type: 'bar', label: 'Long %', data: lp, color: C.up, fmt: (v) => F.num(v, 1) + '%' }, { type: 'bar', label: 'Short %', data: lp.map((v) => +(100 - v).toFixed(1)), color: C.down, fmt: (v) => F.num(v, 1) + '%' }], yFmt: (v) => v + '%', hlines: [{ y: 50, color: 'hsl(var(--foreground)/.5)' }], tipExtra: (i) => [['Ratio', F.num(S.v[i], 2)]] }; });
      const fgHost = main.querySelector('[data-fg]'); A.gauge(fgHost, { value: fg, size: 170, thick: 11, color: A.fgColor(fg), label: M.fgLabel(fg), scale: ['extreme fear', 'extreme greed'] });
      fgHost.insertAdjacentHTML('beforeend', '<div class="cg2-row" style="gap:16px;font-size:11px;color:hsl(var(--muted-foreground))"><span>Yesterday <b class="mono" style="color:hsl(var(--foreground))">' + M.fearGreed[M.fearGreed.length - 2].value + '</b></span><span>7d ago <b class="mono" style="color:hsl(var(--foreground))">' + M.fearGreed[M.fearGreed.length - 8].value + '</b></span><span>30d ago <b class="mono" style="color:hsl(var(--foreground))">' + M.fearGreed[M.fearGreed.length - 31].value + '</b></span></div><div style="width:100%">' + A.spark(M.fearGreed.slice(-30).map((p) => p.value), 300, 34, C.curve) + '</div>');
      const glCols = [{ key: 'symbol', label: 'Coin', render: (r) => A.asset(r, { name: false }) }, { key: 'price', label: 'Price', align: 'r', render: (r) => A.price(r.price) }, { key: 'chg24', label: '24h %', align: 'r', render: (r) => A.heat(r.chg24) }, { key: 'volume24h', label: 'Volume', align: 'r', render: (r) => F.usdCompact(r.volume24h) }];
      A.table(main.querySelector('[data-gainers]'), { key: 'ov-g', rows: gainers().slice(0, 7), cols: glCols, rowHref: (r) => '/analytics/coin/' + r.symbol });
      A.table(main.querySelector('[data-losers]'), { key: 'ov-l', rows: losers().slice(0, 7), cols: glCols, rowHref: (r) => '/analytics/coin/' + r.symbol });
      A.treemap(main.querySelector('[data-heat]'), { items: heatCells(), h: 300 });
      A.table(main.querySelector('[data-etf]'), { key: 'ov-etf', rows: etfRows(10), cols: [{ key: 'date', label: 'Date', render: (r) => A.md(r.date) }, { key: 'flow', label: 'Net Flow', align: 'r', render: (r) => A.signedUsd(r.flow) }, { key: 'cumulative', label: 'Cumulative', align: 'r', render: (r) => F.usdCompact(r.cumulative) }] });
      if (!main._tick) { main._tick = CG.on('tick', () => { if (!A.current) return; const b = main.querySelector('.cg2-live-btc .cg2-tile-v'), e = main.querySelector('.cg2-live-eth .cg2-tile-v'); if (b) { b.textContent = A.price(CG.ASSETS.BTC.price); b.classList.remove('cg2-flash'); void b.offsetWidth; b.classList.add('cg2-flash'); } if (e) e.textContent = A.price(CG.ASSETS.ETH.price); }); }
    }
  });
  // ============ /analytics/markets · Futures Markets Screener (+ Compare · Watchlist) ============
  A.screen('/analytics/markets', {
    render(main, params, query) {
      const st = (A.st.markets = A.st.markets || { watchOnly: false }); const cat = query.category || 'all';
      const cats = [['all', 'All'], ['layer-1', 'Layer 1'], ['layer-2', 'Layer 2'], ['defi', 'DeFi'], ['memes', 'Memes']];
      main.innerHTML = '<div data-compare hidden></div>' + A.panel('Futures Markets Screener', 'perpetual futures · aggregated · tick Cmp to compare up to 3 coins · ★ to pin on the hub', '<div class="cg2-pb tight" data-table></div>', A.chips(cats, cat, 'data-cat') + '<button class="cg2-chip star' + (st.watchOnly ? ' on' : '') + '" data-watchonly type="button" title="Show only starred coins">' + A.icons.starOn + 'Watchlist</button>');
      const host = main.querySelector('[data-table]');
      const render = () => { let rows = A.byCap(); if (cat !== 'all') rows = rows.filter((c) => c.sector === cat); if (st.watchOnly) rows = rows.filter((c) => A.watch.has(c.symbol)); A.table(host, Object.assign({ key: 'mk-' + cat + (st.watchOnly ? '-w' : ''), rows, sortKey: 'marketCap', empty: st.watchOnly ? 'Your watchlist is empty — star coins to pin them here' : 'No coins in this category', columns: true, csv: 'futures-markets', star: (r) => r.symbol, select: { get: (r) => r.symbol, selected: () => A.cmp.list(), on: (sym) => A.cmp.toggle(sym) }, cols: [{ key: 'symbol', label: 'Coin', sortVal: (r) => -r.rank, render: (r) => A.asset(r, { rank: true }) }, { key: 'price', label: 'Price', align: 'r', render: (r) => A.price(r.price) }, { key: 'chg24', label: '24h %', align: 'r', render: (r) => A.heat(r.chg24) }, { key: 'chg7d', label: '7d %', align: 'r', hidden: true, render: (r) => A.heat(r.chg7d, { max: 15 }) }, { key: 'marketCap', label: 'Market Cap', align: 'r', render: (r) => F.usdCompact(r.marketCap) }, { key: 'volume24h', label: '24h Volume', align: 'r', render: (r) => F.usdCompact(r.volume24h) }, { key: 'openInterest', label: 'Open Interest', align: 'r', render: (r) => F.usdCompact(r.openInterest) }, { key: 'oiChg24h', label: 'OI 24h %', align: 'r', render: (r) => A.heat(r.oiChg24h) }, { key: 'funding', label: 'Funding', align: 'r', hidden: true, render: (r) => '<span class="' + A.cls(r.funding) + '">' + F.pct(r.funding, 4) + '</span>' }, { key: 'lsRatio', label: 'L/S Ratio', align: 'r', render: (r) => '<span class="' + (r.lsRatio >= 1 ? 'cg2-up' : 'cg2-down') + '">' + F.num(r.lsRatio, 2) + '</span>' }, { key: 'liq24h', label: 'Liq 24h', align: 'r', hidden: true, render: (r) => F.usdCompact(r.liq24h) }], rowHref: (r) => '/analytics/coin/' + r.symbol, foot: '<div class="cg2-note">' + rows.length + ' markets · click a row for full coin analytics · hidden columns: 7d %, Funding, Liq 24h (Columns ▾)</div>' }, SEARCH)); };
      render(); main._render = render;
      A.cmp.panel(main.querySelector('[data-compare]'), { app: 'analytics', force: query.compare === '1' });
      if (query.compare === '1') A.after(80, () => { const p = main.querySelector('[data-compare]'); if (p) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      main.onclick = (e) => { const c = e.target.closest('[data-cat]'); if (c) { CG.navigate(c.dataset.cat === 'all' ? '/analytics/markets' : '/analytics/markets?category=' + c.dataset.cat); return; } const w = e.target.closest('[data-watchonly]'); if (w) { st.watchOnly = !st.watchOnly; w.classList.toggle('on', st.watchOnly); render(); } };
      if (!main._wl) { main._wl = true; CG.on('watchlist', () => { if (A.current && main.isConnected && main._render && (A.st.markets || {}).watchOnly) main._render(); }); }
    }
  });
})();
</script>
