// Deterministic A/B: seeded RNG + hand-stepped clock, so two runs differ only in the source.
const puppeteer = require('puppeteer-core');
const [,, url, out, vh, x0, y0, x1, y1, post='10'] = process.argv;
const X0=+x0, Y0=+y0, X1=+x1, Y1=+y1;
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => {
    let a = 0x9e3779b9;
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    let now = 0; const q = [];
    performance.now = () => now;
    window.requestAnimationFrame = cb => (q.push(cb), q.length);
    window.cancelAnimationFrame = () => {};
    window.__step = n => { for (let i = 0; i < n; i++) { now += 1000 / 60; const cbs = q.splice(0); for (const cb of cbs) cb(now); } };
  });
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(v => window.scrollTo(0, v * innerHeight), +vh);
  await page.evaluate(() => __step(150));                 // settle: zoom converges, disc rotates
  await page.mouse.move(X0, Y0);
  await page.evaluate(() => __step(2));
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    await page.mouse.move(X0 + t * (X1 - X0), Y0 + t * (Y1 - Y0));
    await page.evaluate(() => __step(2));
  }
  await page.evaluate(n => __step(n), +post);
  await page.screenshot({ path: out });
  console.log('wrote', out, JSON.stringify(errors.filter(e => !/404/.test(e)).slice(0, 4)));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
