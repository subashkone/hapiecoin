// ---------- HapieCoin Assistant (floating chat, 40px bubble docked above the portfolio bar) ----------
const SUGGEST_BASE = ['How do I add a leg from the chain?', 'What is Probability of Profit?', 'How do I connect Delta Exchange?', 'Difference between mark and bid/ask P&L?'];
const EXPLAIN_Q = 'Explain this strategy';
const onAnalyse = () => (CG.current && CG.current.path) === '/analyse';
const suggestions = () => (onAnalyse() ? [EXPLAIN_Q].concat(SUGGEST_BASE.slice(0, 3)) : SUGGEST_BASE);
// ---- strategy explainer (canned template over CG.analyze) ----
function strategyName(legs, AN) {
  if (AN && AN.name) return AN.name;
  const n = legs.length; const calls = legs.filter((l) => l.type === 'CALL'), puts = legs.filter((l) => l.type === 'PUT'); const buys = legs.filter((l) => l.side === 'BUY'), sells = legs.filter((l) => l.side === 'SELL');
  const by = (arr) => arr.slice().sort((a, b) => a.strike - b.strike);
  if (n === 1) { const l = legs[0]; return (l.side === 'BUY' ? 'Long ' : 'Short ') + (l.type === 'FUTURE' ? 'Future' : l.type === 'CALL' ? 'Call' : 'Put'); }
  if (new Set(legs.map((l) => l.expiry)).size > 1 && n === 2) return 'Calendar Spread';
  if (n === 2 && calls.length === 2 && buys.length === 1) return buys[0].strike < sells[0].strike ? 'Bull Call Spread' : 'Bear Call Spread';
  if (n === 2 && puts.length === 2 && buys.length === 1) return buys[0].strike > sells[0].strike ? 'Bear Put Spread' : 'Bull Put Spread';
  if (n === 2 && calls.length === 1 && puts.length === 1) { const c = calls[0], p = puts[0]; if (c.side === p.side) return (c.side === 'BUY' ? 'Long ' : 'Short ') + (c.strike === p.strike ? 'Straddle' : 'Strangle'); return c.side === 'BUY' ? 'Long Synthetic Future' : 'Short Synthetic Future'; }
  if (n === 4 && calls.length === 2 && puts.length === 2 && buys.length === 2) { const sp = by(sells), bp = by(buys); const inner = sells.every((l) => l.strike >= bp[0].strike && l.strike <= bp[1].strike); if (inner) return sp[0].strike === sp[1].strike ? 'Iron Butterfly' : 'Iron Condor'; return bp[0].strike === bp[1].strike ? 'Reverse Iron Butterfly' : 'Reverse Iron Condor'; }
  if (n === 3 && (calls.length === 3 || puts.length === 3)) { const tb = buys.reduce((a, l) => a + (l.lots || 1), 0), ts = sells.reduce((a, l) => a + (l.lots || 1), 0); if (tb === ts) return 'Long ' + (calls.length === 3 ? 'Call' : 'Put') + ' Butterfly'; }
  if (n === 3 && puts.length === 2 && calls.length === 1 && calls[0].side === 'SELL' && sells.length === 2) return 'Jade Lizard';
  if (n === 3 && calls.length === 2 && puts.length === 1 && puts[0].side === 'SELL' && sells.length === 2) return 'Reverse Jade Lizard';
  return 'Custom ' + n + '-leg strategy';
}
CH.strategyName = strategyName;
function legLine(l, A) { return (l.side === 'BUY' ? 'Buy ' : 'Sell ') + (l.lots || 1) + ' × ' + (l.type === 'FUTURE' ? A.symbol + ' future' : F.int(l.strike) + ' ' + (l.type === 'CALL' ? 'Call' : 'Put') + ' · ' + expLabel(l.expiry)) + (l.price ? ' @ ' + F.num(l.price, 1) : ''); }
CH.explainStrategy = function () {
  const AN = CG.analyse; const legs = ((AN && AN.legs) || []).filter((l) => l.status !== 'SQUARED_OFF'); const asset = (AN && AN.asset) || st.asset; const A = CG.ASSETS[asset] || CG.ASSETS.BTC;
  if (!legs.length) return 'There are no legs in the Builder yet. Click a Bid or Ask price in the chain (or press B / S on a strike) to add one — then ask me again and I will summarise max profit, max loss, breakevens and probability of profit.';
  let r; try { r = CG.analyze(legs, asset); } catch (e) { return 'I could not price this strategy right now — try again after the next tick.'; }
  const name = strategyName(legs, AN);
  const mp = isFinite(r.maxProfit) ? '+' + F.money(r.maxProfit) : 'unlimited'; const ml = isFinite(r.maxLoss) ? '-' + F.money(Math.abs(r.maxLoss)) : 'unlimited';
  const be = r.breakevens.length ? r.breakevens.map((b) => F.int(b) + ' (' + F.pct((b / r.spot - 1) * 100, 1) + ' from spot)').join(' and ') : 'none — the position is entirely in profit or loss at expiry';
  const prem = r.netPremium >= 0 ? 'You collect a net credit of ' + F.money(r.netPremium) : 'You pay a net debit of ' + F.money(-r.netPremium);
  const qty = legs.reduce((s, l) => s + (l.lots || 1), 0) * r.lot; const d = r.greeks.delta; const bias = Math.abs(d) < qty * 0.12 ? 'neutral' : d > 0 ? 'bullish' : 'bearish';
  const risk = !isFinite(r.maxLoss) ? 'risk is open-ended, so size it carefully' : isFinite(r.maxProfit) ? 'both risk and reward are capped' : 'risk is capped while reward is open-ended';
  const theta = r.greeks.theta >= 0 ? 'time decay works for you' : 'time decay works against you';
  const pop = r.pop == null ? '—' : Math.round(r.pop * 100) + '%';
  return name + ' on ' + A.name + ' (' + A.symbol + ') · ' + legs.length + ' leg' + (legs.length > 1 ? 's' : '') + ' · spot ' + F.num(r.spot, A.price > 1000 ? 1 : 2) + '\n' + legs.map((l) => '• ' + legLine(l, A)).join('\n') +
    '\n\n' + prem + '. Max profit ' + mp + ', max loss ' + ml + '. Breakeven' + (r.breakevens.length > 1 ? 's' : '') + ': ' + be + '. Probability of profit ' + pop + (r.rewardRisk ? ' · reward : risk 1 : ' + F.num(1 / r.rewardRisk, 2).replace(/\.00$/, '') : '') + '. Estimated margin ' + F.money(r.margin) + '.' +
    '\n\nGreeks now — Δ ' + F.signed(d, 4) + ' ' + A.symbol + ', Θ ' + F.signedMoney(r.greeks.theta) + ' per day, ν ' + F.signedMoney(r.greeks.vega) + ' per 1% IV.' +
    '\n\nRead: ' + bias + ' bias; ' + risk + '; ' + theta + '. Not financial advice.';
};
const ANSWERS = [
  { k: /explain|summar|this strategy|my strategy|what am i holding/i, a: () => CH.explainStrategy() },
  { k: /probab|\bpop\b/i, a: 'Probability of Profit (POP) is the estimated chance that your strategy finishes above breakeven at expiry. HapieCoin derives it from the current futures price, the implied volatility of your legs and the days to expiry. Above 60% is shown as high probability, 40–60% as moderate and below 40% as low. It is a statistical estimate, not a guarantee.' },
  { k: /mark|bid|ask|basis|realis|realiz/i, a: 'Mark price P&L uses the exchange mark price — the same figure Delta Exchange shows. Bid/Ask (executable) P&L uses the price you would actually get if you closed right now: long legs at the bid and short legs at the ask. The two differ by roughly the bid/ask spread, more on illiquid strikes. Switch the basis in Settings → P&L Settings or from the Basis item in the portfolio bar.' },
  { k: /connect|delta|api|exchange|key|secret|whitelist/i, a: 'Open Settings (gear icon) → API Settings. Create an API key on Delta Exchange (Account → API Keys), whitelist the IP 172.236.179.136, then paste the API key and secret and press Connect & Save. Once connected the header shows your wallet balance and the Live Trade button places real orders.' },
  { k: /leg|chain|strike|\badd\b/i, a: 'To add a leg, open the Options Chain tab on the left and click the Bid or Ask price of any Call or Put — a B/S selector appears on that strike. Pick Buy or Sell and the quantity, and the leg is added to your Strategy Legs on the right. Keyboard: j / k move the strike cursor, B / S add a buy or sell leg. Add up to 10 legs, then use the Payoff Diagram to see max profit, max loss and breakevens.' },
  { k: /paper|virtual|start|stop|square/i, a: 'Build your legs, then click Paper Trade in the Strategy Legs panel. Give the strategy a name, review the order preview (legs, net premium, margin) and click Start Paper Trade. The trade appears in the Paper Trades tab with live P&L. Open it to square off individual legs or stop the whole trade — virtual funds only, no real money.' },
  { k: /alert|notify|telegram|push/i, a: 'Open the bell icon in the header (or press Ctrl K and type “alert”) to manage alerts. You can arm price alerts (BTC ≥ 82,000), IV rank alerts and strategy P&L alerts, delivered by push, email or Telegram. Alerts are evaluated on every price tick and show a toast when they trigger.' },
  { k: /shortcut|keyboard|palette|ctrl|command/i, a: 'Press Ctrl K (⌘ K on Mac) anywhere to open the command palette — jump to any screen, switch asset, toggle theme or density, create an alert or log out. Press ? to see every keyboard shortcut: j / k strike cursor, B / S add legs, E next expiry, Shift E previous expiry, T theme, D density.' },
  { k: /template|iron|condor|straddle|strangle|spread|butterfly|lizard/i, a: 'The Strategy tab includes 28 ready-made templates — Bull Call Spread, Iron Condor, Straddles, Strangles, Butterflies, Jade Lizard and more, grouped by Bullish, Bearish, Neutral and Others. Click a template to load its legs at the current ATM strike; you can still edit strikes, expiry and quantity before trading.' },
  { k: /greek|delta\b|theta|vega|gamma/i, a: 'The Greeks tab shows portfolio and per-leg Greeks. Delta is the P&L change per $1 move in the futures price, Gamma is how fast Delta changes, Theta is the daily time decay and Vega is the sensitivity to a 1% change in implied volatility. Multi-leg strategies net these out across legs, and the portfolio bar at the bottom nets them across all open strategies.' },
  { k: /margin|capital|collateral/i, a: 'Expected Required Margin is the capital Delta Exchange would block for the strategy: long options need only the premium paid, short options need an initial margin on the notional, and spreads get margin benefit. The figure in the Payoff panel updates as you change legs and quantity.' },
  { k: /\blot|quantity|size|density|compact/i, a: 'One lot equals the contract size on Delta Exchange: 0.001 BTC, 0.01 ETH and 0.001 XAUT by default. Change these in Settings → Lot Size Settings; quantity in the chain and strategy legs is always lots × lot size. Prefer denser tables? Toggle Density (D) in the header for 28px rows.' },
  { k: /plan|subscri|upgrade|renew|coupon|referr/i, a: 'Plans are managed under Settings → My Subscription. Free includes the live chain and 5 paper trades a month; Basic, Pro and Elite add templates, Greeks, unlimited paper trades, live trading and Market Analytics. Coupons can be applied at checkout, and your referral code (Settings → My Referrals) earns commission on every paid signup.' },
  { k: /currency|inr|usd|rupee/i, a: 'Click the CCY item in the portfolio bar (or Settings → Currency Settings) to switch the display currency. All calculated values (P&L, Margin, Net Premium) are converted with the rate from Currency Settings (default $1 = ₹83.5). Chain prices stay in USD as quoted by the exchange.' }
];
const FALLBACK = 'I can help with using HapieCoin — the options chain, building strategies, paper and live trades, Greeks, alerts, shortcuts, settings and subscriptions. Try one of the suggestions above, or email support@hapiecoin.com for anything else.';
const VISITOR = 'You are in limited visitor mode — I can explain how HapieCoin works, but log in for full support with your own strategies and trades.';
const answerFor = (q) => { const hit = ANSWERS.find((x) => x.k.test(q)); const a = hit ? (typeof hit.a === 'function' ? hit.a() : hit.a) : FALLBACK; return a + (!st.loggedIn ? '\n\n' + VISITOR : ''); };
const chat = { msgs: [], panel: null, btn: null, typing: null };
function chatButton() {
  if (chat.btn) return chat.btn;
  const b = h('<button class="cgc-chat-btn" data-tour="chat-launcher" title="Ask HapieCoin Assistant (drag to move)" aria-label="Ask HapieCoin Assistant (drag to move)">' + I('chat') + '</button>');
  document.body.appendChild(b); chat.btn = b;
  try { const p = JSON.parse(localStorage.getItem('cg-v2-chat-pos') || 'null'); if (p) { b.style.left = Math.min(p.x, window.innerWidth - 48) + 'px'; b.style.top = Math.min(p.y, window.innerHeight - 48) + 'px'; b.style.right = 'auto'; b.style.bottom = 'auto'; } } catch (e) { }
  let start = null, moved = false;
  b.addEventListener('pointerdown', (e) => { const r = b.getBoundingClientRect(); start = { x: e.clientX, y: e.clientY, l: r.left, t: r.top }; moved = false; b.setPointerCapture(e.pointerId); });
  b.addEventListener('pointermove', (e) => { if (!start) return; const dx = e.clientX - start.x, dy = e.clientY - start.y; if (!moved && Math.hypot(dx, dy) < 5) return; moved = true; b.classList.add('drag'); const x = Math.max(4, Math.min(start.l + dx, window.innerWidth - 44)), y = Math.max(4, Math.min(start.t + dy, window.innerHeight - 44)); b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.right = 'auto'; b.style.bottom = 'auto'; if (chat.panel) placePanel(); });
  const end = () => { if (!start) return; b.classList.remove('drag'); if (moved) { const r = b.getBoundingClientRect(); try { localStorage.setItem('cg-v2-chat-pos', JSON.stringify({ x: r.left, y: r.top })); } catch (er) { } } else toggleChat(); start = null; };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChat(); } });
  return b;
}
function placePanel() { const p = chat.panel; if (!p) return; const r = chat.btn.getBoundingClientRect(); const w = p.offsetWidth, hh = p.offsetHeight; let left = r.right - w, top = r.top - hh - 10; if (top < 8) top = Math.min(r.bottom + 10, window.innerHeight - hh - 8); left = Math.max(8, Math.min(left, window.innerWidth - w - 8)); p.style.left = left + 'px'; p.style.top = Math.max(8, top) + 'px'; }
function toggleChat() { chat.panel ? closeChat() : openChat(); }
function closeChat() { if (chat.panel) { chat.panel.remove(); chat.panel = null; } }
function openChat() {
  const p = h('<div class="cgc-chat" role="dialog" aria-label="HapieCoin Assistant"><div class="cgc-chat-head">' + I('chat') + '<div><b>HapieCoin Assistant</b><span>' + (st.loggedIn ? 'Platform help · not financial advice' : 'Limited visitor mode · log in for full support') + '</span></div>' + (onAnalyse() ? '<button class="cgc-hbtn" data-explain title="Explain this strategy" aria-label="Explain this strategy">' + I('sparkles') + '</button>' : '<span style="margin-left:auto"></span>') + '<button class="cgc-hbtn" aria-label="Close" data-close>' + I('x') + '</button></div><div class="cgc-chat-body" data-body></div><form class="cgc-chat-form"><input class="input" placeholder="Ask a question…" data-q autocomplete="off"><button class="btn btn-primary btn-icon" type="submit" aria-label="Send" title="Send">' + I('send') + '</button></form><div class="cgc-chat-foot">Need a human? <a href="mailto:support@hapiecoin.com" target="_blank" rel="noreferrer">Email</a> support@hapiecoin.com</div></div>');
  document.body.appendChild(p); chat.panel = p; placePanel();
  const body = p.querySelector('[data-body]');
  if (!chat.msgs.length) chat.msgs.push({ who: 'bot', text: 'Hi! Ask me anything about using HapieCoin — or try one of these:', chips: true });
  chat.msgs.forEach((m) => body.appendChild(renderMsg(m)));
  body.scrollTop = body.scrollHeight;
  p.querySelector('[data-close]').onclick = closeChat;
  const ex = p.querySelector('[data-explain]'); if (ex) ex.onclick = () => ask(EXPLAIN_Q);
  p.addEventListener('click', (e) => { const c = e.target.closest('[data-chip]'); if (c) ask(c.dataset.chip); });
  p.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const inp = p.querySelector('[data-q]'); const q = inp.value.trim(); if (!q) return; inp.value = ''; ask(q); });
  p.querySelector('[data-q]').focus();
}
function renderMsg(m) { if (m.chips) { const d = h('<div class="cgc-msg bot"></div>'); d.textContent = m.text; const chips = h('<div class="cgc-chips mt-2"></div>'); suggestions().forEach((s) => { const b = h('<button type="button" data-chip="' + esc(s) + '" class="' + (s === EXPLAIN_Q ? 'hi' : '') + '">' + (s === EXPLAIN_Q ? I('sparkles') : '') + esc(s) + '</button>'); chips.appendChild(b); }); d.appendChild(chips); return d; } const d = h('<div class="cgc-msg ' + (m.who === 'me' ? 'me' : 'bot') + '"></div>'); d.textContent = m.text; return d; }
function ask(q) {
  if (chat.typing) return;
  const body = chat.panel && chat.panel.querySelector('[data-body]'); const me = { who: 'me', text: q }; chat.msgs.push(me); if (body) { body.appendChild(renderMsg(me)); body.scrollTop = body.scrollHeight; }
  const full = answerFor(q); const bot = { who: 'bot', text: '' }; chat.msgs.push(bot);
  const el = h('<div class="cgc-msg bot"><span class="cgc-typing"><i></i><i></i><i></i></span></div>'); if (body) { body.appendChild(el); body.scrollTop = body.scrollHeight; }
  chat.typing = setTimeout(() => { let n = 0; const step = Math.max(1, Math.ceil(full.length / 45)); el.textContent = ''; const iv = setInterval(() => { n = Math.min(full.length, n + step); el.textContent = full.slice(0, n); bot.text = el.textContent; if (body) body.scrollTop = body.scrollHeight; if (n >= full.length) { clearInterval(iv); chat.typing = null; } }, 33); chat.typing = iv; }, 450);
}
CH.openAssistant = openChat; CH.closeAssistant = closeChat; CH.askAssistant = (q) => { if (!chat.panel) openChat(); ask(q); }; CH.assistantOpen = () => !!chat.panel;
CG.on('auth', () => { if (chat.panel) { closeChat(); } chat.msgs = []; });
CG.on('route', (cur) => { document.documentElement.style.setProperty('--cgc-dock', cur && cur.path === '/analyse' ? '56px' : '16px'); if (chat.panel) { closeChat(); } chat.msgs = []; });
window.addEventListener('resize', () => { if (chat.panel) placePanel(); });
if (document.body) chatButton(); else document.addEventListener('DOMContentLoaded', chatButton);
