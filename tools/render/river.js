// node river.js <prefix> [W H DPR] — galaxy.html's river (the name's stars running
// through the cut in the profile's sheet) at a set of scroll positions, one still each:
// <prefix>-0.png … Prints the page's measurements and every console error / warning
// (a shader that fails to compile shows up here as "galaxy shader: …").
//   POS=0,0.25,0.6,1.2,end   scroll positions in screens ("end" = the page's end)
//   WAIT=1400                ms to settle at each position
//   HASH=#build              open on a section
//   REDUCE=1                 emulate prefers-reduced-motion
//   GL=metal                 the real GPU on a Mac (default: SwiftShader, any machine)
//   CHROME=/path/to/chrome   the browser (default: Chrome on macOS)
//   URL=http://…/galaxy.html the page (default: localhost:8123)
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [,, out = 'river', W = 1470, H = 840, DPR = 1] = process.argv;
const POS = (process.env.POS || '0,0.25,0.6,1.2,1.9,2.3,3.0,3.6,end').split(',');
const GL = process.env.GL === 'metal'
  ? ['--use-angle=metal', '--enable-gpu']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-dev-shm-usage'];
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: [...GL, '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if ((m.type() === 'error' || m.type() === 'warning') && !/404|Failed to load resource/.test(m.text()))
      errors.push(m.type() + ': ' + m.text().slice(0, 400));
  });
  await page.setViewport({ width: +W, height: +H, deviceScaleFactor: +DPR });
  if (process.env.REDUCE) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto((process.env.URL || 'http://localhost:8123/galaxy.html') + (process.env.HASH || ''),
                  { waitUntil: 'load', timeout: 120000 });
  await sleep(+(process.env.BOOT || 2800));
  const info = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    return { max: document.documentElement.scrollHeight - innerHeight,
             sheetTop: Math.round(sheet.getBoundingClientRect().top + scrollY),
             cutChars: (sheet.style.getPropertyValue('--sheet-cut') || '').length,
             sideways: document.documentElement.scrollWidth > innerWidth };
  });
  console.log('info', JSON.stringify(info));
  let k = 0;
  for (const q of POS) {
    const y = q === 'end' ? info.max : Math.round(parseFloat(q) * H);
    await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), y);
    await sleep(+(process.env.WAIT || 1400));
    await page.screenshot({ path: `${out}-${k++}.png` });
  }
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
