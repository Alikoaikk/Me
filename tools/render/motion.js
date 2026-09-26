// node motion.js <label> <target> [retarget]  (REAL GPU: --use-angle=metal)
// Selects <target> (a planet index or "pilot") through window.system and
// samples the camera and the body every frame for 3.2 s. Reports: time to
// the first visible movement, the worst single-frame jump relative to its
// neighbours (a snap; 1.0 = none), when the camera settles relative to the
// (orbiting) body, when the card opens, and where the body ends on screen.
// [retarget] re-selects another body 600 ms in, to test a re-aim.
const puppeteer = require('puppeteer-core');
const [,, label = 'run', target = '0', retarget = ''] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto('http://localhost:8123/galaxy.html', { waitUntil: 'networkidle0', timeout: 120000 });
  await page.evaluate(() => { const r = document.documentElement.classList; r.add('is-sealed', 'is-launched', 'is-arrived'); scrollTo(0, 0); window.koaik.arm(); });
  await sleep(300); await page.evaluate(() => window.koaik.reveal());
  for (let i = 0; i < 40; i++) { await sleep(500); if (await page.evaluate(() => window.system && window.system.state().ready)) break; }
  await sleep(1500);
  const which = target === 'pilot' ? 'pilot' : +target;
  const re = retarget === '' ? null : (retarget === 'pilot' ? 'pilot' : +retarget);
  const r = await page.evaluate((which, re) => new Promise(res => {
    const S = []; const t0 = performance.now(); let switched = false;
    window.system.select(which);
    const tick = () => {
      const t = performance.now() - t0;
      if (re !== null && !switched && t > 600) { switched = true; window.system.select(re); }
      const cur = switched ? re : which;
      const p = window.system.pose(cur);
      S.push({ t, cam: p.cam, body: p.body, ndc: p.ndc, dist: p.dist, card: document.getElementById('sysPanel').classList.contains('is-open') });
      if (t < 3200) requestAnimationFrame(tick); else res(S);
    };
    requestAnimationFrame(tick);
  }), which, re);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let firstMove = null, maxJump = 0, maxJumpAt = 0, speeds = [];
  const rel = x => [x.cam[0] - x.body[0], x.cam[1] - x.body[1], x.cam[2] - x.body[2]];
  for (let i = 1; i < r.length; i++) {
    const step = d(r[i].cam, r[i - 1].cam) / Math.max(0.05, r[i].dist);
    r[i].relStep = d(rel(r[i]), rel(r[i - 1])) / Math.max(0.05, r[i].dist);
    speeds.push(step);
    if (firstMove === null && d(r[i].cam, r[0].cam) / r[0].dist > 0.01) firstMove = Math.round(r[i].t);
  }
  // A jump = a step much larger than its neighbours (a snap), not just fast motion.
  for (let i = 2; i < speeds.length - 1; i++) { const nb = Math.max(1e-6, (speeds[i - 1] + speeds[i + 1]) / 2); const ratio = speeds[i] / nb; if (ratio > maxJump && speeds[i] > 0.004) { maxJump = ratio; maxJumpAt = Math.round(r[i + 1].t); } }
  const last = r[r.length - 1];
  const cardAt = (r.find(x => x.card) || {}).t;
  // settle: first time after which the camera's per-frame move stays < 0.1% of the distance
  let settle = null; for (let i = r.length - 1; i >= 1; i--) { if (r[i].relStep > 0.001) { settle = Math.round(r[i].t); break; } }
  console.log(label, JSON.stringify({ target, frames: r.length, firstMoveMs: firstMove, snapRatio: +maxJump.toFixed(1), snapAtMs: maxJumpAt, settleMs: settle, cardOpenMs: cardAt ? Math.round(cardAt) : null, endNdc: last.ndc, endDistR: last.dist }), 'errors', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
