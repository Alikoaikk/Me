// node flow.js <outdir> [W H]  — the real reader flow, one browser session:
// hero → scroll to the name → wait for the burst → scroll up (allowed, the
// burst rewinds) and back → on into the profile → its end → press the button → the release → the warp → the arrival → the
// system → a planet → the pilot → try to scroll. Screenshots at every beat, JSON
// summary on stdout.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const [,, outdir, W = 1280, H = 800] = process.argv;
fs.mkdirSync(outdir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
           '--enable-webgl', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
  await page.goto(process.env.URL || 'http://localhost:8123/galaxy.html', { waitUntil: 'networkidle0', timeout: 120000 });
  const state = () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement); const g = n => cs.getPropertyValue(n).trim();
    const h = innerHeight;
    return { y: +(scrollY / h).toFixed(2), max: +((document.documentElement.scrollHeight - h) / h).toFixed(2),
             burst: g('--burst'), release: g('--release'), planetIn: g('--planet-in'),
             warping: document.documentElement.classList.contains('is-warping'),
             system: window.system ? window.system.state() : null };
  });
  const to = (vh) => page.evaluate(v => { scrollTo(0, v * innerHeight); dispatchEvent(new Event('scroll')); }, vh);
  const shot = async (name) => { await page.screenshot({ path: `${outdir}/${name}.png` }); console.log(name, JSON.stringify(await state())); };

  await sleep(4000); await shot('01-hero');
  await to(1.8); await sleep(4000); await shot('02-approach');
  await to(2.7); await sleep(24000); await shot('03-name');        // written, button under the quote
  await to(2.0); await sleep(4000); await shot('03b-scroll-up-rewinds'); // allowed before the press
  await to(2.7); await sleep(8000);
  await to(3.35); await sleep(3000); await shot('03c-profile');   // the name scrolled up, who Ali is
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await sleep(3000); await shot('03d-button');
  await page.evaluate(() => document.getElementById('launchBtn').click());
  await sleep(1000); await shot('04-release');                     // the letters letting go (timed)
  for (let i = 0; i < 20; i++) { await sleep(500); if ((await state()).warping) break; }
  await sleep(1200); await shot('05-warp');
  for (let i = 0; i < 40; i++) { await sleep(1000); if (!(await state()).warping) break; }
  await sleep(2500); await shot('06-arrival');
  for (let i = 0; i < 40; i++) { await sleep(1000); if (await page.evaluate(() => document.getElementById('planet').classList.contains('is-system'))) break; }
  await sleep(1500); await shot('07-system');                    // the pull-back done, the system live
  await page.evaluate(() => window.system.select(3)); await sleep(3500); await shot('08-planet');
  await page.evaluate(() => window.system.overview()); await sleep(2500);
  await page.evaluate(() => window.system.select('pilot')); await sleep(3500); await shot('09-pilot');
  await page.mouse.wheel({ deltaY: 1200 }); await sleep(1000); await shot('10-wheel-after-launch'); // the page is one screen: must stay at 0
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
