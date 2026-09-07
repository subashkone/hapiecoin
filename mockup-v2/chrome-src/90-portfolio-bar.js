// ---------- portfolio bar · CG.chrome['portfolio-bar'] ----------
const pbars = [];
function pbLocal() {
  const open = (M.strategies || []).filter((s) => s.status === 'PAPER' || s.status === 'LIVE');
  const out = { strategies: open.length, paper: open.filter((s) => s.status === 'PAPER').length, live: open.filter((s) => s.status === 'LIVE').length, netDelta: 0, netTheta: 0, netVega: 0, netGamma: 0, margin: 0, dayPnl: 0, openPnl: 0, source: 'chrome' };
  open.forEach((s) => {
    const legs = (s.legs || []).filter((l) => l.status !== 'SQUARED_OFF').map((l) => ({ type: l.type, side: l.side, strike: l.strike, expiry: l.expiry, lots: l.lots, price: l.price, iv: l.iv }));
    if (legs.length) { try { const r = CG.analyze(legs, s.asset); out.netDelta += r.greeks.delta / (r.lot || 1); out.netTheta += r.greeks.theta; out.netVega += r.greeks.vega; out.netGamma += r.greeks.gamma; out.margin += r.margin; } catch (e) { } }
    const hist = s.pnlHistory || []; const total = s.totalPnl != null ? s.totalPnl : (s.realizedPnl || 0) + (s.unrealizedPnl || 0); out.openPnl += total; out.dayPnl += hist.length > 1 ? total - hist[hist.length - 2].pnl : total;
  });
  const W = M.wallet || { available: 1000, marginUsed: 0 }; out.marginUsed = W.marginUsed || out.margin; out.marginTotal = (W.available || 0) + (W.marginUsed || 0);
  return out;
}
function pbData() {
  if (CG.portfolio && typeof CG.portfolio.compute === 'function') { try { const r = CG.portfolio.compute(); if (r) { const d = pbLocal(); return Object.assign(d, r, { source: 'portfolio' }); } } catch (e) { } }
  return pbLocal();
}
CH.portfolioData = pbData;
function pbRender(el) {
  const d = pbData(); const al = CG.alerts ? CG.alerts.counts() : { armed: 0, triggered: 0 };
  const num = (v, dp) => (v >= 0 ? '+' : '-') + F.num(Math.abs(v), dp); const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const pct = d.marginTotal ? Math.max(0, Math.min(100, d.marginUsed / d.marginTotal * 100)) : 0;
  el.innerHTML = '<div class="cgc-pbar" role="status" aria-label="Portfolio summary">' +
    '<button class="si" data-act="portfolio" title="Open paper & live trades"><span class="micro">Portfolio</span><b>' + d.strategies + ' open strateg' + (d.strategies === 1 ? 'y' : 'ies') + '</b>' + (d.live ? '<span class="micro">· ' + d.live + ' live</span>' : '') + '</button>' +
    '<div class="si" title="Σ delta × lots across open strategies"><span class="micro">Net Δ</span><b class="' + cls(d.netDelta) + '">' + num(d.netDelta, 2) + '</b></div>' +
    '<div class="si" title="Daily time decay of all open strategies"><span class="micro">Net Θ/day</span><b class="' + cls(d.netTheta) + '">' + F.signedMoney(d.netTheta) + '</b></div>' +
    '<div class="si opt" title="P&L per 1% change in implied volatility"><span class="micro">Net ν</span><b class="' + cls(d.netVega) + '">' + F.signedMoney(d.netVega) + '</b></div>' +
    '<button class="si" data-act="wallet" title="Margin used of available balance · click for wallet"><span class="micro">Margin used</span><b>' + F.money(d.marginUsed, 0) + ' / ' + F.money(d.marginTotal, 0) + '</b><span class="mbar"><b class="' + (pct > 70 ? 'warn' : '') + '" style="width:' + pct.toFixed(0) + '%"></b></span></button>' +
    '<div class="si" title="Change in open P&L since yesterday"><span class="micro">Day P&L</span><b class="' + cls(d.dayPnl) + '">' + F.signedMoney(d.dayPnl) + '</b></div>' +
    '<button class="si" data-act="alerts" title="Open the alerts center"><span class="micro">Alerts</span><b>' + al.armed + ' armed</b>' + (al.triggered ? '<span class="badge badge-warning">' + al.triggered + ' fired</span>' : '') + '</button>' +
    '<div class="end"><button class="si" data-act="basis" title="P&L price basis · click to change"><span class="micro">Basis</span><b>' + (st.pnlBasis === 'bid_ask' ? 'bid/ask' : 'mark') + '</b></button><button class="si" data-act="ccy" title="Display currency · click to change"><span class="micro">CCY</span><b>' + st.currency + '</b></button></div></div>';
}
function pbAction(act) {
  if (act === 'alerts') return CG.alerts && CG.alerts.open();
  if (act === 'basis') return CH.openSettings('pnl');
  if (act === 'ccy') return CH.openSettings('currency');
  if (act === 'wallet') { const b = CG.$('.cgc-header [data-act="wallet"]'); return b ? CH.openWalletPopover(b) : CH.openSettings('api'); }
  if (act === 'portfolio') { if ((CG.current.path || '') !== '/analyse') CG.navigate('/analyse'); CG.emit('analyse:set-tab', 'paper'); }
}
CH['portfolio-bar'] = function (el) { if (!pbars.includes(el)) { pbars.push(el); el.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && el.contains(b)) pbAction(b.dataset.act); }); } pbRender(el); };
CH.refreshPortfolioBar = () => { for (let i = pbars.length - 1; i >= 0; i--) { if (!pbars[i].isConnected) pbars.splice(i, 1); else pbRender(pbars[i]); } };
['tick', 'portfolio-changed', 'analyse:strategies-changed', 'strategies-changed', 'alerts-changed', 'alert-triggered', 'pnl-basis-changed', 'currency-settings-changed', 'currency', 'lot-sizes-changed', 'broker-balance-changed', 'density'].forEach((ev) => CG.on(ev, CH.refreshPortfolioBar));
// fallback: if the analyse section has no placeholder, dock a fixed bar at the bottom of the workspace
CG.on('route', (cur) => {
  if (!cur || cur.path !== '/analyse') return;
  const sec = CG.$('section.screen[data-route="/analyse"]'); if (!sec) return;
  if (!sec.querySelector('[data-cg="portfolio-bar"]')) { const d = h('<div data-cg="portfolio-bar" class="cgc-pbar-fixed"></div>'); sec.appendChild(d); d.dataset.cgDone = '1'; CH['portfolio-bar'](d, sec); document.documentElement.classList.add('cgc-pbar-fixed-on'); }
});
