  // ======================================================================
  // INIT / REGISTER
  // ======================================================================
  const PANELS = ['strategy', 'paper', 'live', 'journal'];
  function moveOrToggle(name) { const target = name === 'chain' ? null : S.panels[name]; if (!S.selfManaged) return; const cont = S.root.querySelector('#analyse-left-panels') || S.root; CG.$$('.lp-panel', cont).forEach((p) => { p.hidden = p.dataset.tab !== name; }); CG.$$('[data-trd-tab]', S.root).forEach((b) => b.classList.toggle('active', b.dataset.trdTab === name)); if (target) target.hidden = false; }
  function placePanels(root) { const holder = document.getElementById('analyse-trading-holder'); const cont = root.querySelector('#analyse-left-panels'); const dest = cont || root; PANELS.forEach((k) => { const p = S.panels[k] || (holder && holder.querySelector('.lp-panel[data-tab="' + k + '"]')) || document.querySelector('.trd-panel[data-tab="' + k + '"]'); if (!p) return; S.panels[k] = p; if (p.parentNode !== dest) dest.appendChild(p); }); S.selfManaged = !cont || !!root.hasAttribute('data-trd-fallback'); if (holder && !holder.children.length) holder.remove(); }
  function tickPanels(pf) {
    ['paper', 'live'].forEach((k) => {
      const el = S.els[k]; if (!el || (S.panels[k] && S.panels[k].hidden)) return; const st = k === 'paper' ? 'PAPER' : 'LIVE'; const mine = pf.byStrategy.filter((x) => x.status === st);
      mine.forEach((x) => { const set = (sel, v) => { const n = el.querySelector(sel); if (n) { n.className = n.className.replace(/text-(profit|loss)/g, '').trim() + ' ' + pnlClass(v); n.textContent = smoney(v); } }; set('[data-pnl="' + x.id + '"]', x.pnl); set('[data-upnl="' + x.id + '"]', x.unrealized); set('[data-rpnl="' + x.id + '"]', x.realized); });
      const sum = (key) => mine.reduce((a, x) => a + x[key], 0); const put = (sel, txt, cls) => { const n = el.querySelector(sel); if (n) { n.textContent = txt; if (cls) n.className = 'v ' + cls; } };
      put('[data-total]', smoney(sum('pnl')), pnlClass(sum('pnl'))); put('[data-day]', smoney(sum('dayPnl')), pnlClass(sum('dayPnl'))); put('[data-delta]', F.signed(sum('delta'), 4)); put('[data-margin]', money(sum('margin')));
    });
  }
  CG.register('/analyse:trading', {
    init(root) {
      S.root = root; seedLive(); M.strategies.forEach(recalc); placePanels(root);
      S.els.builder = document.getElementById('trd-builder'); S.els.templates = document.getElementById('trd-templates'); S.els.paper = document.getElementById('trd-paper'); S.els.live = document.getElementById('trd-live'); S.els.journal = document.getElementById('trd-journal');
      bindBuilder(); bindTemplates(); bindPaper(); bindLive(); bindJournal();
      CG.delegate(S.panels.strategy, 'click', '[data-trd-subtab]', (e, t) => T.setSubTab(t.dataset.trdSubtab));
      if (root.hasAttribute('data-trd-fallback')) { CG.delegate(root, 'click', '[data-trd-tab]', (e, t) => CG.emit('analyse:set-tab', t.dataset.trdTab)); }
      CG.on('analyse:set-tab', (name) => { if (S.selfManaged) { moveOrToggle(name); CG.emit('analyse:tab', name); } });
      CG.on('analyse:tab', (name) => { if (name === 'paper') renderPaper(); else if (name === 'live') renderLive(); else if (name === 'journal') renderJournal(); else if (name === 'strategy') { if (S.subTab === 'templates') renderTemplates(); else renderBuilder(); } });
      /* chain → builder: the workspace toasts 'Leg Added' itself and falls back to pushing the leg when nobody emits legs-changed, so add silently and always emit */
      CG.on('analyse:addLeg', (leg) => { if (!leg) return; const added = T.addLeg(leg, { silent: true }); if (!added) CG.emit('analyse:legs-changed', AN.legs); });
      /* target price / date from the payoff sliders → ticket "P&L at target" */
      CG.on('analyse:target', () => renderTicket());
      /* density from the chrome part */
      CG.on('density', applyDensity); applyDensity(ST.density);
      CG.on('tick', () => { tickBuilder(); M.strategies.forEach((s) => { if (s.status === 'PAPER' || s.status === 'LIVE') recalc(s); }); const pf = portfolioChanged(); tickPanels(pf); evalLocalAlerts(); });
      /* asset switch: the workspace part may already have set CG.analyse.asset before we run, so compare against the asset the builder legs were built on */
      S.legsAsset = AN.asset;
      CG.on('asset', (sym) => {
        if (!sym || !CG.ASSETS[sym]) return; const cur = S.legsAsset || AN.asset;
        if (sym === cur) { AN.asset = sym; renderBuilder(); renderTemplates(); return; }
        if (!AN.legs.length) { S.legsAsset = sym; AN.asset = sym; renderBuilder(); renderTemplates(); return; }
        if (S.assetPrompt) return; S.assetPrompt = true;
        CG.modal.confirm({ title: 'Switch asset to ' + sym + '?', description: 'Changing the asset will clear the current strategy legs.', confirmText: 'Clear & Switch' }).then((ok) => {
          S.assetPrompt = false;
          if (ok) { S.legsAsset = sym; AN.asset = sym; AN.legs = []; AN.name = ''; S.editing = null; AN.strategyId = null; S.dirty = false; legsChanged(); renderTemplates(); }
          else { ST.asset = cur; CG.saveState(); CG.emit('asset', cur); AN.asset = cur; renderBuilder(); renderTemplates(); }
        });
      });
      const onExpiry = (code) => { if (code && CG.EXPIRIES.includes(code)) { AN.expiry = code; S.tplExpiry = code; if (S.subTab === 'templates') renderTemplates(); } };
      CG.on('expiry', onExpiry); CG.on('analyse:expiry', onExpiry);
      CG.on('currency', () => renderAll()); CG.on('settings', () => renderAll()); CG.on('currency-settings-changed', () => renderAll());
      CG.on('analyse:strategies-changed', () => { if (S.subTab === 'templates') renderTemplates(); T._renderJournal(); });
      registerPalette(); CG.on('palette-ready', registerPalette); CG.on('palette', registerPalette);
      renderAll();
      if (S.selfManaged) moveOrToggle('strategy');
    },
    show(root) { placePanels(root); M.strategies.forEach(recalc); renderAll(); registerPalette(); if (S.selfManaged && PANELS.every((k) => S.panels[k] && S.panels[k].hidden)) moveOrToggle('strategy'); }
  });
  /* keyboard: P = paper trade the current builder strategy (only on /analyse, builder visible, focus outside inputs, no dialog open) */
  document.addEventListener('keydown', (e) => { if (e.key !== 'p' && e.key !== 'P') return; if (e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return; if (!CG.current || CG.current.path !== '/analyse') return; if (!S.panels.strategy || S.panels.strategy.hidden || S.subTab !== 'builder' || !AN.legs.length) return; if (document.querySelector('.cg-overlay')) return; e.preventDefault(); T.beginTrade('paper'); });
  T.render = renderAll; T.refresh = () => { M.strategies.forEach(recalc); renderAll(); };
  T.state = () => ({ analyse: AN, editing: S.editing, dirty: S.dirty, subTab: S.subTab, basket: S.basket, density: S.density, brokerId: S.brokerId, jFilter: S.jFilter, tplOutlook: S.tplOutlook });
  T.setBroker = (id) => { if (brokerOf(id)) { S.brokerId = id; renderTicket(); } };
})();
