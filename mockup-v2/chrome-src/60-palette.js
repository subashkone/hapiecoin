// ---------- command palette · CG.palette ----------
PATHS.history = 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2';
const PAL = (CG.palette = {});
const palRegistry = new Map();
const PAL_GROUPS = ['Recent', 'Navigate', 'Actions', 'Settings'];
const PAL_ICON = { Navigate: 'arrow', Actions: 'command', Settings: 'gear', Recent: 'history' };
PAL.register = function (cmd) {
  if (!cmd || !cmd.id || !cmd.label) throw new Error('CG.palette.register({id,label,group,keywords,hint,run})');
  const kw = Array.isArray(cmd.keywords) ? cmd.keywords : typeof cmd.keywords === 'string' ? cmd.keywords.split(/[,;|]+|\s{2,}/) : [];
  palRegistry.set(String(cmd.id), Object.assign({ group: 'Actions', hint: '' }, cmd, { id: String(cmd.id), label: String(cmd.label), group: String(cmd.group || 'Actions'), keywords: kw.map((k) => String(k).trim()).filter(Boolean), run: typeof cmd.run === 'function' ? cmd.run : () => CG.toast({ title: String(cmd.label) }) })); if (pal.open) palRender();
  return () => PAL.unregister(cmd.id);
};
PAL.unregister = (id) => { palRegistry.delete(id); if (pal.open) palRender(); };
PAL.list = () => Array.from(palRegistry.values());
PAL.get = (id) => palRegistry.get(id);
const pal = { open: false, ov: null, input: null, list: null, items: [], active: 0, query: '' };
PAL.isOpen = () => pal.open;
// ---- fuzzy matching ----
function palFuzzy(q, text) {
  const t = String(text || '').toLowerCase(); if (!q) return 1; if (!t) return -1;
  const idx = t.indexOf(q); if (idx >= 0) return 120 - Math.min(idx, 40) * 0.8 + (idx === 0 || /[\s·/→(-]/.test(t[idx - 1]) ? 15 : 0) - Math.min(t.length - q.length, 60) * 0.05;
  let score = 0, qi = 0, streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) { if (t[ti] === q[qi]) { score += 2 + streak * 2 + (ti === 0 || /[\s·/→(-]/.test(t[ti - 1]) ? 4 : 0); streak++; qi++; } else streak = 0; }
  return qi === q.length ? score : -1;
}
const palHint = (c) => { try { const v = typeof c.hint === 'function' ? c.hint() : c.hint; return v == null ? '' : String(v); } catch (e) { return ''; } };
function palScore(cmd, q) { try { let best = palFuzzy(q, cmd.label); (Array.isArray(cmd.keywords) ? cmd.keywords : []).forEach((k) => { best = Math.max(best, palFuzzy(q, k) * 0.85); }); best = Math.max(best, palFuzzy(q, cmd.group) * 0.5, palFuzzy(q, palHint(cmd)) * 0.6); return best; } catch (e) { return -1; } }
function palHighlight(label, q) {
  if (!q) return esc(label); const t = label.toLowerCase(); const idx = t.indexOf(q);
  if (idx >= 0) return esc(label.slice(0, idx)) + '<mark>' + esc(label.slice(idx, idx + q.length)) + '</mark>' + esc(label.slice(idx + q.length));
  let out = '', qi = 0; for (let i = 0; i < label.length; i++) { if (qi < q.length && t[i] === q[qi]) { out += '<mark>' + esc(label[i]) + '</mark>'; qi++; } else out += esc(label[i]); } return out;
}
const palVisible = (cmd) => { try { return typeof cmd.when === 'function' ? !!cmd.when() : true; } catch (e) { return false; } };
function palCompute() {
  const q = pal.query.trim().toLowerCase(); const all = PAL.list().filter(palVisible); const groups = {};
  if (!q) {
    const recent = (st.recentCommands || []).map((id) => palRegistry.get(id)).filter((c) => c && palVisible(c));
    if (recent.length) groups.Recent = recent.map((c) => ({ cmd: c, score: 0 }));
    all.forEach((c) => { (groups[c.group] = groups[c.group] || []).push({ cmd: c, score: 0 }); });
  } else {
    all.forEach((c) => { const s = palScore(c, q); if (s > 0) (groups[c.group] = groups[c.group] || []).push({ cmd: c, score: s }); });
    Object.keys(groups).forEach((g) => groups[g].sort((a, b) => b.score - a.score));
  }
  const order = PAL_GROUPS.concat(Object.keys(groups).filter((g) => !PAL_GROUPS.includes(g)));
  const items = []; order.forEach((g) => { if (!groups[g] || !groups[g].length) return; groups[g].forEach((x, i) => items.push({ cmd: x.cmd, group: g, first: i === 0 })); });
  if (q) { // when searching, surface the best hit first regardless of group
    let bi = 0, bs = -1; items.forEach((it, i) => { const s = palScore(it.cmd, q); if (s > bs) { bs = s; bi = i; } });
    if (bi > 0) { const top = items.splice(bi, 1)[0]; items.unshift(Object.assign({}, top, { group: 'Best match', first: true })); if (items[1] && items[1].group === top.group) items[1].first = items.slice(1).find((x) => x.group === top.group) === items[1]; }
  }
  return items;
}
function palRender() {
  if (!pal.open) return; pal.items = palCompute(); pal.active = Math.max(0, Math.min(pal.active, pal.items.length - 1)); const q = pal.query.trim().toLowerCase();
  if (!pal.items.length) { pal.list.innerHTML = '<div class="cgc-pal-empty">No commands match “' + esc(pal.query) + '”.<br><span class="text-2xs">Try a screen name, “alert”, “theme”, “density”, “BTC”…</span></div>'; return; }
  let html = ''; pal.items.forEach((it, i) => { if (it.first) html += '<div class="cgc-pal-grp">' + esc(it.group) + '</div>'; const c = it.cmd; html += '<div class="cgc-pal-item ' + (i === pal.active ? 'active' : '') + '" data-i="' + i + '" role="option" aria-selected="' + (i === pal.active) + '">' + I(c.icon || PAL_ICON[c.group] || 'command') + '<span class="lbl">' + palHighlight(c.label, q) + '</span>' + (palHint(c) ? '<span class="hint">' + esc(palHint(c)) + '</span>' : '') + (c.kbd ? '<kbd class="kbd">' + esc(c.kbd) + '</kbd>' : '') + '</div>'; });
  pal.list.innerHTML = html; palScrollActive();
}
function palScrollActive() { const el = pal.list && pal.list.querySelector('.cgc-pal-item.active'); if (el) { const r = el.getBoundingClientRect(), lr = pal.list.getBoundingClientRect(); if (r.top < lr.top) pal.list.scrollTop -= lr.top - r.top; else if (r.bottom > lr.bottom) pal.list.scrollTop += r.bottom - lr.bottom; } }
function palSetActive(i) { if (!pal.items.length) return; pal.active = (i + pal.items.length) % pal.items.length; CG.$$('.cgc-pal-item', pal.list).forEach((el) => { const on = +el.dataset.i === pal.active; el.classList.toggle('active', on); el.setAttribute('aria-selected', on); }); palScrollActive(); }
PAL.run = function (id) {
  const c = palRegistry.get(id); if (!c) return false;
  st.recentCommands = [id].concat((st.recentCommands || []).filter((x) => x !== id)).slice(0, 5); CG.saveState();
  PAL.close(); try { c.run(); } catch (e) { console.error('palette command', id, e); CG.toast({ title: 'Command failed', description: String(e.message || e), variant: 'destructive' }); }
  CG.emit('palette:run', { id, label: c.label }); return true;
};
PAL.open = function (query) {
  if (pal.open) { if (query != null) { pal.input.value = query; pal.query = query; pal.active = 0; palRender(); } pal.input.focus(); return; }
  CG.menu.closeAll(); palDiscoverRoutes();
  const ov = h('<div class="cgc-pal-ov" role="dialog" aria-modal="true" aria-label="Command palette"><div class="cgc-pal"><div class="cgc-pal-in">' + I('search') + '<input type="text" placeholder="Type a command or search…" aria-label="Search commands" spellcheck="false" autocomplete="off"><kbd class="kbd">Esc</kbd></div><div class="cgc-pal-list" role="listbox"></div><div class="cgc-pal-foot"><span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> navigate</span><span><kbd class="kbd">↵</kbd> run</span><span><kbd class="kbd">Esc</kbd> close</span><span style="margin-left:auto" class="mono">' + palRegistry.size + ' commands</span></div></div></div>');
  document.body.appendChild(ov); pal.ov = ov; pal.input = ov.querySelector('input'); pal.list = ov.querySelector('.cgc-pal-list'); pal.open = true; pal.query = query || ''; pal.active = 0; pal.input.value = pal.query;
  palRender(); pal.input.focus();
  pal.input.addEventListener('input', () => { pal.query = pal.input.value; pal.active = 0; palRender(); });
  pal.input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); palSetActive(pal.active + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); palSetActive(pal.active - 1); } else if (e.key === 'Enter') { e.preventDefault(); const it = pal.items[pal.active]; if (it) PAL.run(it.cmd.id); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); PAL.close(); } else if (e.key === 'Tab') { e.preventDefault(); palSetActive(pal.active + (e.shiftKey ? -1 : 1)); } });
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) PAL.close(); });
  pal.list.addEventListener('mousemove', (e) => { const it = e.target.closest('.cgc-pal-item'); if (it && +it.dataset.i !== pal.active) palSetActive(+it.dataset.i); });
  pal.list.addEventListener('click', (e) => { const it = e.target.closest('.cgc-pal-item'); if (it) { const x = pal.items[+it.dataset.i]; if (x) PAL.run(x.cmd.id); } });
  CG.emit('palette:open');
};
PAL.close = function () { if (!pal.open) return; pal.ov.remove(); pal.ov = null; pal.open = false; pal.items = []; CG.emit('palette:close'); };
PAL.toggle = (q) => (pal.open ? PAL.close() : PAL.open(q));
// ---- default registry ----
const loggedIn = () => !!st.loggedIn, isAdmin = () => CG.auth.isAdmin(), notLogged = () => !st.loggedIn;
const nav = (id, path, label, keywords, when, hint) => PAL.register({ id, group: 'Navigate', label, keywords: keywords || [], hint: hint || path, when, run: () => CG.navigate(path) });
nav('nav:home', '/', 'Home', ['landing', 'public', 'website']);
nav('nav:auth', '/auth', 'Sign in', ['login', 'signup', 'register', 'otp', 'password'], notLogged);
nav('nav:analyse', '/analyse', 'Analyse workspace', ['options chain', 'builder', 'payoff', 'strategy', 'paper', 'live', 'greeks', 'scenarios'], loggedIn);
nav('nav:subscription', '/subscription', 'My Subscription', ['plan', 'billing', 'upgrade', 'renew', 'payments', 'coupon'], loggedIn);
nav('nav:referrals', '/referrals', 'My Referrals', ['referral code', 'commission', 'earnings'], loggedIn);
[['users', 'Users', ['user management', 'members']], ['subscriptions', 'Subscription Plans', ['plans', 'pricing']], ['menu-pricing', 'Menu Pricing', ['features', 'menu items']], ['coupons', 'Coupon Codes', ['discount', 'promo']], ['user-subscriptions', 'User Subscriptions', ['assign plan']], ['banners', 'Banners', ['flyers', 'popups', 'announcements']], ['emails', 'Promotional Emails', ['campaign', 'newsletter']]].forEach(([k, label, kw]) => nav('nav:admin:' + k, '/admin/' + k, 'Admin · ' + label, kw.concat(['admin']), isAdmin));
[['coinglass', 'Markets Hub', ['coinglass', 'overview']], ['overview', 'Futures', ['open interest', 'volume']], ['liquidations', 'Liquidations', ['liq', 'long short']], ['derivatives', 'Derivatives', ['funding', 'oi']], ['options', 'Options', ['options oi', 'max pain', 'expiries']], ['etf', 'ETF', ['bitcoin etf', 'flows', 'ibit']], ['whales', 'Whales', ['whale alerts', 'large orders']], ['sentiment', 'Sentiment', ['fear greed', 'index']], ['markets', 'Futures Markets Screener', ['screener', 'coins', 'rsi']], ['coin/BTC', 'Coin · BTC', ['bitcoin coin page']]].forEach(([k, label, kw]) => nav('nav:analytics:' + k, '/analytics/' + k, 'Market Analytics · ' + label, kw.concat(['analytics', 'market']), loggedIn));
[['', 'Terminal home', ['dashboard']], ['coin/BTC', 'Coin · BTC', ['bitcoin']], ['derivatives/funding', 'Funding Rates', ['funding']], ['derivatives/liquidations', 'Liquidations', ['liq']], ['derivatives/long-short', 'Long / Short', ['ratio']], ['derivatives/open-interest', 'Open Interest', ['oi']], ['etf', 'Bitcoin Spot ETFs', ['etf', 'flows']], ['exchanges/Binance', 'Exchange overview · Binance', ['exchanges']], ['indicators/cycle', 'BTC Cycle Indicators', ['ahr999', 'puell', 'pi cycle']], ['indicators/fear-greed', 'Fear & Greed Index', ['sentiment']], ['onchain/exchange-balance', 'Exchange Balance', ['onchain', 'reserves']], ['onchain/unlocks', 'Token Unlock Schedule', ['unlocks', 'vesting']], ['sectors/layer-1', 'Sectors · Layer 1', ['sectors', 'defi', 'memes']], ['spot', 'Spot Markets', ['spot']]].forEach(([k, label, kw]) => nav('nav:terminal:' + (k || 'home'), '/terminal' + (k ? '/' + k : ''), 'Terminal · ' + label, kw.concat(['terminal']), loggedIn));
nav('nav:features', '/features', 'Feature inventory', ['features', 'inventory', 'qa', 'status']);
nav('nav:payoff-preview', '/payoff-preview', 'Payoff chart preview', ['chart', 'preview', 'demo']);
nav('nav:privacy', '/privacy', 'Privacy Policy', ['legal']); nav('nav:terms', '/terms', 'Terms of Service', ['legal']); nav('nav:disclaimer', '/disclaimer', 'Disclaimer', ['legal', 'risk']);
Object.values(CG.ASSETS).forEach((A) => PAL.register({ id: 'asset:' + A.symbol, group: 'Actions', label: 'Switch asset → ' + A.symbol, keywords: [A.name, 'asset', 'switch', 'coin'], hint: A.name, icon: 'layers', run: () => { CH.setAsset(A.symbol); if ((CG.current.path || '') !== '/analyse' && st.loggedIn) CG.navigate('/analyse'); } }));
PAL.register({ id: 'act:theme', group: 'Actions', label: 'Toggle theme', keywords: ['dark', 'light', 'mode', 'appearance'], kbd: 'T', icon: 'moon', run: () => CG.theme.toggle() });
PAL.register({ id: 'act:density', group: 'Actions', label: 'Toggle density', keywords: ['compact', 'comfortable', 'rows', 'dense'], kbd: 'D', icon: 'rows', run: () => CH.toggleDensity() });
PAL.register({ id: 'act:new-alert', group: 'Actions', label: 'New alert…', keywords: ['alert', 'price', 'notify', 'iv rank', 'pnl', 'telegram', 'push', 'email'], icon: 'bell', when: loggedIn, run: () => CG.alerts && CG.alerts.openNew() });
PAL.register({ id: 'act:alerts', group: 'Actions', label: 'Alerts center', keywords: ['alerts', 'armed', 'triggered', 'bell'], icon: 'bell', when: loggedIn, run: () => CG.alerts && CG.alerts.open() });
PAL.register({ id: 'act:tour', group: 'Actions', label: 'Take a tour', keywords: ['help', 'onboarding', 'guide', 'walkthrough'], icon: 'help', when: loggedIn, run: () => CH.startTour() });
PAL.register({ id: 'act:shortcuts', group: 'Actions', label: 'Keyboard shortcuts', keywords: ['keys', 'hotkeys', 'help', '?'], kbd: '?', icon: 'keyboard', run: () => CG.shortcuts && CG.shortcuts.open() });
PAL.register({ id: 'act:explain', group: 'Actions', label: 'Explain this strategy', keywords: ['assistant', 'summary', 'legs', 'max profit', 'breakeven', 'pop'], icon: 'sparkles', when: () => loggedIn() && (CG.current.path || '') === '/analyse', run: () => CH.askAssistant('Explain this strategy') });
PAL.register({ id: 'act:assistant', group: 'Actions', label: 'Ask the assistant', keywords: ['chat', 'help', 'support', 'question'], icon: 'chat', run: () => CH.openAssistant() });
PAL.register({ id: 'act:flyers', group: 'Actions', label: 'Show announcements', keywords: ['flyers', 'banners', 'popup', 'offers'], icon: 'image', when: loggedIn, run: () => CH.showFlyers() });
PAL.register({ id: 'act:feed', group: 'Actions', label: 'Pause / resume live feed', keywords: ['live', 'feed', 'prices', 'websocket', 'pause', 'connect'], icon: 'wifi', when: loggedIn, run: () => { const H = headers.find((x) => x.variant === 'analyse'); if (H) headerAction(H, 'live', null); else { st.liveFeed = !st.liveFeed; CG.saveState(); CG.emit('live-feed', st.liveFeed); CG.toast({ title: st.liveFeed ? 'Feed live' : 'Feed paused' }); } } });
PAL.register({ id: 'act:logout', group: 'Actions', label: 'Logout', keywords: ['sign out', 'log out', 'exit'], icon: 'logout', when: loggedIn, run: () => CH.confirmLogout() });
[['api', 'Open API Settings', ['delta exchange', 'api key', 'secret', 'connect', 'whitelist'], 'key'], ['currency', 'Open Currency Settings', ['usd', 'inr', 'conversion rate', 'rupee'], 'dollar'], ['lot', 'Open Lot Size Settings', ['lot', 'contract size', 'quantity'], 'layers'], ['pnl', 'Open P&L Settings', ['mark', 'bid ask', 'basis', 'executable'], 'percent'], ['exchanges', 'Open Exchange Setup', ['brokers', 'fees', 'gst', 'exchange management'], 'plug'], ['profile', 'Open Profile', ['account', 'avatar', 'name', 'mobile', 'referral code'], 'user']].forEach(([k, label, kw, icon]) => PAL.register({ id: 'set:' + k, group: 'Settings', label, keywords: kw.concat(['settings']), icon, when: loggedIn, run: () => CH.openSettings(k) }));
PAL.register({ id: 'set:currency-toggle', group: 'Settings', label: 'Display currency → ' + (st.currency === 'INR' ? 'USD' : 'INR'), keywords: ['currency', 'inr', 'usd', 'toggle'], icon: 'dollar', when: loggedIn, run: () => { CH.toggleCurrency(); const c = palRegistry.get('set:currency-toggle'); if (c) c.label = 'Display currency → ' + (st.currency === 'INR' ? 'USD' : 'INR'); } });
// auto-discover any static screen other parts registered (labels from data-title)
function palDiscoverRoutes() {
  const known = new Set(PAL.list().filter((c) => c.group === 'Navigate').map(palHint));
  CG.$$('section.screen[data-route][data-title]').forEach((sec) => { const r = sec.dataset.route; if (!r || r === '*' || r.includes(':') || sec.dataset.redirect || known.has(r) || palRegistry.has('nav:auto:' + r)) return; const auth = sec.dataset.auth; PAL.register({ id: 'nav:auto:' + r, group: 'Navigate', label: sec.dataset.title.replace(/&amp;/g, '&'), keywords: r.split('/').filter(Boolean), hint: r, when: auth === 'admin' ? isAdmin : auth === 'user' ? loggedIn : undefined, run: () => CG.navigate(r) }); });
}
