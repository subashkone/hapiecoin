// ---------- product tour (driver.js-like) ----------
const TOUR_STEPS = [
  { title: 'Welcome to HapieCoin', desc: "Let's place a real paper trade together — from picking legs to stopping the trade. Skip anytime; replay later from Settings → Take a tour.", next: 'Start' },
  { target: 'asset-select', title: 'Choose your asset', desc: 'Switch between BTC, ETH and XAUT. The live futures price, ATM IV and expected move update here in real time.' },
  { target: 'options-chain', title: 'Your workspaces', desc: 'Option Chain shows live strikes. Builder creates strategies. Paper and Live manage your trades, and Templates stores ready-made setups.', tab: 'options-chain' },
  { target: 'options-chain', title: 'Add a leg — try it now', desc: 'Click any Call or Put price in the chain to add it as a leg (or press B / S on the highlighted strike). The tour moves on as soon as your first leg is added.', tab: 'options-chain', waitFor: 'cg-tour:leg-added' },
  { target: 'strategy-legs', alt: 'add-leg-button', title: 'Your strategy legs', desc: 'Here is the leg you just added. Adjust side (Buy/Sell), strike, expiry and quantity — add more legs for multi-leg strategies. Press Next when it looks right.', tab: 'builder' },
  { target: 'payoff-panel', title: 'Payoff and analytics', desc: 'See the payoff diagram, max profit, max loss and breakevens for the strategy you are building.' },
  { target: 'paper-trade-button', title: 'Start a paper trade', desc: 'Click Paper Trade to begin — virtual funds only, no real money.', waitFor: 'cg-tour:save-dialog-open' },
  { target: 'save-dialog', alt: 'save-button', title: 'Name your strategy', desc: "Give the trade a name you'll recognise in the list, then press Save.", waitFor: 'cg-tour:trade-modal-open' },
  { target: 'trade-modal', alt: 'trade-confirm-button', title: 'Review and start', desc: 'Check the order preview — legs, net premium and required margin — then click Start Paper Trade.', waitFor: 'cg-tour:paper-started' },
  { target: 'paper-tab', title: 'Your trade is running', desc: 'Every paper trade lives in the Paper tab — including the one you just started.', tab: 'paper' },
  { target: 'paper-pnl', title: 'Track P&L and details', desc: 'Total P&L updates live as the market moves. Click the trade card to open full details — per-leg P&L, payoff chart and history.', tab: 'paper' },
  { target: 'paper-stop', title: 'Stop a paper trade', desc: 'Use Stop on the trade card to square off every open leg at the current price and move the trade to your archive.', tab: 'paper' },
  { target: 'settings-menu', title: 'Settings', desc: 'Manage your profile, subscription, API settings, alerts, density and preferences here. Replay this tour anytime from this menu.' },
  { target: 'chat-launcher', title: 'Ask the HapieCoin Assistant', desc: 'Stuck anywhere? Click this chat button to ask about strategies, options concepts or how a screen works — or use “Explain this strategy” for a summary of your current legs. You can drag the button anywhere on the page.' },
  { target: 'command-palette', title: 'Command palette', desc: 'Press Ctrl K (⌘ K on Mac) anywhere to jump to any screen, switch asset, toggle theme or density, create an alert or log out — just start typing. Press ? for the full list of keyboard shortcuts.' }
];
CH.TOUR_STEPS = TOUR_STEPS;
let tour = null;
const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
function findTarget(step) { if (!step.target) return null; const sel = (k) => CG.$$('[data-tour="' + k + '"]').find(visible) || null; return sel(step.target) || (step.alt ? sel(step.alt) : null); }
function makeTour() {
  const ov = h('<div class="cgc-tour"><svg><defs><mask id="cgc-tour-mask"><rect width="100%" height="100%" fill="#fff"/><rect data-hole x="0" y="0" width="0" height="0" rx="4" fill="#000"/></mask></defs><rect width="100%" height="100%" fill="rgba(4,6,10,.66)" mask="url(#cgc-tour-mask)"/></svg></div>');
  const ring = h('<div class="cgc-tour-ring" hidden></div>');
  const pop = h('<div class="cgc-tour-pop" role="dialog" aria-live="polite"><button class="cgc-tour-x" aria-label="Close" data-close>' + I('x', 14) + '</button><h4 data-title></h4><p data-desc></p><div class="cgc-tour-foot"><span class="cgc-tour-prog" data-prog></span><button class="btn btn-outline btn-sm" data-prev>Previous</button><button class="btn btn-primary btn-sm" data-next>Next</button></div><div class="cgc-tour-arrow" data-arrow hidden></div></div>');
  document.body.append(ov, ring, pop);
  const N = TOUR_STEPS.length; let idx = 0, unsubWait = null, placeT = null, unsubRoute = null;
  const hole = ov.querySelector('[data-hole]'), arrow = pop.querySelector('[data-arrow]');
  function place() {
    const step = TOUR_STEPS[idx]; const t = findTarget(step);
    if (t) {
      try { t.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { }
      const r = t.getBoundingClientRect(); const pad = 6; const x = r.left - pad, y = r.top - pad, w = r.width + pad * 2, hh = r.height + pad * 2;
      hole.setAttribute('x', x); hole.setAttribute('y', y); hole.setAttribute('width', w); hole.setAttribute('height', hh);
      ring.hidden = false; Object.assign(ring.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
      const pw = pop.offsetWidth, ph = pop.offsetHeight; let left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)); let top, below = true;
      if (r.bottom + 14 + ph <= window.innerHeight - 8) top = r.bottom + 14; else if (r.top - 14 - ph >= 8) { top = r.top - 14 - ph; below = false; } else { top = Math.max(8, Math.min(r.top, window.innerHeight - ph - 8)); left = r.right + 14 + pw <= window.innerWidth ? r.right + 14 : Math.max(8, r.left - pw - 14); arrow.hidden = true; }
      if (r.bottom + 14 + ph <= window.innerHeight - 8 || r.top - 14 - ph >= 8) { arrow.hidden = false; arrow.className = 'cgc-tour-arrow' + (below ? '' : ' bottom'); arrow.style.left = Math.max(12, Math.min(r.left + r.width / 2 - left - 6, pw - 24)) + 'px'; arrow.style.top = below ? '-7px' : 'auto'; arrow.style.bottom = below ? 'auto' : '-7px'; }
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    } else {
      hole.setAttribute('width', 0); hole.setAttribute('height', 0); ring.hidden = true; arrow.hidden = true;
      pop.style.left = Math.max(8, (window.innerWidth - pop.offsetWidth) / 2) + 'px'; pop.style.top = Math.max(8, (window.innerHeight - pop.offsetHeight) / 2) + 'px';
    }
  }
  function render() {
    const step = TOUR_STEPS[idx];
    pop.querySelector('[data-title]').textContent = step.title; pop.querySelector('[data-desc]').textContent = step.desc; pop.querySelector('[data-prog]').textContent = (idx + 1) + ' / ' + N;
    const prev = pop.querySelector('[data-prev]'), next = pop.querySelector('[data-next]'); prev.disabled = idx === 0; prev.hidden = idx === 0; next.textContent = idx === N - 1 ? 'Done' : step.next || 'Next';
    if (unsubWait) { unsubWait(); unsubWait = null; }
    if (step.waitFor) unsubWait = CG.on(step.waitFor, () => T.go(idx + 1));
    CG.emit('tour-step', { index: idx, target: step.target || null, tab: step.tab || null, title: step.title });
    place(); clearTimeout(placeT); placeT = setTimeout(place, 180);
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); T.destroy(); } else if (e.key === 'ArrowRight') T.go(idx + 1); else if (e.key === 'ArrowLeft') T.go(idx - 1); };
  const onResize = () => place();
  const T = {
    go(i) { if (i < 0) return; if (i >= N) return T.finish(); idx = i; render(); },
    finish() { T.destroy(); CG.emit('tour-end', { completed: true }); CG.toast({ title: 'Tour complete', description: 'Replay it anytime from Settings → Take a tour, or press Ctrl K and type “tour”.', variant: 'success' }); },
    destroy() { if (unsubWait) unsubWait(); if (unsubRoute) unsubRoute(); clearTimeout(placeT); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true); ov.remove(); ring.remove(); pop.remove(); if (tour === T) tour = null; CG.emit('tour-end', { completed: false }); },
    get index() { return idx; }
  };
  pop.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) T.destroy(); else if (e.target.closest('[data-prev]')) T.go(idx - 1); else if (e.target.closest('[data-next]')) T.go(idx + 1); });
  document.addEventListener('keydown', onKey, true); window.addEventListener('resize', onResize); window.addEventListener('scroll', onResize, true);
  unsubRoute = CG.on('route', (c) => { if (c && c.path !== '/analyse' && CG.$('section.screen[data-route="/analyse"]')) T.destroy(); });
  return T;
}
CH.startTour = function () {
  if (tour) tour.destroy();
  const hasAnalyse = !!CG.$('section.screen[data-route="/analyse"]');
  if (hasAnalyse && (CG.current.path || '') !== '/analyse') { const un = CG.on('route', (c) => { if (c.path === '/analyse') { un(); setTimeout(() => CH.startTour(), 450); } }); CG.navigate('/analyse'); return null; }
  CG.modal.closeAll(); CG.menu.closeAll(); if (CG.palette) CG.palette.close();
  tour = makeTour(); tour.go(0); return tour;
};
CH.autoTour = function () { if (st.tourDone) return; st.tourDone = true; CG.saveState(); CH.startTour(); };
CH.tourActive = () => !!tour;
CH.tourNext = () => { if (tour) tour.go(tour.index + 1); };
