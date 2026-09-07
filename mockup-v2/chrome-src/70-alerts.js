// ---------- alerts center · CG.alerts ----------
const AL = (CG.alerts = {});
let alSeq = 10, alDialog = null;
M.alerts = M.alerts || [
  { id: 'al_1', kind: 'price', asset: 'BTC', op: '>=', value: 82000, channels: ['push'], state: 'armed', createdAt: '2026-09-05T09:10:00', lastValue: null, triggeredAt: null },
  { id: 'al_2', kind: 'ivrank', asset: 'BTC', op: '<=', value: 30, channels: ['telegram'], state: 'armed', createdAt: '2026-09-05T09:12:00', lastValue: null, triggeredAt: null },
  { id: 'al_3', kind: 'pnl', strategyId: 's_301', op: '>=', value: 20, channels: ['email'], state: 'armed', createdAt: '2026-09-06T08:40:00', lastValue: null, triggeredAt: null }
];
const AL_KINDS = { price: { label: 'Price', icon: 'trending', unit: 'USD' }, ivrank: { label: 'IV rank', icon: 'activity', unit: 'rank 0–100' }, pnl: { label: 'Strategy P&L', icon: 'percent', unit: 'USD P&L' } };
const AL_CHANNELS = ['push', 'email', 'telegram'];
const opSym = (op) => (op === '<=' ? '≤' : '≥');
const stratName = (id) => { const s = (M.strategies || []).find((x) => x.id === id); return s ? s.name : id; };
AL.conditionText = function (a) {
  if (a.kind === 'price') return a.asset + ' ' + opSym(a.op) + ' ' + F.int(a.value);
  if (a.kind === 'ivrank') return a.asset + ' IV rank ' + opSym(a.op) + ' ' + F.int(a.value);
  return stratName(a.strategyId) + ' P&L ' + opSym(a.op) + ' ' + F.signedMoney(a.value, 2);
};
AL.list = () => M.alerts;
AL.get = (id) => M.alerts.find((a) => a.id === id);
AL.counts = () => ({ armed: M.alerts.filter((a) => a.state === 'armed').length, triggered: M.alerts.filter((a) => a.state === 'triggered').length, paused: M.alerts.filter((a) => a.state === 'paused').length, total: M.alerts.length });
const alChanged = () => { CG.emit('alerts-changed', M.alerts); if (alDialog) alDialog.render(); };
AL.add = function (a) {
  a = Object.assign({ kind: 'price', asset: st.asset, op: '>=', value: 0, channels: ['push'], state: 'armed', createdAt: new Date(CG.NOW).toISOString(), lastValue: null, triggeredAt: null }, a || {});
  if (!a.id) a.id = 'al_' + (alSeq++); if (!Array.isArray(a.channels) || !a.channels.length) a.channels = ['push']; a.value = +a.value || 0;
  M.alerts.push(a); alChanged(); AL.evaluate([a]); return a;
};
AL.update = function (id, patch) { const a = AL.get(id); if (!a) return null; Object.assign(a, patch || {}); if (patch && (patch.value != null || patch.op || patch.kind || patch.asset || patch.strategyId)) { if (a.state === 'triggered') a.state = 'armed'; a.triggeredAt = null; } alChanged(); return a; };
AL.remove = function (id) { const i = M.alerts.findIndex((a) => a.id === id); if (i < 0) return false; M.alerts.splice(i, 1); alChanged(); return true; };
AL.arm = function (id, on) { const a = AL.get(id); if (!a) return null; a.state = on === false ? 'paused' : 'armed'; if (on !== false) a.triggeredAt = null; alChanged(); if (on !== false) AL.evaluate([a]); return a; };
function alCurrent(a) {
  if (a.kind === 'price') { const A = CG.ASSETS[a.asset]; return A ? A.price : null; }
  if (a.kind === 'ivrank') { const ext = CG.analyse && CG.analyse.stats; if (ext && ext.ivRank != null && (!ext.asset || ext.asset === a.asset)) return ext.ivRank <= 1 ? ext.ivRank * 100 : ext.ivRank; return CH.marketStats(a.asset).ivRank; }
  if (a.kind === 'pnl') { if (CG.portfolio && typeof CG.portfolio.strategyPnl === 'function') { try { const v = CG.portfolio.strategyPnl(a.strategyId); if (v != null && !isNaN(v)) return v; } catch (e) { } } const s = (M.strategies || []).find((x) => x.id === a.strategyId); return s ? (s.totalPnl != null ? s.totalPnl : (s.realizedPnl || 0) + (s.unrealizedPnl || 0)) : null; }
  return null;
}
AL.currentValue = alCurrent;
const alMet = (a, v) => (a.op === '<=' ? v <= a.value : v >= a.value);
AL.evaluate = function (subset) {
  if (!st.loggedIn) return 0; const list = subset || M.alerts; let fired = 0;
  list.forEach((a) => { if (a.state !== 'armed') return; const v = alCurrent(a); if (v == null || isNaN(v)) return; a.lastValue = v; if (alMet(a, v)) { a.state = 'triggered'; a.triggeredAt = Date.now(); fired++; const what = a.kind === 'price' ? a.asset + ' crossed ' + F.int(a.value) : a.kind === 'ivrank' ? a.asset + ' IV rank ' + opSym(a.op) + ' ' + a.value + ' (now ' + Math.round(v) + ')' : stratName(a.strategyId) + ' P&L reached ' + F.signedMoney(v); CG.toast({ title: 'Alert triggered · ' + what, description: 'Sent via ' + a.channels.join(', ') + ' · re-arm it from the Alerts center.', variant: 'success', duration: 5000 }); CG.emit('alert-triggered', a); } });
  if (fired) alChanged(); return fired;
};
CG.on('tick', () => AL.evaluate());
CG.on('portfolio-changed', () => AL.evaluate());
// ---- dialog ----
function alRowHtml(a) {
  const k = AL_KINDS[a.kind] || AL_KINDS.price; const cur = alCurrent(a);
  const curTxt = cur == null ? '' : a.kind === 'price' ? 'now ' + F.num(cur, cur > 1000 ? 1 : 2) : a.kind === 'ivrank' ? 'now ' + Math.round(cur) : 'now ' + F.signedMoney(cur);
  const stateBadge = a.state === 'triggered' ? '<span class="badge badge-warning">triggered</span>' : a.state === 'paused' ? '<span class="badge badge-outline">paused</span>' : '<span class="badge badge-success">armed</span>';
  return '<div class="cgc-al-row ' + a.state + '" data-id="' + a.id + '"><span class="ic" title="' + k.label + '">' + I(k.icon) + '</span><div><div class="cond">' + esc(AL.conditionText(a)) + '</div><div class="sub">' + k.label + (curTxt ? ' · ' + curTxt : '') + (a.triggeredAt ? ' · fired ' + new Date(a.triggeredAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '') + '</div></div><div class="cgc-al-ch">' + a.channels.map((c) => '<span>' + esc(c) + '</span>').join('') + '</div>' + stateBadge + '<span class="switch ' + (a.state !== 'paused' ? 'on' : '') + '" role="switch" aria-checked="' + (a.state !== 'paused') + '" data-arm title="' + (a.state === 'paused' ? 'Arm' : a.state === 'triggered' ? 'Re-arm' : 'Pause') + '"></span><button class="del" data-del title="Delete alert" aria-label="Delete alert">' + I('trash') + '</button></div>';
}
function alFormHtml(pre) {
  pre = pre || {}; const kind = AL_KINDS[pre.kind] ? pre.kind : 'price'; const strategies = (M.strategies || []).filter((s) => s.status === 'PAPER' || s.status === 'LIVE');
  const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
  return '<form class="cgc-al-form" data-al-form novalidate><div class="g3">' +
    '<div class="field"><label class="label">Type</label><select class="select" name="kind">' + Object.keys(AL_KINDS).map((k) => opt(k, AL_KINDS[k].label, k === kind)).join('') + '</select></div>' +
    '<div class="field" data-f-asset' + (kind === 'pnl' ? ' hidden' : '') + '><label class="label">Asset</label><select class="select" name="asset">' + Object.keys(CG.ASSETS).map((s) => opt(s, CG.ASSETS[s].name + ' (' + s + ')', s === (pre.asset || st.asset))).join('') + '</select></div>' +
    '<div class="field" data-f-strategy' + (kind !== 'pnl' ? ' hidden' : '') + '><label class="label">Strategy</label><select class="select" name="strategyId">' + (strategies.length ? strategies.map((s) => opt(s.id, s.name + ' · ' + s.status, s.id === pre.strategyId)).join('') : '<option value="">No open strategies</option>') + '</select></div>' +
    '<div class="field"><label class="label">Condition</label><select class="select" name="op">' + opt('>=', '≥  at or above', (pre.op || '>=') === '>=') + opt('<=', '≤  at or below', pre.op === '<=') + '</select></div></div>' +
    '<div class="g2"><div class="field"><label class="label">Value <span class="text-muted" data-unit>· ' + AL_KINDS[kind].unit + '</span></label><input class="input mono" name="value" type="number" step="any" placeholder="' + (kind === 'price' ? '82000' : kind === 'ivrank' ? '30' : '20') + '" value="' + (pre.value != null ? esc(pre.value) : '') + '"><div class="cgc-form-err" data-err hidden></div></div>' +
    '<div class="field"><label class="label">Channels</label><div class="cgc-al-chk">' + AL_CHANNELS.map((c) => '<label><input type="checkbox" class="checkbox" name="ch" value="' + c + '"' + ((pre.channels || ['push']).includes(c) ? ' checked' : '') + '> ' + c + '</label>').join('') + '</div></div></div>' +
    '<div class="actions"><button type="button" class="btn btn-outline" data-al-cancel>Cancel</button><button type="submit" class="btn btn-primary">Save alert</button></div></form>';
}
function alBuildDialog(prefill) {
  const el = h('<div><div class="cg-dialog-body"><div class="cgc-al-head"><span class="counts" data-counts></span><span class="cgc-spacer"></span><button class="btn btn-primary btn-sm" data-al-new>' + I('plus') + 'New alert</button></div><div data-form-host></div><div data-list></div></div><div class="cg-dialog-foot"><span class="text-2xs text-muted" style="margin-right:auto">Evaluated on every price tick · price vs futures, IV rank vs ATM chain, P&L vs open strategies.</span><button class="btn btn-outline" data-cg-close>Close</button></div></div>');
  const list = el.querySelector('[data-list]'), host = el.querySelector('[data-form-host]'), counts = el.querySelector('[data-counts]');
  const D = { el, hd: null, render() { const c = AL.counts(); counts.textContent = c.total + ' alert' + (c.total === 1 ? '' : 's') + ' · ' + c.armed + ' armed · ' + c.triggered + ' triggered' + (c.paused ? ' · ' + c.paused + ' paused' : ''); list.innerHTML = M.alerts.length ? M.alerts.map(alRowHtml).join('') : '<div class="cgc-al-empty">' + I('bell') + '<b>No alerts yet</b>Create a price, IV rank or strategy P&L alert and we will notify you by push, email or Telegram.<div class="mt-3"><button class="btn btn-outline btn-sm" data-al-new>' + I('plus') + 'New alert</button></div></div>'; }, showForm(pre) { host.innerHTML = alFormHtml(pre); const inp = host.querySelector('[name="value"]'); if (inp) inp.focus(); }, hideForm() { host.innerHTML = ''; } };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-al-new]')) return D.showForm({});
    if (e.target.closest('[data-al-cancel]')) return D.hideForm();
    const row = e.target.closest('[data-id]'); if (!row) return; const a = AL.get(row.dataset.id); if (!a) return;
    if (e.target.closest('[data-arm]')) { const on = a.state === 'paused' || a.state === 'triggered'; AL.arm(a.id, on); CG.toast({ title: on ? 'Alert armed' : 'Alert paused', description: AL.conditionText(a) }); }
    else if (e.target.closest('[data-del]')) { const ok = await CG.modal.confirm({ title: 'Delete alert', description: AL.conditionText(a), confirmText: 'Delete', variant: 'destructive' }); if (ok) { AL.remove(a.id); CG.toast({ title: 'Alert deleted', description: AL.conditionText(a) }); } }
  });
  el.addEventListener('change', (e) => { const f = e.target.closest('[data-al-form]'); if (!f || e.target.name !== 'kind') return; const k = e.target.value; f.querySelector('[data-f-asset]').hidden = k === 'pnl'; f.querySelector('[data-f-strategy]').hidden = k !== 'pnl'; f.querySelector('[data-unit]').textContent = '· ' + AL_KINDS[k].unit; f.querySelector('[name="value"]').placeholder = k === 'price' ? '82000' : k === 'ivrank' ? '30' : '20'; });
  el.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-al-form]'); if (!f) return; e.preventDefault();
    const kind = f.kind.value, value = parseFloat(f.value.value), channels = Array.from(f.querySelectorAll('[name="ch"]:checked')).map((c) => c.value); const err = f.querySelector('[data-err]');
    if (isNaN(value)) { err.hidden = false; err.textContent = 'Value is required'; return CG.toast({ title: 'Validation Error', description: 'Alert value is required', variant: 'destructive' }); }
    if (kind === 'ivrank' && (value < 0 || value > 100)) { err.hidden = false; err.textContent = 'IV rank is 0–100'; return; }
    if (kind === 'pnl' && !f.strategyId.value) { err.hidden = false; err.textContent = 'Start a paper or live strategy first'; return; }
    if (!channels.length) return CG.toast({ title: 'Validation Error', description: 'Pick at least one channel', variant: 'destructive' });
    err.hidden = true; const a = AL.add({ kind, asset: f.asset.value, strategyId: kind === 'pnl' ? f.strategyId.value : undefined, op: f.op.value, value, channels });
    D.hideForm(); if (a.state !== 'triggered') CG.toast({ title: 'Alert armed', description: AL.conditionText(a) + ' · via ' + channels.join(', '), variant: 'success' });
  });
  D.render(); if (prefill) D.showForm(prefill);
  return D;
}
AL.open = function (prefill) {
  if (alDialog) { if (prefill) alDialog.showForm(prefill); return alDialog.hd; }
  const D = alBuildDialog(prefill); alDialog = D;
  const unRoute = CG.on('route', () => { if (alDialog === D) D.hd.close(); });
  D.hd = CG.modal.open(D.el, { title: 'Alerts', description: 'Price, IV rank and strategy P&L alerts · push, email or Telegram', size: 'lg', onClose: () => { alDialog = null; unRoute(); } });
  return D.hd;
};
AL.openNew = function (prefill) { return AL.open(Object.assign({ kind: 'price', asset: st.asset, op: '>=', channels: ['push'] }, prefill || {})); };
AL.close = () => { if (alDialog && alDialog.hd) alDialog.hd.close(); };
