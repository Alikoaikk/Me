/* ============================================================
   GLOBE — dot-matrix Earth with orbits, satellites and stars
   ------------------------------------------------------------
   Self-contained WebGL scene for the hero background (#heroCanvas).
   No libraries, no textures, no external asset files.

   Draw order, back to front:
     1. starfield   — parallax point layers
     2. orbit rings — inclined line loops behind the globe
     3. globe dots  — land points on a sphere, depth-shaded
     4. satellites  — points travelling along the rings

   Mouse events bind to the parent <section id="hero">, not the
   canvas, because the canvas sits behind .hero-content.
   ============================================================ */
(function () {
  'use strict';

  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;

  const reduceMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const config = {
    DOT_SPACING:     1.35,   // degrees between candidate dots (smaller = denser)
    DOT_SIZE:        1.75,   // base point size, scaled by viewport
    ROTATION_SPEED:  0.055,  // radians/sec of spin
    TILT:            0.41,   // axial tilt, ~23.5 degrees
    PARALLAX:        0.17,   // how far the globe leans toward the cursor
    PARALLAX_EASE:   0.045,  // lerp factor, keeps the lean smooth
    STAR_COUNT:      1200,
    SAT_COUNT:       7,
    CAMERA_DIST:     3.15,
    // Fraction of the viewport half-height the globe's silhouette fills.
    // The projection scale is derived from this in resize(), so the globe
    // keeps a consistent size across viewports instead of overflowing.
    GLOBE_FILL:      0.62,
  };

  // Scene colors, mirroring the CSS design tokens in style.css.
  const COLOR = {
    land:    new Float32Array([0.30, 0.84, 1.00]),  // cyan, lit hemisphere
    landDim: new Float32Array([0.42, 0.39, 1.00]),  // purple, far hemisphere
    orbit:   new Float32Array([0.42, 0.39, 1.00]),
    sat:     new Float32Array([0.62, 0.95, 1.00]),
    star:    new Float32Array([0.74, 0.80, 1.00]),
  };

  /* ============================================================
     LAND MASK
     180x90 equirectangular bitmask, 1 bit per 2-degree cell,
     rasterized from Natural Earth 110m land polygons.
     ============================================================ */
  const MASK_W = 180, MASK_H = 90;
  const MASK_B64 =
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf+' +
    'Af/AAAAAAAAAAAAAAAAAAAAAAAA//////+AAAABAAADgAAAAAAAAAAAAFf9f///4AA/AAAAAB8AAAAAAAAAABwAz4f///wAAYAAA' +
    'EAAPAAAAAAAAAAAPmvwAf//wAAAAADgAf/4AHAAAAAAAH8338AP//gAAAAAMBD///8DAAAADwACfx3/gH//gAAA4AMHf//////wA' +
    'Af////79jwH//AAAP/gA//////////8P//////h+H/gAAAf/7///////////M///////n8D8A+AB+/P///////////AP/////4g8' +
    'D4AAAH9/////////////Af/////gHgA4AAAP5///////////P4AHgP///gH2AAAAAH4//////////aMAADAB///8H+AAAAGCx///' +
    '//////8A8AAAAA////v/gAAAPCr/////////wA4AAAAAf///v/wAAAbv///////////AwAAAAAP/////wAAAH////////////AAA' +
    'AAAAH////8YAAAD///////////9AAAAAAAD////8EAAAB///////////9AAAAAAAD/////AAAAB//5/P//////5AAAAAAAD////g' +
    'AAAAfxvwPP//////jgAAAAAAD////AAAAAfiz//n/////+CAAAAAAAD///+AAAAAfADf/n////+MCAAAAAAAB///8AAAAAOeRP//' +
    '/////mOAAAAAAAB///8AAAAAH+AA///////E8AAAAAAAAf//wAAAAAf/iB///////hAAAAAAAAAP//gAAAAAf/7////////gAAAA' +
    'AAAAAD/owAAAAAf////f/////gAAAAAAAAAF+AQAAAAB///+/v/////AAAAAAAAAAC+AAAAAAD/////23////AAAAAAAAAAAeAQA' +
    'AAAD////f/D///8gAAAAAAAAAAfEEAAAAH////v/B/z/QAAAAAAAAAAAPMBwAAAD////v+A/h+gAAAAAAAAAAAH8AAAAAD////38' +
    'AeB/AgAAAAAAAAAAAfAAAAAH////3wAcAfggAAAAAAAAAAAHAAAAAH////+AAcAfgwAAAAAAAAAAABDwAAAD////9wAMATAQAAAA' +
    'AAAAAAAA//AAAB/////gAKAQAIAAAAAAAAAAAAH/gAAA/////gACAIAIAAAAAAAAAAAAH/8AAAfH///AAAAsGAAAAAAAAAAAAAH/' +
    '+AAAAB///AAAA0OAAAAAAAAAAAAAP/+AAAAB//8AAAAc+AAAAAAAAAAAAAf//gAAAD//4AAAAMeggAAAAAAAAAAAP//8AAAB//wA' +
    'AAAGdg+AAAAAAAAAAAf///AAAA//wAAAACAAPkAAAAAAAAAAP///gAAA//wAAAAB4AHwAAAAAAAAAAP///gAAA//wAAAAAAIDYAA' +
    'AAAAAAAAH///AAAAf/wAAAAAAAAAAAAAAAAAAAH//+AAAA//wgAAAAABxAAAAAAAAAAAD//+AAAA//xgAAAAAPxgAAAAAAAAAAA/' +
    '/+AAAA//zgAAAAAf/gAAAAAAAAAAAf/8AAAA//DgAAAAAf/wAAAAAAAAAAAf/8AAAAf/DAAAAAD//4CAAAAAAAAAAf/4AAAAf/DA' +
    'AAAAH//8AAAAAAAAAAAf/AAAAAf+CAAAAAH//8AAAAAAAAAAA//AAAAAf+AAAAAAH//+AAAAAAAAAAA//AAAAAP8AAAAAAH//+AA' +
    'AAAAAAAAA/+AAAAAH4AAAAAAH//+AAAAAAAAAAA/8AAAAAHwAAAAAAD4f8AAAAAAAAAAA/4AAAAAAAAAAAAACAH8AAAAAAAAAAB/' +
    'wAAAAAAAAAAAAAAAD4AEAAAAAAAAB/AAAAAAAAAAAAAAAAAAAGAAAAAAAAB+AAAAAAAAAAAAAAAAAQAMAAAAAAAAB8AAAAAAAAAA' +
    'AAAAAAAQAYAAAAAAAAB4AAAAAAAAAAAAAAAAAABwAAAAAAAAD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAD4AAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAA+AA/////gAAAAAAAAAAAsAAAAAAADv/+H//////AA' +
    'AAAAAAAAB+AAAAJ/////8////////gAAAAAAPWB/AAAD///////////////gAAAf/////8AAAH//////////////+AABn/////+A' +
    'AAH///////////////8AAE//////4ABw////////////////+AAAf//////3Hh////////////////4AAAf/////////////////' +
    '/////////A/93///////////////////////////////////////////////////////////////////////////////////////';

  // Decoded lazily into a Uint8Array of 0/1 per cell.
  const landBits = (function decodeMask(b64) {
    const bin = atob(b64);
    const bits = new Uint8Array(MASK_W * MASK_H);
    for (let i = 0; i < bits.length; i++) {
      const byte = bin.charCodeAt(i >> 3);
      bits[i] = (byte >> (7 - (i & 7))) & 1;
    }
    return bits;
  })(MASK_B64);

  function isLand(lat, lon) {
    // lat: +90 (north) .. -90, lon: -180 .. +180
    let col = Math.floor((lon + 180) / 360 * MASK_W);
    let row = Math.floor((90 - lat) / 180 * MASK_H);
    if (col < 0) col = 0; else if (col >= MASK_W) col = MASK_W - 1;
    if (row < 0) row = 0; else if (row >= MASK_H) row = MASK_H - 1;
    return landBits[row * MASK_W + col] === 1;
  }

  /* ============================================================
     WEBGL SETUP
     ============================================================ */
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: true, depth: false,
    premultipliedAlpha: false,
  }) || canvas.getContext('experimental-webgl');
  if (!gl) return;

  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);   // additive: glow stacks nicely

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('globe: shader failed', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function program(vsSrc, fsSrc) {
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('globe: link failed', gl.getProgramInfoLog(p));
      return null;
    }
    // Collect every active uniform and attribute up front.
    const u = {}, a = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const name = gl.getActiveAttrib(p, i).name;
      a[name] = gl.getAttribLocation(p, name);
    }
    return { p, u, a };
  }

  /* ── Shared shader chunk: rotate + project a model-space point ── */
  const PROJECT = `
    uniform mat3 uRot;        // model rotation (spin + tilt + parallax)
    uniform float uCamDist;   // camera distance along +z
    uniform float uFov;
    uniform float uAspect;

    // Returns clip position; passes view-space z out for depth shading.
    vec4 projectPoint(vec3 modelPos, out float viewZ) {
      vec3 p = uRot * modelPos;
      viewZ = p.z;
      float w = uCamDist - p.z;
      vec2 ndc = vec2(p.x, p.y) * uFov / w;
      ndc.x /= uAspect;
      return vec4(ndc, 0.0, 1.0);
    }
  `;

  /* ── Globe dots ── */
  const globeProg = program(`
    precision highp float;
    attribute vec3 aPos;
    attribute float aSeed;
    ${PROJECT}
    uniform float uPointScale;
    varying float vShade;
    void main() {
      float z;
      gl_Position = projectPoint(aPos, z);
      // Front hemisphere bright, back hemisphere dim but still visible.
      vShade = smoothstep(-1.0, 1.0, z);
      float persp = uCamDist / (uCamDist - z);
      gl_PointSize = uPointScale * persp * (0.55 + 0.45 * vShade);
    }
  `, `
    precision highp float;
    uniform vec3 uNear;
    uniform vec3 uFar;
    varying float vShade;
    void main() {
      // Round, soft-edged point.
      vec2 d = gl_PointCoord - vec2(0.5);
      float r = dot(d, d);
      if (r > 0.25) discard;
      float alpha = smoothstep(0.25, 0.02, r);
      vec3 col = mix(uFar, uNear, vShade);
      // Far side stays visible but recedes, so the sphere reads as
      // translucent without the silhouette collapsing into the void.
      float depthFade = mix(0.22, 1.35, vShade);
      gl_FragColor = vec4(col, alpha * depthFade);
    }
  `);

  /* ── Orbit rings and satellites (shared shader) ── */
  const lineProg = program(`
    precision highp float;
    attribute vec3 aPos;
    ${PROJECT}
    uniform float uPointScale;
    varying float vShade;
    void main() {
      float z;
      gl_Position = projectPoint(aPos, z);
      vShade = smoothstep(-1.4, 1.4, z);
      float persp = uCamDist / (uCamDist - z);
      gl_PointSize = uPointScale * persp;
    }
  `, `
    precision highp float;
    uniform vec3 uColor;
    uniform float uAlpha;
    uniform float uGlow;    // 0 = flat disc (orbit trail), 1 = bright core (satellite)
    varying float vShade;
    void main() {
      vec2 d = gl_PointCoord - vec2(0.5);
      float r = dot(d, d);
      if (r > 0.25) discard;

      float a = uAlpha * mix(0.34, 1.0, vShade);

      // A satellite gets a hot core and a halo; an orbit dot stays a
      // near-flat disc, so the ring keeps its density when tiled into
      // a trail instead of dissolving at the edges.
      float core = smoothstep(0.25, 0.0, r);
      float mask = mix(smoothstep(0.25, 0.14, r), core, uGlow);
      a *= mask;

      gl_FragColor = vec4(uColor * (1.0 + core * uGlow * 0.8), a);
    }
  `);

  /* ── Starfield ── */
  const starProg = program(`
    precision highp float;
    attribute vec2 aPos;      // normalized device position
    attribute float aSize;
    attribute float aSeed;
    uniform vec2 uParallax;
    uniform float uDpr;
    varying float vAlpha;
    void main() {
      // Deeper stars (smaller) shift less — fake parallax depth.
      float depth = aSize;
      vec2 p = aPos + uParallax * (0.35 + depth * 0.65);
      gl_Position = vec4(p, 0.0, 1.0);
      vAlpha = 0.25 + depth * 0.75;
      gl_PointSize = (0.7 + depth * 2.1) * uDpr;
    }
  `, `
    precision highp float;
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
      vec2 d = gl_PointCoord - vec2(0.5);
      float r = dot(d, d);
      if (r > 0.25) discard;
      float a = smoothstep(0.25, 0.0, r) * vAlpha;
      gl_FragColor = vec4(uColor, a);
    }
  `);

  if (!globeProg || !lineProg || !starProg) return;

  /* ============================================================
     GEOMETRY
     ============================================================ */

  // ── Globe dots: walk lat/lon, keep the ones that land on land.
  //    Rows are spaced evenly in latitude; longitude steps scale by
  //    cos(lat) so dot density stays roughly even across the sphere.
  const globeGeo = (function buildGlobe() {
    const pos = [], seed = [];
    const step = config.DOT_SPACING;
    for (let lat = -89; lat <= 89; lat += step) {
      const rad = lat * Math.PI / 180;
      const circ = Math.cos(rad);
      if (circ < 0.02) continue;
      const lonStep = step / circ;
      for (let lon = -180; lon < 180; lon += lonStep) {
        if (!isLand(lat, lon)) continue;
        const lonRad = lon * Math.PI / 180;
        pos.push(
          circ * Math.sin(lonRad),
          Math.sin(rad),
          circ * Math.cos(lonRad)
        );
        seed.push(Math.random());
      }
    }
    return {
      pos: new Float32Array(pos),
      seed: new Float32Array(seed),
      count: seed.length,
    };
  })();

  // ── Orbit rings: circles rotated by inclination and node angle.
  //    Drawn as dense point trails rather than LINE_LOOP, because
  //    ALIASED_LINE_WIDTH_RANGE is [1,1] on most GPUs — a 1px hairline
  //    on a high-DPI canvas is nearly invisible. Points let us control
  //    thickness and brightness, and match the dot aesthetic.
  const SEGMENTS = 620;
  // Inclinations stay shallow so the rings read as ellipses around the
  // globe rather than near-vertical lines that vanish behind it.
  const orbits = [
    { radius: 1.20, incl:  0.30, node: 0.35, speed:  0.34, alpha: 0.85 },
    { radius: 1.40, incl: -0.46, node: 1.90, speed: -0.25, alpha: 0.66 },
    { radius: 1.62, incl:  0.72, node: 2.85, speed:  0.19, alpha: 0.50 },
  ];

  function orbitBasis(incl, node) {
    // Two orthonormal vectors spanning the orbital plane.
    const ci = Math.cos(incl), si = Math.sin(incl);
    const cn = Math.cos(node), sn = Math.sin(node);
    return {
      u: [cn, 0, -sn],                       // in-plane, along ascending node
      v: [si * sn, ci, si * cn],             // in-plane, perpendicular to u
    };
  }

  orbits.forEach(o => {
    const b = orbitBasis(o.incl, o.node);
    const verts = new Float32Array(SEGMENTS * 3);
    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / SEGMENTS * Math.PI * 2;
      const c = Math.cos(t) * o.radius, s = Math.sin(t) * o.radius;
      verts[i * 3    ] = b.u[0] * c + b.v[0] * s;
      verts[i * 3 + 1] = b.u[1] * c + b.v[1] * s;
      verts[i * 3 + 2] = b.u[2] * c + b.v[2] * s;
    }
    o.basis = b;
    o.buffer = makeBuffer(verts);
  });

  // ── Satellites: distributed across the rings, each with a phase.
  const satellites = [];
  for (let i = 0; i < config.SAT_COUNT; i++) {
    const o = orbits[i % orbits.length];
    satellites.push({ orbit: o, phase: (i / config.SAT_COUNT) * Math.PI * 2 });
  }
  const satPos = new Float32Array(config.SAT_COUNT * 3);
  const satBuffer = gl.createBuffer();

  // ── Starfield: random NDC positions, biased away from dead center
  //    so stars don't crowd the globe and the headline.
  const starGeo = (function buildStars() {
    const n = config.STAR_COUNT;
    const pos = new Float32Array(n * 2);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let x, y, r;
      do {
        x = (Math.random() * 2 - 1) * 1.05;
        y = (Math.random() * 2 - 1) * 1.05;
        r = Math.sqrt(x * x + y * y);
      } while (r < 0.30 && Math.random() < 0.72); // thin out the middle
      pos[i * 2] = x;
      pos[i * 2 + 1] = y;
      size[i] = Math.pow(Math.random(), 2.2);      // mostly small, few bright
      seed[i] = Math.random();
    }
    return {
      pos: makeBuffer(pos),
      size: makeBuffer(size),
      seed: makeBuffer(seed),
      count: n,
    };
  })();

  function makeBuffer(data) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  const globeBuffers = {
    pos: makeBuffer(globeGeo.pos),
    seed: makeBuffer(globeGeo.seed),
  };

  /* ============================================================
     MATRIX HELPERS (3x3, column-major for WebGL)
     ============================================================ */
  function mat3Multiply(a, b) {
    const o = new Float32Array(9);
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        o[c * 3 + r] =
          a[0 * 3 + r] * b[c * 3 + 0] +
          a[1 * 3 + r] * b[c * 3 + 1] +
          a[2 * 3 + r] * b[c * 3 + 2];
      }
    }
    return o;
  }

  function rotY(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]);
  }

  function rotX(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return new Float32Array([1, 0, 0, 0, c, s, 0, -s, c]);
  }

  function mat3Apply(m, v) {
    return [
      m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
      m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
      m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
    ];
  }

  /* ============================================================
     RESIZE
     ============================================================ */
  let dpr = 1, aspect = 1, pointScale = 1, fov = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return false;

    // Derived values must be refreshed on every call, not just on a
    // size change — the canvas may already carry the right dimensions
    // from a previous page view while these still hold their defaults.
    aspect = w / h;

    // Size the globe from GLOBE_FILL. A unit sphere seen from distance d
    // has its silhouette at the tangent point, whose projected radius is
    // 1/sqrt(d^2 - 1) in view units; solving for the scale that makes it
    // cover GLOBE_FILL of the half-height gives the projection factor.
    const d = config.CAMERA_DIST;
    const silhouette = 1 / Math.sqrt(d * d - 1);
    // On narrow screens, fall back to width so the globe never overflows.
    const fill = config.GLOBE_FILL * Math.min(1, aspect / 0.85);
    fov = fill / silhouette;

    pointScale = config.DOT_SIZE * dpr * Math.min(1.5, Math.max(0.7, h / 900));

    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }

  /* ============================================================
     POINTER PARALLAX
     ============================================================ */
  const hero = canvas.closest('section') || canvas.parentElement;
  let targetX = 0, targetY = 0;   // -1 .. 1
  let leanX = 0, leanY = 0;       // eased values

  if (hero && !reduceMotion) {
    hero.addEventListener('mousemove', e => {
      const r = hero.getBoundingClientRect();
      targetX = ((e.clientX - r.left) / r.width) * 2 - 1;
      targetY = ((e.clientY - r.top) / r.height) * 2 - 1;
    }, { passive: true });

    hero.addEventListener('mouseleave', () => { targetX = 0; targetY = 0; });

    hero.addEventListener('touchmove', e => {
      if (!e.touches.length) return;
      const r = hero.getBoundingClientRect();
      const t = e.touches[0];
      targetX = ((t.clientX - r.left) / r.width) * 2 - 1;
      targetY = ((t.clientY - r.top) / r.height) * 2 - 1;
    }, { passive: true });

    hero.addEventListener('touchend', () => { targetX = 0; targetY = 0; });
  }

  /* ============================================================
     ANIMATION STATE
     Declared before the observers below, which may fire during
     setup and need to read and wake the loop.
     ============================================================ */
  let spin = 0;
  let lastTime = performance.now();
  let running = false;
  let visible = true;

  function wake() {
    if (running || document.hidden || !visible) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  // Paint a single frame regardless of visibility, so a tab that loads
  // in the background isn't blank the moment it's brought forward.
  function paintOnce() {
    resize();
    draw(performance.now() / 1000);
  }

  /* ============================================================
     PAUSE WHEN OFF-SCREEN
     Saves battery once the hero scrolls out of view.
     ============================================================ */
  if ('IntersectionObserver' in window && hero) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      wake();
    }, { threshold: 0 }).observe(hero);
  }
  document.addEventListener('visibilitychange', wake);

  /* ============================================================
     DRAW HELPERS
     ============================================================ */
  function setCommon(prog, rot) {
    gl.uniformMatrix3fv(prog.u.uRot, false, rot);
    gl.uniform1f(prog.u.uCamDist, config.CAMERA_DIST);
    gl.uniform1f(prog.u.uFov, fov);
    gl.uniform1f(prog.u.uAspect, aspect);
  }

  function bindAttrib(prog, name, buffer, size) {
    const loc = prog.a[name];
    if (loc === undefined || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  function drawStars(time) {
    gl.useProgram(starProg.p);
    bindAttrib(starProg, 'aPos', starGeo.pos, 2);
    bindAttrib(starProg, 'aSize', starGeo.size, 1);
    bindAttrib(starProg, 'aSeed', starGeo.seed, 1);
    gl.uniform1f(starProg.u.uDpr, dpr);
    gl.uniform2f(starProg.u.uParallax, -leanX * 0.03, leanY * 0.03);
    gl.uniform3fv(starProg.u.uColor, COLOR.star);
    gl.drawArrays(gl.POINTS, 0, starGeo.count);
  }

  function drawOrbits(rot) {
    gl.useProgram(lineProg.p);
    setCommon(lineProg, rot);
    gl.uniform1f(lineProg.u.uGlow, 0);      // flat discs, so the trail reads as a line
    gl.uniform1f(lineProg.u.uPointScale, 2.4 * dpr);
    gl.uniform3fv(lineProg.u.uColor, COLOR.orbit);
    orbits.forEach(o => {
      bindAttrib(lineProg, 'aPos', o.buffer, 3);
      gl.uniform1f(lineProg.u.uAlpha, o.alpha);
      gl.drawArrays(gl.POINTS, 0, SEGMENTS);
    });
  }

  function drawGlobe(rot, time) {
    gl.useProgram(globeProg.p);
    setCommon(globeProg, rot);
    bindAttrib(globeProg, 'aPos', globeBuffers.pos, 3);
    bindAttrib(globeProg, 'aSeed', globeBuffers.seed, 1);
    gl.uniform1f(globeProg.u.uPointScale, pointScale);
    gl.uniform3fv(globeProg.u.uNear, COLOR.land);
    gl.uniform3fv(globeProg.u.uFar, COLOR.landDim);
    gl.drawArrays(gl.POINTS, 0, globeGeo.count);
  }

  function drawSatellites(rot, time) {
    // Advance each satellite along its ring, then upload in one go.
    for (let i = 0; i < satellites.length; i++) {
      const s = satellites[i];
      const o = s.orbit;
      const t = s.phase + time * o.speed;
      const c = Math.cos(t) * o.radius, sn = Math.sin(t) * o.radius;
      satPos[i * 3    ] = o.basis.u[0] * c + o.basis.v[0] * sn;
      satPos[i * 3 + 1] = o.basis.u[1] * c + o.basis.v[1] * sn;
      satPos[i * 3 + 2] = o.basis.u[2] * c + o.basis.v[2] * sn;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, satBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, satPos, gl.DYNAMIC_DRAW);

    gl.useProgram(lineProg.p);
    setCommon(lineProg, rot);
    const loc = lineProg.a.aPos;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.uniform1f(lineProg.u.uGlow, 1);      // hot core + halo
    gl.uniform1f(lineProg.u.uPointScale, 5.2 * dpr);
    gl.uniform1f(lineProg.u.uAlpha, 1.0);
    gl.uniform3fv(lineProg.u.uColor, COLOR.sat);
    gl.drawArrays(gl.POINTS, 0, satellites.length);
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */

  // Renders one frame at the current state. Kept separate from frame()
  // so a single frame can be painted without starting the loop.
  function draw(time) {
    // Model rotation: spin about the axis, then tilt, then lean toward cursor.
    const rot = mat3Multiply(
      mat3Multiply(
        rotX(-config.TILT + leanY * config.PARALLAX),
        rotY(leanX * config.PARALLAX * 1.4)
      ),
      rotY(spin)
    );

    gl.clear(gl.COLOR_BUFFER_BIT);
    drawStars(time);
    drawOrbits(rot);
    drawGlobe(rot, time);
    drawSatellites(rot, time);
  }

  function frame(now) {
    if (document.hidden || !visible) { running = false; return; }

    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    resize();

    if (!reduceMotion) {
      spin += dt * config.ROTATION_SPEED;
      leanX += (targetX - leanX) * config.PARALLAX_EASE;
      leanY += (targetY - leanY) * config.PARALLAX_EASE;
    }

    draw(now / 1000);

    requestAnimationFrame(frame);
  }

  paintOnce();
  wake();
})();
