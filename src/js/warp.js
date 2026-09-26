/* ============================================================
   WARP — the launch sequence, from the button to the planet
   ------------------------------------------------------------
   Plays after the reader presses "start the trip" and the release
   has let the name go (galaxy.js starts it). One timeline, in
   seconds from the first frame, drawn on a fixed full-screen 2D
   canvas (#warp) over everything. No ship: the reader IS the ship,
   and the sky itself does the travelling.

     0.0 – 1.1   the stars begin to streak toward us and the speed
                 ramps up; whatever is left of the name fades beneath.
     1.1         JUMP — white flash; under it the page is moved to
                 the planet section (which, the hero having collapsed
                 on launch, is the top of the page: a no-op today,
                 kept so the sequence is right if that changes).
     1.1 – 2.3   LIGHT SPEED — full streaks with chromatic fringes.
     2.3 – 3.4   deceleration; the planet grows in behind the last
                 streaks (system.js, told at 2.1).
     3.6   END   overlay hidden, scrolling unlocked.

   While the sequence runs the root carries .is-warping, which locks
   user scrolling (overflow: hidden keeps the scroll offset and still
   allows scrollTo). galaxy.js calls start() from the button and owns
   the .is-launched class that makes the planet section
   exist; this file never touches the galaxy itself, only --warp-fade,
   which the name block multiplies into its opacity.
   ============================================================ */
