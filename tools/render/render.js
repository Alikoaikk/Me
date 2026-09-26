// node render.js <url> <out.png> [scrollVh=0] [settleMs=4000]
const puppeteer = require('puppeteer-core');
const [,, url, out, vhArg = '0', settleArg = '4000'] = process.argv;
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
           '--enable-webgl', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: +(process.env.W || 1280), height: +(process.env.H || 800), deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  const vh = parseFloat(vhArg);
  if (vh > 0) await page.evaluate(v => window.scrollTo(0, v * innerHeight), vh);
  await new Promise(r => setTimeout(r, parseInt(settleArg)));
  const info = await page.evaluate(async () => {
    let n = 0; const t0 = performance.now();
    await new Promise(r => { const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else r(); }; requestAnimationFrame(tick); });
    return { noWebgl: document.documentElement.hasAttribute('data-no-webgl'),
             fps: n, scrollY: scrollY, zoom: getComputedStyle(document.documentElement).getPropertyValue('--zoom'),
             burst: getComputedStyle(document.documentElement).getPropertyValue('--burst') };
  });
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ out, ...info, errors: errors.slice(0, 5) }));
  await browser.close();
})().catch(e => { console.error('RENDER FAILED:', e.message); process.exit(1); });
