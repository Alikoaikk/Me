// node diff.js <base> <a.png> <b.png> <diff.png> x0 y0 x1 y1 band — pixel diff, stats in/out of the sweep band.
const puppeteer = require('puppeteer-core');
const [,, base, a, b, out, x0, y0, x1, y1, band] = process.argv;
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(base + '/blank.html');
  const stats = await page.evaluate(async (a, b, x0, y0, x1, y1, band) => {
    const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const W = ia.width, H = ia.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.drawImage(ia, 0, 0); const A = g.getImageData(0, 0, W, H).data;
    g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, W, H).data;
    const D = g.createImageData(W, H);
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    let inS = 0, inN = 0, outS = 0, outN = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i+1] - B[i+1]) + Math.abs(A[i+2] - B[i+2])) / 3;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
      const px = x0 + dx * t, py = y0 + dy * t;
      const inBand = Math.hypot(x - px, y - py) < band;
      if (inBand) { inS += d; inN++; } else { outS += d; outN++; }
      D.data[i] = Math.min(255, d * 4); D.data[i+1] = inBand ? Math.min(255, d * 4) : 0; D.data[i+2] = 0; D.data[i+3] = 255;
    }
    g.putImageData(D, 0, 0);
    document.body.style.margin = '0'; document.body.appendChild(c);
    return { meanDiffInBand: inS / inN, meanDiffOutside: outS / outN, ratio: (inS / inN) / (outS / outN) };
  }, a, b, +x0, +y0, +x1, +y1, +band);
  await page.screenshot({ path: out });
  console.log(JSON.stringify(stats));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
