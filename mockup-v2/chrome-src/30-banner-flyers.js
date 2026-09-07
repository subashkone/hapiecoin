// ---------- plan banner (slim one-line strip) ----------
function bannerState() {
  const S = M.subscription || {}; const exp = S.expiresAt ? new Date(S.expiresAt) : null; const days = exp ? Math.ceil((exp - CG.NOW) / 86400000) : null;
  if (S.status === 'expired' || S.status === 'cancelled' || (days != null && days < 0)) return { kind: 'expired', text: 'Your plan has expired.', btn: 'Renew Plan' };
  if (S.status === 'free' || S.planId === 'p_free' || !S.planId) return { kind: 'free', text: 'Your free plan is active.', btn: 'Upgrade' };
  if (days != null && days <= 7) return { kind: 'expiring', text: 'Your plan expires soon — ' + days + ' day' + (days === 1 ? '' : 's') + ' left.', btn: 'Renew Plan' };
  return { kind: 'active', text: 'Congratulations! Your plan is active until ' + (exp ? F.dateIN(exp) : ''), dismiss: true };
}
let bannerDismissed = null; try { bannerDismissed = sessionStorage.getItem('cg-plan-banner-dismissed'); } catch (e) { }
let bannerEls = [];
const liveBanners = () => (bannerEls = bannerEls.filter((e) => e.isConnected));
function renderBanner(el) {
  const b = bannerState();
  if (!st.loggedIn || (b.dismiss && bannerDismissed === b.text)) { el.innerHTML = ''; return; }
  const plan = (M.subscription && M.subscription.planName) || 'Plan';
  el.innerHTML = '<div class="cgc-banner ' + b.kind + '" role="status"><i class="stripe"></i>' + I(b.kind === 'active' ? 'check' : b.kind === 'expired' ? 'alert' : 'bell') + '<span class="micro">' + esc(plan) + '</span><span>' + esc(b.text) + '</span>' + (b.btn ? '<a class="btn btn-outline btn-xs" href="#/subscription">' + esc(b.btn) + ' →</a>' : '') + (b.dismiss ? '<button class="cgc-x" data-dismiss aria-label="Dismiss">' + I('x', 12) + '</button>' : '') + '</div>';
  const d = el.querySelector('[data-dismiss]'); if (d) d.onclick = () => { bannerDismissed = b.text; try { sessionStorage.setItem('cg-plan-banner-dismissed', b.text); } catch (e) { } bannerEls.forEach(renderBanner); };
}
CH['plan-banner'] = function (el) { liveBanners(); if (!bannerEls.includes(el)) bannerEls.push(el); renderBanner(el); };
CH.planBannerState = bannerState;
CH.refreshPlanBanner = () => liveBanners().forEach(renderBanner);
['subscription-changed', 'auth'].forEach((ev) => CG.on(ev, CH.refreshPlanBanner));
// ---------- banner flyers (popup carousel) ----------
const activeBanners = () => (M.banners || []).filter((b) => b.isActive && (!b.startsAt || new Date(b.startsAt) <= CG.NOW) && (!b.endsAt || new Date(b.endsAt) >= CG.NOW));
const toRoute = (url) => { const m = /hapiecoin\.com(\/[^?#]*)/.exec(url || ''); return m ? m[1] : null; };
CH.showFlyers = function () {
  const list = activeBanners(); if (!list.length) { CG.toast({ title: 'No active flyers', description: 'There are no banners scheduled right now.' }); return null; }
  let i = 0;
  const el = h('<div class="cgc-flyer"><div class="cg-dialog-body"><div data-slide></div><div class="cgc-flyer-row">' + (list.length > 1 ? '<button class="cgc-flyer-nav" aria-label="Previous flyer" data-prev>' + I('left') + '</button><div class="cgc-dots" data-dots></div><button class="cgc-flyer-nav" aria-label="Next flyer" data-next>' + I('right') + '</button>' : '<div class="cgc-dots" data-dots></div>') + '<span class="cgc-freq" data-freq></span><span data-cta></span></div></div></div>');
  const slide = el.querySelector('[data-slide]'), dots = el.querySelector('[data-dots]'), freq = el.querySelector('[data-freq]'), cta = el.querySelector('[data-cta]');
  const render = () => { const b = list[i]; const r = toRoute(b.linkUrl); slide.innerHTML = '<div class="cgc-flyer-card"><span class="micro">Announcement · ' + (i + 1) + ' of ' + list.length + '</span><h3>' + esc(b.title) + '</h3><p>' + esc(b.description) + '</p><div class="cgc-flyer-meta"><span>' + (b.startsAt ? F.dateIN(b.startsAt) : '') + (b.endsAt ? ' → ' + F.dateIN(b.endsAt) : '') + '</span></div></div>'; freq.textContent = b.frequency ? b.frequency.replace(/_/g, ' ') : ''; cta.innerHTML = b.linkUrl ? (r ? '<a class="btn btn-primary btn-sm" href="#' + esc(r) + '" data-view>View ' + I('external', 13) + '</a>' : '<a class="btn btn-primary btn-sm" href="' + esc(b.linkUrl) + '" target="_blank" rel="noopener,noreferrer">View ' + I('external', 13) + '</a>') : ''; dots.innerHTML = list.map((_, k) => '<i class="' + (k === i ? 'on' : '') + '"></i>').join(''); };
  render();
  let unRoute = null; const hd = CG.modal.open(el, { size: 'sm', onClose: () => { if (unRoute) unRoute(); CG.emit('flyers-closed'); } }); unRoute = CG.on('route', () => hd.close());
  el.addEventListener('click', (e) => { if (e.target.closest('[data-prev]')) { i = (i - 1 + list.length) % list.length; render(); } else if (e.target.closest('[data-next]')) { i = (i + 1) % list.length; render(); } else if (e.target.closest('[data-view]')) hd.close(); });
  return hd;
};
let flyersShown = false; try { flyersShown = !!sessionStorage.getItem('cg-flyers-shown'); } catch (e) { }
CG.on('route', (cur) => {
  if (!cur || cur.path !== '/analyse' || !st.loggedIn) return;
  const needTour = !st.tourDone;
  if (!flyersShown && activeBanners().length) {
    flyersShown = true; try { sessionStorage.setItem('cg-flyers-shown', '1'); } catch (e) { }
    setTimeout(() => { CH.showFlyers(); if (needTour) { const un = CG.on('flyers-closed', () => { un(); setTimeout(() => CH.autoTour(), 300); }); } }, 400);
  } else if (needTour) setTimeout(() => CH.autoTour(), 500);
});
