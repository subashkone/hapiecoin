// Visits every route of the assembled clone, records console/page errors + horizontal overflow, screenshots each.
const { chromium } = require('../pw/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const FILE = 'file:///C:/Users/localPC/AppData/Local/Temp/claude/e--Subash-Projects-CoinGreeks/d3615c97-79cc-4291-b058-71a5f85d2a88/scratchpad/clone/coingreeks-clone.local.html';
const html = fs.readFileSync(path.join(__dirname, 'coingreeks-clone.html'), 'utf8');
const routeRe = new RegExp('<section(?=[^>]*class="[^"]*screen)[^>]*data-route="([^"]+)"', 'g');
let routes = Array.from(new Set(Array.from(html.matchAll(routeRe)).map((m) => m[1]))).filter((r) => r !== '*');
routes = routes.map((r) => r.replace(':symbol', 'BTC').replace(':slug', 'layer-1').replace(':exchange', 'Binance'));
const extra = ['/auth?tab=signup', '/auth?tab=otp-login', '/auth?tab=forgot', '/analytics/markets?category=memes', '/nope-404'];
routes = routes.concat(extra);
const theme = process.argv[2] || 'light';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = {}; let cur = '';
  page.on('pageerror', (e) => (errs[cur] = errs[cur] || []).push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') (errs[cur] = errs[cur] || []).push('console: ' + m.text().slice(0, 300)); });
  await page.goto(FILE + '#/'); await page.waitForTimeout(800);
  await page.evaluate((t) => { CG.theme.set(t); CG.state.loggedIn = true; CG.state.tourDone = true; CG.saveState(); try { sessionStorage.setItem('cg-flyers-shown', '1'); } catch (e) { } }, theme);
  const report = [];
  fs.mkdirSync(path.join(__dirname, 'shots', 'qa-' + theme), { recursive: true });
  for (const r of routes) {
    cur = r;
    await page.evaluate((rr) => { CG.modal.closeAll(); location.hash = '#' + rr; }, r);
    await page.waitForTimeout(1300);
    const info = await page.evaluate(() => ({ path: CG.current.path, title: document.title, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, active: (document.querySelector('section.screen.active') || {}).dataset ? document.querySelector('section.screen.active').dataset.route : null, height: document.documentElement.scrollHeight, text: (document.querySelector('section.screen.active') || document.body).innerText.length }));
    const name = r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
    await page.screenshot({ path: path.join(__dirname, 'shots', 'qa-' + theme, name + '.jpg'), type: 'jpeg', quality: 55 });
    report.push({ route: r, matched: info.active, overflow: info.overflow, height: info.height, textLen: info.text, errors: errs[r] || [] });
    console.log((errs[r] && errs[r].length ? 'ERR ' : info.overflow > 2 ? 'OVF ' : 'ok  ') + r.padEnd(42) + ' -> ' + String(info.active).padEnd(34) + ' h=' + info.height + ' ovf=' + info.overflow + ' text=' + info.text + (errs[r] ? ' ' + errs[r].slice(0, 2).join(' | ') : ''));
  }
  fs.writeFileSync(path.join(__dirname, 'qa-report-' + theme + '.json'), JSON.stringify(report, null, 1));
  const bad = report.filter((x) => x.errors.length || x.overflow > 2 || x.textLen < 40);
  console.log('\nroutes:', report.length, 'with errors:', report.filter((x) => x.errors.length).length, 'overflow:', report.filter((x) => x.overflow > 2).length, 'thin:', report.filter((x) => x.textLen < 40).length);
  await b.close();
})();
