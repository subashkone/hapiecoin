<script>
(function () {
  const CG = window.CG, M = CG.mock, F = CG.fmt, A = window.CG2, C = A.C; const G = M.global;
  // per-coin derived series (deterministic, cached)
  A.coinSeries = function (sym) {
    const cache = (A._cs = A._cs || {}); if (cache[sym]) return cache[sym];
    const c = A.coin(sym) || M.coins[0]; const r = CG.rng(sym.length * 7 + sym.charCodeAt(0) * 13 + (sym.charCodeAt(1) || 0) * 3);
    const price = M.priceHistory(sym, 96); const k = c.openInterest / G.totalOi;
    let fo = 1, fl = 1; const oi = M.oiHistory.map((p) => { fo *= 1 + (r() - 0.5) * 0.03; return p.oi * k * fo; });
    const ls = M.lsHistory.map((p) => { fl *= 1 + (r() - 0.5) * 0.02; return +(p.global * c.lsRatio / 1.05 * fl).toFixed(2); });
    const funding = M.fundingHistory.map((p) => +((p.oiWeighted - 0.009 + c.funding) * (0.8 + r() * 0.4)).toFixed(4));
    const liq = M.liqHistory.map((p) => ({ time: p.time, long: p.long * c.liq24h / G.liq24h * (0.5 + r()), short: p.short * c.liq24h / G.liq24h * (0.5 + r()) }));
    const taker = price.map((p) => { const b = 0.4 + r() * 0.25; return { buy: p.volume * b, sell: p.volume * (1 - b) }; });
    const basis = price.map(() => +(((r() - 0.35) * 0.3) + 0.05).toFixed(3));
    return (cache[sym] = { c, price, oi, ls, funding, liq, taker, basis });
  };
  const topCoins = () => A.byCap().slice(0, 20);
  const coinSelect = (cur, attr) => '<select class="cg2-select" ' + attr + '>' + topCoins().map((c) => '<option value="' + c.symbol + '"' + (c.symbol === cur ? ' selected' : '') + '>' + c.symbol + ' · ' + CG.esc(c.name) + '</option>').join('') + '</select>';
  const yPx = (v) => (v >= 1000 ? '$' + F.compact(v) : A.price(v));
  // ============ /analytics/derivatives ============
  A.screen('/analytics/derivatives', {
    render(main, params, query) {
      const st = (A.st.deriv = A.st.deriv || { sym: 'BTC' }); if (query.symbol && A.coin(query.symbol)) st.sym = query.symbol.toUpperCase();
      const S = A.coinSeries(st.sym), c = S.c; const ls = S.ls[S.ls.length - 1]; const fund = S.funding[S.funding.length - 1]; const livePx = CG.ASSETS[c.symbol] ? CG.ASSETS[c.symbol].price : c.price;
      main.innerHTML =
        '<div class="cg2-row"><span class="cg2-pt" style="font-size:14px">Derivatives</span><span class="cg2-ps">perpetual futures · aggregated across Binance · OKX · Bybit</span><div style="margin-left:auto" class="cg2-row">' + coinSelect(st.sym, 'data-sym') + '<a class="cg2-link" href="#/analytics/coin/' + c.symbol + '">Full coin analytics →</a></div></div>' +
        '<div class="cg2-tiles four">' +
        A.tile('Open interest', F.usdCompact(c.openInterest), A.signed(c.oiChg24h) + '24h') +
        A.tile('24h volume', F.usdCompact(c.volume24h), 'Perp · ' + c.symbol + 'USDT') +
        A.tile('Funding', '<span class="' + A.cls(fund) + '">' + F.pct(fund, 4) + '</span>', 'OI-weighted · 8h · APR ' + F.pct(fund * 3 * 365, 1)) +
        A.tile('L/S ratio · 24h', '<span class="' + (ls >= 1 ? 'cg2-up' : 'cg2-down') + '">' + F.num(ls, 2) + '</span>', 'Global accounts · <span class="cg2-up">L ' + F.num(ls / (1 + ls) * 100, 1) + '%</span> <span class="cg2-down">S ' + F.num(100 / (1 + ls), 1) + '%</span>') +
        '</div>' +
        '<div class="cg2-grid cg2-grid2">' +
        A.panel('Close price', c.symbol + 'USDT', '<div class="cg2-pb" data-chart="px"></div>') +
        A.panel('Open Interest', 'Aggregated · Binance · OKX · Bybit', '<div class="cg2-pb" data-chart="oi"></div>') +
        A.panel('Funding', 'OI-weighted · % · 8h', '<div class="cg2-pb" data-chart="fund"></div>') +
        A.panel('Global account ratio', 'L/S Ratio', '<div class="cg2-pb" data-chart="ls"></div>') +
        '</div>' +
        A.panel('Basis', 'Perp/spot basis % · positive = contango', '<div class="cg2-pb" data-chart="basis"></div>') +
        A.panel('Funding Rate Arbitrage', 'Cross-exchange funding spreads · long the negative leg, short the positive leg', '<div class="cg2-pb tight" data-arb></div>');
      const pxVals = S.price.map((p) => p.close); const pf = (v) => A.price(v);
      A.tfChart(main.querySelector('[data-chart="px"]'), 'px', st, {}, (tf) => { const T = A.tfSeries('px:' + c.symbol, tf, { values: pxVals, stepH: 1, end: livePx }); return { h: 200, x: T.x, xTip: T.xTip, series: [{ type: 'area', label: 'Close', data: T.v, color: C.fg, fmt: pf }], yFmt: yPx }; });
      A.tfChart(main.querySelector('[data-chart="oi"]'), 'oi', st, {}, (tf) => { const T = A.tfSeries('oi:' + c.symbol, tf, { values: S.oi, stepH: 1 }); return { h: 200, x: T.x, xTip: T.xTip, series: [{ type: 'area', label: 'Open Interest', data: T.v, color: C.curve, fmt: F.usdCompact }], yFmt: F.usdCompact }; });
      A.tfChart(main.querySelector('[data-chart="fund"]'), 'fund', st, { options: ['7D', '30D', '90D', '1Y'], def: '30D' }, (tf) => { const T = A.tfSeries('fund:' + c.symbol, tf, { values: S.funding, stepH: 8, keepStep: true, additive: true, clamp: [-0.1, 0.1] }); return { h: 200, x: T.x, xTip: T.xTip, series: [{ type: 'bar', label: 'Funding', data: T.v.map((v) => +v.toFixed(4)), color: C.up, colorNeg: C.down, legendColor: C.up, fmt: (v) => F.pct(v, 4) }], yFmt: (v) => F.num(v, 3) + '%' }; });
      A.tfChart(main.querySelector('[data-chart="ls"]'), 'ls', st, {}, (tf) => { const T = A.tfSeries('ls:' + c.symbol, tf, { values: S.ls, stepH: 1, clamp: [0.4, 3] }); return { h: 200, x: T.x, xTip: T.xTip, series: [{ type: 'line', label: 'L/S Ratio', data: T.v.map((v) => +v.toFixed(2)), color: C.curve, fmt: (v) => F.num(v, 2) }], yFmt: (v) => F.num(v, 2), hlines: [{ y: 1, label: '1.00', color: C.muted }] }; });
      A.tfChart(main.querySelector('[data-chart="basis"]'), 'basis', st, {}, (tf) => { const T = A.tfSeries('basis:' + c.symbol, tf, { values: S.basis, stepH: 1, additive: true, clamp: [-0.6, 0.9] }); return { h: 180, x: T.x, xTip: T.xTip, series: [{ type: 'bar', label: 'Basis', data: T.v.map((v) => +v.toFixed(3)), color: C.curve, colorNeg: C.down, legendColor: C.curve, fmt: (v) => F.pct(v, 3) }], yFmt: (v) => F.num(v, 2) + '%' }; });
      A.table(main.querySelector('[data-arb]'), { key: 'arb', rows: M.fundingArb, sortKey: 'estApr', csv: 'funding-arbitrage', cols: [{ key: 'symbol', label: 'Coin', render: (r) => A.asset(A.coin(r.symbol) || { symbol: r.symbol, name: '' }, { name: false }) }, { key: 'longLeg', label: 'Long leg', render: (r) => '<span class="cg2-badge long">Long</span> ' + CG.esc(r.longLeg) }, { key: 'shortLeg', label: 'Short leg', render: (r) => '<span class="cg2-badge short">Short</span> ' + CG.esc(r.shortLeg) }, { key: 'spread', label: 'Spread', align: 'r', render: (r) => '<b>' + F.num(r.spread, 4) + '%</b>' }, { key: 'fdelta', label: 'Funding Δ', align: 'r', sortVal: (r) => r.spread * 3, render: (r) => A.heat(r.spread * 3, { max: 0.2, fmt: (v) => F.pct(v, 3) }) }, { key: 'estApr', label: 'Est. APR', align: 'r', render: (r) => '<span class="cg2-up">' + F.num(r.estApr, 1) + '%</span>' }, { key: 'minOi', label: 'Min OI', align: 'r', render: (r) => F.usdCompact(r.minOi) }], rowHref: (r) => '/analytics/coin/' + r.symbol });
      main.querySelector('[data-sym]').addEventListener('change', (e) => { st.sym = e.target.value; A.current && A.current(); });
    }
  });
  // ============ /analytics/options ============
  A.screen('/analytics/options', {
    render(main) {
      const st = (A.st.opt = A.st.opt || { ex: 'Deribit' }); const exs = M.optionsByExchange; const ex = exs.find((x) => x.exchange === st.ex) || exs[0]; const k = ex.share / exs[0].share;
      const exp = M.optionsExpiries.map((e) => ({ expiry: e.expiry, callOi: Math.round(e.callOi * k), putOi: Math.round(e.putOi * k), maxPain: e.maxPain }));
      const contracts = exp.reduce((s, e) => s + e.callOi + e.putOi, 0); const totalOi = ex.oiUsd; const vol = ex.volume24h; const pcr = exp.reduce((s, e) => s + e.putOi, 0) / exp.reduce((s, e) => s + e.callOi, 0);
      const colors = [C.curve, 'hsl(var(--foreground)/.55)', C.up, C.down, C.warn, C.muted];
      main.innerHTML =
        '<div class="cg2-row"><span class="cg2-pt" style="font-size:14px">' + CG.esc(ex.exchange) + ' · Options</span><span class="cg2-ps">BTC options · open interest, volume &amp; max pain</span><div style="margin-left:auto">' + A.seg(exs.map((x) => x.exchange), ex.exchange, 'data-ex') + '</div></div>' +
        '<div class="cg2-tiles four">' +
        A.tile('Total open interest', F.usdCompact(totalOi), A.signed(ex.oiChg24) + '24h · share ' + F.num(ex.share * 100, 1) + '%') +
        A.tile('OI (contracts)', F.compact(contracts), 'Put/Call ratio <span class="mono ' + (pcr > 1 ? 'cg2-down' : 'cg2-up') + '">' + F.num(pcr, 2) + '</span>') +
        A.tile('24h volume', F.usdCompact(vol), A.signed(ex.volChg24) + 'vs yesterday') +
        A.tile('Nearest expiry max pain', '$' + F.num(exp[0].maxPain, 0), exp[0].expiry + ' · spot ' + A.price(CG.ASSETS.BTC.price)) +
        '</div>' +
        A.panel('Open Interest by Expiry', 'Call/put OI per expiry with max pain price · ' + CG.esc(ex.exchange), '<div class="cg2-pb" data-chart="exp"></div>') +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Open Interest by Exchange', 'share of options OI', '<div class="cg2-pb" data-donut></div>') +
        A.panel('Options Markets by Exchange', 'OI, market share and volume', '<div class="cg2-pb tight" data-table></div>') +
        '</div>';
      const mx = exp.map((e) => Math.max(e.callOi, e.putOi));
      A.chart(main.querySelector('[data-chart="exp"]'), { h: 260, rightAxis: true, x: exp.map((e) => e.expiry), barW: 0.6, series: [{ type: 'bar', label: 'Call OI', data: exp.map((e) => e.callOi), color: 'hsl(var(--profit)/.75)', fmt: (v) => F.int(v) }, { type: 'bar', label: 'Put OI', data: exp.map((e) => e.putOi), color: 'hsl(var(--loss)/.75)', fmt: (v) => F.int(v) }, { type: 'line', label: 'Max Pain', axis: 'r', data: exp.map((e) => e.maxPain), color: C.primary, width: 1.4, dash: '4 3', fmt: (v) => '$' + F.int(v) }], labels: exp.map((e, i) => ({ i, y: mx[i], text: '$' + F.compact(e.maxPain), color: C.primary })), yFmt: F.compact, y2Fmt: (v) => '$' + F.compact(v), xCount: exp.length });
      A.donut(main.querySelector('[data-donut]'), { items: exs.map((x, i) => ({ label: x.exchange, value: x.oiUsd, color: colors[i % colors.length] })), center: F.usdCompact(exs.reduce((s, x) => s + x.oiUsd, 0)), size: 150 });
      A.table(main.querySelector('[data-table]'), { key: 'opt-ex', rows: exs, sortKey: 'oiUsd', csv: 'options-exchanges', cols: [{ key: 'exchange', label: 'Exchange', render: (r) => '<span class="cg2-asset"><i style="display:inline-block;background:' + colors[exs.indexOf(r) % colors.length] + ';width:10px;height:10px;border-radius:2px"></i><b>' + CG.esc(r.exchange) + '</b></span>' }, { key: 'oiUsd', label: 'OI (USD)', align: 'r', render: (r) => F.usdCompact(r.oiUsd) }, { key: 'share', label: 'Share', align: 'r', render: (r) => F.num(r.share * 100, 1) + '%' }, { key: 'oiChg24', label: 'OI Δ 24h', align: 'r', render: (r) => A.heat(r.oiChg24) }, { key: 'volume24h', label: '24h Volume', align: 'r', render: (r) => F.usdCompact(r.volume24h) }, { key: 'volChg24', label: 'Vol Δ 24h', align: 'r', render: (r) => A.heat(r.volChg24, { max: 25 }) }] });
      main.onclick = (e) => { const b = e.target.closest('[data-ex]'); if (b) { st.ex = b.dataset.ex; A.current && A.current(); } };
    }
  });
  // ============ /analytics/etf ============
  const etfPrice = (t) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 997; return 18 + (h % 45) + (h % 100) / 100; };
  A.screen('/analytics/etf', {
    render(main) {
      const st = (A.st.etf = A.st.etf || { asset: 'bitcoin' }); const isBtc = st.asset === 'bitcoin'; const funds = isBtc ? M.etfs : M.ethEtfs; const r = CG.rng(isBtc ? 11 : 22);
      const flows = M.etfFlows.map((p) => ({ date: p.date, flow: isBtc ? p.flow : Math.round(p.flow * 0.22 * (0.6 + r() * 0.8)), price: isBtc ? p.price : p.price * CG.ASSETS.ETH.price / 79521 })); let cum = isBtc ? 18.2e9 : 3.4e9; flows.forEach((p) => { cum += p.flow; p.cumulative = cum; });
      const week = flows.slice(-7).reduce((s, p) => s + p.flow, 0); const aum = funds.reduce((s, f) => s + f.aum, 0); const unit = isBtc ? 'BTC' : 'ETH';
      main.innerHTML =
        '<div class="cg2-row"><span class="cg2-pt" style="font-size:14px">' + (isBtc ? 'Bitcoin' : 'Ethereum') + ' Spot ETFs</span><span class="cg2-ps">US-listed spot ETFs · flows, AUM and holdings</span><div style="margin-left:auto">' + A.seg([['bitcoin', 'Bitcoin'], ['ethereum', 'Ethereum']], st.asset, 'data-asset') + '</div></div>' +
        '<div class="cg2-tiles three">' +
        A.tile('7-day net flow', A.signedUsd(week), 'Yesterday ' + A.signedUsd(flows[flows.length - 1].flow)) +
        A.tile('Total AUM', F.usdCompact(aum), F.compact(funds.reduce((s, f) => s + (f.btcHeld || f.ethHeld || 0), 0)) + ' ' + unit + ' held') +
        A.tile('Funds tracked', funds.length, funds.map((f) => f.ticker).slice(0, 6).join(' · ') + (funds.length > 6 ? ' …' : '')) +
        '</div>' +
        A.panel('Net Flows', 'Daily net inflow/outflow (USD) with price overlay', '<div class="cg2-pb" data-chart="flow"></div>') +
        '<div class="cg2-grid cg2-grid-side">' +
        A.panel('Cumulative Net Flow', 'since launch · USD', '<div class="cg2-pb" data-chart="cum"></div>') +
        A.panel('Grayscale Holdings', 'Trust holdings &amp; premium/discount', '<div class="cg2-pb tight" data-gs></div>') +
        '</div>' +
        A.panel((isBtc ? 'Bitcoin' : 'Ethereum') + ' ETF Funds', 'Per-fund AUM, holdings and daily change', '<div class="cg2-pb tight" data-funds></div>');
      const daily = { stepH: 24, keepStep: true }; const livePx = isBtc ? CG.ASSETS.BTC.price : CG.ASSETS.ETH.price;
      A.tfChart(main.querySelector('[data-chart="flow"]'), 'flow', st, { options: ['7D', '30D', '90D', '1Y'], def: '30D' }, (tf) => { const T = A.tfSeries('etf-flow:' + st.asset, tf, Object.assign({ values: flows.map((p) => p.flow), iid: (rr, mean) => (rr() - 0.42) * mean * 2.4 }, daily)); const P = A.tfSeries('etf-px:' + st.asset, tf, Object.assign({ values: flows.map((p) => p.price), end: livePx }, daily)); return { h: 240, rightAxis: true, x: T.x, xTip: T.xTip, series: [{ type: 'bar', label: 'Net flow', data: T.v.map(Math.round), color: C.up, colorNeg: C.down, legendColor: C.up, fmt: (v) => (v >= 0 ? '+' : '-') + F.usdCompact(Math.abs(v)) }, { type: 'line', label: 'Price', axis: 'r', data: P.v, color: C.fg, fmt: (v) => '$' + F.num(v, 0) }], yFmt: (v) => F.usdCompact(v), y2Fmt: (v) => '$' + F.compact(v) }; });
      A.tfChart(main.querySelector('[data-chart="cum"]'), 'cum', st, { options: ['30D', '90D', '1Y'], def: '30D' }, (tf) => { const T = A.tfSeries('etf-cum:' + st.asset, tf, Object.assign({ values: flows.map((p) => p.cumulative), volMult: 0.6 }, daily)); return { h: 200, x: T.x, xTip: T.xTip, series: [{ type: 'area', label: 'Cumulative', data: T.v, color: C.curve, fmt: F.usdCompact }], yFmt: F.usdCompact }; });
      const gs = M.etfs.filter((f) => f.issuer === 'Grayscale').map((f) => ({ asset: f.ticker + ' · ' + f.fund, holdings: f.btcHeld, unit: 'BTC', value: f.btcHeld * CG.ASSETS.BTC.price, premium: f.premium, chg30: f.chg30 })).concat(M.ethEtfs.filter((f) => f.issuer === 'Grayscale').map((f) => ({ asset: f.ticker + ' · ' + f.fund, holdings: f.ethHeld, unit: 'ETH', value: f.ethHeld * CG.ASSETS.ETH.price, premium: f.premium, chg30: f.chg30 })));
      A.table(main.querySelector('[data-gs]'), { key: 'gs', rows: gs, cols: [{ key: 'asset', label: 'Asset', render: (r) => '<b>' + CG.esc(r.asset.split(' · ')[0]) + '</b> <span class="cg2-dim">' + CG.esc(r.asset.split(' · ')[1]) + '</span>' }, { key: 'holdings', label: 'Holdings', align: 'r', render: (r) => F.int(r.holdings) + ' ' + r.unit }, { key: 'value', label: 'Value', align: 'r', render: (r) => F.usdCompact(r.value) }, { key: 'premium', label: 'Premium', align: 'r', render: (r) => A.heat(r.premium, { max: 0.5 }) }, { key: 'chg30', label: 'Δ 30d', align: 'r', render: (r) => A.heat(r.chg30, { max: 10 }) }] });
      A.table(main.querySelector('[data-funds]'), { key: 'funds-' + st.asset, rows: funds, sortKey: 'aum', csv: 'etf-funds-' + st.asset, columns: true, cols: [{ key: 'ticker', label: 'Ticker', render: (r) => '<b class="mono">' + r.ticker + '</b>' }, { key: 'fund', label: 'Fund', render: (r) => CG.esc(r.fund) + ' <span class="cg2-dim">· ' + CG.esc(r.issuer) + '</span>' }, { key: 'type', label: 'Type', align: 'c', render: (r) => '<span class="cg2-badge accent">' + r.type + '</span>' }, { key: 'price', label: 'Price', align: 'r', sortVal: (r) => etfPrice(r.ticker), render: (r) => '$' + F.num(etfPrice(r.ticker), 2) }, { key: 'chg24', label: '24h %', align: 'r', render: (r) => A.heat(r.chg24, { max: 4 }) }, { key: 'volume24h', label: 'Volume', align: 'r', render: (r) => F.usdCompact(r.volume24h) }, { key: 'aum', label: 'AUM', align: 'r', render: (r) => F.usdCompact(r.aum) }, { key: 'hold', label: 'Holdings', align: 'r', sortVal: (r) => r.btcHeld || r.ethHeld, render: (r) => F.int(r.btcHeld || r.ethHeld) + ' ' + unit }, { key: 'hold24', label: 'Δ 24h', align: 'r', sortVal: (r) => r.hold24 != null ? r.hold24 : Math.round(r.flow1d / (isBtc ? 79521 : 2447)), render: (r) => { const v = r.hold24 != null ? r.hold24 : Math.round(r.flow1d / (isBtc ? 79521 : 2447)); return '<span class="' + A.cls(v) + '">' + (v >= 0 ? '+' : '') + F.int(v) + ' ' + unit + '</span>'; } }] });
      main.onclick = (e) => { const b = e.target.closest('[data-asset]'); if (b) { st.asset = b.dataset.asset; A.current && A.current(); } };
    }
  });
})();
</script>
