// node prof.js [W H variant] — real GPU (--use-angle=metal). Times every rAF callback (by source) and the
// gaps between frames, during: idle overview, a flight to planet 3, the time
// after, a flight to the pilot, and back to overview.
const puppeteer = require('puppeteer-core');
const [,, W = 1280, H = 800, variant = 'base'] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__prof = { on: false, cb: {}, frames: [], last: 0 };
    window.requestAnimationFrame = function (cb) {
      return raf(function (t) {
        const P = window.__prof;
        const s = performance.now(); cb(t); const d = performance.now() - s;
        if (P.on) {
          const src = (cb.toString().match(/galaxy|koaik|stepFlight|renderer|setAnimationLoop|onAnimationFrame/) || [''])[0] || (cb.name || 'anon');
          (P.cb[src] = P.cb[src] || []).push(d);
          if (t !== P.last) { P.frames.push(t); P.last = t; }
        }
      });
    };
  });
  await page.goto('http://localhost:8123/galaxy.html', { waitUntil: 'networkidle0', timeout: 120000 });
  if (variant === 'noblur') await page.addStyleTag({ content: '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' });
  if (variant === 'nopanel') await page.addStyleTag({ content: '#sysPanel{display:none!important}' });
  if (variant === 'noemoji') await page.evaluate(() => window.portfolioData.projects.forEach(p => p.icon = ''));
  await page.evaluate(() => { const r = document.documentElement.classList; r.add('is-sealed', 'is-launched', 'is-arrived'); scrollTo(0, 0); window.koaik.arm(); });
  await sleep(300); await page.evaluate(() => window.koaik.reveal());
  for (let i = 0; i < 40; i++) { await sleep(500); if (await page.evaluate(() => window.system && window.system.state().ready)) break; }
  await sleep(1500);
  async function measure(label, action, ms) {
    await page.evaluate(() => { window.__prof.on = true; window.__prof.cb = {}; window.__prof.frames = []; window.__prof.last = 0; });
    if (action) await page.evaluate(action);
    await sleep(ms);
    const r = await page.evaluate(() => { const P = window.__prof; P.on = false;
      const gaps = []; for (let i = 1; i < P.frames.length; i++) gaps.push(P.frames[i] - P.frames[i - 1]);
      const st = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return { n: a.length, avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
      const cbs = {}; for (const k in P.cb) cbs[k] = st(P.cb[k]);
      const long = []; for (let i = 1; i < P.frames.length; i++) { const g = P.frames[i] - P.frames[i - 1]; if (g > 20) long.push(+g.toFixed(0) + '@' + (P.frames[i - 1] - P.frames[0]).toFixed(0)); }
      return { gap: st(gaps), long }; });
    console.log(label, JSON.stringify(r));
  }
  await measure('idle-overview', null, 2000);
  await measure('fly-to-planet3', () => window.system.select(3), 2600);
  await measure('at-planet3', null, 2000);
  await measure('back-overview', () => window.system.overview(), 2600);
  await measure('fly-to-pilot', () => window.system.select('pilot'), 2600);
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
