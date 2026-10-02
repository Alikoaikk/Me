// node name.js <prefix> [W H DPR] — the name, cropped, at a list of times after load (TIMES=ms,ms…)
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [,, out = 'name', W = 1470, H = 840, DPR = 2] = process.argv;
const TIMES = (process.env.TIMES || '3200').split(',').map(Number);
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/404|Failed to load/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.setViewport({ width: +W, height: +H, deviceScaleFactor: +DPR });
  if (process.env.REDUCE) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const t0 = Date.now();
  await page.goto((process.env.URL || 'http://localhost:8123/galaxy.html') + (process.env.HASH || ''), { waitUntil: 'load', timeout: 60000 });
  const tl = Date.now() - t0;
  const full = !!process.env.FULL;
  const ch = Math.round(+H * (process.env.CH || 0.30)), cy = Math.round(+H * 0.52 - ch / 2);
  const cw = Math.min(+W, Math.round(+H * (process.env.CW || 1.15))), cx = Math.round((+W - cw) / 2);
  let k = 0, start = Date.now();
  for (const t of TIMES) {
    const wait = t - (Date.now() - start); if (wait > 0) await sleep(wait);
    await page.screenshot(full ? { path: `${out}-${k++}.png` } : { path: `${out}-${k++}.png`, clip: { x: cx, y: cy, width: cw, height: ch } });
  }
  const info = await page.evaluate(() => (window.galaxySky && window.galaxySky.name) ? window.galaxySky.name() : null);
  console.log('load', tl, 'name', JSON.stringify(info), 'errors', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
