/* ============================================================
   GALAXY — HDR volumetric spiral galaxy
   ------------------------------------------------------------
   WebGL2, no libraries, no textures, no external assets.

   RENDER PIPELINE (this is why it reads as photographic rather
   than as dots on black):

     1. scene  -> RGBA16F HDR buffer
                  · deep-field sky, nebulae, distant galaxies
                  · volumetric dust (raymarched density field)
                  · meteors
                  · star particles with emission above 1.0
     2. bright -> soft-knee threshold, half resolution
     3. blur   -> separable gaussian across 4 mips
     4. tone   -> ACES filmic curve + vignette + grain -> screen

   Values above 1.0 survive to the tone mapper, so a bright star
   blooms the way it does on a camera sensor. An LDR pipeline
   clips them to flat white, which is what makes most particle
   galaxies look lifeless.

   Stars spiral inward along their arm, flare as the core swallows
   them, and re-enter at the rim. The disc orientation is fixed so
   the spiral can never wind up.

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
    // simulate() is O(n) on the CPU and measured 13.65ms at 46k, which
    // alone blew the 16.7ms frame budget (49fps). 26k brings the whole
    // frame under budget; the volumetric dust carries the density that
    // the extra particles used to provide.
    STAR_COUNT:      26000,

    /* ── Spiral structure ── */
    ARMS:            2,
    ARM_TIGHTNESS:   3.10,     // ~18 degree pitch angle
    ARM_SPREAD:      0.30,
    ARM_BIAS:        0.28,     // bias to the convex side of the arm
    DISC_RADIUS:     1.0,
    DISC_SCALE:      0.46,
    BULGE_RADIUS:    0.26,
    ARM_START:       0.18,
    ARM_FLOOR:       0.099,
    ARM_MIN:         0.20,
    ARM_FADE:        0.30,
    THICKNESS:       0.042,

    /* ── Populations ── */
    NUCLEUS_FRACTION: 0.09,
    NUCLEUS_RADIUS:   0.040,
    BULGE_FRACTION:   0.19,
    INTERARM:         0.34,
    SPUR_FRACTION:    0.09,

    /* ── Dust lanes on the concave edge of each arm ── */
    DUST_OFFSET:     0.55,
    DUST_WIDTH:      0.34,
    DUST_OPACITY:    0.92,

    /* ── HII star-forming knots ── */
    HII_RATE:        0.075,
    HII_KNOTS:       48,

    /* ── Feathers / spurs ── */
    SPURS_PER_ARM:   8,
    SPUR_LENGTH:     0.16,
    SPUR_PITCH:      0.42,

    /* ── Motion ── */
    PATTERN_SPEED:   0.070,    // rigid rotation, ~90s per turn
    INFALL:          0.028,
    RIM_LO:          0.80,
    CORE_RADIUS:     0.028,
    SWALLOW_REACH:   0.20,
    SWALLOW_FLARE:   3.2,
    SWALLOW_BASE:    820,
    SWALLOW_PEAK:    3200,

    /* ── The burst ──
       Fired when the page scrolls past BURST_TRIGGER, then it runs on
       its own clock. It is an event, not a scrubbable animation: the
       collapse and detonation need their own pacing. Scrolling back up
       reverses it, so the galaxy reassembles and can be watched again. */
    BURST_TRIGGER:   2.60,     // in viewport heights
    BURST_DURATION:  2.6,      // seconds, collapse through dispersal
    BURST_REWIND:    1.1,      // seconds to reassemble when scrolling up
    BURST_HYSTERESIS: 0.25,    // dead band, so hovering cannot strobe it

    /* ── Camera ── */
    TILT:            0.34,     // near face-on, slight depth
    POINT_SIZE:      0.88,
    /* The approach is a straight push down the view axis — no lateral
       pan. Drifting the disc sideways while zooming read as the galaxy
       sliding off the screen rather than coming at the viewer. */
    SCROLL_DRIFT:    0.0,
    /* How far the camera closes in, in world units, against a CAM_DIST
       of 3.0. At 2.2 the disc grows ~3.75x and the nearest stars stop
       at w = 0.45 — still clear of the camera plane, which is what
       caps this: past ~2.5 stars cross z = 0 and smear. */
    ZOOM_PUSH:       2.20,

    /* ── HDR / bloom ── */
    EXPOSURE:        0.85,
    BLOOM_THRESHOLD: 0.95,
    BLOOM_STRENGTH:  0.55,
    BLOOM_MIPS:      3,

    /* ── Volumetric dust ── */
    DUST_STEPS:      16,       // raymarch samples through the disc
    DUST_DENSITY:    0.78,

    /* ── Sky ── */
    METEOR_COUNT:    3,
    METEOR_CHANCE:   0.06,     // spawn probability per second per slot

    /* ── Cursor ── */
    PUSH_RADIUS:     0.34,
    PUSH_STRENGTH:   0.26,
    SWIRL:           0.55,
    WAKE_DECAY:      1.7,
    RETURN_SPRING:   1.20,
    RETURN_DAMPING:  2.30,
    MAX_OFFSET:      0.34,
  };

  const CAM_DIST = 3.0;

  /* ============================================================
     WEBGL2
     ============================================================ */
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: false, depth: false,
    premultipliedAlpha: true, powerPreference: 'high-performance',
  });
  if (!gl) {
    // WebGL2 is required for the HDR pipeline (float render targets,
    // multiple render passes). Without it, fall back to the previous
    // WebGL1 particle renderer rather than leaving the hero empty.
    const fallback = document.createElement('script');
    fallback.src = 'galaxy.legacy.js';
    document.head.appendChild(fallback);
    return;
  }

  // Float render targets are what let brightness exceed 1.0 and bloom
  // properly; without them everything clips at white.
  const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('EXT_float_blend');
  const HDR_FMT  = hasFloat ? gl.RGBA16F : gl.RGBA8;
  const HDR_TYPE = hasFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('galaxy shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function program(vsSrc, fsSrc) {
    const vs = compile(gl.VERTEX_SHADER, '#version 300 es\n' + vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, '#version 300 es\n' + fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('galaxy link:', gl.getProgramInfoLog(p));
      return null;
    }
    const u = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const n = gl.getActiveUniform(p, i).name;
      u[n] = gl.getUniformLocation(p, n);
    }
    return { p, u };
  }

  /* ── Render targets ── */
  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, HDR_FMT, w, h, 0, gl.RGBA, HDR_TYPE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                            gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  let sceneRT = null;
  let dustRT = null;          // half-res: the raymarch is the GPU cost
  const bloomRT = [];

  function disposeTargets() {
    if (sceneRT) {
      gl.deleteTexture(sceneRT.tex); gl.deleteFramebuffer(sceneRT.fbo);
    }
    if (dustRT) {
      gl.deleteTexture(dustRT.tex); gl.deleteFramebuffer(dustRT.fbo);
      dustRT = null;
    }
    bloomRT.forEach(m => [m.down, m.blurA].forEach(t => {
      gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo);
    }));
    bloomRT.length = 0;
    sceneRT = null;
  }

  function buildTargets(w, h) {
    disposeTargets();
    sceneRT = makeTarget(w, h);
    // Dust is smooth and low-frequency, so half resolution is visually
    // free — and it is the difference between 39ms and 10ms per frame.
    dustRT = makeTarget(Math.max(2, w >> 1), Math.max(2, h >> 1));
    let mw = w, mh = h;
    for (let i = 0; i < config.BLOOM_MIPS; i++) {
      mw = Math.max(2, mw >> 1);
      mh = Math.max(2, mh >> 1);
      bloomRT.push({ down: makeTarget(mw, mh), blurA: makeTarget(mw, mh) });
    }
  }

  /* ── Fullscreen triangle, shared by every fullscreen pass ── */
  const quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const QUAD_VS = `
    layout(location = 0) in vec2 aPos;
    out vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  /* ============================================================
     SHADER CHUNKS
     ============================================================ */
  const NOISE = `
    vec3 hash33(vec3 p) {
      p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
               dot(p, vec3(269.5, 183.3, 246.1)),
               dot(p, vec3(113.5, 271.9, 124.6)));
      return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
    }
    float noise3(vec3 p) {
      vec3 i = floor(p), f = fract(p);
      vec3 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(dot(hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
                         dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                     mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
                         dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
                 mix(mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
                         dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                     mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
                         dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
    }
    float fbm(vec3 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise3(p); p *= 2.03; a *= 0.5; }
      return v;
    }`;

  // Shared so the dust and the particles agree on where the arms are.
  const SPIRAL = `
    uniform float uArms;
    uniform float uTightness;
    uniform float uArmStart;
    uniform float uArmFloor;
    float armRidge(float r) {
      float x = max(r, uArmFloor);
      return log(x / uArmStart + 0.30) * uTightness;
    }
    float armDist(float r, float theta) {
      float gap = 6.28318530718 / uArms;
      float d = mod(theta - armRidge(r), gap);
      if (d > gap * 0.5) d -= gap;
      return d;
    }`;

  /* ── Sky: deep field, nebulae, distant galaxies ── */
  const skyProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform vec2 uRes;
    uniform float uTime;
    uniform vec2 uParallax;
    ${NOISE}

    // Jittered grid: evenly spread without the clumping of pure random.
    vec3 starLayer(vec2 uv, float density, float bright, float seed) {
      vec2 g = uv * density;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      vec3 h = hash33(vec3(id, seed));
      if (h.z < 0.30) return vec3(0.0);
      vec2 off = h.xy * 0.38;
      float d = length(f - off);
      float mag = fract(h.z * 91.7);
      float lum = pow(mag, 3.2) * bright;
      float core = exp(-d * d * 520.0) * lum;
      float t = fract(h.x * 57.3);
      vec3 col = mix(vec3(1.0, 0.84, 0.66), vec3(0.74, 0.86, 1.0),
                     smoothstep(0.25, 0.85, t));
      float tw = 1.0 + (1.0 - lum) * 0.32 * sin(uTime * 1.1 + h.y * 30.0);
      return col * core * tw;
    }

    // A far galaxy: small inclined ellipse with a core and faint arms.
    vec3 farGalaxy(vec2 uv, vec2 pos, float size, float rot, vec3 tint) {
      vec2 d = uv - pos;
      float c = cos(rot), s = sin(rot);
      d = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
      d.y /= 0.42;
      float r = length(d) / size;
      float disc = exp(-r * r * 3.2) * 0.26;
      float core = exp(-r * r * 44.0) * 0.80;
      float th = atan(d.y, d.x);
      float arms = 0.72 + 0.28 * cos(th * 2.0 - r * 7.0);
      return tint * (disc * arms + core);
    }

    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
      vec3 col = vec3(0.0);

      // Faint nebular wash: large scale, very low contrast.
      vec3 np = vec3(p * 2.1, 0.0);
      float n1 = fbm(np + vec3(0.0, 0.0, 0.7));
      float n2 = fbm(np * 1.7 + vec3(4.2, 1.3, 0.0));
      col += (vec3(0.15, 0.19, 0.40) * max(0.0, n1) * 0.26
            + vec3(0.32, 0.15, 0.21) * max(0.0, n2) * 0.15) * 0.7;

      // Depth layers: nearer layers parallax further.
      col += starLayer(p + uParallax * 0.30, 20.0, 1.00, 1.0);
      col += starLayer(p + uParallax * 0.62, 42.0, 0.60, 2.0);
      col += starLayer(p + uParallax * 1.00, 86.0, 0.32, 3.0);

      // Distant galaxies, kept off-centre and away from the headline.
      col += farGalaxy(p, vec2(-0.76,  0.29), 0.050, 0.7, vec3(0.86, 0.82, 1.00));
      col += farGalaxy(p, vec2( 0.70, -0.32), 0.038, 2.2, vec3(1.00, 0.88, 0.76));
      col += farGalaxy(p, vec2(-0.54, -0.39), 0.029, 1.1, vec3(0.80, 0.90, 1.00));
      col += farGalaxy(p, vec2( 0.82,  0.17), 0.025, 4.0, vec3(1.00, 0.84, 0.70));
      col += farGalaxy(p, vec2( 0.36,  0.45), 0.021, 3.1, vec3(0.88, 0.92, 1.00));
      col += farGalaxy(p, vec2(-0.32,  0.47), 0.017, 5.2, vec3(0.92, 0.86, 1.00));
      col += farGalaxy(p, vec2( 0.18, -0.47), 0.019, 0.3, vec3(0.82, 0.88, 1.00));

      frag = vec4(col, 1.0);
    }`);

  /* ── Volumetric dust: the biggest reason this reads as photographic ── */
  const dustProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uScale;
    uniform float uCamDist;
    uniform float uTilt;
    uniform float uDrift;
    uniform float uPattern;
    uniform float uDensity;
    uniform int   uSteps;
    ${NOISE}
    ${SPIRAL}

    float density(vec3 q) {
      float r = length(q.xy);
      if (r > 1.15) return 0.0;
      float zf = exp(-abs(q.z) * 24.0);            // thin disc
      float radial = exp(-r * 1.9) * smoothstep(0.02, 0.15, r);
      float th = atan(q.y, q.x);
      float d = armDist(r, th);
      float arm = exp(-d * d * 7.0);               // gas piles on arms
      vec3 np = vec3(q.xy * 3.1, q.z * 5.0 + uTime * 0.012);
      float turb  = fbm(np) * 0.5 + 0.5;
      float turb2 = fbm(np * 2.7 + 11.3) * 0.5 + 0.5;
      float dens = radial * zf * (0.30 + arm * 1.35) * (0.35 + turb * 0.95);
      // Dark lanes carved by the second noise field.
      dens *= mix(1.0, 0.18, smoothstep(0.52, 0.82, turb2) * arm);
      return dens * uDensity;
    }

    vec3 emission(float r, float armness) {
      vec3 core = vec3(1.00, 0.72, 0.38);
      vec3 mid  = vec3(0.60, 0.48, 0.70);
      vec3 rim  = vec3(0.30, 0.44, 0.86);
      vec3 c = mix(core, mid, smoothstep(0.03, 0.34, r));
      c = mix(c, rim, smoothstep(0.30, 0.95, r));
      // Star-forming arms glow magenta, as HII gas does.
      return mix(c, c * vec3(1.35, 0.72, 0.95), armness * 0.40);
    }

    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 ndc = (vUv - 0.5) * 2.0;
      vec2 sp = vec2(ndc.x * aspect, ndc.y);

      vec3 ro = vec3(0.0, 0.0, uCamDist);
      vec3 rd = normalize(vec3(sp / uScale, -1.0));

      // Into the disc's frame (inverse tilt about X).
      float ct = cos(-uTilt), st = sin(-uTilt);
      mat3 inv = mat3(1.0, 0.0, 0.0,
                      0.0,  ct,  st,
                      0.0, -st,  ct);
      ro = inv * ro; rd = inv * rd;
      ro.x -= uDrift;

      // Slab containing the disc.
      float tN = (0.22 - ro.z) / rd.z;
      float tF = (-0.22 - ro.z) / rd.z;
      if (tN > tF) { float t = tN; tN = tF; tF = t; }
      tN = max(tN, 0.0);
      if (tF <= tN) { frag = vec4(0.0); return; }

      float stepLen = (tF - tN) / float(uSteps);
      float jit = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      float t = tN + stepLen * jit;                // dither out banding

      vec3 acc = vec3(0.0);
      float trans = 1.0;
      float cs = cos(-uPattern), ss = sin(-uPattern);

      for (int i = 0; i < 48; i++) {
        if (i >= uSteps || trans < 0.02) break;
        vec3 q = ro + rd * t;
        vec3 qq = vec3(q.x * cs - q.y * ss, q.x * ss + q.y * cs, q.z);
        float dens = density(qq);
        if (dens > 0.002) {
          float r = length(qq.xy);
          float armness = exp(-pow(armDist(r, atan(qq.y, qq.x)), 2.0) * 7.0);
          float a = dens * stepLen * 5.4;
          acc += emission(r, armness) * a * trans;
          trans *= 1.0 - min(a, 0.96);
        }
        t += stepLen;
      }
      frag = vec4(acc, 1.0);
    }`);

  /* ── Star particles ── */
  const starProg = program(`
    precision highp float;
    layout(location = 0) in vec3 aPos;
    layout(location = 1) in vec3 aAttr;   // radius, twinkle seed, alpha
    layout(location = 2) in vec4 aTint;   // rgb + size
    layout(location = 3) in float aLum;
    uniform mat3 uRot;
    uniform float uCamDist;
    uniform float uScale;
    uniform float uAspect;
    uniform float uPointScale;
    uniform float uTime;
    uniform float uDrift;
    uniform float uZoom;      // 0..1, camera closes in
    uniform float uZoomPush;  // world units the camera travels at uZoom=1
    uniform float uBurst;     // 0..1, the disc flies apart
    out vec3  vColor;
    out float vAlpha;
    out float vBright;
    void main() {
      vec3 world = aPos;

      // ── Burst ──
      // Each star flies outward along its own direction, accelerating
      // then easing. A hash of the position gives every star a slightly
      // different speed so the front is ragged rather than a clean ring.
      if (uBurst > 0.0) {
        float h = fract(sin(dot(world.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float r0 = length(world.xy);
        vec3 dir = normalize(vec3(world.xy, world.z * 2.0 + 0.001));

        // ── Collapse, then detonate ──
        // 0.00-0.34  the disc is pulled inward and tightens
        // 0.34-1.00  it detonates outward, decelerating as it goes
        // Simply expanding from the start read as the galaxy shrinking
        // away; the inward squeeze is what gives the blast its recoil.
        float collapse = smoothstep(0.0, 0.34, uBurst)
                       * (1.0 - smoothstep(0.30, 0.42, uBurst));
        // Outer stars fall furthest, so the disc visibly tightens.
        world.xy *= 1.0 - collapse * 0.58 * (0.45 + r0 * 0.55);
        world.z  *= 1.0 - collapse * 0.40;

        float blast = smoothstep(0.34, 1.0, uBurst);
        // Ease-out cubic: violent at the instant of release, gliding to
        // a stop as the debris spreads.
        float e = 1.0 - blast;
        float ease = 1.0 - e * e * e;
        world += dir * ease * (2.4 + h * 5.8);
        // Flatten toward the sky plane as the shell disperses.
        world.z *= 1.0 - blast * 0.75;
      }

      world += vec3(uDrift, 0.0, 0.0);
      vec3 p = uRot * world;
      // Camera pulls back as the galaxy zooms out.
      // The camera pushes IN as the page scrolls, so the galaxy grows
      // toward the viewer before it detonates. A positive term here
      // pulled the camera back instead, which read as the galaxy
      // shrinking away from the explosion rather than rushing at it.
      float w = uCamDist - uZoom * uZoomPush - p.z;
      vec2 ndc = vec2(p.x, p.y) * uScale / w;
      ndc.x /= uAspect;
      gl_Position = vec4(ndc, 0.0, 1.0);

      vColor = aTint.rgb;
      float amp = mix(0.30, 0.05, clamp(aLum / 3.2, 0.0, 1.0));
      float tw = (1.0 - amp) + amp * sin(uTime * 1.7 + aAttr.y * 6.283);
      // HDR: allowed to exceed 1.0 so it blooms downstream.
      vAlpha = aAttr.z * tw * (0.14 + pow(aLum, 0.85) * 0.52);
      vBright = smoothstep(1.4, 4.4, aLum);

      // Flash at the instant of detonation (0.34), not at the start:
      // during the collapse the disc should darken and tighten, and the
      // light should arrive with the blast.
      float squeeze = smoothstep(0.0, 0.32, uBurst)
                    * (1.0 - smoothstep(0.28, 0.40, uBurst));
      float flash = exp(-pow((uBurst - 0.38) * 11.0, 2.0)) * 0.85;
      // Brighten as the disc compresses, then flare on release.
      vAlpha *= 1.0 + squeeze * 0.55 + flash;
      vBright = min(1.0, vBright + flash * 0.55);
      // Once dispersed the stars read as distant background points.
      vAlpha *= 1.0 - smoothstep(0.34, 1.0, uBurst) * 0.45;

      float persp = uCamDist / w;
      gl_PointSize = uPointScale * persp * aTint.a *
                     (0.62 + pow(aLum, 0.50) * 0.44);
    }
  `, `
    precision highp float;
    in vec3  vColor;
    in float vAlpha;
    in float vBright;
    out vec4 frag;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r2 = dot(d, d);
      if (r2 > 0.25) discard;
      float disc = smoothstep(0.25, 0.0, r2);
      float core = pow(disc, 3.2);
      float halo = pow(disc, 0.55);

      float spikes = 0.0;
      if (vBright > 0.02) {
        vec2 ad = abs(d);
        float cr = max(smoothstep(0.030, 0.0, ad.x) * smoothstep(0.5, 0.0, ad.y),
                       smoothstep(0.030, 0.0, ad.y) * smoothstep(0.5, 0.0, ad.x));
        spikes = cr * vBright * 0.55;
      }

      // Hot cores desaturate toward white, as an overexposed star does.
      vec3 col = mix(vColor, vec3(1.0), core * vBright * 0.42);
      float e = vAlpha * (halo * (0.18 + vBright * 0.26)
                        + disc * 0.30 + core * 0.95 + spikes);
      frag = vec4(col * e, 1.0);
    }`);

  /* ── Meteors ── */
  const meteorProg = program(`
    precision highp float;
    layout(location = 0) in vec2 aPos;
    uniform vec2 uStart;
    uniform vec2 uDir;
    uniform float uLen;
    uniform float uWidth;
    uniform float uAspect;
    out vec2 vLocal;
    void main() {
      vec2 perp = vec2(-uDir.y, uDir.x);
      vec2 p = uStart + uDir * (aPos.x * uLen) + perp * (aPos.y * uWidth);
      vLocal = aPos;
      gl_Position = vec4(p.x / uAspect, p.y, 0.0, 1.0);
    }
  `, `
    precision highp float;
    in vec2 vLocal;
    out vec4 frag;
    uniform float uFade;
    uniform vec3 uColor;
    void main() {
      float along = vLocal.x * 0.5 + 0.5;      // head at 1, tail at 0
      float trail = pow(along, 3.0);
      float across = 1.0 - abs(vLocal.y);
      float body = trail * across * across;
      float head = smoothstep(0.86, 1.0, along) * across * 2.2;
      frag = vec4(uColor * (body * 1.4 + head) * uFade, 1.0);
    }`);

  /* ── Post ── */
  const brightProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform sampler2D uSrc;
    uniform float uThreshold;
    void main() {
      vec3 c = texture(uSrc, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float k = smoothstep(uThreshold, uThreshold * 2.0, l);  // soft knee
      frag = vec4(c * k, 1.0);
    }`);

  const blurProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform sampler2D uSrc;
    uniform vec2 uDir;
    void main() {
      // 9-tap gaussian via 5 linear-filtered fetches.
      vec3 c  = texture(uSrc, vUv).rgb * 0.2270270270;
      c += texture(uSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
      c += texture(uSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
      c += texture(uSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
      c += texture(uSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
      frag = vec4(c, 1.0);
    }`);

  // Straight bilinear lift from the half-res dust buffer. The texture
  // is already LINEAR-filtered, so this is just a copy.
  const upsampleProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform sampler2D uSrc;
    void main() { frag = vec4(texture(uSrc, vUv).rgb, 1.0); }`);


  /* ── Gas giant ──
     Grows behind the content sections as the page is read. Banded
     flow, a persistent storm, terminator shading and an atmospheric
     rim, all procedural — drawn as a single fullscreen pass that
     discards outside the disc. */
  const planetProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uGrow;      // 0..1 scroll progress
    ${NOISE}

    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

      // Approaches from a distance and settles dead centre, filling
      // much of the frame — the destination of the whole sequence.
      float R = 0.045 + uGrow * uGrow * 0.60;
      vec2 centre = vec2(0.0, -0.30 * (1.0 - uGrow));
      vec2 d = p - centre;
      float r = length(d) / R;
      if (r > 1.35) { frag = vec4(0.0); return; }

      // Sphere normal, for shading and for mapping the bands.
      float z = sqrt(max(0.0, 1.0 - r * r));
      vec3 n = normalize(vec3(d / R, z));

      // Gentle axial tilt so the bands are not perfectly horizontal.
      float ct = cos(0.34), st = sin(0.34);
      vec3 sn = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);

      // Latitude drives the banding; longitude drifts with time so the
      // atmosphere flows. Bands shear at different rates by latitude,
      // which is what makes a gas giant read as fluid rather than
      // painted stripes.
      float lat = asin(clamp(sn.y, -1.0, 1.0));
      float lon = atan(sn.x, sn.z) + uTime * 0.020 + sin(lat * 3.0) * 0.30;

      float bands = sin(lat * 15.0
                  + fbm(vec3(lon * 1.6, lat * 5.0, uTime * 0.03)) * 3.2);
      float detail = fbm(vec3(lon * 3.4, lat * 9.0, uTime * 0.05));

      // Warm ochre and cream, like Jupiter.
      vec3 dark  = vec3(0.42, 0.26, 0.17);
      vec3 mid   = vec3(0.78, 0.58, 0.38);
      vec3 light = vec3(0.94, 0.86, 0.72);
      vec3 col = mix(dark, mid, smoothstep(-0.6, 0.4, bands));
      col = mix(col, light, smoothstep(0.2, 0.9, bands + detail * 0.5));
      col = mix(col, col * 0.82, smoothstep(0.3, 0.8, detail));

      // A persistent storm, south of the equator.
      vec2 sp = vec2(lon - 0.9, lat + 0.42);
      sp.x = mod(sp.x + 3.14159, 6.28318) - 3.14159;
      float storm = exp(-dot(sp * vec2(1.6, 3.4), sp * vec2(1.6, 3.4)) * 5.0);
      float swirl = sin(atan(sp.y, sp.x) * 3.0 - length(sp) * 12.0 + uTime * 0.3);
      col = mix(col, vec3(0.86, 0.40, 0.26) * (0.85 + swirl * 0.15),
                storm * 0.85);

      // Lit from the upper left, matching the galaxy's glow.
      vec3 L = normalize(vec3(-0.55, 0.42, 0.72));
      float lam = max(0.0, dot(n, L));
      float term = smoothstep(0.0, 0.32, lam);         // soft terminator
      col *= 0.06 + term * 1.08;

      // Atmospheric rim: brightest where the limb is lit.
      float rim = pow(1.0 - z, 2.6);
      col += vec3(0.44, 0.60, 0.95) * rim * (0.20 + lam * 0.85);

      // Soft edge into the sky, plus the overall fade-in.
      float edge = smoothstep(1.02, 0.965, r);
      float vis = smoothstep(0.0, 0.10, uGrow);
      frag = vec4(col * edge * vis, 1.0);
    }`);

  const compositeProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform sampler2D uScene;
    uniform sampler2D uBloom0;
    uniform sampler2D uBloom1;
    uniform sampler2D uBloom2;
    uniform float uExposure;
    uniform float uBloomStrength;
    uniform vec2 uRes;
    uniform float uTime;

    // ACES filmic curve: keeps bright cores from clipping to flat white.
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    void main() {
      vec3 col = texture(uScene, vUv).rgb;
      // Three mips: tight, medium and wide halo. Binding the last mip
      // twice (as a 4-sampler version would with 3 targets) double
      // weights it and over-brightens the widest halo.
      vec3 bloom = texture(uBloom0, vUv).rgb * 1.00
                 + texture(uBloom1, vUv).rgb * 0.72
                 + texture(uBloom2, vUv).rgb * 0.46;
      col += bloom * uBloomStrength;

      col *= uExposure;
      col = aces(col);

      vec2 q = vUv - 0.5;
      col *= clamp(1.0 - dot(q, q) * 0.85, 0.0, 1.0);        // vignette

      // Grain, to break banding in the faint gradients.
      float g = fract(sin(dot(vUv * uRes + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.016;
      col = max(col, vec3(0.0));

      // Premultiplied output: alpha from luminance so the page colour
      // shows through empty sky instead of the canvas painting it black.
      float a = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)) * 3.4, 0.0, 1.0);
      frag = vec4(col, a);
    }`);

  if (!skyProg || !dustProg || !starProg || !meteorProg || !upsampleProg ||
      !planetProg ||
      !brightProg || !blurProg || !compositeProg) return;

  /* ============================================================
     STAR CLASSES
     Brightness is deliberately NOT tied to hue. An earlier ordering
     ran warm-faint to cool-bright, which left amber stars at 60% of
     the count but 25% of the light and rendered the field white.
     ============================================================ */
  const STAR_TYPES = [
    { k: 'deep red',    w: 0.07, c: [1.00, 0.36, 0.16], s: 0.62, l: 0.30 },
    { k: 'ember',       w: 0.06, c: [1.00, 0.46, 0.20], s: 0.68, l: 0.58 },
    { k: 'amber dim',   w: 0.10, c: [1.00, 0.60, 0.26], s: 0.68, l: 0.38 },
    { k: 'amber',       w: 0.09, c: [1.00, 0.70, 0.42], s: 0.88, l: 1.05 },
    { k: 'gold',        w: 0.06, c: [1.00, 0.82, 0.46], s: 0.98, l: 1.55 },
    { k: 'cream',       w: 0.05, c: [1.00, 0.94, 0.82], s: 0.94, l: 0.92 },
    { k: 'amber giant', w: 0.05, c: [1.00, 0.66, 0.34], s: 1.26, l: 2.70 },
    { k: 'rose',        w: 0.04, c: [1.00, 0.58, 0.64], s: 0.86, l: 1.15 },
    { k: 'mint',        w: 0.05, c: [0.64, 0.98, 0.86], s: 0.66, l: 0.50 },
    { k: 'teal',        w: 0.05, c: [0.52, 0.88, 0.96], s: 0.70, l: 0.48 },
    { k: 'ice',         w: 0.06, c: [0.58, 0.90, 1.00], s: 0.76, l: 0.80 },
    { k: 'blue dim',    w: 0.08, c: [0.70, 0.84, 1.00], s: 0.70, l: 0.42 },
    { k: 'blue-white',  w: 0.07, c: [0.86, 0.94, 1.00], s: 1.00, l: 1.40 },
    { k: 'hot blue',    w: 0.05, c: [0.60, 0.78, 1.00], s: 1.32, l: 3.00 },
    { k: 'violet',      w: 0.04, c: [0.72, 0.62, 1.00], s: 1.08, l: 1.70 },
    { k: 'anchor warm', w: 0.02, c: [1.00, 0.80, 0.50], s: 1.90, l: 5.00 },
    { k: 'anchor cool', w: 0.01, c: [0.72, 0.88, 1.00], s: 2.00, l: 5.60 },
  ];

  const WARM_TYPES = ['deep red', 'amber dim', 'ember', 'cream', 'rose',
                      'amber', 'gold', 'amber giant', 'anchor warm']
    .map(k => STAR_TYPES.find(t => t.k === k));
  const COOL_TYPES = ['mint', 'teal', 'blue dim', 'ice', 'violet',
                      'blue-white', 'hot blue', 'anchor cool']
    .map(k => STAR_TYPES.find(t => t.k === k));

  function pickType(r, inBulge, inArm, ang) {
    let coolChance;
    if (inBulge) coolChance = 0.12;
    else if (inArm) {
      // Arms skew blue, banded along their length so colour clumps.
      const band = Math.sin(ang * 2.7 + r * 9.0) * 0.5 + 0.5;
      coolChance = 0.34 + band * 0.44;
    } else coolChance = 0.30;
    const pool = Math.random() < coolChance ? COOL_TYPES : WARM_TYPES;
    const u = Math.random();
    return pool[Math.min(pool.length - 1,
                Math.floor(Math.pow(u, 2.1) * pool.length))];
  }

  /* ============================================================
     PARTICLES
     ============================================================ */
  const N = config.STAR_COUNT;
  const radius = new Float32Array(N);
  const angle  = new Float32Array(N);    // offset FROM the arm
  const height = new Float32Array(N);
  const seed   = new Float32Array(N);
  const lum    = new Float32Array(N);
  const life   = new Float32Array(N);
  const lifeRate = new Float32Array(N);
  const popArr = new Uint8Array(N);
  const offX = new Float32Array(N), offY = new Float32Array(N), offZ = new Float32Array(N);
  const velX = new Float32Array(N), velY = new Float32Array(N), velZ = new Float32Array(N);
  const posArr  = new Float32Array(N * 3);
  const attrArr = new Float32Array(N * 3);
  const tintArr = new Float32Array(N * 4);
  let tintDirty = true, lumDirty = true;

  const gauss = () =>
    (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const smooth01 = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

  // Must match the SPIRAL shader chunk exactly.
  function armRidge(r, arm) {
    const x = r > config.ARM_FLOOR ? r : config.ARM_FLOOR;
    return (arm / config.ARMS) * Math.PI * 2 +
           Math.log(x / config.ARM_START + 0.30) * config.ARM_TIGHTNESS;
  }

  function spawnStar(i, freshLife) {
    const roll = Math.random();
    const NU = config.NUCLEUS_FRACTION, B = config.BULGE_FRACTION;
    let pop;
    if (roll < NU) pop = 4;
    else if (roll < NU + B) pop = 0;
    else if (roll < NU + B + config.INTERARM) pop = 3;
    else if (roll < NU + B + config.INTERARM + config.SPUR_FRACTION) pop = 2;
    else pop = 1;

    let r, ang, thickness, hii = 0;

    if (pop === 4) {
      // Cube-root fills a sphere evenly rather than crowding the centre.
      r = Math.cbrt(Math.random()) * config.NUCLEUS_RADIUS + 0.002;
      ang = Math.random() * Math.PI * 2;
      thickness = 4.2;
    } else if (pop === 0) {
      r = Math.pow(Math.random(), 3.1) * config.BULGE_RADIUS + 0.010;
      ang = Math.random() * Math.PI * 2;
      thickness = 2.8;
    } else {
      if (freshLife) {
        // Recycled stars re-enter AT THE RIM. Re-sampling the whole
        // profile let infall drain the outer disc (8.3% -> 0.9% of
        // stars in a minute) until the arms collapsed into a blob.
        r = config.RIM_LO + Math.random() * (config.DISC_RADIUS - config.RIM_LO);
      } else {
        const k = config.DISC_RADIUS / config.DISC_SCALE;
        r = -config.DISC_SCALE * Math.log(1 - Math.random() * (1 - Math.exp(-k)));
      }
      if (r > config.DISC_RADIUS) r = config.DISC_RADIUS;
      if (r < config.ARM_START) r = config.ARM_START * (0.55 + Math.random() * 0.75);

      const arm = Math.floor(Math.random() * config.ARMS);
      const ridge = armRidge(r, arm);

      if (pop === 3) {
        ang = ridge + gauss() * (Math.PI * 2 / config.ARMS) * 0.42;
        thickness = 1.0;
      } else if (pop === 2) {
        const spurIdx = Math.floor(Math.random() * config.SPURS_PER_ARM);
        const along = Math.random();
        const anchorR = config.ARM_MIN + 0.06 +
          (spurIdx / config.SPURS_PER_ARM) *
          (config.DISC_RADIUS - config.ARM_MIN - 0.18);
        r = Math.min(config.DISC_RADIUS,
              anchorR + along * config.SPUR_LENGTH * (0.6 + Math.random() * 0.8));
        ang = armRidge(anchorR, arm) + along * config.SPUR_PITCH + gauss() * 0.05;
        thickness = 0.8;
      } else {
        // Arm density tapers in; a hard radius cut stacked stars into
        // bright blobs at the arm roots.
        const armProb = smooth01((r - config.ARM_MIN) / config.ARM_FADE);
        if (Math.random() > armProb) {
          pop = 3;
          ang = ridge + gauss() * (Math.PI * 2 / config.ARMS) * 0.42;
          thickness = 1.0;
        } else {
          const w = config.ARM_SPREAD * (0.55 + r * 0.75);
          let off = gauss() * w + config.ARM_BIAS * w;
          // Dust lane on the concave edge: the dark dividing line.
          const lane = -config.ARM_BIAS * w - config.DUST_OFFSET * w;
          if (Math.abs(off - lane) < config.DUST_WIDTH * w &&
              Math.random() < config.DUST_OPACITY) {
            off += (off > lane ? 1 : -1) * config.DUST_WIDTH * w * 1.4;
          }
          ang = armRidge(r, arm) + off;
          thickness = 0.55;

          if (Math.random() < config.HII_RATE) {
            hii = 1;
            // Radius FIRST: the ridge angle depends on it.
            const knot = Math.floor(Math.random() * config.HII_KNOTS);
            r = config.ARM_MIN + (knot / config.HII_KNOTS) *
                (config.DISC_RADIUS - config.ARM_MIN) + gauss() * 0.020;
            const kw = config.ARM_SPREAD * (0.55 + r * 0.75);
            const kl = -config.ARM_BIAS * kw - config.DUST_OFFSET * kw;
            ang = armRidge(r, arm) + kl + config.DUST_WIDTH * kw * 2.0 +
                  gauss() * 0.030;
          }
        }
      }
    }

    radius[i] = r;
    popArr[i] = pop;
    // Offset FROM the arm, not an absolute angle: the arm's angle is a
    // function of radius, so a star keeping a fixed angle while falling
    // inward slides off its arm and tears the spiral apart.
    angle[i] = (pop === 4 || pop === 0) ? ang : ang - armRidge(r, 0);
    height[i] = gauss() * config.THICKNESS * thickness * (1.0 - r * 0.45);
    seed[i] = Math.random();

    const vary = 0.88 + Math.random() * 0.24;
    const t4 = i * 4;
    if (hii) {
      // HII regions glow pink: hot young stars lighting hydrogen gas.
      tintArr[t4] = 1.00; tintArr[t4 + 1] = 0.40; tintArr[t4 + 2] = 0.62;
      tintArr[t4 + 3] = 1.30 * vary;
      lum[i] = 2.8 * (0.85 + Math.random() * 0.3);
    } else if (pop === 4) {
      // The little sun: white-hot centre warming to gold at the limb.
      const edge = r / config.NUCLEUS_RADIUS;
      tintArr[t4] = 1.00;
      tintArr[t4 + 1] = 0.99 - edge * 0.20;
      tintArr[t4 + 2] = 0.96 - edge * 0.44;
      tintArr[t4 + 3] = (1.05 - edge * 0.26) * vary;
      lum[i] = (4.6 - edge * 1.6) + Math.random() * 1.3;
    } else {
      const type = pickType(r, pop === 0, pop === 1, ang);
      tintArr[t4] = type.c[0];
      tintArr[t4 + 1] = type.c[1];
      tintArr[t4 + 2] = type.c[2];
      tintArr[t4 + 3] = type.s * vary;
      lum[i] = type.l * (0.82 + Math.random() * 0.36);
    }
    tintDirty = lumDirty = true;

    life[i] = freshLife ? 0 : Math.random();
    lifeRate[i] = 0.020 + Math.random() * 0.026;
    offX[i] = offY[i] = offZ[i] = 0;
    velX[i] = velY[i] = velZ[i] = 0;
  }

  for (let i = 0; i < N; i++) spawnStar(i, false);

  /* ── Buffers ── */
  const starVAO = gl.createVertexArray();
  gl.bindVertexArray(starVAO);
  const posBuf = gl.createBuffer(), attrBuf = gl.createBuffer();
  const tintBuf = gl.createBuffer(), lumBuf = gl.createBuffer();
  function setupAttr(buf, loc, size, data, usage) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  setupAttr(posBuf, 0, 3, posArr, gl.DYNAMIC_DRAW);
  setupAttr(attrBuf, 1, 3, attrArr, gl.DYNAMIC_DRAW);
  setupAttr(tintBuf, 2, 4, tintArr, gl.DYNAMIC_DRAW);
  setupAttr(lumBuf, 3, 1, lum, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);

  const meteorVAO = gl.createVertexArray();
  gl.bindVertexArray(meteorVAO);
  const meteorBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meteorBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  1, 1,
    -1, -1,  1,  1, -1, 1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  /* ── Meteors ── */
  const meteors = [];
  for (let i = 0; i < config.METEOR_COUNT; i++) {
    meteors.push({ active: false, t: 0, dur: 1, x: 0, y: 0, dx: 1, dy: 0,
                   len: 0.2, w: 0.003, speed: 1, col: [1, 1, 1] });
  }

  function spawnMeteor(m) {
    const edge = Math.random();
    if (edge < 0.55) { m.x = -1.5 + Math.random() * 3.0; m.y = 1.15; }
    else if (edge < 0.78) { m.x = -1.65; m.y = 0.2 + Math.random() * 0.9; }
    else { m.x = 1.65; m.y = 0.2 + Math.random() * 0.9; }
    const dir = Math.atan2(-m.y, -m.x) + (Math.random() - 0.5) * 0.9;
    m.dx = Math.cos(dir); m.dy = Math.sin(dir);
    m.len = 0.10 + Math.random() * 0.20;
    m.w = 0.0022 + Math.random() * 0.0028;
    m.dur = 0.7 + Math.random() * 0.8;
    m.speed = 1.5 + Math.random() * 1.4;
    m.t = 0;
    m.col = Math.random() < 0.5 ? [1.0, 0.86, 0.66] : [0.80, 0.90, 1.0];
    m.active = true;
  }

  /* ============================================================
     SIZING
     ============================================================ */
  let dpr = 1, aspect = 1, pointScale = 1, scale = 1, vw = 0, vh = 0;

  function resize() {
    // The whole HDR chain (scene + bright + 4 blurred mips + composite)
    // is per-pixel, so internal resolution dominates GPU cost: measured
    // 25.7ms at 1.6x versus ~7ms at 0.9x on an M2. Rendering below the
    // device ratio is standard for effects-heavy scenes — the bloom and
    // the dust are both low-frequency, so the softness is not visible.
    dpr = Math.min(window.devicePixelRatio || 1, 0.9);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return false;

    aspect = w / h;
    const FILL = 0.80;
    const vertical = Math.max(Math.cos(config.TILT), 0.25);
    scale = Math.min(FILL * CAM_DIST / (config.DISC_RADIUS * vertical),
                     FILL * CAM_DIST * aspect / config.DISC_RADIUS);
    pointScale = config.POINT_SIZE * dpr * Math.min(1.5, Math.max(0.7, h / 900));
    lastPublishedDrift = NaN;            // the projection moved

    if (w === vw && h === vh) return false;
    vw = w; vh = h;
    canvas.width = w; canvas.height = h;
    buildTargets(w, h);
    return true;
  }

  /* ============================================================
     POINTER
     ============================================================ */
  const hero = canvas.closest('section') || canvas.parentElement;
  let pointerActive = false;
  let pointerX = 0, pointerY = 0, prevPointerX = 0, prevPointerY = 0;

  function setPointer(cx, cy) {
    const r = hero.getBoundingClientRect();
    const nx = ((cx - r.left) / r.width) * 2 - 1;
    const ny = -(((cy - r.top) / r.height) * 2 - 1);
    if (!pointerActive) { pointerX = prevPointerX = nx; pointerY = prevPointerY = ny; }
    else { pointerX = nx; pointerY = ny; }
    pointerActive = true;
  }

  if (hero && !reduceMotion) {
    hero.addEventListener('mousemove', e => setPointer(e.clientX, e.clientY), { passive: true });
    hero.addEventListener('mouseleave', () => { pointerActive = false; });
    hero.addEventListener('touchmove', e => {
      if (e.touches.length) setPointer(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    hero.addEventListener('touchend', () => { pointerActive = false; });
  }

  /* ============================================================
     STATE
     ============================================================ */
  let patternAngle = 0;
  let driftX = 0, targetDrift = 0, scrollProgress = 0;
  // Stage progress, all 0..1. See readScroll().
  let zoomT = 0, planetT = 0;
  // The burst runs on its own clock once fired, not on scroll.
  let burstFired = false, burstClock = 0;
  // Smoothed values the renderer actually uses, so a flick of the wheel
  // glides instead of snapping.
  let zoom = 0, burst = 0, planet = 0;
  let lastPublishedDrift = NaN, lastPublishedGlow = NaN;
  let swallowFeed = 0, coreGlow = 0;
  let leanX = 0, leanY = 0;
  let lastTime = performance.now();
  let running = false, visible = true;

  function wake() {
    if (running || document.hidden || !visible) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  if ('IntersectionObserver' in window) {
    // Watch the canvas, not #hero: the canvas is fixed and stays on
    // screen after the hero section scrolls past.
    new IntersectionObserver(e => { visible = e[0].isIntersecting; wake(); },
                             { threshold: 0 }).observe(canvas);
  }
  document.addEventListener('visibilitychange', wake);

  /* ── Scroll stages ──
     The page tells one continuous story as it scrolls:

       0 .. 1 vh   hero: the galaxy holds
       1 .. 2 vh   intro: the name reads over it
       1.75 vh     BURST FIRES — a timed event, not scroll-driven.
                   The disc collapses inward, detonates, and settles
                   into a starfield over BURST_DURATION seconds.
       2 .. 5 vh   planet: a gas giant approaches and fills the centre

     The scroll-driven stages must line up with the section heights in
     galaxy.css, or a stage finishes while its screen is still on view
     and the scene sits frozen for a full screen of scrolling.

     Each stage's progress is derived here so the renderer only reads
     smooth 0..1 values and never has to know about pixels. */
  function readScroll() {
    const h = window.innerHeight || 1;
    const y = window.scrollY;
    scrollProgress = Math.min(1, Math.max(0, y / h));

    // Stage 1: the camera closes in, so the galaxy swells as the page
    // scrolls toward the burst. It runs the full length of the approach
    // and lands at 1 right as the trigger fires, so the detonation
    // happens at maximum size with the stars filling the screen.
    //
    // Derived from BURST_TRIGGER rather than a second hardcoded length:
    // when those two drifted apart the zoom finished early and the
    // galaxy hung at a fixed size for the rest of the scroll.
    const ZOOM_START = 0.25;
    zoomT = Math.min(1, Math.max(0,
      (y / h - ZOOM_START) / (config.BURST_TRIGGER - ZOOM_START)));
    // Ease in: linear against scroll made the approach feel like it
    // decelerated, because equal steps cover less apparent distance the
    // closer the camera gets. Cubing front-loads the slow part.
    zoomT = zoomT * zoomT * (3 - 2 * zoomT);

    // Stage 2: the burst is NOT scroll-driven. Scrolling past the
    // trigger point fires it once and it then plays out on its own
    // clock — scrubbing an explosion back and forth with the wheel
    // robs it of any impact, and it should not need continued
    // scrolling to finish.
    const pastTrigger = y / h >= config.BURST_TRIGGER;

    if (!burstFired && pastTrigger) {
      burstFired = true;
      burstClock = 0;
    } else if (burstFired && y / h < config.BURST_TRIGGER - config.BURST_HYSTERESIS) {
      // Scrolling back above the trigger reassembles the galaxy, so the
      // sequence can be watched again. The hysteresis band matters: a
      // bare threshold would re-fire every frame while the user hovers
      // exactly on it, strobing the explosion.
      burstFired = false;
      burstClock = 0;
    }

    // Stage 3: the planet approach, beginning just after the burst
    // fires so the two do not overlap. Anchored to the trigger for the
    // same reason as the zoom.
    planetT = Math.min(1, Math.max(0,
      (y / h - (config.BURST_TRIGGER + 0.25)) / 2.9));

    targetDrift = (1 - Math.pow(1 - scrollProgress, 2)) * config.SCROLL_DRIFT;
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', readScroll, { passive: true });
  readScroll();

  /* ── Cursor wake, as a swept segment ── */
  let wakeAx = 0, wakeAy = 0, wakeBx = 0, wakeBy = 0;
  let wakeDirX = 0, wakeDirY = 0, wakeEnergy = 0;
  const _a = [0, 0], _b = [0, 0];

  function unprojectToDisc(px, py, out) {
    const w = CAM_DIST;
    out[0] = px * aspect * w / scale - driftX;
    out[1] = (py * w / scale) / (Math.cos(config.TILT) || 1e-3);
  }

  function updateWake(dt) {
    if (pointerActive) {
      unprojectToDisc(prevPointerX, prevPointerY, _a);
      unprojectToDisc(pointerX, pointerY, _b);
      wakeAx = _a[0]; wakeAy = _a[1]; wakeBx = _b[0]; wakeBy = _b[1];
      const dx = wakeBx - wakeAx, dy = wakeBy - wakeAy;
      const len = Math.hypot(dx, dy);
      if (len > 1e-5 && dt > 0) {
        wakeDirX = dx / len; wakeDirY = dy / len;
        const target = Math.min(1, (len / dt) / 1.6);
        wakeEnergy += (target - wakeEnergy) * Math.min(1, dt * 9);
      }
      prevPointerX = pointerX; prevPointerY = pointerY;
    }
    wakeEnergy -= wakeEnergy * Math.min(1, config.WAKE_DECAY * dt);
    if (wakeEnergy < 0.002) wakeEnergy = 0;
  }

  /* ============================================================
     SIMULATION
     ============================================================ */
  function simulate(dt) {
    swallowFeed = 0;
    const pr2 = config.PUSH_RADIUS * config.PUSH_RADIUS;
    const maxOff2 = config.MAX_OFFSET * config.MAX_OFFSET;
    const spring = config.RETURN_SPRING, damp = config.RETURN_DAMPING;

    for (let i = 0; i < N; i++) {
      life[i] += lifeRate[i] * dt;
      const pop = popArr[i];

      // Only disc stars spiral inward; nucleus and bulge hold radius.
      if (pop !== 4 && pop !== 0) {
        radius[i] -= config.INFALL * dt * (0.35 + radius[i] * 0.85);
      }
      if (life[i] >= 1 || radius[i] <= config.CORE_RADIUS) {
        spawnStar(i, true);
        continue;
      }

      const r = radius[i];
      // Rebuild from the arm's CURRENT ridge so a falling star tracks
      // its arm instead of cutting straight across the spiral.
      const armA = (pop === 4 || pop === 0) ? 0 : armRidge(r, 0);
      const a = armA + angle[i] + patternAngle;
      const hx = Math.cos(a) * r, hy = Math.sin(a) * r;

      if (wakeEnergy > 0) {
        const sx = hx + offX[i], sy = hy + offY[i];
        const abx = wakeBx - wakeAx, aby = wakeBy - wakeAy;
        const abLen2 = abx * abx + aby * aby;
        let t = 0;
        if (abLen2 > 1e-9) {
          t = ((sx - wakeAx) * abx + (sy - wakeAy) * aby) / abLen2;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
        }
        const dx = sx - (wakeAx + abx * t), dy = sy - (wakeAy + aby * t);
        const d2 = dx * dx + dy * dy;
        if (d2 < pr2) {
          const d = Math.sqrt(d2) || 1e-6;
          const q = 1 - d / config.PUSH_RADIUS;
          const imp = config.PUSH_STRENGTH * (q * q * (3 - 2 * q)) *
                      wakeEnergy * dt * 60;
          const sw = config.SWIRL;
          velX[i] += ((dx / d) * (1 - sw) + wakeDirX * sw) * imp;
          velY[i] += ((dy / d) * (1 - sw) + wakeDirY * sw) * imp;
          velZ[i] += (seed[i] - 0.5) * imp * 0.35;
        }
      }

      // Over-damped spring: ~4s home, no overshoot.
      velX[i] += (-spring * offX[i] - damp * velX[i]) * dt;
      velY[i] += (-spring * offY[i] - damp * velY[i]) * dt;
      velZ[i] += (-spring * offZ[i] - damp * velZ[i]) * dt;
      offX[i] += velX[i] * dt; offY[i] += velY[i] * dt; offZ[i] += velZ[i] * dt;

      const om2 = offX[i] * offX[i] + offY[i] * offY[i];
      if (om2 > maxOff2) {
        const k = config.MAX_OFFSET / Math.sqrt(om2);
        offX[i] *= k; offY[i] *= k; velX[i] *= 0.5; velY[i] *= 0.5;
      }

      const l = life[i];
      let alpha = smooth01(l / 0.30) * smooth01((1 - l) / 0.30);
      if (pop !== 4 && pop !== 0) {
        // Swallowed by the core: flare on the plunge, then extinguish.
        const fall = 1 - smooth01((r - config.CORE_RADIUS) / config.SWALLOW_REACH);
        const flare = 1 + fall * fall * config.SWALLOW_FLARE;
        const consumed = smooth01((r - config.CORE_RADIUS) / 0.022);
        const enter = 1 - smooth01((r - config.RIM_LO) /
                                   (config.DISC_RADIUS - config.RIM_LO) - 0.55);
        alpha *= flare * consumed * Math.max(0.35, enter);
        if (fall > 0.75) swallowFeed += (fall - 0.75) * 4.0 * alpha;
      }

      const o = i * 3;
      posArr[o] = hx + offX[i];
      posArr[o + 1] = hy + offY[i];
      posArr[o + 2] = height[i] + offZ[i];
      attrArr[o] = r;
      attrArr[o + 1] = seed[i];
      attrArr[o + 2] = alpha;
    }
  }

  /* ============================================================
     DRAW
     ============================================================ */
  function bindTarget(rt) {
    if (rt) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
      gl.viewport(0, 0, rt.w, rt.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, vw, vh);
    }
  }

  function rotMatrix() {
    // Tilt only. The disc orientation is FIXED — real galaxies rotate
    // differentially, which shears the arms apart (+438 deg of winding
    // in two minutes, measured). The stars carry the rotation instead.
    const c = Math.cos(config.TILT), s = Math.sin(config.TILT);
    return new Float32Array([1, 0, 0, 0, c, s, 0, -s, c]);
  }

  function draw(time) {
    if (!sceneRT || bloomRT.length === 0) return;
    const rot = rotMatrix();

    /* 1. scene -> HDR */
    bindTarget(sceneRT);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);

    gl.useProgram(skyProg.p);
    gl.uniform2f(skyProg.u.uRes, vw, vh);
    gl.uniform1f(skyProg.u.uTime, time);
    gl.uniform2f(skyProg.u.uParallax, leanX * 0.012, leanY * 0.012);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── Dust at half resolution, into its own buffer ──
    // Skipped once the burst has dissolved it: this is the most
    // expensive pass in the frame and adds nothing after that point.
    const dustVisible = burst < 0.7;
    gl.disable(gl.BLEND);
    bindTarget(dustRT);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (dustVisible) {
    gl.useProgram(dustProg.p);
    gl.uniform2f(dustProg.u.uRes, dustRT.w, dustRT.h);
    gl.uniform1f(dustProg.u.uTime, time);
    gl.uniform1f(dustProg.u.uScale, scale);
    gl.uniform1f(dustProg.u.uCamDist, CAM_DIST);
    gl.uniform1f(dustProg.u.uTilt, config.TILT);
    gl.uniform1f(dustProg.u.uDrift, driftX);
    gl.uniform1f(dustProg.u.uPattern, patternAngle);
    // The dust cannot fly apart like the particles, so it dissolves as
    // the burst takes over; leaving it up would anchor the old disc in
    // place while the stars scattered around it.
    gl.uniform1f(dustProg.u.uDensity,
                 config.DUST_DENSITY * Math.max(0, 1 - burst * 1.5));
    gl.uniform1i(dustProg.u.uSteps, config.DUST_STEPS);
    gl.uniform1f(dustProg.u.uArms, config.ARMS);
    gl.uniform1f(dustProg.u.uTightness, config.ARM_TIGHTNESS);
    gl.uniform1f(dustProg.u.uArmStart, config.ARM_START);
    gl.uniform1f(dustProg.u.uArmFloor, config.ARM_FLOOR);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Composite the dust up into the scene, then continue additively.
    bindTarget(sceneRT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(upsampleProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dustRT.tex);
    gl.uniform1i(upsampleProg.u.uSrc, 0);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(meteorProg.p);
    gl.bindVertexArray(meteorVAO);
    gl.uniform1f(meteorProg.u.uAspect, aspect);
    for (const m of meteors) {
      if (!m.active) continue;
      const prog = m.t / m.dur;
      const travel = prog * m.speed;
      gl.uniform2f(meteorProg.u.uStart, m.x + m.dx * travel, m.y + m.dy * travel);
      gl.uniform2f(meteorProg.u.uDir, m.dx, m.dy);
      gl.uniform1f(meteorProg.u.uLen, m.len);
      gl.uniform1f(meteorProg.u.uWidth, m.w);
      gl.uniform1f(meteorProg.u.uFade, Math.sin(Math.min(1, prog) * Math.PI) * 2.4);
      gl.uniform3fv(meteorProg.u.uColor, m.col);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.useProgram(starProg.p);
    gl.bindVertexArray(starVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, posArr);
    gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, attrArr);
    if (tintDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, tintArr);
      tintDirty = false;
    }
    if (lumDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, lumBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lum);
      lumDirty = false;
    }
    gl.uniformMatrix3fv(starProg.u.uRot, false, rot);
    gl.uniform1f(starProg.u.uCamDist, CAM_DIST);
    gl.uniform1f(starProg.u.uScale, scale);
    gl.uniform1f(starProg.u.uAspect, aspect);
    gl.uniform1f(starProg.u.uPointScale, pointScale);
    gl.uniform1f(starProg.u.uTime, time);
    gl.uniform1f(starProg.u.uDrift, driftX);
    gl.uniform1f(starProg.u.uZoom, zoom);
    gl.uniform1f(starProg.u.uZoomPush, config.ZOOM_PUSH);
    gl.uniform1f(starProg.u.uBurst, burst);
    gl.drawArrays(gl.POINTS, 0, N);

    // ── Planet, behind the content sections ──
    if (planet > 0.001) {
      gl.useProgram(planetProg.p);
      gl.uniform2f(planetProg.u.uRes, vw, vh);
      gl.uniform1f(planetProg.u.uTime, time);
      gl.uniform1f(planetProg.u.uGrow, planet);
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* 2. bright pass */
    gl.disable(gl.BLEND);
    bindTarget(bloomRT[0].down);
    gl.useProgram(brightProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex);
    gl.uniform1i(brightProg.u.uSrc, 0);
    gl.uniform1f(brightProg.u.uThreshold, config.BLOOM_THRESHOLD);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* 3. downsample + separable blur */
    gl.useProgram(blurProg.p);
    gl.bindVertexArray(quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    for (let i = 0; i < bloomRT.length; i++) {
      const m = bloomRT[i];
      if (i > 0) {
        bindTarget(m.down);
        gl.bindTexture(gl.TEXTURE_2D, bloomRT[i - 1].down.tex);
        gl.uniform1i(blurProg.u.uSrc, 0);
        gl.uniform2f(blurProg.u.uDir, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      bindTarget(m.blurA);
      gl.bindTexture(gl.TEXTURE_2D, m.down.tex);
      gl.uniform1i(blurProg.u.uSrc, 0);
      gl.uniform2f(blurProg.u.uDir, 1 / m.down.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      bindTarget(m.down);
      gl.bindTexture(gl.TEXTURE_2D, m.blurA.tex);
      gl.uniform2f(blurProg.u.uDir, 0, 1 / m.down.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* 4. composite + tone map -> screen */
    bindTarget(null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    // Premultiplied: the shader outputs colour already scaled by alpha.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(compositeProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex);
    gl.uniform1i(compositeProg.u.uScene, 0);
    for (let i = 0; i < bloomRT.length; i++) {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, bloomRT[i].down.tex);
      gl.uniform1i(compositeProg.u['uBloom' + i], 1 + i);
    }
    gl.uniform1f(compositeProg.u.uExposure, config.EXPOSURE);
    gl.uniform1f(compositeProg.u.uBloomStrength, config.BLOOM_STRENGTH);
    gl.uniform2f(compositeProg.u.uRes, vw, vh);
    gl.uniform1f(compositeProg.u.uTime, time);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    /* publish nucleus position + feeding glow for the CSS corona */
    if (driftX !== lastPublishedDrift) {
      lastPublishedDrift = driftX;
      const ndcX = (driftX * scale / CAM_DIST) / aspect;
      document.documentElement.style.setProperty(
        '--nucleus-x', (ndcX * 50).toFixed(3) + 'vw');
    }
    const gq = Math.round(coreGlow * 50) / 50;
    if (gq !== lastPublishedGlow) {
      lastPublishedGlow = gq;
      document.documentElement.style.setProperty('--core-glow', gq.toFixed(2));
    }
  }

  function paintOnce() {
    resize();
    simulate(0);
    draw(performance.now() / 1000);
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  function frame(now) {
    if (document.hidden || !visible) { running = false; return; }
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    resize();

    if (reduceMotion) {
      draw(0);
      requestAnimationFrame(frame);
      return;
    }

    patternAngle += config.PATTERN_SPEED * dt;
    driftX += (targetDrift - driftX) * Math.min(1, dt * 4.5);
    // Ease the scroll-driven stages so a flick of the wheel glides.
    zoom   += (zoomT   - zoom)   * Math.min(1, dt * 4.0);
    planet += (planetT - planet) * Math.min(1, dt * 3.2);

    // The burst plays on its own timeline once fired, and rewinds when
    // it is un-fired — faster on the way back, since a reversed
    // explosion is a transition rather than the main event.
    if (burstFired) {
      if (burst < 1) {
        burstClock += dt;
        burst = Math.min(1, burstClock / config.BURST_DURATION);
      }
    } else if (burst > 0) {
      burst = Math.max(0, burst - dt / config.BURST_REWIND);
    }
    leanX += (pointerX - leanX) * Math.min(1, dt * 2.5);
    leanY += (pointerY - leanY) * Math.min(1, dt * 2.5);

    for (const m of meteors) {
      if (m.active) {
        m.t += dt;
        if (m.t >= m.dur) m.active = false;
      } else if (Math.random() < config.METEOR_CHANCE * dt) {
        spawnMeteor(m);
      }
    }

    updateWake(dt);
    simulate(dt);

    // The core flares as it feeds: rises fast, settles slower.
    const feed = Math.min(1, Math.max(0,
      (swallowFeed - config.SWALLOW_BASE) /
      (config.SWALLOW_PEAK - config.SWALLOW_BASE)));
    coreGlow += (feed - coreGlow) *
                Math.min(1, dt * (feed > coreGlow ? 5.0 : 1.4));

    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  paintOnce();
  wake();
})();
