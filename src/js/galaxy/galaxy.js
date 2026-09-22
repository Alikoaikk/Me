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

  /* Captured while the script is still executing synchronously, which
     is the only time document.currentScript is set. Sibling assets are
     resolved against this so they follow the script when it moves. */
  const SCRIPT_URL = (document.currentScript && document.currentScript.src)
    || location.href;

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
    /* Longer than the old detonation's 2.6s. An explosion wants to be
       over quickly; a migration is the opposite — the stars should be
       seen travelling, and the per-star stagger (up to 45% of the
       burst) needs room to read as a ripple across the disc rather
       than as one sheet sliding over. */
    BURST_DURATION:  4.2,      // seconds, first star leaves to last arrives
    BURST_REWIND:    1.1,      // seconds to reassemble when scrolling up
    BURST_HYSTERESIS: 0.25,    // dead band, so hovering cannot strobe it
    /* The simulation freezes here, very early, because every star's
       destination is hashed from its position: if the spiral kept
       turning underneath, a star's sky home would move with it and
       the arrivals would never hold still. Freezing hands the shader
       one fixed field to migrate. See simulate(). */
    BURST_FREEZE:    0.02,
    /* How quickly the disc's gas and dust fade out once the stars
       begin leaving. Faster than the migration on purpose: the dust
       should be gone by the time the last stars arrive, so the sky is
       left clean rather than with a haze hanging where the galaxy
       used to be. See the uDensity term in draw(). */
    DUST_FADE:       1.9,

    /* ── Camera ── */
    TILT:            0.34,     // near face-on, slight depth
    /* How far the disc rolls toward edge-on over the approach, in
       radians: 19 deg -> 37 deg. Enough to read as looking at the
       galaxy from the side rather than onto its face, while still
       showing the arms.

       Positive lifts the BOTTOM edge toward the viewer, so the disc
       opens from below. See ZOOM_PUSH — these two share a depth
       budget and cannot both be raised. */
    TILT_ROLL:       0.30,
    POINT_SIZE:      0.88,
    /* The approach is a straight push down the view axis — no lateral
       pan. Drifting the disc sideways while zooming read as the galaxy
       sliding off the screen rather than coming at the viewer. */
    SCROLL_DRIFT:    0.0,
    /* How far the camera closes in, in world units, against a CAM_DIST
       of 3.0, giving ~2.07x growth.

       The cap is NOT the disc thickness — it is the tilt. Rolling the
       disc turns its RADIUS into depth: at 37 deg the near edge sits
       0.68 in front of centre, so the push and the roll compete for
       the same headroom. At 2.20 with the roll applied the near edge
       reached w = -0.05, crossing the camera plane and flinging that
       half of the galaxy off-screen. Raise either of these and
       re-check w_min = 3.0 - ZOOM_PUSH - (sin(tilt) + 0.22*cos(tilt)). */
    ZOOM_PUSH:       1.55,

    /* ── HDR / bloom ──
       Exposure is the master brightness. Lowered from 0.85: the field
       was bright enough that the bloom smeared neighbouring stars into
       a single wash and the arms lost their structure. Dimmer points
       with the same dynamic range read as more stars, not fewer.

       The threshold rises with it — the two have to move together, or
       lowering exposure alone just dims everything uniformly and the
       bright stars stop blooming at all. Raising the threshold keeps
       the bloom for the genuinely hot cores while the ordinary field
       stays a clean point. */
    EXPOSURE:        0.62,
    BLOOM_THRESHOLD: 1.15,
    BLOOM_STRENGTH:  0.46,
    BLOOM_MIPS:      3,

    /* ── Volumetric dust ── */
    DUST_STEPS:      16,       // raymarch samples through the disc
    DUST_DENSITY:    0.78,

    /* ── Sky ──
       COUNT is how many meteors can be in flight at once; CHANCE is
       the per-second spawn probability of each idle slot. The two
       multiply, so the felt rate is roughly COUNT * CHANCE per second
       while the sky is empty: 3 * 0.06 was about one streak every five
       seconds, which is realistic for a real night sky but reads as
       nothing at all on a hero someone looks at for ten. 9 * 0.16 is
       ~1.4/sec, so there is almost always one crossing and often two
       or three at once, without becoming a rain of them. */
    METEOR_COUNT:    5,
    METEOR_CHANCE:   0.14,     // spawn probability per second per slot

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
    /* WebGL2 is required for the HDR pipeline (float render targets,
       multiple render passes). Without it, fall back to the previous
       WebGL1 particle renderer rather than leaving the hero empty.

       The flag matters more than it used to. The name has no fill and
       no stroke — the stars ARE the letterforms — so if nothing can
       render them the hero is a blank screen with no name on it. CSS
       keys off this attribute to paint the name conventionally, which
       also covers the case where even WebGL1 is unavailable and the
       legacy script can do nothing either. */
    document.documentElement.setAttribute('data-no-webgl', '');
    const fallback = document.createElement('script');
    /* Resolved against this script's own URL rather than the page's, so
       the fallback keeps loading wherever the hero page lives. */
    fallback.src = new URL('galaxy.legacy.js', SCRIPT_URL).href;
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
    uniform vec2 uParallax;
    uniform float uSkyTime;
    ${NOISE}

    // Jittered grid: evenly spread without the clumping of pure random.
    /* The cull has climbed 0.30 -> 0.58 -> 0.72, so the painted sky now
       keeps only 28% of its grid cells. It is deliberately SPARSE,
       because it is only PART of the sky. The rest arrives when the
       galaxy bursts and its stars settle into the empty cells as
       permanent points.

       This is the half of the effect that cannot be fixed in the star
       shader. However well the arrivals are matched for size, colour
       and brightness, if the background is already a full sky then
       every one of them is a star too many: they land on top of a
       finished field and read as debris in front of it. Emptying the
       background first is what gives them somewhere to belong — the
       burst then visibly POPULATES the sky rather than decorating it,
       and the total density before and after is what a sky should be.

       Going sparser still starts to read as an overcast night before
       the burst has fired, which undersells the hero. */
    vec3 starLayer(vec2 uv, float density, float bright, float seed) {
      vec2 g = uv * density;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      vec3 h = hash33(vec3(id, seed));
      if (h.z < 0.72) return vec3(0.0);

      /* Per-star drift. Each star gets its own phase and its own pair
         of frequencies from the hash, so the field never moves as a
         sheet — which is what made the parallax read as a texture
         sliding rather than as sky. The amplitude is a fraction of a
         cell (0.10 of 0.38) so a star wanders within its own cell and
         can never cross into a neighbour's, keeping the jittered grid
         evenly spread. */
      float ph = h.x * 6.2831853;
      vec2 wob = vec2(
        sin(uSkyTime * (0.09 + h.y * 0.11) + ph),
        cos(uSkyTime * (0.07 + h.x * 0.10) + ph * 1.37)) * 0.10;

      vec2 off = h.xy * 0.38 + wob;
      float d = length(f - off);
      float mag = fract(h.z * 91.7);
      float lum = pow(mag, 3.2) * bright;

      /* Twinkle. Real scintillation is fast, shallow and uncorrelated
         between stars; a slow deep pulse reads as blinking fairy
         lights. Two incommensurate sines per star keep it irregular,
         and the depth is scaled by (1 - mag) so the faintest stars
         flicker most and the bright ones stay steady — which is how
         atmospheric seeing actually behaves. */
      float tw = sin(uSkyTime * (1.7 + h.y * 2.3) + ph)
               * sin(uSkyTime * (1.1 + h.z * 1.9) + ph * 2.1);
      lum *= 1.0 + tw * 0.28 * (1.0 - mag);

      float core = exp(-d * d * 520.0) * lum;
      float t = fract(h.x * 57.3);
      vec3 col = mix(vec3(1.0, 0.84, 0.66), vec3(0.74, 0.86, 1.0),
                     smoothstep(0.25, 0.85, t));
      return col * core;
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
    uniform float uZoom;      // 0..1, matches the star field
    uniform float uZoomPush;  // world units travelled at uZoom = 1
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

      // The dust shares the star field's camera. Leaving this pinned at
      // uCamDist while the stars flew in split the disc into two layers:
      // the points rushed past a set of lanes that never grew.
      vec3 ro = vec3(0.0, 0.0, uCamDist - uZoom * uZoomPush);
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
    layout(location = 1) in vec3 aAttr;   // radius, variation seed, alpha
    layout(location = 2) in vec4 aTint;   // rgb + size
    layout(location = 3) in float aLum;
    layout(location = 4) in vec3 aName;  // xy = NDC home in the word, z = 1 if a fill star
    uniform mat3 uRot;
    uniform float uCamDist;
    uniform float uScale;
    uniform float uAspect;
    uniform float uPointScale;
    uniform float uDrift;
    uniform float uZoom;      // 0..1, camera closes in
    uniform float uZoomPush;  // world units the camera travels at uZoom=1
    uniform float uBurst;     // 0..1, the disc flies apart
    out vec3  vColor;
    out float vAlpha;
    out float vBright;
    out float vSettled;
    void main() {
      vec3 world = aPos;

      /* ── The migration ──
         There is no explosion. The galaxy does not collapse, detonate
         or recede: each of its stars simply MOVES to a fixed place on
         the night sky and stays there, at sky size and sky brightness,
         while the disc's gas and dust fade out behind them.

         Everything that made the old version read as debris came from
         modelling this as a physical event in world space:

           · stars "settled" by being pushed 11-30 world units into
             DEPTH, so perspective shrank them to sub-pixel specks. The
             shrinking was not a styling mistake, it was the method.
             Distance is now never used to make a star look like a sky
             star — it simply stops at the right size.
           · the outward throw ran along each star's own radial
             direction while the disc's tilt was still rolling, so the
             paths swept sideways as they travelled: the "flying in a
             circle". Nothing here follows a radial direction.

         So the destination is computed directly in SCREEN space and
         the star is interpolated to it. A sky star's position is a
         point on the celestial sphere — it has no depth to fall
         through and no orbit to follow. Treating it as a 2D fact is
         both what it actually is and what removes every artefact at
         once. */
      float h  = fract(sin(dot(aPos.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float h2 = fract(sin(dot(aPos.xy, vec2(39.3468, 11.1357))) * 24634.6345);
      float h3 = fract(sin(dot(aPos.xy, vec2(73.1567, 52.8129))) * 31415.9265);

      /* ── Per-star timing ──
         The field must not arrive as one sheet on a single curve —
         that reads as a slide transition. Staggering the departure
         lets the migration ripple across the disc: some stars are
         already parked while others have not yet left.

         Sky stars and name stars are deliberately on DIFFERENT
         schedules, because the sequence has to be legible in this
         order: the galaxy empties into the sky first, and only then
         do the remaining stars gather into the word. Running both at
         once buried the writing inside the general exodus — the name
         simply resolved out of noise instead of being drawn.

         Sky stars:  leave early (0.00-0.45), all home by ~0.80.
         Name stars: leave late (0.46-0.72), arriving 0.62-0.92, so
         the word is visibly assembling against a sky that has already
         settled. Their spread is tighter too, so they read as one
         deliberate gathering rather than a second scatter. */
      bool fill = aName.z > 0.5;
      float delay = fill ? (0.46 + h3 * 0.26) : (h3 * 0.45);
      float span  = fill ? 0.94 : 0.80;
      float t = clamp((uBurst - delay) / max(0.0001, span - delay), 0.0, 1.0);
      // Ease in and out: leaves gently, arrives gently, no hard stop.
      float m = t * t * (3.0 - 2.0 * t);
      float scatter = m;   // 0..1, how far this star has joined the sky

      // ── Where the galaxy puts this star this frame ──
      vec3 gw = world + vec3(uDrift, 0.0, 0.0);
      vec3 gp = uRot * gw;
      float w = uCamDist - uZoom * uZoomPush - gp.z;
      vec2 gNdc = vec2(gp.x, gp.y) * uScale / w;
      gNdc.x /= uAspect;

      /* ── Where it ends up on the sky ──
         A fixed point in NDC, spread over the whole frame. It is keyed
         only to the star's own hashes, so it is CONSTANT: the star has
         one home from the first frame to the last and cannot drift,
         swim or be re-randomised. That is what makes it stay put.

         Deliberately uncorrelated with the star's place in the disc.
         Preserving the galaxy's layout as it expanded just looked like
         a zoom, with the spiral still legible as a ghost. Scattering
         breaks the disc up so the sky ends up evenly populated, the
         way a real star field is. */
      vec2 sNdc = vec2(h * 2.0 - 1.0, h2 * 2.0 - 1.0);
      /* Pushed out toward the edges. The galaxy's stars start bunched
         in the middle of the frame, so a uniform square leaves a
         visible thinning around the rim. */
      sNdc *= 1.02 + h3 * 0.16;

      /* ── Some stars land in the name instead ──
         aName carries a point inside the KOAIK letterforms, sampled
         from the real rasterised glyphs on the CPU. A star flagged as
         a fill star flies there rather than out to the sky, so the
         outlined word is filled by the galaxy's own material.

         The sky destination is kept as the fallback for when the mask
         could not be built (tiny viewport, tainted canvas): aName.z is
         0 there and every star simply goes to the sky, which is the
         previous behaviour rather than a broken screen. */
      vec2 dest = fill ? aName.xy : sNdc;

      /* The path. Straight in screen space — a star crossing the frame
         has no reason to curve, and every curve in the old version was
         an artefact of world-space motion under a rolling camera.

         A small perpendicular bow keeps thousands of straight paths
         from reading as a mechanical starburst. It peaks mid-flight
         and is exactly zero at both ends, so it cannot disturb either
         the departure or the arrival. */
      vec2 delta = dest - gNdc;
      vec2 perp = normalize(vec2(-delta.y, delta.x) + 1e-6);
      /* The bow is dropped almost entirely for fill stars: a curve on
         the way in is fine for the open sky, but the word has to end
         up crisp, and a star still swinging as it arrives blurs the
         edge of the letter it is supposed to define. */
      float bow = sin(m * 3.14159) * (h3 - 0.5) * (fill ? 0.02 : 0.10);
      vec2 ndc = mix(gNdc, dest, m) + perp * bow;

      gl_Position = vec4(ndc, 0.0, 1.0);

      vColor = aTint.rgb;
      // HDR: allowed to exceed 1.0 so it blooms downstream. The 0.52
      // was 0.52 at EXPOSURE 0.85; the exposure now carries the
      // dimming, so the per-star range is left alone and the faint
      // stars do not get crushed to nothing.
      vAlpha = aAttr.z * (0.14 + pow(aLum, 0.85) * 0.52);
      // Raised from 1.4 to match the higher bloom threshold: fewer
      // stars earn diffraction spikes, so the ones that do stand out
      // instead of the whole field glittering.
      vBright = smoothstep(2.2, 5.0, aLum);

      /* ── Brightness: galaxy star -> sky star ──
         No flash and no swell. Those belonged to a detonation; this is
         a migration, and a bright pulse in the middle of it would only
         draw the eye to an event that is not happening.

         The star does not fade out. It arrives at the brightness of a
         real deep-field star and stays there — permanently part of the
         background. The floor varies per star so the arrivals carry
         the same mixed magnitudes as the sky they join; one uniform
         value reads as a grid. */
      /* Fill stars stay bright. They are not joining the background —
         they ARE the word, and dimming them to deep-field magnitude
         would leave the name barely legible against the sky it sits
         on. Slight per-star variation keeps the fill alive rather
         than flat, but the floor is far higher than the sky's. */
      float skyFloor = 0.30 + fract(aAttr.y * 7.31) * 0.42;
      float fillFloor = 1.05 + fract(aAttr.y * 3.17) * 0.55;
      vAlpha *= mix(1.0, fill ? fillFloor : skyFloor, scatter);
      /* Diffraction spikes retire on the way. A sky star is a ~1.6 px
         point and far too small to carry them; keeping them made the
         arrivals look nearer than the field around them. */
      /* Sky arrivals lose their spikes; fill stars keep a little, so
         the word carries some sparkle instead of reading as a flat
         stencil of dots. */
      vBright *= fill ? (1.0 - scatter * 0.45) : (1.0 - scatter);

      /* ── Size: galaxy star -> sky star ──
         The single most important line in the migration.

         As part of the galaxy the star is sized by perspective, so it
         swells as the camera closes in — correct, and what makes the
         approach work. As part of the sky it must be a fixed ~1.6 px
         point, because that is what every other star in the deep field
         already is.

         The old code tried to reach that by pushing the star into the
         distance and then propping the result up with a max() floor.
         That is what produced the shrinking: perspective was driving
         the size down toward zero and the floor was fighting it. Both
         are gone. The size is now interpolated DIRECTLY from its
         galaxy value to its sky value on the same curve as everything
         else, so it can never overshoot, never go sub-pixel, and never
         needs rescuing.

         SKY_SIZE is a multiple of uPointScale rather than a pixel
         count because uPointScale already carries the device pixel
         ratio — a flat number renders half-size on a retina display. */
      float persp = uCamDist / w;
      float galaxySize = uPointScale * persp * aTint.a *
                         (0.62 + pow(aLum, 0.50) * 0.44);
      // Slight per-star variation, so the settled field is not uniform.
      float skySize = uPointScale * (0.92 + h2 * 0.38);
      /* A touch larger than a sky star so the letters read as solid
         at a glance, but still a point — big enough to blur the
         glyph edge and the outline stops looking sharp. */
      float fillSize = uPointScale * (1.25 + h2 * 0.35);
      gl_PointSize = mix(galaxySize, fill ? fillSize : skySize, scatter);
      vSettled = scatter;
    }
  `, `
    precision highp float;
    in vec3  vColor;
    in float vAlpha;
    in float vBright;
    in float vSettled;
    out vec4 frag;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r2 = dot(d, d);
      if (r2 > 0.25) discard;
      float disc = smoothstep(0.25, 0.0, r2);
      /* The core exponent relaxes as the star settles into the sky.

         At full size a tight core (3.2) is what makes a star look like
         a star rather than a blob. But a settled star is only ~1.7 px
         across, and at that size barely any fragment samples near the
         centre — nearly all of a 3.2-weighted core falls between the
         pixels and the star renders far dimmer than its alpha asks
         for. This was the other half of why the settled field looked
         empty. Flattening to 1.3 spreads the same energy across the
         few fragments that do get sampled. */
      float core = pow(disc, mix(3.2, 1.3, vSettled));
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

      // Static grain, to break banding without making bright points sparkle.
      float g = fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.016;
      col = max(col, vec3(0.0));

      // Premultiplied output: alpha from luminance so the page colour
      // shows through empty sky instead of the canvas painting it black.
      float a = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)) * 3.4, 0.0, 1.0);
      frag = vec4(col, a);
    }`);

  if (!skyProg || !dustProg || !starProg || !meteorProg || !upsampleProg ||
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
  /* Where this star lands in the name, in NDC, plus whether it is a
     fill star at all. Packed as vec3(x, y, isFill) so the word costs
     one attribute rather than two. Rebuilt on resize, since the
     letterforms are sized to the viewport. */
  const nameBuf = gl.createBuffer();
  const nameArr = new Float32Array(N * 3);
  setupAttr(nameBuf, 4, 3, nameArr, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);

  /* Interleave the sampler's two arrays into the attribute buffer. */
  function uploadNameTargets() {
    for (let i = 0; i < N; i++) {
      nameArr[i * 3]     = nameTargets[i * 2];
      nameArr[i * 3 + 1] = nameTargets[i * 2 + 1];
      nameArr[i * 3 + 2] = nameReady ? nameIsFill[i] : 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, nameBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, nameArr);
    nameDirty = false;
  }

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

  /* ============================================================
     NAME MASK — "KOAIK" filled with the galaxy's own stars
     ============================================================

     The word is drawn on the page as an OUTLINE with a transparent
     interior (see .name-koaik in galaxy.css). The fill comes from
     here: a share of the migrating stars are given a destination
     inside the letterforms instead of out on the sky, so the word
     is literally filled by the galaxy that just came apart.

     The interior points are found by rasterising the text once to a
     2D canvas and keeping pixels that are actually inside a glyph.
     Sampling the real rasteriser rather than hand-placing points
     means the fill follows the font exactly — including the counters
     of O and A, which must stay empty — and keeps working if the
     font, weight or wording changes.

     Everything is in NDC so it can be handed straight to the vertex
     shader, which does its arrival in screen space. */
  const fract = x => x - Math.floor(x);
  const nameTargets = new Float32Array(N * 2);  // NDC xy per star
  const nameIsFill  = new Float32Array(N);      // 1 = lands in a glyph
  let nameReady = false;

  /* Which fraction of the field fills the word. The rest go to the
     sky. Too high and the sky ends up empty, which defeats the whole
     migration; too low and the letters read as speckled rather than
     solid.

     Raised 0.34 -> 0.46 when the outline was removed. With a stroke
     around it the fill only had to SUGGEST the letterform — the line
     carried the shape. Now the stars are the only thing defining the
     glyphs, so a speckled fill just reads as a smudge; the word needs
     enough density to hold its own edges. The string also nearly
     doubled in length (KOAIK -> ALI KOAIK), so the same share would
     have spread thinner over more glyph area. */
  const NAME_FILL_SHARE = 0.46;

  /* Mirrors .gname-full in galaxy.css. If these drift apart the
     stars fill a word that is not where the CSS box is measured, so
     both are derived from the same numbers: font size as a fraction
     of the smaller viewport axis, and the baseline offsets below. */
  /* The WHOLE name is written by the stars — both words, one string,
     one size. "ALI" used to be a small CSS-only lead-in above it; a
     name split across two weights and two sizes reads as a label and
     a headline rather than one signature, so it is now a single line
     that the burst writes in full.

     The gap between the words is a space in this string: it measures
     and lays out like any other glyph, which keeps the two words on
     the same baseline and the same tracking automatically. */
  const NAME_TEXT = 'ALI KOAIK';
  /* Orbitron: geometric, wide, and built on circles — the letterforms
     echo the disc the stars arrive from, where Space Grotesk (still
     the UI font everywhere else) reads as a product heading. 800 over
     700 because the counters must stay open enough to hold stars once
     the glyphs are this wide. */
  const NAME_FONT = '800 {SIZE}px "Orbitron", "Space Grotesk", system-ui, sans-serif';
  /* 11vmin, not 17: the string went from 5 glyphs to 9, and Orbitron
     is a markedly wider face than Space Grotesk. At 17vmin the name
     overflowed a laptop viewport entirely. Mirrored by the CSS clamp
     mid on .gname-full. */
  const NAME_SIZE_VMIN = 0.11;
  const NAME_LETTER_SPACING = 0.08; // em, matches CSS letter-spacing
  /* Vertical centre of the name as a fraction of viewport height.
     Now that it is a single line rather than a stacked pair, it sits
     closer to the optical middle. */
  const NAME_CENTER_Y = 0.52;

  function buildNameTargets() {
    if (vw === 0 || vh === 0) return;
    const cssW = vw / dpr, cssH = vh / dpr;
    const px = Math.round(Math.min(cssW, cssH) * NAME_SIZE_VMIN);
    if (px < 8) { nameReady = false; return; }

    const c = document.createElement('canvas');
    c.width = vw; c.height = vh;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) { nameReady = false; return; }

    g.clearRect(0, 0, vw, vh);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = NAME_FONT.replace('{SIZE}', String(px * dpr));

    /* Letter spacing is applied by hand: canvas letterSpacing is not
       supported everywhere, and the CSS outline uses it, so the two
       would disagree on total width exactly where it matters most. */
    const track = px * dpr * NAME_LETTER_SPACING;
    const chars = NAME_TEXT.split('');
    let total = 0;
    const widths = chars.map(ch => {
      const w = g.measureText(ch).width;
      total += w + track;
      return w;
    });
    total -= track;   // no trailing gap

    let x = (vw - total) / 2;
    const y = vh * NAME_CENTER_Y;
    for (let i = 0; i < chars.length; i++) {
      g.fillText(chars[i], x, y);
      x += widths[i] + track;
    }

    /* Read back and collect interior pixels. Alpha is thresholded
       high so antialiased edge pixels are not counted — a star
       sitting half outside the glyph is what makes a filled word look
       furry instead of crisp. */
    let data;
    try {
      data = g.getImageData(0, 0, vw, vh).data;
    } catch (e) {
      nameReady = false; return;    // tainted canvas; fall back to sky
    }

    /* Step the scan rather than testing every pixel: at 26k stars a
       full-resolution list is far more candidates than needed, and the
       stride keeps the cost flat as resolution rises. */
    const want = Math.max(1, Math.floor(N * NAME_FILL_SHARE));
    const pts = [];
    const stride = Math.max(1, Math.floor(Math.sqrt((vw * vh) / (want * 6))));
    for (let py = 0; py < vh; py += stride) {
      for (let pxx = 0; pxx < vw; pxx += stride) {
        if (data[(py * vw + pxx) * 4 + 3] > 200) pts.push(pxx, py);
      }
    }
    if (pts.length < 8) { nameReady = false; return; }

    const count = pts.length / 2;
    /* Assign by star index so the choice is stable across rebuilds —
       a star that fills the K must not become a sky star on resize. */
    for (let i = 0; i < N; i++) {
      const pick = fract(Math.sin(i * 12.9898) * 43758.5453) < NAME_FILL_SHARE;
      nameIsFill[i] = pick ? 1 : 0;
      if (!pick) continue;
      const j = (Math.floor(fract(Math.sin(i * 78.233) * 24634.6345) * count)) % count;
      /* Jitter within the sampling cell, so the fill is not a visible
         lattice at the stride's spacing. */
      const jx = (fract(Math.sin(i * 39.346) * 31415.9265) - 0.5) * stride;
      const jy = (fract(Math.sin(i * 11.135) * 27182.8182) - 0.5) * stride;
      const sx = pts[j * 2] + jx, sy = pts[j * 2 + 1] + jy;
      nameTargets[i * 2]     = (sx / vw) * 2 - 1;
      nameTargets[i * 2 + 1] = 1 - (sy / vh) * 2;   // GL y is up
    }
    /* The centroid of the sampled glyph pixels, in CSS px. This is
       the ground truth the CSS outline has to line up with. */
    let sumY = 0;
    for (let k = 1; k < pts.length; k += 2) sumY += pts[k];
    starMidY = (sumY / count) / dpr;

    nameReady = true;
    nameDirty = true;
    alignNameToStars();
  }

  /* Where the sampled glyphs actually sit, in CSS px from the top. */
  let starMidY = 0;

  /* ── Align the CSS outline to the sampled glyphs ──
     The sampler draws with a `middle` baseline, which centres the
     CAPITALS. The CSS box, centred with translateY(-50%), centres the
     font's full em box instead — ascent and descent included — which
     sits noticeably lower. Measured at 1280x717 the gap was 26px,
     easily enough to see the outline floating below its own fill.

     Rather than derive the correction from font metrics (which means
     assuming how a family distributes its em box, and breaks on the
     fallback face), this MEASURES the rendered element and shifts it
     by whatever it is actually out by. It is self-correcting: it ends
     up right for whatever font loaded, at whatever size, on whatever
     platform, because it compares the two things that must match
     rather than modelling them. */
  function alignNameToStars() {
    const el = document.querySelector('.gname-full');
    if (!el || !nameReady || !starMidY) return;
    const root = document.documentElement;
    // Measure with the current shift applied, then correct the residual.
    const prev = parseFloat(
      getComputedStyle(root).getPropertyValue('--cap-shift')) || 0;
    const r = el.getBoundingClientRect();
    if (!r.height) return;
    const cssMid = r.top + r.height / 2;
    const shift = prev + (starMidY - cssMid);
    root.style.setProperty('--cap-shift', shift.toFixed(2) + 'px');
  }


  let nameDirty = true;

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
    // The RESTING tilt on purpose, not currentTilt(): this sizes the
    // galaxy to the frame once. Tracking the live roll here would
    // rescale the disc every frame as it tipped, cancelling out the
    // foreshortening that makes the roll visible at all.
    const vertical = Math.max(Math.cos(config.TILT), 0.25);
    scale = Math.min(FILL * CAM_DIST / (config.DISC_RADIUS * vertical),
                     FILL * CAM_DIST * aspect / config.DISC_RADIUS);
    pointScale = config.POINT_SIZE * dpr * Math.min(1.5, Math.max(0.7, h / 900));
    lastPublishedDrift = NaN;            // the projection moved

    if (w === vw && h === vh) return false;
    vw = w; vh = h;
    canvas.width = w; canvas.height = h;
    buildTargets(w, h);
    // The letterforms are sized to the viewport, so their interior
    // points have to be resampled whenever it changes.
    buildNameTargets();
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
  let zoomT = 0;
  // The burst runs on its own clock once fired, not on scroll.
  let burstFired = false, burstClock = 0;
  // Smoothed values the renderer actually uses, so a flick of the wheel
  // glides instead of snapping.
  let zoom = 0, burst = 0;
  let lastPublishedDrift = NaN, lastPublishedGlow = NaN;
  let lastPublishedZoom = NaN;
  let lastPublishedBurst = NaN, lastPublishedName = NaN;
  let lastPublishedKoaik = NaN;
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

       0 .. 1 vh      hero: the galaxy holds
       0.25 .. 2.6 vh the approach: the camera flies straight in along
                      the view axis while the disc rolls from 19 deg to
                      37 deg, opening from the bottom edge so the
                      galaxy is seen from the side rather than face-on.
                      It ends ~2.07x oversize with the stars reading as
                      discs rather than points.
       2.6 vh         BURST FIRES — a timed event, not scroll-driven.
                      The disc collapses to a knot, lets go, and the
                      stars recede into the background sky: each keeps
                      drifting the way it was already going while
                      falling away from the camera, sorted into the
                      same three depth tiers the sky itself is drawn
                      in, until perspective has shrunk them to ~0.15x
                      size at 0.22 alpha and they read as deep field.
                      The camera eases back to a third of its push over
                      the same beat, so the view opens out as the
                      galaxy dissolves rather than staying pressed
                      against an empty frame. Nothing moves to a
                      destination — the motion never arrives, it just
                      recedes past the point of being distinguishable.

     The scroll-driven stages must line up with the section heights in
     galaxy.css, or a stage finishes while its screen is still on view
     and the scene sits frozen for a full screen of scrolling. The
     approach needs #intro at 180vh for BURST_TRIGGER to land inside it.

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

    targetDrift = (1 - Math.pow(1 - scrollProgress, 2)) * config.SCROLL_DRIFT;
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', readScroll, { passive: true });
  readScroll();

  /* ── Cursor wake, as a swept segment ── */
  let wakeAx = 0, wakeAy = 0, wakeBx = 0, wakeBy = 0;
  let wakeDirX = 0, wakeDirY = 0, wakeEnergy = 0;
  const _a = [0, 0], _b = [0, 0];

  /* Screen point -> disc plane. This has to mirror the vertex shader's
     projection exactly, including the camera push and the live tilt —
     using the resting values here sent the cursor wake to where the
     galaxy used to be once the approach had started. */
  function unprojectToDisc(px, py, out) {
    const w = CAM_DIST - effectiveZoom() * config.ZOOM_PUSH;
    out[0] = px * aspect * w / scale - driftX;
    out[1] = (py * w / scale) / (Math.cos(currentTilt()) || 1e-3);
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
    /* ── Frozen once the collapse starts ──
       The burst is not a force applied to a living simulation; it is a
       transformation of a FIXED set of positions, computed entirely in
       the vertex shader from aPos. Letting the spiral keep running
       underneath it was why the settled sky would not hold:

         · stars kept falling inward, so any one of them eventually hit
           CORE_RADIUS (or ran out of life) and spawnStar() teleported
           it back to the rim. Its scattered position is derived from
           aPos, so a star that had already settled into the deep field
           silently vanished from where it was and reappeared somewhere
           else — the sky churned instead of holding.
         · the per-star hashes h/h2 are also derived from aPos, so a
           recycled star drew a new depth tier and a new sky floor on
           the frame it respawned: a visible twinkle-and-jump.

       Freezing at BURST_FREEZE (just before the collapse bites) hands
       the shader a stable field to work from, so every star has one
       origin and one destination for the whole sequence. The wake and
       the pattern rotation stop mattering at this point anyway: the
       disc is being crushed into a knot within a few tenths of a
       second. Position data is already in posArr from the last live
       frame, so there is nothing to recompute — we simply leave the
       buffers alone.

       Reversal is handled for free: scrolling back up drives burst
       below the threshold and the simulation picks up exactly where it
       was parked, with no discontinuity. */
    if (burst >= config.BURST_FREEZE) return;

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

      // Stars keep a fixed luminosity throughout their path. The old
      // lifecycle fade and core flare made the field read as flickering.
      const alpha = 1;

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

  /* The viewing tilt for this frame.

     Derived from the already-smoothed `zoom` rather than smoothed
     separately, so the roll and the push are guaranteed to stay in
     lockstep — two independently smoothed values drift apart under a
     fast scroll and the disc appears to swing on its own. */
  function currentTilt() {
    return config.TILT + effectiveZoom() * config.TILT_ROLL;
  }

  /* The camera push actually in force this frame.

     The scroll drives `zoom` to 1 by the time the burst fires, but
     holding it there through the burst is wrong on both counts. It is
     wrong visually — the galaxy is dissolving, and a camera still
     pressed against it has nothing left to look at. And it is wrong
     geometrically: the release throws the rim out to ~1.4 radius, and
     at a 37 deg roll that radius lands in DEPTH, so the nearest stars
     crowd the camera plane (w = 0.67 at the tightest) and perspective
     swells them 4.5x for a few frames — a smear of fat blobs exactly
     where the effect wants small receding points.

     Easing the push back to a third over the release solves both: the
     view opens out as the debris spreads, and the depth budget that
     the roll is eating gets handed back. Kept on the same `burst`
     clock as everything else, so it cannot drift out of step. */
  function effectiveZoom() {
    return zoom * (1 - smooth01(Math.max(0, (burst - 0.30) / 0.45)) * 0.67);
  }

  function rotMatrix() {
    // Tilt only — no spin. The disc orientation is otherwise FIXED:
    // real galaxies rotate differentially, which shears the arms apart
    // (+438 deg of winding in two minutes, measured). The stars carry
    // the rotation instead.
    //
    // The tilt angle itself does change over the approach: the disc
    // rolls from near face-on toward edge-on as the camera closes in.
    const t = currentTilt();
    const c = Math.cos(t), s = Math.sin(t);
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
    /* Sky parallax = pointer lean + a slow autonomous drift.
       The lean was 0.012, which is below the threshold where the eye
       reads the layers as separated depths; 0.030 is still a shift of
       a few pixels at the near layer, so the sky reacts without
       sliding around under the galaxy.

       The drift term keeps the field alive when the pointer is
       still — two incommensurate periods (23s / 31s) so the motion
       never visibly repeats. It is a third of the lean's amplitude:
       enough to float, not enough to notice as movement. */
    gl.uniform2f(skyProg.u.uParallax,
      leanX * 0.030 + Math.sin(time * 0.2731) * 0.010,
      leanY * 0.030 + Math.cos(time * 0.2026) * 0.010);
    gl.uniform1f(skyProg.u.uSkyTime, time);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── Dust at half resolution, into its own buffer ──
    // Skipped once the burst has dissolved it: this is the most
    // expensive pass in the frame and adds nothing after that point.
    const dustVisible = burst * config.DUST_FADE < 1.0;
    gl.disable(gl.BLEND);
    bindTarget(dustRT);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (dustVisible) {
    gl.useProgram(dustProg.p);
    gl.uniform2f(dustProg.u.uRes, dustRT.w, dustRT.h);
    gl.uniform1f(dustProg.u.uTime, time);
    gl.uniform1f(dustProg.u.uScale, scale);
    gl.uniform1f(dustProg.u.uCamDist, CAM_DIST);
    gl.uniform1f(dustProg.u.uZoom, effectiveZoom());
    gl.uniform1f(dustProg.u.uZoomPush, config.ZOOM_PUSH);
    gl.uniform1f(dustProg.u.uTilt, currentTilt());
    gl.uniform1f(dustProg.u.uDrift, driftX);
    gl.uniform1f(dustProg.u.uPattern, patternAngle);
    // The dust cannot fly apart like the particles, so it dissolves as
    // the burst takes over; leaving it up would anchor the old disc in
    // place while the stars scattered around it.
    gl.uniform1f(dustProg.u.uDensity,
                 config.DUST_DENSITY * Math.max(0, 1 - burst * config.DUST_FADE));
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
    if (nameDirty) uploadNameTargets();
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
    gl.uniform1f(starProg.u.uDrift, driftX);
    gl.uniform1f(starProg.u.uZoom, effectiveZoom());
    gl.uniform1f(starProg.u.uZoomPush, config.ZOOM_PUSH);
    gl.uniform1f(starProg.u.uBurst, burst);
    gl.drawArrays(gl.POINTS, 0, N);

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
    /* The corona is a CSS circle of fixed size, but the rendered
       nucleus grows with the approach — without this the glow detached
       and sat as a small blob inside a much larger core. Quantised so
       it only writes on real change. */
    // effectiveZoom(), not zoom: the corona tracks the rendered
    // nucleus, so it has to shrink with the camera when the burst
    // pulls back. Publishing raw `zoom` left a large glow hanging
    // over a galaxy that had already receded.
    const zq = Math.round(effectiveZoom() * 50) / 50;
    if (zq !== lastPublishedZoom) {
      lastPublishedZoom = zq;
      document.documentElement.style.setProperty('--zoom', zq.toFixed(2));
    }

    const gq = Math.round(coreGlow * 50) / 50;
    if (gq !== lastPublishedGlow) {
      lastPublishedGlow = gq;
      document.documentElement.style.setProperty('--core-glow', gq.toFixed(2));
    }

    /* The corona has to go out with the galaxy. It is a CSS glow with
       no knowledge of the burst, so without this it stays lit over an
       empty sky — a bright halo around nothing. */
    /* ── The name arrives in two beats ──
       Both words are now written by the stars as one string, so the
       two tokens no longer mean "Ali" and "Koaik". They mean:

       1. --name-ali (0.62 -> 0.88). The OUTLINE of the full name,
          fading in once the field has largely parked, so the stroke
          settles around the letters the stars have drawn rather than
          presenting itself as the title they land inside.
       2. --name-koaik (0.86 -> 1.00). The portfolio rows beneath it —
          role, status, links. They come last: the identity resolves
          first, then the framing that makes it a portfolio.

       The token NAMES are kept as-is because they are written from
       here and read in galaxy.css, and renaming them buys nothing but
       a chance to miss one. */
    const aliT = smooth01(Math.max(0, (burst - 0.62) / 0.26));
    const aq = Math.round(aliT * 50) / 50;
    if (aq !== lastPublishedName) {
      lastPublishedName = aq;
      document.documentElement.style.setProperty('--name-ali', aq.toFixed(2));
    }

    const koaikT = smooth01(Math.max(0, (burst - 0.86) / 0.14));
    const kq = Math.round(koaikT * 50) / 50;
    if (kq !== lastPublishedKoaik) {
      lastPublishedKoaik = kq;
      document.documentElement.style.setProperty('--name-koaik', kq.toFixed(2));
    }

    const bq = Math.round(burst * 50) / 50;
    if (bq !== lastPublishedBurst) {
      lastPublishedBurst = bq;
      document.documentElement.style.setProperty('--burst', bq.toFixed(2));
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

  /* The mask is rasterised with Space Grotesk, but web fonts load
     asynchronously: if the first build runs before the font arrives,
     the sampler measures a fallback and the star fill ends up in the
     shape of the WRONG typeface while the CSS outline uses the right
     one. Rebuilding once the font is ready realigns them.

     Guarded because document.fonts is absent on older browsers, where
     the fallback rasterisation is still a usable word. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      buildNameTargets();
      alignNameToStars();
      wake();
    }).catch(() => {});
  }

  /* ============================================================
     THE QUOTE — short lines from Interstellar, in rotation
     ============================================================
     Fades one line out, swaps the text while it is invisible, then
     fades the next in. The swap happens at zero opacity so the reader
     never sees the text change; the CSS reserves two lines of height
     so the ship below does not move as the lines change length.

     Kept to brief, widely-quoted fragments rather than long passages
     of the screenplay.

     The rotation is paused while the tab is hidden — an interval left
     running in a background tab burns wakeups and, worse, would
     advance through several lines unseen. */
  const quoteEl = document.getElementById('gnameQuote');
  if (quoteEl) {
    const textEl = quoteEl.querySelector('.gname-quote-text');
    /* Lines only — no per-line attribution. Repeating the same source
       under every quote added a word of noise to each rotation and
       told the reader nothing new after the first one. */
    const QUOTES = [
      'Do not go gentle into that good night.',
      'We used to look up and wonder at our place in the stars.',
      'Mankind was born on Earth. It was never meant to die here.',
      "Love isn't something we invented.",
      'Love is the one thing that transcends time and space.',
      'We will find a way. We always have.',
    ];

    const HOLD = 5200;   // how long a line stays up
    const FADE = 900;    // must match the CSS transition
    let qi = 0, timer = 0;

    function showQuote(i) {
      textEl.textContent = QUOTES[i];
      quoteEl.classList.add('is-visible');
    }

    function cycle() {
      quoteEl.classList.remove('is-visible');       // fade out
      timer = setTimeout(() => {
        qi = (qi + 1) % QUOTES.length;
        showQuote(qi);                              // swap + fade in
        timer = setTimeout(cycle, HOLD);
      }, FADE);
    }

    function startQuotes() {
      clearTimeout(timer);
      timer = setTimeout(cycle, HOLD);
    }

    showQuote(0);
    if (!reduceMotion) {
      startQuotes();
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearTimeout(timer);
        else startQuotes();
      });
    }
  }

  /* ============================================================
     LAUNCH — "press here to start the trip"
     ============================================================
     The CTA flies the page to just past BURST_TRIGGER, which is what
     detonates the galaxy. Native smooth scrolling is not used: its
     duration is fixed by the browser and is far too brisk over the
     ~2.6 viewport heights involved, so the approach flicks past
     instead of reading as a journey. This eases it by hand over a
     duration proportional to the distance left.

     It also cooperates with a reader who takes over: any wheel,
     touch or key input cancels the flight mid-way rather than
     fighting the user for the scroll position. */
  const launchBtn = document.getElementById('launchBtn');
  if (launchBtn) {
    let flying = false;

    const cancelFlight = () => { flying = false; };

    launchBtn.addEventListener('click', () => {
      if (flying) return;
      const h = window.innerHeight || 1;
      // A little past the trigger, so the burst is certain to fire.
      const target = (config.BURST_TRIGGER + 0.06) * h;
      const from = window.scrollY;
      const dist = target - from;
      if (dist <= 0) return;

      /* ~950ms per viewport height travelled, clamped so a short hop
         is not sluggish and a long one does not overstay. */
      const dur = Math.max(1200, Math.min(3200, (dist / h) * 950));
      const t0 = performance.now();
      flying = true;

      /* easeInOutCubic: the ship accelerates away from rest and
         settles at the far end, which is the shape of a launch. */
      const ease = t => t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const step = now => {
        if (!flying) return;
        const p = Math.min(1, (now - t0) / dur);
        window.scrollTo(0, from + dist * ease(p));
        if (p < 1) requestAnimationFrame(step);
        else flying = false;
      };
      requestAnimationFrame(step);
    });

    /* passive: these only ever cancel; they never block the gesture. */
    ['wheel', 'touchstart', 'keydown'].forEach(evt =>
      window.addEventListener(evt, cancelFlight, { passive: true }));
  }

  paintOnce();
  wake();
})();
