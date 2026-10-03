/* ============================================================
   THE RIVER ON THE LIST — work.html
   ------------------------------------------------------------
   The home page's star river (galaxy.js "THE FLOW"), small and in
   2D: one stream of stars that leaves the title, runs down the side
   margin, crosses LEVEL through some of the gaps (under the header,
   between rows, above the foot) and passes others by, on an irregular
   ROUTE, and runs on off the bottom of the page. Margins under MARGIN_MIN (phones): the side runs go
   off-screen and only the crossings show, as on the home page.

   The centreline is measured from the DOM in document px (the rows
   are read from the cards' rects, so any column count works),
   corners are quarter circles, and it is resampled every STEP px by
   arc length. A star's place is a CONVEYOR, as at home: it moves
   along the line with TIME only (SPEED px/s, each star 0.75–1.25×),
   never with scrolling. Colours are the name's and the home river's
   (SPARK_TINTS in galaxy.js — keep the two in step).

   One fixed 2D canvas UNDER the page's sheet (css/work.css): the
   sheet is solid ink, CUT along the river (cutSheet), so the stars
   and the galaxy sky behind them show only inside the channel — the
   home page's sheet and cut. Redrawn every frame, only the stars in
   the window. Reduced
   motion: the stars stand still and are redrawn on scroll only.
   ============================================================ */