(function () {
  'use strict';

  const canvas = document.getElementById('warpCanvas');
  const overlay = document.getElementById('warp');
  if (!overlay || !canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const root = document.documentElement;

  const T = {
    NAME_FADE:    [0.0, 0.7],
    WARP_START:   0.0,
    WARP_FULL:    1.1,
    WARP_HOLD:    2.3,
    WARP_END:     3.4,
    JUMP:         1.12,
    ARRIVE:       2.1,
    END:          3.6,
  };

  /* ── Maths ── */
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const ramp = (t, a, b) => clamp01((t - a) / (b - a));
  const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };

  let vw = 0, vh = 0, dpr = 1;
  const focal = () => Math.max(vw, vh) * 0.5;

  /* ── The streaks ── */
  const STAR_COUNT = 520;
  const stars = new Float32Array(STAR_COUNT * 3);
  function seed(i, deep) {
    stars[i * 3]     = (Math.random() * 2 - 1) * 1.6;
    stars[i * 3 + 1] = (Math.random() * 2 - 1) * 1.6;
    stars[i * 3 + 2] = deep ? Math.random() : 0.75 + Math.random() * 0.25;
  }
  function seedAll() { for (let i = 0; i < STAR_COUNT; i++) seed(i, true); }

  function speedAt(t) {
    if (t < T.WARP_START) return 0;
    if (t < T.WARP_FULL) return Math.pow(ramp(t, T.WARP_START, T.WARP_FULL), 2.2);
    if (t < T.WARP_HOLD) return 1;
    return 1 - smooth(ramp(t, T.WARP_HOLD, T.WARP_END));
  }

  function drawStars(dt, speed) {
    const cx = vw / 2, cy = vh / 2, f = focal();
    const dz = (0.06 + 3.6 * speed) * dt;
    const tail = dz * (1.5 + 14 * speed);
    const alphaAll = smooth(speed / 0.12);
    if (alphaAll <= 0) return;
    const chroma = smooth(ramp(speed, 0.55, 1)) * 0.035;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < STAR_COUNT; i++) {
      let x = stars[i * 3], y = stars[i * 3 + 1], z = stars[i * 3 + 2] - dz;
      if (z <= 0.02) { seed(i, false); x = stars[i * 3]; y = stars[i * 3 + 1]; z = stars[i * 3 + 2]; }
      stars[i * 3 + 2] = z;
      const z0 = Math.min(1, z + tail);
      const sx = cx + x / z * f, sy = cy + y / z * f;
      const tx = cx + x / z0 * f, ty = cy + y / z0 * f;
      if ((sx < -40 && tx < -40) || (sx > vw + 40 && tx > vw + 40) ||
          (sy < -40 && ty < -40) || (sy > vh + 40 && ty > vh + 40)) continue;
      const near = 1 - z;
      const a = alphaAll * (0.25 + 0.75 * near);
      const w = 0.6 + 2.2 * near + 1.2 * speed;
      if (chroma > 0) {
        const dx = (tx - sx) * chroma, dy = (ty - sy) * chroma;
        ctx.strokeStyle = `rgba(255,120,110,${(a * 0.42).toFixed(3)})`;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(tx + dx, ty + dy); ctx.lineTo(sx + dx, sy + dy); ctx.stroke();
        ctx.strokeStyle = `rgba(120,170,255,${(a * 0.42).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(tx - dx, ty - dy); ctx.lineTo(sx - dx, sy - dy); ctx.stroke();
      }
      ctx.strokeStyle = `rgba(214,228,255,${a.toFixed(3)})`;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(sx, sy); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* The tunnel glow at the vanishing point, and the jump flash. */
  function drawGlow(t, speed) {
    if (speed > 0) {
      const cx = vw / 2, cy = vh / 2, r = Math.max(vw, vh) * 0.55;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const core = 0.5 * speed;
      g.addColorStop(0, `rgba(200,220,255,${core.toFixed(3)})`);
      g.addColorStop(0.25, `rgba(120,160,255,${(core * 0.35).toFixed(3)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalCompositeOperation = 'source-over';
    }
    // A sharp white flash at the jump, gone in half a second.
    const flash = t >= T.WARP_FULL - 0.08
      ? (t < T.WARP_FULL ? ramp(t, T.WARP_FULL - 0.08, T.WARP_FULL) : Math.max(0, 1 - (t - T.WARP_FULL) / 0.5))
      : 0;
    if (flash > 0) {
      ctx.fillStyle = `rgba(235,242,255,${(flash * flash).toFixed(3)})`;
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  /* ── The sequence ── */
  let running = false, t0 = 0, last = 0, jumped = false, arrived = false;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (w === vw && h === vh && d === dpr) return;
    vw = w; vh = h; dpr = d;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  function jumpToPlanet() {
    const planet = document.getElementById('planet');
    const top = planet ? planet.offsetTop : window.scrollY;
    window.scrollTo(0, top);
  }

  /* One frame of the overlay at sequence time t. */
  function paint(t, dt) {
    resize();
    const speed = speedAt(t);
    ctx.clearRect(0, 0, vw, vh);
    drawGlow(t, speed);
    drawStars(dt, speed);
  }

  function frame(now) {
    if (!running) return;
    if (!t0) { t0 = now; last = now; }
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    paint(t, dt);

    root.style.setProperty('--warp-fade',
      smooth(ramp(t, T.NAME_FADE[0], T.NAME_FADE[1])).toFixed(3));

    if (!jumped && t >= T.JUMP) { jumped = true; jumpToPlanet(); }
    if (!arrived && t >= T.ARRIVE) { arrived = true; if (window.koaik) window.koaik.reveal(); }

    if (t < T.END) requestAnimationFrame(frame);
    else finish();
  }

  function finish() {
    running = false;
    ctx.clearRect(0, 0, vw, vh);
    overlay.classList.remove('is-on');
    root.classList.remove('is-warping');
    // The name is hidden by the release now; clear our factor so it
    // comes back intact if the reader scrolls up to it.
    root.style.setProperty('--warp-fade', '0');
    // The button's job is done: .is-arrived retires its layer for good
    // (galaxy.css). Without this the ring, still at release 1 on its
    // fixed layer, sat at screen centre behind the dashboard.
    root.classList.add('is-arrived');
    if (!jumped) jumpToPlanet();
  }

  function start() {
    if (running) return;
    running = true; t0 = 0; jumped = false; arrived = false;
    resize();
    seedAll();
    overlay.classList.add('is-on');
    root.classList.add('is-warping');
    if (window.koaik) window.koaik.arm();
    requestAnimationFrame(frame);
  }

  /* iOS ignores overflow: hidden on the root for touch scrolling, so
     the gesture itself is refused while the sequence runs. */
  window.addEventListener('touchmove', e => { if (running) e.preventDefault(); },
                          { passive: false });

  /* renderAt(t): paint the overlay as it looks t seconds in, without
     running the sequence — for the headless harness (tools/render),
     whose frame rate is too low to catch a moment by wall clock. It
     steps the streak field from 0 so the streaks are as they would
     be, not a first-frame burst. */
  function renderAt(t) {
    if (running) return;
    overlay.classList.add('is-on');
    seedAll();
    resize();
    const step = 1 / 60;
    for (let u = 0; u < t; u += step) {
      const sp = speedAt(u);
      const dz = (0.06 + 3.6 * sp) * step;
      for (let i = 0; i < STAR_COUNT; i++) {
        const z = stars[i * 3 + 2] - dz;
        if (z <= 0.02) seed(i, false); else stars[i * 3 + 2] = z;
      }
    }
    paint(t, step);
  }

  window.warpSequence = { start, renderAt };
})();
