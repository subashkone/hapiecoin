// ---------- keyboard shortcuts · CG.shortcuts (global dispatcher + help dialog) ----------
const SC = (CG.shortcuts = {});
const scMap = new Map();
let scDialog = null;
function scNorm(key) { return String(key || '').trim().toLowerCase().replace(/\s+/g, '').replace(/cmd|meta|⌘/g, 'ctrl').replace(/esc$/, 'escape').replace(/-/g, '+').replace(/\+\+/g, '+'); }
function scPretty(k) { return k.split('+').map((p) => ({ ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', escape: 'Esc', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', enter: '↵' }[p] || (p.length === 1 ? p.toUpperCase() : p))); }
SC.register = function (key, description, handler, opts) { const k = scNorm(key); scMap.set(k, { key: k, description: description || '', handler: typeof handler === 'function' ? handler : null, group: (opts && opts.group) || 'Workspace', owner: (opts && opts.owner) || null, always: !!(opts && opts.always) }); if (scDialog) scDialog.render(); return () => SC.unregister(key); };
SC.unregister = (key) => { scMap.delete(scNorm(key)); if (scDialog) scDialog.render(); };
SC.list = () => Array.from(scMap.values());
SC.combo = function (e) { const k = (e.key || '').toLowerCase(); if (['control', 'shift', 'alt', 'meta'].includes(k)) return null; const letter = k.length === 1 && /[a-z]/.test(k); return (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + (e.altKey ? 'alt+' : '') + (e.shiftKey && letter ? 'shift+' : '') + (k === ' ' ? 'space' : k); };
const scTyping = (t) => !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
document.addEventListener('keydown', (e) => {
  const combo = SC.combo(e); if (!combo) return; const sc = scMap.get(combo); if (!sc) return;
  const typing = scTyping(e.target); const modal = !!document.querySelector('.cg-overlay'); const palOpen = CG.palette && CG.palette.isOpen();
  if (palOpen && combo !== 'ctrl+k') return; if ((typing || modal) && !sc.always) return;
  e.preventDefault(); CG.emit('shortcut', { key: combo, event: e });
  if (sc.handler) { try { sc.handler(e); } catch (err) { console.error('shortcut', combo, err); } }
});
// ---- defaults ----
SC.register('Ctrl+K', 'Command palette', () => CG.palette && CG.palette.toggle(), { group: 'Global', always: true });
SC.register('?', 'Keyboard shortcuts help', () => SC.open(), { group: 'Global' });
SC.register('T', 'Toggle theme (dark / light)', () => CG.theme.toggle(), { group: 'Global' });
SC.register('D', 'Toggle density (comfortable / compact)', () => CH.toggleDensity(), { group: 'Global' });
SC.register('Esc', 'Close dialogs, menus and panels', () => { CG.menu.closeAll(); if (CG.palette) CG.palette.close(); if (CH.assistantOpen && CH.assistantOpen()) CH.closeAssistant(); }, { group: 'Global', always: true });
const onAnalyseRoute = () => (CG.current.path || '') === '/analyse';
function scCycleExpiry(dir) {
  if (!onAnalyseRoute()) return; const AN = CG.analyse; if (AN && typeof AN.setExpiry === 'function') { const i = CG.EXPIRIES.indexOf(AN.expiry || st.expiry); return AN.setExpiry(CG.EXPIRIES[(i + dir + CG.EXPIRIES.length) % CG.EXPIRIES.length]); }
  const btns = CG.$$('section.screen.active [data-expiry], section.screen.active .an-exp'); if (btns.length) { const cur = btns.findIndex((b) => b.classList.contains('active') || b.getAttribute('aria-selected') === 'true'); const next = btns[(Math.max(cur, 0) + dir + btns.length) % btns.length]; if (next) { next.click(); return; } }
  const i = CG.EXPIRIES.indexOf((AN && AN.expiry) || st.expiry); const e = CG.EXPIRIES[(i + dir + CG.EXPIRIES.length) % CG.EXPIRIES.length]; st.expiry = e; if (AN) AN.expiry = e; CG.saveState(); CG.emit('expiry', e); CG.emit('analyse:expiry', e);
}
SC.register('J', 'Move strike cursor down', null, { group: 'Analyse workspace' });
SC.register('K', 'Move strike cursor up', null, { group: 'Analyse workspace' });
SC.register('B', 'Add BUY leg at the strike cursor', null, { group: 'Analyse workspace' });
SC.register('S', 'Add SELL leg at the strike cursor', null, { group: 'Analyse workspace' });
SC.register('E', 'Next expiry', () => scCycleExpiry(1), { group: 'Analyse workspace' });
SC.register('Shift+E', 'Previous expiry', () => scCycleExpiry(-1), { group: 'Analyse workspace' });
// ---- help dialog ----
SC.open = function () {
  if (scDialog) return scDialog.hd;
  const el = h('<div><div class="cg-dialog-body"><table class="cgc-sc-table" data-table></table><p class="text-2xs text-muted mt-3">Shortcuts are ignored while typing in a field or when a dialog is open (except Ctrl K and Esc). Other modules can add rows with <span class="mono">CG.shortcuts.register(key, description, handler)</span>.</p></div><div class="cg-dialog-foot"><button class="btn btn-outline" data-cg-close>Close</button></div></div>');
  const D = { el, hd: null, render() { const groups = {}; SC.list().forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); }); const order = ['Global', 'Analyse workspace'].concat(Object.keys(groups).filter((g) => g !== 'Global' && g !== 'Analyse workspace')); el.querySelector('[data-table]').innerHTML = order.filter((g) => groups[g]).map((g) => '<tr class="grp"><td colspan="2">' + esc(g) + '</td></tr>' + groups[g].map((s) => '<tr><td>' + scPretty(s.key).map((p) => '<kbd class="kbd">' + esc(p) + '</kbd>').join('') + '</td><td>' + esc(s.description) + (s.handler ? '' : '<span class="own">handled by the workspace</span>') + '</td></tr>').join('')).join(''); } };
  D.render(); scDialog = D; const unRoute = CG.on('route', () => { if (scDialog === D) D.hd.close(); }); D.hd = CG.modal.open(el, { title: 'Keyboard shortcuts', description: 'Press ? anywhere (outside a field) to open this list', size: 'sm', onClose: () => { scDialog = null; unRoute(); } }); return D.hd;
};
SC.close = () => { if (scDialog && scDialog.hd) scDialog.hd.close(); };