(function () {
  'use strict';

  const list = document.getElementById('workList');
  const head = document.querySelector('.work-head');
  const title = document.querySelector('.work-title');
  const foot = document.querySelector('.work-foot');
  const sheet = document.getElementById('workSheet');
  const edgePaths = sheet ? sheet.querySelectorAll('.sheet-edge path') : [];
  if (!list || !head || !title) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'work-river';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.prepend(canvas);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TINTS = ['#FFFFFF', '#FFFFFF', '#DDEBFF', '#BFD8FF', '#FFE9C8'];   // galaxy.js SPARK_TINTS
  const STEP = 2;             // px between samples of the centreline
  const SPEED = 78;           // px/s along the river (galaxy.js FLOW_SPEED)
  const R_MAX = 44;           // corner radius, px
  const W_MAX = 72;           // the cut's width at most, px (home: 48–88)
  const MARGIN_MIN = 104;     // narrower side margins: band mode (galaxy.js FLOW_MARGIN_MIN)
  const DENSITY = 0.55;       // stars per px of river
  const MAX_STARS = 5000;
  const FADE_IN = 140, FADE_OUT = 320;   // px at the river's two ends
  // Which gaps the river crosses (1) or passes down its margin (0), in
  // order from the one under the header, repeating. The user's pattern:
  // "right left, down down down down" — out right from the title,
  // across LEFT under the header, down past four gaps, then across
  // RIGHT, across LEFT, down four … (on the 3-row desktop list: one
  // crossing, then straight down the left side).
  const ROUTE = [1, 0, 0, 0, 0, 1];

  /* ── Sprites: one soft dot per tint, drawn scaled. ── */
  const sprites = TINTS.map(col => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, col);
    grd.addColorStop(0.22, col);
    grd.addColorStop(0.42, hexA(col, 0.35));
    grd.addColorStop(1, hexA(col, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return c;
  });
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /* ── The stars: fixed traits; their place is computed per frame. ── */
  let stars = [];
  function makeStars(n) {
    stars = [];
    for (let i = 0; i < n; i++) {
      // Lateral place: bunched toward the thread, a few out at the banks.
      const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      const big = Math.random() < 0.012;
      stars.push({
        h: Math.random(),
        rate: 0.75 + 0.5 * Math.random(),
        off: g,
        wob: 0.06 + 0.10 * Math.random(),
        ph: Math.random() * Math.PI * 2,
        r: big ? 1.6 + Math.random() * 0.8 : 0.35 + 1.25 * Math.pow(Math.random(), 3),
        big,
        tint: (Math.random() * TINTS.length) | 0,
        a: 0.62 + 0.38 * Math.random(),
        tw: 0.6 + 1.8 * Math.random(),
      });
    }
  }

  /* ── The centreline. ── */
  let px = null, py = null, nx = null, ny = null, len = 0, width = 40;
  let vw = 0, vh = 0, dpr = 1;

  function measure() {
    vw = innerWidth; vh = innerHeight;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);

    const sy = scrollY;
    const box = el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top + sy, b: r.bottom + sy }; };
    const cards = [...list.children].map(box);
    if (!cards.length) { px = null; return; }

    // Rows: cards whose tops agree.
    const rows = [];
    for (const c of cards.sort((a, b) => a.t - b.t)) {
      const row = rows.find(r => Math.abs(r.t - c.t) < 6);
      if (row) row.b = Math.max(row.b, c.b); else rows.push({ t: c.t, b: c.b });
    }
    const left = Math.min(...cards.map(c => c.l));
    const right = Math.max(...cards.map(c => c.r));
    const margin = Math.min(left, vw - right);
    const band = margin < MARGIN_MIN;
    const xL = band ? -70 : left / 2;
    const xR = band ? vw + 70 : (right + vw) / 2;
    let R = band ? R_MAX : Math.min(R_MAX, margin * 0.4);

    // The gaps the river crosses: under the header, between rows, above the foot.
    const hb = box(head);
    const edges = [hb.b];
    for (const r of rows) edges.push(r.t, r.b);
    edges.push(foot ? box(foot).t : rows[rows.length - 1].b + 120);
    const gaps = [];
    let gapMin = Infinity;
    for (let i = 0; i < edges.length; i += 2) {
      gaps.push((edges[i] + edges[i + 1]) / 2);
      gapMin = Math.min(gapMin, edges[i + 1] - edges[i]);
    }
    width = Math.max(28, Math.min(W_MAX, gapMin * 0.64));

    // From the title's last letter, out to the right margin, then down.
    // At each gap the river crosses or keeps on down its margin, as
    // ROUTE says — so it does not zigzag row by row.
    const range = document.createRange();
    range.selectNodeContents(title);
    const tr = range.getBoundingClientRect();
    const y0 = (tr.top + tr.bottom) / 2 + sy;
    const x0 = Math.min(tr.right + 24 + width / 2, xR - 2 * R);
    const P = [[x0, y0], [xR, y0]];
    let side = xR;
    gaps.forEach((g, i) => {
      if (!ROUTE[i % ROUTE.length]) return;
      P.push([side, g]);
      side = side === xR ? xL : xR;
      P.push([side, g]);
    });
    P.push([side, document.documentElement.scrollHeight + 40]);

    // A corner tighter than half the cut would fold its inner bank.
    R = Math.max(R, width / 2 + 8);
    resample(roundPolyline(P, R));
    makeStars(Math.min(MAX_STARS, Math.round(len * DENSITY)));
    cutSheet();
  }

  /* ── The cut: the sheet's ink minus the channel (both banks of the
     centreline at width / 2, a round cap at the source; the mouth is
     past the page's end). Written as --sheet-cut on #workSheet, whose
     ::before is the ink; the same outline goes to the three paths of
     its .sheet-edge (rim + shade), as on the home page. ── */
  function cutSheet() {
    if (!sheet || !px) return;
    const r = sheet.getBoundingClientRect();
    const ox = r.left, oy = r.top + scrollY, W = r.width, H = r.height;
    const h = width / 2, n = px.length, k = 4;
    const f = v => v.toFixed(1);
    const L = [], Rt = [];
    for (let i = 0; i < n; i += k) {
      L.push(f(px[i] + nx[i] * h - ox) + ' ' + f(py[i] + ny[i] * h - oy));
      Rt.push(f(px[i] - nx[i] * h - ox) + ' ' + f(py[i] - ny[i] * h - oy));
    }
    // The cap at the source: from the right bank round the back to the left.
    const tx = ny[0], ty = -nx[0], cap = [];          // the tangent
    for (let j = 1; j < 12; j++) {
      const a = Math.PI * (1 - j / 12);
      cap.push(f(px[0] + h * (nx[0] * Math.cos(a) - tx * Math.sin(a)) - ox) + ' ' +
               f(py[0] + h * (ny[0] * Math.cos(a) - ty * Math.sin(a)) - oy));
    }
    const channel = 'M' + L.join('L') + 'L' + Rt.reverse().join('L') + 'L' + cap.join('L') + 'Z';
    sheet.style.setProperty('--sheet-cut', `path(evenodd, "M0 0H${f(W)}V${f(H)}H0Z${channel}")`);
    const svg = sheet.querySelector('.sheet-edge');
    if (svg) svg.setAttribute('viewBox', `0 0 ${f(W)} ${f(H)}`);
    edgePaths.forEach(p => p.setAttribute('d', channel));
  }

  // Axis-aligned polyline → dense points, each corner a quarter circle.
  function roundPolyline(P, R) {
    const out = [];
    const line = (a, b) => {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let i = 0; i < n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    };
    const dir = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d, d]; };
    let from = P[0];
    for (let i = 1; i < P.length - 1; i++) {
      const [ix, iy, li] = dir(P[i - 1], P[i]);
      const [ox, oy, lo] = dir(P[i], P[i + 1]);
      const r = Math.min(R, li / 2, lo / 2);
      const A = [P[i][0] - ix * r, P[i][1] - iy * r];
      const B = [P[i][0] + ox * r, P[i][1] + oy * r];
      line(from, A);
      const C = [A[0] + ox * r, A[1] + oy * r];
      let a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
      let a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
      let da = a1 - a0;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      const n = Math.max(2, Math.ceil(Math.abs(da) * r));
      for (let k = 0; k < n; k++) {
        const a = a0 + da * k / n;
        out.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]);
      }
      from = B;
    }
    line(from, P[P.length - 1]);
    out.push(P[P.length - 1]);
    return out;
  }

  // Dense points → one sample every STEP px of arc, with the normal.
  function resample(pts) {
    let total = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum.push(total);
    }
    const n = Math.max(2, Math.floor(total / STEP) + 1);
    px = new Float32Array(n); py = new Float32Array(n);
    nx = new Float32Array(n); ny = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const f = Math.min(1, (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1));
      px[i] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f;
      py[i] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      const dx = px[b] - px[a], dy = py[b] - py[a], d = Math.hypot(dx, dy) || 1;
      nx[i] = -dy / d; ny[i] = dx / d;
    }
    len = (n - 1) * STEP;
  }

  /* ── Drawing. ── */
  const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!px) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const t = reduceMotion ? 0 : now / 1000;
    const sy = scrollY, last = px.length - 1;
    const half = width * 0.36;     // the stars keep inside the cut
    for (const st of stars) {
      const u = (st.h + t * SPEED * st.rate / len) % 1;
      const s = u * len;
      const i = Math.min(last, (s / STEP) | 0);
      const y = py[i] - sy;
      if (y < -12 || y > vh + 12) continue;
      const lat = (st.off + Math.sin(t * 0.7 + st.ph) * st.wob) * half;
      const x = px[i] + nx[i] * lat;
      const sy2 = y + ny[i] * lat;
      let a = st.a * smooth(s / FADE_IN) * smooth((len - s) / FADE_OUT);
      if (!reduceMotion) a *= 0.72 + 0.28 * Math.sin(t * st.tw + st.ph * 3);
      if (a <= 0.01) continue;
      const d = st.r * 5.2;
      ctx.globalAlpha = a;
      ctx.drawImage(sprites[st.tint], x - d / 2, sy2 - d / 2, d, d);
      if (st.big) {
        // A cross glint on the few big ones, as on the name.
        const g = st.r * 4.5;
        ctx.globalAlpha = a * 0.45;
        ctx.fillStyle = TINTS[st.tint];
        ctx.fillRect(x - g, sy2 - 0.5, g * 2, 1);
        ctx.fillRect(x - 0.5, sy2 - g, 1, g * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(now) { draw(now); requestAnimationFrame(loop); }

  /* ── Wiring. ── */
  let pending = 0;
  const remeasure = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { measure(); if (reduceMotion) draw(0); }); };
  measure();
  if (window.ResizeObserver) new ResizeObserver(remeasure).observe(document.body);
  addEventListener('resize', remeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  if (reduceMotion) { draw(0); addEventListener('scroll', () => draw(0), { passive: true }); }
  else requestAnimationFrame(loop);
})();
