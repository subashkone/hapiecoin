// ---------- settings menu ----------
CH.openSettingsMenu = function (anchor) {
  const admin = CG.auth.isAdmin();
  const item = (act, icon, label, val) => '<button class="menu-item" data-act="' + act + '">' + I(icon) + esc(label) + (val ? '<span class="val">' + esc(val) + '</span>' : '') + '</button>';
  const link = (href, icon, label) => '<a class="menu-item" href="#' + href + '">' + I(icon) + esc(label) + '</a>';
  let html = '<div class="menu-label">Account</div>' + item('profile', 'user', 'My Profile') + link('/subscription', 'card', 'My Subscription') + link('/referrals', 'users', 'My Referrals') +
    '<div class="menu-sep"></div><div class="menu-label">Preferences</div>' + item('api', 'key', 'API Settings') + item('currency', 'dollar', 'Currency Settings', st.currency) + item('lot', 'layers', 'Lot Size Settings') + item('pnl', 'percent', 'P&L Settings', st.pnlBasis === 'bid_ask' ? 'bid/ask' : 'mark') + item('exchanges', 'plug', 'Exchange Setup') +
    item('alerts', 'bell', 'Alerts', CG.alerts ? CG.alerts.counts().armed + ' armed' : '') + item('shortcuts', 'keyboard', 'Keyboard shortcuts', '?') + item('density', 'rows', 'Density', st.density === 'compact' ? 'compact' : 'comfortable') + item('palette', 'command', 'Command palette', 'Ctrl K') + link('/analytics', 'chart', 'Market Analytics') + item('tour', 'help', 'Take a tour') + item('theme', CG.theme.get() === 'dark' ? 'sun' : 'moon', themeTitle());
  if (admin) html += '<div class="menu-sep"></div><div class="menu-label">Admin</div>' + link('/admin/subscriptions', 'crown', 'Subscription Plans') + link('/admin/menu-pricing', 'list', 'Menu Pricing') + link('/admin/coupons', 'tag', 'Coupon Codes') + link('/admin/user-subscriptions', 'shield', 'User Subscriptions') + link('/admin/banners', 'image', 'Banners') + link('/admin/emails', 'mail', 'Promotional Emails') + link('/admin/users', 'users', 'Users');
  html += '<div class="menu-sep"></div><div class="menu-label">Support</div><a class="menu-item" href="mailto:support@hapiecoin.com">' + I('mail') + 'Email Us</a><a class="menu-item" href="https://wa.me/919684022369" target="_blank" rel="noopener noreferrer">' + I('whatsapp') + 'WhatsApp Us</a><div class="menu-sep"></div><button class="menu-item danger" data-act="logout">' + I('logout') + 'Logout</button>';
  const m = CG.menu(anchor, html); m.classList.add('cgc-menu');
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) menuAction(b.dataset.act); });
  return m;
};
function menuAction(act) {
  if (act === 'theme') return CG.theme.toggle();
  if (act === 'tour') return CH.startTour();
  if (act === 'logout') return CH.confirmLogout();
  if (act === 'alerts') return CG.alerts && CG.alerts.open();
  if (act === 'shortcuts') return CG.shortcuts && CG.shortcuts.open();
  if (act === 'density') return CH.toggleDensity();
  if (act === 'palette') return CG.palette && CG.palette.open();
  CH.openSettings(act);
}
CH.menuAction = menuAction;
CH.confirmLogout = function () {
  return CG.modal.confirm({ title: 'Confirm Logout', description: "Are you sure you want to sign out? You'll need to sign in again to access your account.", confirmText: 'Logout', variant: 'destructive' }).then((ok) => { if (ok) { CG.auth.logout(); CG.toast({ title: 'Logged out', description: 'You have been signed out.' }); } return ok; });
};
// ---------- settings dialogs ----------
const foot = (primary, extra) => '<div class="cg-dialog-foot">' + (extra || '') + '<button class="btn btn-outline" data-cg-close>Cancel</button><button class="btn btn-primary" data-primary>' + primary + '</button></div>';
const busy = (btn, label, ms) => new Promise((res) => { const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:2px;border-color:rgba(0,0,0,.25);border-top-color:currentColor"></span>' + label; setTimeout(() => { btn.disabled = false; btn.innerHTML = old; res(); }, ms); });
CH.busy = busy;
const DIALOGS = {};
DIALOGS.profile = function () {
  const U = M.user; let editing = false, avatar = U.avatar;
  const el = h('<div><div class="cg-dialog-body">' +
    '<div class="text-center"><div class="cgc-av big sel mx-auto" data-avatar-big title="Tap to change avatar">' + avatarSvg(avatar) + '</div><div class="text-xs text-muted mt-2">Tap to change avatar</div><button class="btn btn-ghost btn-sm mt-1" data-change>Change</button></div>' +
    '<div data-picker hidden><div class="cgc-sect text-center">Choose your avatar</div><div class="cgc-avatars">' + ['rocket', 'diamond', 'lightning'].map((a) => '<div class="cgc-av ' + (a === avatar ? 'sel' : '') + '" data-pick="' + a + '" title="' + a + '">' + avatarSvg(a) + '</div>').join('') + '</div></div>' +
    '<div class="field"><label class="label">Full Name</label><input class="input" data-f="name" placeholder="Your name" disabled value="' + esc(U.name) + '"></div>' +
    '<div class="field"><label class="label">Mobile</label><input class="input" data-f="mobile" placeholder="Mobile number" disabled value="' + esc(U.mobile) + '"></div>' +
    '<div class="field"><label class="label">Email</label><input class="input" value="' + esc(U.email) + '" readonly disabled></div>' +
    '<div class="grid grid-2 gap-3"><div class="field"><label class="label">Referral code</label><div class="flex gap-2"><input class="input mono" value="' + esc(U.referralCode) + '" readonly disabled><button class="btn btn-outline btn-icon" data-copy-ref title="Copy referral code">' + I('copy') + '</button></div></div><div class="field"><label class="label">Joined</label><input class="input mono" value="' + esc(F.dateIN(U.joinedAt)) + '" readonly disabled></div></div>' +
    '</div><div class="cg-dialog-foot"><button class="btn btn-outline" data-cg-close>Close</button><button class="btn btn-primary" data-edit>Edit Profile</button></div></div>');
  const inputs = () => CG.$$('[data-f]', el); const editBtn = el.querySelector('[data-edit]');
  const setEditing = (v) => { editing = v; inputs().forEach((i) => (i.disabled = !v)); editBtn.textContent = v ? 'Save' : 'Edit Profile'; if (v) inputs()[0].focus(); };
  el.querySelector('[data-change]').onclick = () => { const p = el.querySelector('[data-picker]'); p.hidden = !p.hidden; };
  el.querySelector('[data-avatar-big]').onclick = () => { el.querySelector('[data-picker]').hidden = false; };
  el.addEventListener('click', (e) => { const p = e.target.closest('[data-pick]'); if (!p) return; avatar = p.dataset.pick; U.avatar = avatar; CG.$$('[data-pick]', el).forEach((x) => x.classList.toggle('sel', x.dataset.pick === avatar)); el.querySelector('[data-avatar-big]').innerHTML = avatarSvg(avatar); CG.emit('profile-updated', U); CG.toast({ title: 'Avatar updated' }); });
  el.querySelector('[data-copy-ref]').onclick = () => { try { navigator.clipboard && navigator.clipboard.writeText(U.referralCode); } catch (e) { } CG.toast({ title: 'Copied', description: 'Referral code copied to clipboard' }); };
  editBtn.onclick = () => { if (!editing) return setEditing(true); const name = el.querySelector('[data-f="name"]').value.trim(); if (!name) return CG.toast({ title: 'Validation Error', description: 'Full Name is required', variant: 'destructive' }); busy(editBtn, 'Saving...', 600).then(() => { U.name = name; U.mobile = el.querySelector('[data-f="mobile"]').value.trim(); if (M.users[0]) M.users[0].name = U.name; setEditing(false); CG.emit('profile-updated', U); CG.toast({ title: 'Profile updated' }); }); };
  return { el, opts: { title: 'Profile', description: 'Your account details', size: 'sm' } };
};
DIALOGS.api = function () {
  const cred = (M.apiCredentials = M.apiCredentials || { apiKey: '', connectedAt: null, brokerId: (M.brokers[0] || {}).id });
  const el = h('<div><div class="cg-dialog-body">' +
    '<div class="cgc-status" data-status><span class="spinner"></span><div><b>Checking connection...</b></div></div>' +
    '<div class="cgc-sect">Select Exchange</div><select class="select" data-broker>' + (M.brokers.length ? M.brokers.map((b) => '<option value="' + b.id + '" ' + (b.id === cred.brokerId ? 'selected' : '') + '>' + esc(b.name) + ' (' + b.feePercentage + '% fee)</option>').join('') : '<option value="">No exchanges configured</option>') + '</select><div class="hint" data-fee></div>' +
    '<div class="cgc-sect">API Credentials</div><div class="field"><label class="label">API Key</label><input class="input mono" data-key placeholder="Enter your Delta Exchange API key" autocomplete="off"></div><div class="field"><label class="label">API Secret</label><input class="input mono" type="password" data-secret placeholder="Enter your Delta Exchange API secret" autocomplete="new-password"></div>' +
    '<div class="text-xs text-muted">Get your API key from <a style="text-decoration:underline" href="https://www.delta.exchange/app/account/manageapikeys" target="_blank" rel="noopener noreferrer">Delta Exchange → Account → API Keys</a></div>' +
    '<div class="cgc-sect">Whitelisted IP Address</div><div class="cgc-ip"><code>172.236.179.136</code><button class="btn btn-outline btn-sm" data-copy-ip>' + I('copy') + 'Copy</button></div><div class="hint">Add this IP to your Delta Exchange API key whitelist for secure access.</div>' +
    '</div><div class="cg-dialog-foot"><button class="btn btn-outline text-destructive" data-disconnect hidden>Disconnect Exchange</button><button class="btn btn-outline" data-cg-close>Cancel</button><button class="btn btn-primary" data-connect>Connect &amp; Save</button></div></div>');
  const sel = el.querySelector('[data-broker]'), fee = el.querySelector('[data-fee]'), status = el.querySelector('[data-status]'), disc = el.querySelector('[data-disconnect]');
  const showFee = () => { const b = M.brokers.find((x) => x.id === sel.value); fee.textContent = b ? 'Fee: ' + b.feePercentage + '% · GST: ' + b.gstPercentage + '% · Cap: ' + b.feeCapPercentage + '%' : ''; cred.brokerId = sel.value; }; sel.onchange = showFee; showFee();
  const renderStatus = () => { if (st.exchangeConnected) { status.className = 'cgc-status ok'; status.innerHTML = I('check') + '<div><b>Connected</b><div class="mono">API Key: ••••' + esc((cred.apiKey || 'xxxx1a2b').slice(-4)) + '</div><div class="mono">Connected: ' + esc(cred.connectedAt ? F.dateIN(cred.connectedAt) + ' ' + F.time(cred.connectedAt) : F.dateIN(CG.NOW)) + '</div><div class="mono">Wallet: ' + F.usd(M.wallet.available) + '</div></div>'; disc.hidden = false; } else { status.className = 'cgc-status no'; status.innerHTML = I('alert') + '<div><b>Not Connected</b>Enter your Delta Exchange API credentials to enable live trading.</div>'; disc.hidden = true; } };
  setTimeout(renderStatus, 700);
  el.querySelector('[data-copy-ip]').onclick = () => { try { navigator.clipboard && navigator.clipboard.writeText('172.236.179.136'); } catch (e) { } CG.toast({ title: 'Copied', description: 'IP address copied to clipboard' }); };
  el.querySelector('[data-connect]').onclick = (e) => { const key = el.querySelector('[data-key]').value.trim(), sec = el.querySelector('[data-secret]').value.trim(); if (!key || !sec) return CG.toast({ title: 'Save Failed', description: 'Failed to save credentials · API key and API secret are required', variant: 'destructive' }); if (!sel.value) return CG.toast({ title: 'Save Failed', description: 'Select an exchange...', variant: 'destructive' }); busy(e.currentTarget, ' Connecting...', 1000).then(() => { cred.apiKey = key; cred.connectedAt = new Date(CG.NOW).toISOString(); st.exchangeConnected = true; CG.saveState(); CG.emit('exchange-changed', true); CG.emit('broker-credentials-changed', cred); renderStatus(); el.querySelector('[data-secret]').value = ''; CG.toast({ title: 'Exchange Connected', description: 'API credentials saved to server', variant: 'success' }); }); };
  disc.onclick = () => { cred.apiKey = ''; cred.connectedAt = null; st.exchangeConnected = false; CG.saveState(); CG.emit('exchange-changed', false); CG.emit('broker-credentials-changed', null); renderStatus(); CG.toast({ title: 'Exchange Disconnected', description: 'Delta Exchange credentials removed' }); };
  return { el, opts: { title: 'Delta Exchange API Settings', description: 'Connect your exchange account for live trading and wallet balance.' } };
};
DIALOGS.currency = function () {
  const el = h('<div><div class="cg-dialog-body"><div class="grid grid-2 gap-3"><div class="field"><label class="label">From Currency</label><select class="select" data-from><option>USD</option></select></div><div class="field"><label class="label">To Currency</label><select class="select" data-to><option>INR</option></select></div></div>' +
    '<div class="field"><label class="label">USD to INR Conversion Rate</label><input class="input mono" type="number" step="0.01" min="1" data-rate value="' + st.conversionRate + '"></div>' +
    '<div class="field"><label class="label">Display currency</label><div class="tabs"><button class="tab ' + (st.currency === 'USD' ? 'active' : '') + '" data-cur="USD">$ USD</button><button class="tab ' + (st.currency === 'INR' ? 'active' : '') + '" data-cur="INR">₹ INR</button></div></div>' +
    '<div class="alert alert-info"><div data-note></div></div></div>' + foot('Save') + '</div>');
  const rate = el.querySelector('[data-rate]'), note = el.querySelector('[data-note]'); let cur = st.currency;
  const upd = () => { note.textContent = 'All calculated values (P&L, Margin, Net Premium) will be displayed in ' + (cur === 'INR' ? 'Indian Rupees (₹)' : 'US Dollars ($)') + ' · Rate: $1 = ₹' + (parseFloat(rate.value) || 0); CG.$$('[data-cur]', el).forEach((b) => b.classList.toggle('active', b.dataset.cur === cur)); };
  rate.oninput = upd; el.addEventListener('click', (e) => { const b = e.target.closest('[data-cur]'); if (b) { cur = b.dataset.cur; upd(); } }); upd();
  el.querySelector('[data-primary]').onclick = (e) => { const r = parseFloat(rate.value); if (!(r > 0)) return CG.toast({ title: 'Error', description: 'Conversion rate must be greater than 0', variant: 'destructive' }); busy(e.currentTarget, ' Saving...', 500).then(() => { st.conversionRate = r; st.currency = cur; CG.saveState(); CG.emit('currency-settings-changed', st.currency); CG.emit('currency', st.currency); CG.toast({ title: 'Currency conversion saved', description: 'Rate: $1 = ₹' + r }); CG.modal.close(); }); };
  return { el, opts: { title: 'Currency Settings', description: 'Set the USD to INR conversion rate used for all calculated values.', size: 'sm' } };
};
DIALOGS.lot = function () {
  const syms = ['BTC', 'ETH', 'XAUT'];
  const el = h('<div><div class="cg-dialog-body">' + syms.map((s) => '<div class="cgc-lotrow"><label class="label m-0">' + s + ' Lot Size</label><div class="cgc-eq"><span>1 lot =</span><input class="input input-sm" type="number" step="0.001" min="0.0001" data-lot="' + s + '" value="' + (st.lotSizes[s] || CG.ASSETS[s].lot) + '"><span>' + s + '</span></div></div>').join('') + '</div>' + foot('Save') + '</div>');
  el.querySelector('[data-primary]').onclick = (e) => { const out = {}; for (const s of syms) { const v = parseFloat(el.querySelector('[data-lot="' + s + '"]').value); if (!(v > 0)) return CG.toast({ title: 'Failed to save lot sizes', description: s + ' lot size must be greater than 0', variant: 'destructive' }); out[s] = v; } busy(e.currentTarget, ' Saving...', 500).then(() => { st.lotSizes = out; CG.saveState(); CG.emit('lot-sizes-changed', out); CG.toast({ title: 'Lot sizes saved' }); CG.modal.close(); }); };
  return { el, opts: { title: 'Lot Size Settings', description: 'Lot size for each symbol', size: 'sm' } };
};
DIALOGS.pnl = function () {
  let basis = st.pnlBasis || 'mark';
  const opt = (v, t, d) => '<div class="cgc-radio ' + (basis === v ? 'sel' : '') + '" role="radio" aria-checked="' + (basis === v) + '" data-basis="' + v + '"><i></i><div><b>' + t + '</b><span>' + d + '</span></div></div>';
  const el = h('<div><div class="cg-dialog-body"><div role="radiogroup" aria-label="P&L price basis">' + opt('mark', 'Mark price', 'P&L at the exchange mark price — the same basis Delta Exchange shows.') + opt('bid_ask', 'Bid/Ask (executable)', 'P&L at the price you would actually get closing now: long legs at the bid, short legs at the ask.') + '</div><div class="alert alert-info mt-2 text-xs"><div>Delta Exchange shows P&L at the mark price. With Bid/Ask, HapieCoin shows the P&L you would realise by closing now, so the two figures <b>will differ</b> — usually by the bid/ask spread, and more on illiquid strikes.</div></div></div>' + foot('Save') + '</div>');
  el.addEventListener('click', (e) => { const r = e.target.closest('[data-basis]'); if (!r) return; basis = r.dataset.basis; CG.$$('[data-basis]', el).forEach((x) => { const on = x.dataset.basis === basis; x.classList.toggle('sel', on); x.setAttribute('aria-checked', on); }); });
  el.querySelector('[data-primary]').onclick = (e) => busy(e.currentTarget, ' Saving...', 400).then(() => { st.pnlBasis = basis; CG.saveState(); CG.emit('pnl-basis-changed', basis); CG.toast({ title: 'P&L settings saved', description: basis === 'mark' ? 'P&L basis: Mark price' : 'P&L basis: Bid/Ask (executable)' }); CG.modal.close(); });
  return { el, opts: { title: 'P&L Settings', description: 'Choose the price basis for the P&L shown on paper and live trades.', size: 'sm' } };
};
DIALOGS.exchanges = function () {
  const el = h('<div><div class="cg-dialog-body"><div class="flex items-center justify-between mb-3"><span class="text-sm text-muted">' + M.brokers.length + ' exchange(s) configured</span><button class="btn btn-primary btn-sm" data-add>' + I('plus') + 'Add Exchange</button></div><div data-list></div></div><div class="cg-dialog-foot"><button class="btn btn-outline" data-cg-close>Close</button></div></div>');
  const list = el.querySelector('[data-list]');
  const render = () => { list.innerHTML = M.brokers.length ? M.brokers.map((b) => '<div class="cgc-broker" data-id="' + b.id + '"><div class="cgc-coin">' + esc(b.name.slice(0, 1)) + '</div><div class="flex-1"><b>' + esc(b.name) + (b.isDefault ? ' <span class="badge badge-info">Preferred</span>' : '') + (b.scope === 'GLOBAL' ? ' <span class="badge badge-outline">GLOBAL</span>' : '') + '</b><div class="cgc-meta"><span>Fee: <span class="mono">' + b.feePercentage + '%</span></span><span>GST: <span class="mono">' + b.gstPercentage + '%</span></span><span>Fee Cap: <span class="mono">' + b.feeCapPercentage + '%</span></span></div></div><button class="btn btn-outline btn-sm" data-edit>' + I('edit') + 'Edit</button><button class="btn btn-outline btn-sm text-destructive" data-del>' + I('trash') + 'Delete</button></div>').join('') : '<div class="empty"><b>No exchanges configured</b>Add an exchange to configure its fee structure.</div>'; el.querySelector('.text-muted').textContent = M.brokers.length + ' exchange(s) configured'; };
  render();
  el.querySelector('[data-add]').onclick = () => CH.openExchangeForm(null, render);
  el.addEventListener('click', async (e) => { const row = e.target.closest('[data-id]'); if (!row) return; const b = M.brokers.find((x) => x.id === row.dataset.id); if (e.target.closest('[data-edit]')) CH.openExchangeForm(b, render); else if (e.target.closest('[data-del]')) { const ok = await CG.modal.confirm({ title: 'Delete Exchange', description: 'This action cannot be undone', body: '<p class="text-sm">Are you sure you want to delete this exchange?</p><p class="text-xs text-warning mt-2">Warning: any strategies using this exchange will need to be reconfigured.</p>', confirmText: 'Delete', variant: 'destructive' }); if (ok) { M.brokers.splice(M.brokers.indexOf(b), 1); CG.emit('brokers-changed', M.brokers); render(); CG.toast({ title: 'Success', description: 'Exchange deleted successfully' }); } } });
  return { el, opts: { title: 'Exchange Management', description: 'Manage exchange configurations for paper trading' } };
};
CH.openExchangeForm = function (b, onDone) {
  const edit = !!b; b = b || { name: '', feePercentage: 0.05, gstPercentage: 18, feeCapPercentage: 10 };
  const el = h('<div><div class="cg-dialog-body"><div class="field"><label class="label">Exchange Name</label><input class="input" data-f="name" placeholder="e.g., Delta Exchange India" value="' + esc(b.name) + '"><div class="cgc-form-err" data-err hidden></div></div><div class="field"><label class="label">Fee Percentage (%)</label><input class="input mono" type="number" step="0.01" min="0" data-f="fee" value="' + b.feePercentage + '"><div class="hint">Percentage of notional value</div></div><div class="field"><label class="label">GST Percentage (%)</label><input class="input mono" type="number" step="1" min="0" data-f="gst" value="' + b.gstPercentage + '"></div><div class="field"><label class="label">Fee Cap (% of premium)</label><input class="input mono" type="number" step="1" min="0" data-f="cap" value="' + b.feeCapPercentage + '"><div class="hint">Maximum fee as percentage of premium</div></div></div>' + foot(edit ? 'Update' : 'Create') + '</div>');
  const hd = CG.modal.open(el, { title: edit ? 'Edit Exchange' : 'Add New Exchange', description: 'Configure exchange fee structure', size: 'sm' });
  el.querySelector('[data-primary]').onclick = (e) => { const v = (k) => el.querySelector('[data-f="' + k + '"]').value; const err = el.querySelector('[data-err]'); if (!v('name').trim()) { err.hidden = false; err.textContent = 'Exchange name is required'; return CG.toast({ title: 'Validation Error', description: 'Exchange name is required', variant: 'destructive' }); } err.hidden = true; busy(e.currentTarget, ' Saving...', 500).then(() => { const data = { name: v('name').trim(), feePercentage: +v('fee') || 0, gstPercentage: +v('gst') || 0, feeCapPercentage: +v('cap') || 0 }; if (edit) Object.assign(b, data); else M.brokers.push(Object.assign({ id: 'br_' + Date.now(), scope: 'USER', isDefault: false }, data)); CG.emit('brokers-changed', M.brokers); CG.toast({ title: 'Success', description: edit ? 'Exchange updated successfully' : 'Exchange created successfully' }); hd.close(); if (onDone) onDone(); }); };
  return hd;
};
CH.openSettings = function (kind) { const mk = DIALOGS[kind]; if (!mk) { CG.toast({ title: 'Unknown setting', description: String(kind), variant: 'destructive' }); return null; } const d = mk(); return CG.modal.open(d.el, d.opts); };
CH.dialogs = DIALOGS;
// ---------- upgrade required ----------
CH.upgradeRequired = function (message) {
  const el = h('<div><div class="cg-dialog-body"><div class="alert alert-warning"><span class="text-warning" style="flex-shrink:0;display:inline-flex">' + I('crown', 16) + '</span><div>' + esc(message || 'This feature is not included in your current plan.') + '</div></div></div><div class="cg-dialog-foot"><button class="btn btn-outline" data-cg-close>Dismiss</button><a class="btn btn-primary" href="#/subscription" data-sub>Subscribe Here →</a></div></div>');
  const hd = CG.modal.open(el, { title: 'Upgrade Required', size: 'sm' }); el.querySelector('[data-sub]').addEventListener('click', () => hd.close()); return hd;
};
