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
  /* system.html: this script is only the SKY behind the system there —
     see the SKY ONLY block at the end. */
  const SKY_ONLY = document.documentElement.hasAttribute('data-sky');

  const config = {
    // simulate() is O(n) on the CPU and measured 13.65ms at 46k, which
    // alone blew the 16.7ms frame budget (49fps). 26k brought the whole
    // frame under budget; the volumetric dust carries the density that
    // the extra particles used to provide. Lowered again to 15.5k when
    // POINT_SIZE went up: overlap scales as count x size^2, so bigger
    // sprites at the old count washed the bulge to white.
    STAR_COUNT:      15500,
    /* The FIELD: a second, much larger population that never touches
       the CPU. It is placed once with the same distributions as the
       live stars and turned rigidly in the vertex shader, so it costs
       nothing against the frame budget that caps the live count. It
       is what makes the arms read as bands rather than strings, gives
       the bulge a smooth glow of thousands of faint points, and turns
       the dust lanes into visible gaps. It does not migrate in the
       burst — it dissolves as the bright stars leave, so the sky is
       not flooded with sixty thousand extra arrivals. */
    FIELD_COUNT:     48000,    // scaled down with STAR_COUNT (was 80k)
    FIELD_SIZE:      0.85,     // sprite size relative to a live star
    FIELD_LUM:       0.38,     // luminosity relative to a live star
    /* Secondary arms midway between the two primaries: fainter,
       tighter, mostly older stars — the feathered multi-arm look of
       an M101 rather than a clean two-arm grand design. */
    SECONDARY_FRACTION: 0.22,  // share of arm stars on a secondary ridge

    /* ── Spiral structure ── */
    ARMS:            2,
    ARM_TIGHTNESS:   3.10,     // ~18 degree pitch angle
    ARM_SPREAD:      0.40,     // widened: the arms read as bands, not strings
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
    /* 0.90, down from 2.60 then 1.40: the first scroll should pay
       off within one screen, not after two and a half. */
    BURST_TRIGGER:   0.90,     // in viewport heights
    /* A migration, not an explosion: the stars should be seen
       travelling, and the per-star stagger (up to 45% of the burst)
       needs room to read as a ripple across the disc rather than as
       one sheet sliding over. 2.8 s keeps that; the earlier 4.2 s was
       a wait. */
    BURST_DURATION:  2.8,      // seconds, first star leaves to last arrives
    /* The reverse is SCROLL-driven, unlike the burst itself. Playing
       it on a timer (1.1s, then 2.4s) always felt laggy: nothing
       happened for the first quarter-viewport of scrolling up, then
       the stars flew home on their own schedule while the reader had
       already moved on. Now `burst` follows the scroll position back
       down over BURST_REWIND_SPAN viewport heights above the trigger,
       eased just enough to hide wheel steps, so the galaxy reassembles
       in step with the finger and holds wherever it is left. */
    BURST_REWIND_SPAN: 0.60,   // viewport heights of scroll to fully reassemble
    BURST_REWIND_EASE: 9.0,    // per-second tracking rate (~0.11s behind the finger)
    /* Nearly no dead band. Re-firing resumes the clock from the
       current value, so toggling on the threshold is invisible; the
       band only has to swallow sub-pixel scroll jitter. */
    BURST_HYSTERESIS: 0.02,
    /* ── The release ──
       Pressing the button lets go of the name: the fill stars slide
       from their letterforms out to ordinary sky homes, so the word
       dissolves into the field the trip flies through. It is the
       take-off — TIMED from the press over RELEASE_TIME seconds, not
       scrolled (the page is sealed by then and cannot scroll), and
       the warp starts the moment it has played. Gated on the burst
       having finished: a name cannot dissolve before it is written. */
    RELEASE_TIME:    1.2,      // seconds, press to letters gone
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
    /* Raised from 0.88 with the counts cut by ~40%: fewer, bolder
       points that resolve as individual stars instead of fine dust. */
    POINT_SIZE:      1.18,
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

    /* ── Night ──
       With a project in focus in the Koaik system (system.js, through
       window.galaxySky.night) the sky steps back: out of focus and
       darker, so the model in front of it is the subject. NIGHT_BLUR
       is the defocus radius at full night, in CSS px; NIGHT_DIM is
       the light left. Both happen in the composite pass, read from
       the mips of the scene buffer — nothing per star, nothing on the
       CPU. Not black: the reader should still sense the sky. */
    NIGHT_BLUR:      5.0,
    NIGHT_DIM:       0.45,

    /* ── Volumetric dust ──
       OFF. The continuous glow layer was the one part of the picture
       that could ever be out of step with the stars, and the detail
       it provided now comes from the field population instead. The
       raymarch, the absorption compositing and the split star pass
       are all kept intact behind this flag. */
    DUST:            false,
    DUST_STEPS:      16,       // raymarch samples through the disc
    DUST_DENSITY:    0.78,
    /* The dust ABSORBS as well as glows. Optical depth accumulates
       along the ray into the dust buffer's alpha, and the scene behind
       the disc plane is multiplied by exp(-tau * DUST_TINT) before
       the emission and the near half of the stars go on top. The
       tint is per channel — blue is scattered out first — so a thick
       lane goes brown rather than grey, which is the single most
       recognisable feature of a photographed spiral. */
    DUST_ABSORB:     60.0,     // optical depth per unit dust density
    DUST_TINT:       [1.30, 1.00, 0.70],
    BULGE_GLOW:      5.0,      // smooth spheroid of old stars, in the march

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
    /* These also drive the field, through simulateField(): the same
       wake and the same spring, run on the GPU. */
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
    // No burst here: the name is simply there, so the profile below it
    // (and the button at its end) must be too.
    document.documentElement.classList.add('is-written');
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

  function program(vsSrc, fsSrc, varyings) {
    const vs = compile(gl.VERTEX_SHADER, '#version 300 es\n' + vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, '#version 300 es\n' + fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    // Must be declared before the link for a transform-feedback program.
    if (varyings) gl.transformFeedbackVaryings(p, varyings, gl.SEPARATE_ATTRIBS);
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
  let skyBaseRT = null;       // the sky's still part, painted once per size
  let skyBaseDirty = true;
  let dustRT = null;          // half-res: the raymarch is the GPU cost
  const bloomRT = [];

  function disposeTargets() {
    if (sceneRT) {
      gl.deleteTexture(sceneRT.tex); gl.deleteFramebuffer(sceneRT.fbo);
    }
    if (skyBaseRT) {
      gl.deleteTexture(skyBaseRT.tex); gl.deleteFramebuffer(skyBaseRT.fbo);
      skyBaseRT = null;
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
    skyBaseRT = makeTarget(w, h);
    skyBaseDirty = true;
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
    }
    float fbm2(vec3 p) { return 0.5 * noise3(p) + 0.25 * noise3(p * 2.03); }`;

  // Shared so the dust and the particles agree on where the arms are.
  const SPIRAL = `
    uniform float uArms;
    uniform float uTightness;
    uniform float uArmStart;
    uniform float uArmFloor;
    float armRidge(float r) {
      float x = max(r, uArmFloor);
      // The wobble is what keeps the arms from reading as two perfect
      // logarithmic curves. Mirrored exactly in the JS armRidge.
      return log(x / uArmStart + 0.30) * uTightness
           + 0.09 * sin(x * 11.3) + 0.05 * sin(x * 23.7 + 1.7);
    }
    float armDist(float r, float theta) {
      float gap = 6.28318530718 / uArms;
      float d = mod(theta - armRidge(r), gap);
      if (d > gap * 0.5) d -= gap;
      return d;
    }`;

  /* ── Sky: deep field, nebulae, distant galaxies ──
     Two programs. The nebular wash and the far galaxies depend on
     nothing but the pixel, yet they were most of the frame (two fbm =
     64 hashes, seven atan/exp per pixel, every frame — measured ~60%
     of the GPU time of the whole galaxy on an M2). skyBaseProg paints
     them ONCE per canvas size into skyBaseRT; skyProg, per frame, reads
     that texel and adds only what moves: the three star layers. */
  const skyBaseProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform vec2 uRes;
    ${NOISE}

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

  const skyProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform vec2 uRes;
    uniform vec2 uParallax;
    uniform float uSkyTime;
    uniform sampler2D uBase;   // skyBaseRT, same size as the target
    vec3 hash33(vec3 p) {
      p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
               dot(p, vec3(269.5, 183.3, 246.1)),
               dot(p, vec3(113.5, 271.9, 124.6)));
      return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
    }

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

    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
      // The wash and the far galaxies, painted once (skyBaseProg).
      vec3 col = texelFetch(uBase, ivec2(gl_FragCoord.xy), 0).rgb;

      // Depth layers: nearer layers parallax further.
      col += starLayer(p + uParallax * 0.30, 20.0, 1.00, 1.0);
      col += starLayer(p + uParallax * 0.62, 42.0, 0.60, 2.0);
      col += starLayer(p + uParallax * 1.00, 86.0, 0.32, 3.0);

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

    uniform float uArmSpread;
    uniform float uArmBias;
    uniform float uDustOffset;
    uniform float uDustWidth;
    uniform float uBulgeRadius;
    uniform float uBulgeGlow;
    uniform float uAbsorb;

    /* Two fields share one march. GAS is what glows: the young stars
       and ionised hydrogen strung along the arms, plus the smooth old
       disc between them. DUST is what absorbs: a cold lane on the
       concave edge of each arm, broken into threads, over a thin
       diffuse layer. They are kept apart because in a photograph
       they sit in different places — the dark lane runs just INSIDE
       the bright arm, not on top of it. The lane geometry mirrors
       the particle spawner's, so the stars avoid the same gap. */
    void discSample(vec3 q, out float gas, out float dust, out vec3 col) {
      gas = 0.0; dust = 0.0; col = vec3(0.0);
      float r = length(q.xy);
      if (r > 1.15) return;
      float th = atan(q.y, q.x);
      float d = armDist(r, th);
      float zGas  = exp(-abs(q.z) * 22.0);
      float zDust = exp(-abs(q.z) * 30.0);           // the thinnest layer
      float radial = exp(-r * 1.15) * smoothstep(0.02, 0.15, r);

      vec3 np = vec3(q.xy * 3.1, q.z * 5.0 + uTime * 0.012);
      float turb  = fbm(np) * 0.5 + 0.5;
      /* Cost note: this runs 16 times per half-res pixel and is the
         heaviest thing in the frame. turb is the only full fbm; the
         lane threads need two octaves, and the two fine fields are
         single high-frequency octaves — their lower octaves only
         duplicated what turb already carries. */
      float turb2 = fbm2(np * 2.7 + 11.3) * 0.5 + 0.5;
      float fine  = noise3(np * 9.0 + 3.7) * 0.5 + 0.5;   // clusters
      float fine2 = noise3(np * 13.0 + 7.1) * 0.5 + 0.5;  // grain within them

      /* Gas rides the CONVEX side of the ridge, where the spawner puts
         the stars; the lane sits on the concave side. The profile is
         sharp toward the lane and feathered away from it, so the lane
         has clear space to be dark in instead of glow piled on it. */
      float w  = uArmSpread * (0.50 + r * 1.00);
      float dg = d - uArmBias * w;
      float arm = exp(-pow(dg / (dg < 0.0 ? w * 0.45 : w * 0.95), 2.0));
      // HII knots: the brightest, pinkest clumps, only on the arms.
      // Single-octave noise blobs are larger and smoother than fbm's, so
      // the thresholds sit high: knots are the rare bright tips, not a
      // pink wash over half the arm.
      float knot = smoothstep(0.64, 0.82, fine) * smoothstep(0.60, 0.80, fine2) * arm;
      // Contrast in the clumping is what survives the march: a gentle
      // multiplier averages out over 16 samples into a smooth ribbon.
      float clump = mix(0.12, 1.70, smoothstep(0.28, 0.80, fine));
      float grain = mix(0.45, 1.25, smoothstep(0.30, 0.75, fine2));
      gas = radial * zGas * (0.20 + arm * 1.60)
          * (0.30 + turb * 0.90) * clump * grain
          * (1.0 + knot * 3.0);

      float lc = -(uArmBias + uDustOffset) * w;
      float lw = max(uDustWidth * w, 0.02);
      float lane = exp(-pow((d - lc) / lw, 2.0));
      float threads = smoothstep(0.30, 0.75, turb2);
      float diffuse = 0.05 + 0.08 * smoothstep(0.45, 0.80, turb);
      dust = radial * zDust * (lane * (0.70 + threads * 1.30) + diffuse)
           * smoothstep(0.06, 0.20, r);               // none over the nucleus

      // Colour: warm old disc, blue-white along the arms, pink knots
      // where the gas is ionised, everything reddening toward the core.
      col = mix(vec3(0.96, 0.88, 0.74), vec3(0.55, 0.70, 1.00), arm * 0.90);
      col = mix(col, vec3(1.00, 0.36, 0.56), knot);
      col = mix(col, vec3(1.00, 0.84, 0.58), smoothstep(0.32, 0.06, r));
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

      // Slab containing the disc and the bulge.
      float tN = (0.30 - ro.z) / rd.z;
      float tF = (-0.30 - ro.z) / rd.z;
      if (tN > tF) { float t = tN; tN = tF; tF = t; }
      tN = max(tN, 0.0);
      if (tF <= tN) { frag = vec4(0.0); return; }

      float stepLen = (tF - tN) / float(uSteps);
      float jit = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      float t = tN + stepLen * jit;                // dither out banding

      vec3 acc = vec3(0.0);
      float trans = 1.0, tau = 0.0;
      float cs = cos(-uPattern), ss = sin(-uPattern);
      const vec3 bulgeCol = vec3(1.00, 0.88, 0.66);

      for (int i = 0; i < 48; i++) {
        if (i >= uSteps || trans < 0.02) break;
        vec3 q = ro + rd * t;
        vec3 qq = vec3(q.x * cs - q.y * ss, q.x * ss + q.y * cs, q.z);
        float gas, dust; vec3 col;
        discSample(qq, gas, dust, col);
        // Bulge: a flattened spheroid of old stars with a long,
        // Sérsic-like tail, so the core is a gradient and not a dot.
        float rb = length(vec3(qq.xy, qq.z * 2.2)) / uBulgeRadius;
        float bulge = exp(-pow(rb, 0.90) * 3.0) * uBulgeGlow * uDensity;
        acc += (col * gas * 11.0 + bulgeCol * bulge) * stepLen * trans;
        float a = dust * stepLen * uAbsorb;
        trans *= exp(-a);
        tau += a;
        t += stepLen;
      }
      frag = vec4(acc, tau);
    }`);

  /* ── Star particles ── */
  const starProg = program(`
    precision highp float;
    layout(location = 0) in vec3 aPos;
    layout(location = 1) in vec3 aAttr;   // radius, variation seed, alpha
    layout(location = 2) in vec4 aTint;   // rgb + size
    layout(location = 3) in float aLum;
    layout(location = 4) in vec3 aName;  // xy = NDC home in the word, z = 1 if a fill star
    layout(location = 5) in float aKind; // 0 star, 1 nebula, 2 giant
    layout(location = 6) in vec3 aOff;   // field only: offset from home, from simulateField
    uniform mat3 uRot;
    uniform float uCamDist;
    uniform float uScale;
    uniform float uAspect;
    uniform float uPointScale;
    uniform float uDrift;
    uniform float uZoom;      // 0..1, camera closes in
    uniform float uZoomPush;  // world units the camera travels at uZoom=1
    uniform float uBurst;     // 0..1, the disc flies apart
    uniform float uRelease;   // 0..1, the written name lets go into the sky
    uniform float uNameShift; // NDC y: the name scrolls up with the page (profile below it)
    uniform float uHalf;      // -1 behind the disc plane, +1 in front, 0 all
    uniform float uMigrate;   // 1: live star, joins the burst; 0: field star, dissolves
    uniform float uPattern;   // rigid rotation, applied here for the field only
    out vec3  vColor;
    out float vAlpha;
    out float vBright;
    out float vSettled;
    flat out float vKind;
    void main() {
      vec3 world = aPos;
      vKind = aKind;
      /* The field is placed once in the disc frame and turned here;
         the live stars arrive already rotated by the simulation. */
      if (uMigrate < 0.5) {
        float cp = cos(uPattern), sp = sin(uPattern);
        world.xy = vec2(aPos.x * cp - aPos.y * sp, aPos.x * sp + aPos.y * cp);
        world += aOff;   // the wake and the spring, exactly as the live stars carry them
      }

      /* The dust lanes have to be able to darken what lies behind
         them, so the field is drawn in two halves around the disc
         plane with the dust composited in between. A culled point
         is parked outside the clip volume. */
      if (uHalf != 0.0 && (aPos.z >= 0.0) != (uHalf > 0.0)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        return;
      }

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
      // The field does not travel: it fades where it stands (below).
      float m = uMigrate > 0.5 ? t * t * (3.0 - 2.0 * t) : 0.0;
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
      /* The release: a fill star's home moves from its letter to the
         sky spot it would otherwise have had. Staggered per star so
         the word frays outward rather than sliding off as a sheet.
         fillW is "how much of a fill star this still is" and drives
         every fill-specific value below. */
      float rel = smoothstep(h3 * 0.5, 0.5 + h3 * 0.5, uRelease);
      float fillW = fill ? 1.0 - rel : 0.0;
      vec2 home = aName.xy + vec2(0.0, uNameShift);
      vec2 dest = fill ? mix(home, sNdc, rel) : sNdc;

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
      float bow = sin(m * 3.14159) * (h3 - 0.5) * mix(0.10, 0.02, fillW);
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
      vAlpha *= mix(1.0, mix(skyFloor, fillFloor, fillW), scatter);
      if (uMigrate < 0.5) vAlpha *= 1.0 - smoothstep(0.0, 0.55, uBurst);
      /* Diffraction spikes retire on the way. A sky star is a ~1.6 px
         point and far too small to carry them; keeping them made the
         arrivals look nearer than the field around them. */
      /* Sky arrivals lose their spikes; fill stars keep a little, so
         the word carries some sparkle instead of reading as a flat
         stencil of dots. */
      vBright *= 1.0 - scatter * mix(1.0, 0.45, fillW);

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
      gl_PointSize = mix(galaxySize, mix(skySize, fillSize, fillW), scatter);
      /* Field stars are small, so they take the flattened core that
         the settled sky uses for the same reason: a tight core on a
         ~1.5px point falls between the pixels and renders dark. */
      vSettled = uMigrate > 0.5 ? scatter : 0.7;
    }
  `, `
    precision highp float;
    in vec3  vColor;
    in float vAlpha;
    in float vBright;
    in float vSettled;
    flat in float vKind;
    out vec4 frag;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r2 = dot(d, d);
      if (r2 > 0.25) discard;
      if (vKind > 0.5 && vKind < 1.5) {
        // HII nebula: a wide soft blob. No core, no spikes — this is
        // light from gas, and it should never read as a point.
        float g = exp(-r2 * 14.0) - exp(-0.25 * 14.0);
        frag = vec4(vColor * vAlpha * g * 0.55, 1.0);
        return;
      }
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

      float spikes = 0.0, ring = 0.0;
      if (vBright > 0.02) {
        if (vKind > 1.5) {
          // Giant: three lines at 60 deg — a six-point diffraction
          // pattern — plus a faint blue ring, the way a lens flares.
          const float c60 = 0.5, s60 = 0.8660254;
          vec2 d1 = vec2(d.x * c60 - d.y * s60, d.x * s60 + d.y * c60);
          vec2 d2 = vec2(d.x * c60 + d.y * s60, -d.x * s60 + d.y * c60);
          float line = smoothstep(0.030, 0.0, abs(d.y))  * smoothstep(0.5, 0.0, abs(d.x));
          line = max(line, smoothstep(0.030, 0.0, abs(d1.y)) * smoothstep(0.5, 0.0, abs(d1.x)));
          line = max(line, smoothstep(0.030, 0.0, abs(d2.y)) * smoothstep(0.5, 0.0, abs(d2.x)));
          spikes = line * vBright * 0.65;
          ring = smoothstep(0.09, 0.14, r2) * smoothstep(0.22, 0.16, r2) * vBright;
        } else {
          vec2 ad = abs(d);
          float cr = max(smoothstep(0.030, 0.0, ad.x) * smoothstep(0.5, 0.0, ad.y),
                         smoothstep(0.030, 0.0, ad.y) * smoothstep(0.5, 0.0, ad.x));
          spikes = cr * vBright * 0.55;
        }
      }

      // Hot cores desaturate toward white, as an overexposed star does.
      vec3 col = mix(vColor, vec3(1.0), core * vBright * 0.42);
      col = mix(col, vec3(0.60, 0.74, 1.00), ring * 0.7);
      float e = vAlpha * (halo * (0.18 + vBright * 0.26)
                        + disc * 0.30 + core * 0.95 + spikes + ring * 0.12);
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

  // Multiplies the scene by the dust's transmittance. Blended with
  // (ZERO, SRC_COLOR), so the output IS the per-channel factor.
  const dustAbsorbProg = program(QUAD_VS, `
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform sampler2D uSrc;
    uniform vec3 uExt;
    void main() {
      float tau = texture(uSrc, vUv).a;
      frag = vec4(exp(-tau * uExt), 1.0);
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
    uniform vec2 uHole;       // the black hole on screen (uv), system.js
    uniform float uSwallow;   // 0..1, the sky falls into it
    uniform float uNight;     // 0..1, a project is in focus (system.js)
    uniform float uNightBlur; // the defocus radius right now, px (0 = sharp)
    uniform float uNightDim;  // the light left at full night

    /* The night: the scene read out of focus. Thirteen taps — the
       centre, a ring of six at half the radius, six more at the full
       radius turned 30° — taken from the mip whose texel is about half
       the radius, so the taps overlap and a star becomes one soft disc
       rather than thirteen copies of itself. At radius 0 it is the
       plain read, so the night eases in from nothing. */
    const vec2 HEX_A[6] = vec2[6](vec2(1.0, 0.0), vec2(0.5, 0.8660254), vec2(-0.5, 0.8660254),
                                  vec2(-1.0, 0.0), vec2(-0.5, -0.8660254), vec2(0.5, -0.8660254));
    const vec2 HEX_B[6] = vec2[6](vec2(0.8660254, 0.5), vec2(0.0, 1.0), vec2(-0.8660254, 0.5),
                                  vec2(-0.8660254, -0.5), vec2(0.0, -1.0), vec2(0.8660254, -0.5));
    vec3 sceneAt(vec2 uv) {
      if (uNightBlur <= 0.0) return texture(uScene, uv).rgb;
      float lod = log2(max(uNightBlur * 0.5, 1.0));
      vec2 px = uNightBlur / uRes;
      vec3 c = textureLod(uScene, uv, lod).rgb * 0.16;
      for (int i = 0; i < 6; i++) {
        c += textureLod(uScene, uv + HEX_A[i] * px * 0.5, lod).rgb * 0.09;
        c += textureLod(uScene, uv + HEX_B[i] * px, lod).rgb * 0.05;
      }
      return c;
    }

    /* The swallow: every pixel shows the sky from FURTHER out along its
       line from the hole, turned by a swirl that tightens near it, so
       the whole sky contracts and spirals in; inner parts go first.
       Squeezed light gets brighter (a little), and what would come
       from beyond the frame is black. At 1 nothing is left. */
    vec2 swallowUv(vec2 uv, out float gain) {
      gain = 1.0;
      if (uSwallow <= 0.0) return uv;
      float asp = uRes.x / uRes.y;
      vec2 p = (uv - uHole) * vec2(asp, 1.0);
      float r = length(p);
      float k = 1.0 - uSwallow;
      float kr = pow(k, 1.0 + 1.6 * exp(-r * 2.5));
      float rs = r / max(kr, 1e-3);
      float ang = atan(p.y, p.x) + uSwallow * uSwallow * 2.4 / (r + 0.12);
      gain = mix(1.0, 1.0 / max(kr, 0.15), 0.35);
      return uHole + vec2(cos(ang), sin(ang)) * rs / vec2(asp, 1.0);
    }

    // ACES filmic curve: keeps bright cores from clipping to flat white.
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    void main() {
      float gain;
      vec2 uv = swallowUv(vUv, gain);
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      vec3 col = sceneAt(uv);
      // Three mips: tight, medium and wide halo. Binding the last mip
      // twice (as a 4-sampler version would with 3 targets) double
      // weights it and over-brightens the widest halo.
      vec3 bloom = texture(uBloom0, uv).rgb * 1.00
                 + texture(uBloom1, uv).rgb * 0.72
                 + texture(uBloom2, uv).rgb * 0.46;
      col += bloom * uBloomStrength;
      col *= inside * gain * (1.0 - smoothstep(0.85, 1.0, uSwallow));

      col *= uExposure;
      col = aces(col);
      col *= mix(1.0, uNightDim, uNight);                    // the night: what light is left

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

  if (!skyProg || !skyBaseProg || !dustProg || !starProg || !meteorProg || !upsampleProg ||
      !dustAbsorbProg || !brightProg || !blurProg || !compositeProg) return;

  /* ============================================================
     STAR CLASSES
     Brightness is deliberately NOT tied to hue: both pools run faint
     to bright. An earlier ordering ran warm-faint to cool-bright,
     which left amber stars at 60% of the count but 25% of the light
     and rendered the field white.
     ============================================================ */
  /* Real stellar colours — blackbody hues by spectral class, O blue
     through M red. There are no green, teal or violet stars; an
     earlier palette had them and read as confetti, not a galaxy.
     Within each pool the FIRST entries are the most common (pickType
     skews toward the front), and they are the faint ones: a real
     luminosity function is dominated by dim stars, with a handful of
     giants carrying the eye. */
  const STAR_TYPES = [
    { k: 'K dwarf',     c: [1.00, 0.78, 0.56], s: 0.58, l: 0.30 },
    { k: 'M dwarf',     c: [1.00, 0.64, 0.42], s: 0.54, l: 0.24 },
    { k: 'G dwarf',     c: [1.00, 0.91, 0.78], s: 0.62, l: 0.38 },
    { k: 'K',           c: [1.00, 0.80, 0.60], s: 0.78, l: 0.72 },
    { k: 'G',           c: [1.00, 0.92, 0.80], s: 0.84, l: 0.95 },
    { k: 'F',           c: [1.00, 0.97, 0.92], s: 0.90, l: 1.20 },
    { k: 'K giant',     c: [1.00, 0.74, 0.48], s: 1.22, l: 2.60 },
    { k: 'anchor warm', c: [1.00, 0.84, 0.62], s: 1.80, l: 4.60 },
    { k: 'A dim',       c: [0.80, 0.87, 1.00], s: 0.62, l: 0.40 },
    { k: 'B dim',       c: [0.64, 0.76, 1.00], s: 0.64, l: 0.46 },
    { k: 'A',           c: [0.82, 0.89, 1.00], s: 0.88, l: 1.10 },
    { k: 'B',           c: [0.62, 0.74, 1.00], s: 1.00, l: 1.60 },
    { k: 'O',           c: [0.54, 0.66, 1.00], s: 1.28, l: 2.90 },
    { k: 'anchor cool', c: [0.70, 0.80, 1.00], s: 1.90, l: 5.20 },
  ];

  const WARM_TYPES = ['K dwarf', 'M dwarf', 'G dwarf', 'K', 'G', 'F',
                      'K giant', 'anchor warm']
    .map(k => STAR_TYPES.find(t => t.k === k));
  const COOL_TYPES = ['A dim', 'B dim', 'A', 'B', 'O', 'anchor cool']
    .map(k => STAR_TYPES.find(t => t.k === k));

  function pickType(r, inBulge, inArm, ang) {
    let coolChance;
    if (inBulge) coolChance = 0.03;          // old stars: yellow-orange
    else if (inArm) {
      // Arms skew blue, banded along their length so colour clumps.
      const band = Math.sin(ang * 2.7 + r * 9.0) * 0.5 + 0.5;
      coolChance = 0.46 + band * 0.40;
    } else coolChance = 0.16;
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
  const kindArr = new Float32Array(N);     // 0 star, 1 nebula, 2 giant
  let tintDirty = true, lumDirty = true;

  const gauss = () =>
    (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const smooth01 = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

  // Must match the SPIRAL shader chunk exactly.
  function armRidge(r, arm) {
    const x = r > config.ARM_FLOOR ? r : config.ARM_FLOOR;
    return (arm / config.ARMS) * Math.PI * 2 +
           Math.log(x / config.ARM_START + 0.30) * config.ARM_TIGHTNESS +
           0.09 * Math.sin(x * 11.3) + 0.05 * Math.sin(x * 23.7 + 1.7);
  }

  /* simulate() needs the ridge and a cos/sin for each of the 15.5k live
     stars every frame; as Math calls that loop was ~2 ms of main
     thread per frame on an M2, the largest thing the hero did on the
     CPU. Tables with linear interpolation give the same values to
     2e-6 rad (ridge) and 3e-7 (trig) — a thousandth of a pixel — for
     about a quarter of the time. The ridge table holds the UNCLAMPED
     curve and the lookup clamps to ARM_FLOOR, so the kink there stays
     exact. Only simulate() uses these; spawning keeps armRidge(). */
  const RIDGE_N = 4096, RIDGE_MAX = 1.5, RIDGE_SCALE = RIDGE_N / RIDGE_MAX;
  const ridgeTab = new Float64Array(RIDGE_N + 2);
  for (let k = 0; k < RIDGE_N + 2; k++) {
    const x = k / RIDGE_SCALE;
    ridgeTab[k] = Math.log(x / config.ARM_START + 0.30) * config.ARM_TIGHTNESS +
                  0.09 * Math.sin(x * 11.3) + 0.05 * Math.sin(x * 23.7 + 1.7);
  }
  function ridgeFast(r) {
    const f = (r > config.ARM_FLOOR ? r : config.ARM_FLOOR) * RIDGE_SCALE;
    const k = f | 0;
    if (k >= RIDGE_N) return armRidge(r, 0);
    return ridgeTab[k] + (ridgeTab[k + 1] - ridgeTab[k]) * (f - k);
  }
  const TRIG_N = 4096, TRIG_SCALE = TRIG_N / (Math.PI * 2);
  const sinTab = new Float64Array(TRIG_N + 1), cosTab = new Float64Array(TRIG_N + 1);
  for (let k = 0; k <= TRIG_N; k++) {
    sinTab[k] = Math.sin(k / TRIG_SCALE);
    cosTab[k] = Math.cos(k / TRIG_SCALE);
  }

  /* Where a new star goes. Shared by the live population and the
     field, so both are drawn from the same galaxy. `ang` is absolute,
     ridge included; the caller decides how to store it. */
  function sampleDisc(freshLife, field) {
    const roll = Math.random();
    // The field leans on the smooth populations — bulge and interarm —
    // because that is where the unresolved light in a photograph is.
    const NU = field ? 0.04 : config.NUCLEUS_FRACTION;
    const B  = field ? 0.30 : config.BULGE_FRACTION;
    const IA = field ? 0.30 : config.INTERARM;
    let pop;
    if (roll < NU) pop = 4;
    else if (roll < NU + B) pop = 0;
    else if (roll < NU + B + IA) pop = 3;
    else if (roll < NU + B + IA + config.SPUR_FRACTION) pop = 2;
    else pop = 1;

    let r, ang, thickness, hii = 0, secondary = false;

    if (pop === 4) {
      // Cube-root fills a sphere evenly rather than crowding the centre.
      r = Math.cbrt(Math.random()) * config.NUCLEUS_RADIUS + 0.002;
      ang = Math.random() * Math.PI * 2;
      thickness = 4.2;
    } else if (pop === 0) {
      // The field's bulge is broader and shallower: a Sérsic-like tail
      // of faint points is what makes the core a gradient, not a dot.
      r = field
        ? Math.pow(Math.random(), 1.9) * config.BULGE_RADIUS * 1.35 + 0.010
        : Math.pow(Math.random(), 3.1) * config.BULGE_RADIUS + 0.010;
      ang = Math.random() * Math.PI * 2;
      thickness = field ? 3.6 : 2.8;
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

      // A half-integer arm index puts the ridge midway between the
      // primaries: that is the whole of how a secondary arm is made.
      secondary = pop === 1 && Math.random() < config.SECONDARY_FRACTION;
      const arm = Math.floor(Math.random() * config.ARMS) + (secondary ? 0.5 : 0);
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
          const w = config.ARM_SPREAD * (0.55 + r * 0.75) * (secondary ? 0.55 : 1);
          let off = gauss() * w + config.ARM_BIAS * w;
          // Dust lane on the concave edge: the dark dividing line.
          const lane = -config.ARM_BIAS * w - config.DUST_OFFSET * w;
          if (Math.abs(off - lane) < config.DUST_WIDTH * w &&
              Math.random() < config.DUST_OPACITY) {
            off += (off > lane ? 1 : -1) * config.DUST_WIDTH * w * 1.4;
          }
          ang = armRidge(r, arm) + off;
          thickness = 0.55;

          // Star formation lives on the primaries.
          if (!secondary && Math.random() < config.HII_RATE) {
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
    return { r, ang, pop, thickness, hii, secondary };
  }

  /* Colour, sprite size, luminosity and SHAPE for a star of this
     population. kind 0 is an ordinary point; 1 an HII nebula — a wide
     soft pink blob with no core and no spikes, light from gas rather
     than from a star; 2 a giant, with six-point diffraction and a
     chromatic halo, which is what a long exposure does to the
     brightest few. */
  function styleStar(r, pop, ang, hii, secondary) {
    const vary = 0.88 + Math.random() * 0.24;
    if (hii) {
      return { c: [1.00, 0.40, 0.62], s: 3.2 * vary,
               l: 1.6 * (0.85 + Math.random() * 0.3), kind: 1 };
    }
    if (pop === 4) {
      // The little sun: white-hot centre warming to gold at the limb.
      const edge = r / config.NUCLEUS_RADIUS;
      // Old stars: even the hottest point of a real bulge is cream,
      // not blue-white, and it must not clip to a flat disc.
      return { c: [1.00, 0.92 - edge * 0.14, 0.74 - edge * 0.26],
               s: (1.05 - edge * 0.26) * vary,
               l: (3.2 - edge * 1.2) + Math.random() * 0.9, kind: 0 };
    }
    const type = pickType(r, pop === 0, pop === 1 && !secondary, ang);
    const kind = (type.l >= 2.5 && Math.random() < 0.55) ? 2 : 0;
    return { c: type.c, s: type.s * vary,
             l: type.l * (0.82 + Math.random() * 0.36), kind };
  }

  function spawnStar(i, freshLife) {
    const { r, ang, pop, thickness, hii, secondary } = sampleDisc(freshLife, false);

    radius[i] = r;
    popArr[i] = pop;
    // Offset FROM the arm, not an absolute angle: the arm's angle is a
    // function of radius, so a star keeping a fixed angle while falling
    // inward slides off its arm and tears the spiral apart.
    angle[i] = (pop === 4 || pop === 0) ? ang : ang - armRidge(r, 0);
    height[i] = gauss() * config.THICKNESS * thickness * (1.0 - r * 0.45);
    seed[i] = Math.random();

    const st = styleStar(r, pop, ang, hii, secondary);
    const t4 = i * 4;
    tintArr[t4] = st.c[0]; tintArr[t4 + 1] = st.c[1]; tintArr[t4 + 2] = st.c[2];
    tintArr[t4 + 3] = st.s;
    lum[i] = st.l;
    kindArr[i] = st.kind;
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
  const kindBuf = gl.createBuffer();
  setupAttr(kindBuf, 5, 1, kindArr, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);

  /* ── The field ──
     Placed once, uploaded once. Its home positions never change; its
     rotation is applied in the vertex shader from uPattern, so it
     turns with the live stars and freezes with them during the burst.
     What DOES change is its offset from home: the cursor wake and the
     return spring run for the field exactly as simulate() runs them
     for the live stars, but as a transform-feedback pass on the GPU
     (simulateField), ping-ponging an offset/velocity pair. Every star
     in the galaxy obeys one rule, and the field costs the CPU nothing. */
  const F = config.FIELD_COUNT;
  let fieldVAO, tfVAO, tfObj, fieldCur = 0;
  const fieldOff = [], fieldVel = [];

  const tfProg = program(`
    layout(location = 0) in vec3 aBase;   // home, in the disc frame
    layout(location = 1) in vec3 aOff;
    layout(location = 2) in vec3 aVel;
    layout(location = 3) in float aSeed;
    uniform float uPattern;
    uniform float uDt;
    uniform vec2  uWakeA, uWakeB, uWakeDir;
    uniform float uWakeEnergy, uRadius, uStrength, uSwirl;
    uniform float uSpring, uDamp, uMaxOff;
    out vec3 tOff;
    out vec3 tVel;
    /* A line-for-line port of the wake and spring in simulate(). Keep
       the two in step: a field that answers the cursor differently
       from the live stars reads as two galaxies. */
    void main() {
      float cp = cos(uPattern), sp = sin(uPattern);
      vec2 h = vec2(aBase.x * cp - aBase.y * sp, aBase.x * sp + aBase.y * cp);
      vec3 off = aOff, vel = aVel;
      if (uWakeEnergy > 0.0) {
        vec2 s = h + off.xy;
        vec2 ab = uWakeB - uWakeA;
        float l2 = dot(ab, ab);
        float t = l2 > 1e-9 ? clamp(dot(s - uWakeA, ab) / l2, 0.0, 1.0) : 0.0;
        vec2 d = s - (uWakeA + ab * t);
        float d2 = dot(d, d);
        if (d2 < uRadius * uRadius) {
          float dd = max(sqrt(d2), 1e-6);
          float q = 1.0 - dd / uRadius;
          float imp = uStrength * (q * q * (3.0 - 2.0 * q)) * uWakeEnergy * uDt * 60.0;
          vel.xy += ((d / dd) * (1.0 - uSwirl) + uWakeDir * uSwirl) * imp;
          vel.z += (aSeed - 0.5) * imp * 0.35;
        }
      }
      // Over-damped spring: ~4s home, no overshoot.
      vel += (-uSpring * off - uDamp * vel) * uDt;
      off += vel * uDt;
      float om2 = dot(off.xy, off.xy);
      if (om2 > uMaxOff * uMaxOff) {
        float k = uMaxOff / sqrt(om2);
        off.xy *= k; vel.xy *= 0.5;
      }
      tOff = off;
      tVel = vel;
      gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
    }`, `
    precision highp float;
    out vec4 frag;
    void main() { frag = vec4(0.0); }`, ['tOff', 'tVel']);

  {
    const fPos = new Float32Array(F * 3), fAttr = new Float32Array(F * 3);
    const fTint = new Float32Array(F * 4), fLum = new Float32Array(F);
    const fKind = new Float32Array(F);
    for (let i = 0; i < F; i++) {
      const { r, ang, pop, thickness, hii, secondary } = sampleDisc(false, true);
      const st = styleStar(r, pop, ang, hii, secondary);
      const o = i * 3, t4 = i * 4;
      fPos[o] = Math.cos(ang) * r;
      fPos[o + 1] = Math.sin(ang) * r;
      fPos[o + 2] = gauss() * config.THICKNESS * thickness * (1.0 - r * 0.45);
      fAttr[o] = r; fAttr[o + 1] = Math.random(); fAttr[o + 2] = 1;
      fTint[t4] = st.c[0]; fTint[t4 + 1] = st.c[1]; fTint[t4 + 2] = st.c[2];
      // Nebulae keep their size; everything else is a fainter, smaller
      // point than its live counterpart — the unresolved background.
      fTint[t4 + 3] = st.s * (hii ? 1 : config.FIELD_SIZE);
      fLum[i] = st.l * config.FIELD_LUM;
      fKind[i] = st.kind;
    }
    const fPosBuf = gl.createBuffer(), fAttrBuf = gl.createBuffer();
    fieldVAO = gl.createVertexArray();
    gl.bindVertexArray(fieldVAO);
    setupAttr(fPosBuf, 0, 3, fPos, gl.STATIC_DRAW);
    setupAttr(fAttrBuf, 1, 3, fAttr, gl.STATIC_DRAW);
    setupAttr(gl.createBuffer(), 2, 4, fTint, gl.STATIC_DRAW);
    setupAttr(gl.createBuffer(), 3, 1, fLum, gl.STATIC_DRAW);
    setupAttr(gl.createBuffer(), 5, 1, fKind, gl.STATIC_DRAW);
    // No name target: a field star is never a fill star. The generic
    // attribute value stands in for the missing array. Location 6
    // (aOff) is pointed at the current state set by draw().
    gl.disableVertexAttribArray(4);
    gl.vertexAttrib3f(4, 0, 0, 0);
    gl.bindVertexArray(null);
    // The live stars carry their offsets inside posArr already.
    gl.vertexAttrib3f(6, 0, 0, 0);

    // Offset/velocity state, two sets for the ping-pong.
    const zeros = new Float32Array(F * 3);
    for (let i = 0; i < 2; i++) {
      fieldOff[i] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, fieldOff[i]);
      gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_COPY);
      fieldVel[i] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, fieldVel[i]);
      gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_COPY);
    }
    const point = (buf, loc, size, stride, offset) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    };
    tfVAO = [gl.createVertexArray(), gl.createVertexArray()];
    tfObj = [gl.createTransformFeedback(), gl.createTransformFeedback()];
    for (let i = 0; i < 2; i++) {
      gl.bindVertexArray(tfVAO[i]);
      point(fPosBuf, 0, 3, 0, 0);
      point(fieldOff[i], 1, 3, 0, 0);
      point(fieldVel[i], 2, 3, 0, 0);
      point(fAttrBuf, 3, 1, 12, 4);              // the seed, from (r, seed, alpha)
      gl.bindVertexArray(null);
      // Reading set i writes set 1 - i.
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfObj[i]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, fieldOff[1 - i]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, fieldVel[1 - i]);
    }
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
  }

  /* The field's simulate(): one GPU pass over the offset/velocity
     state. Frozen on the same condition as the live stars. */
  function simulateField(dt) {
    if (!tfProg || dt <= 0 || burst >= config.BURST_FREEZE) return;
    gl.useProgram(tfProg.p);
    gl.uniform1f(tfProg.u.uPattern, patternAngle);
    gl.uniform1f(tfProg.u.uDt, dt);
    gl.uniform2f(tfProg.u.uWakeA, wakeAx, wakeAy);
    gl.uniform2f(tfProg.u.uWakeB, wakeBx, wakeBy);
    gl.uniform2f(tfProg.u.uWakeDir, wakeDirX, wakeDirY);
    gl.uniform1f(tfProg.u.uWakeEnergy, wakeEnergy);
    gl.uniform1f(tfProg.u.uRadius, config.PUSH_RADIUS);
    gl.uniform1f(tfProg.u.uStrength, config.PUSH_STRENGTH);
    gl.uniform1f(tfProg.u.uSwirl, config.SWIRL);
    gl.uniform1f(tfProg.u.uSpring, config.RETURN_SPRING);
    gl.uniform1f(tfProg.u.uDamp, config.RETURN_DAMPING);
    gl.uniform1f(tfProg.u.uMaxOff, config.MAX_OFFSET);
    gl.bindVertexArray(tfVAO[fieldCur]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfObj[fieldCur]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, F);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    fieldCur = 1 - fieldCur;                     // the set just written
  }

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
     have spread thinner over more glyph area.

     0.46 -> 0.50 when STAR_COUNT dropped 26k -> 15.5k: the larger
     points nearly cover the loss, the extra share closes the rest. */
  const NAME_FILL_SHARE = 0.50;

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
    /* The CANVAS's rect, not the hero section's. The canvas is fixed
       and fills the viewport; the section scrolls away underneath it,
       so measuring against the section sent the wake to the wrong
       part of the disc as soon as the approach had begun. */
    const r = canvas.getBoundingClientRect();
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
  let burstFired = false, burstClock = 0, rewindTarget = 0;
  let releaseT = 0, release = 0;
  // Set by the launch button. Until then the trip does not exist: the
  // planet is collapsed and the page ends on the
  // released name with the button over it.
  let launched = false;
  /* THE SEAL — the trip is one-way from the button. Until it is
     pressed the reader may scroll back up from the name to the galaxy
     (the burst rewinds, scroll-driven). On the press the sky is
     frozen at its finished state and the approach and burst sections
     are collapsed (.is-sealed, galaxy.css), so the page is exactly
     one screen tall and there is nothing above to scroll back to.
     readScroll() stops reading; the browser's own scroll bound does
     the rest, the same way the gate below works. */
  // Reduced motion: no burst, the name is simply there — and so is
  // the profile below it.
  if (reduceMotion) document.documentElement.classList.add('is-written');
  let sealed = false;
  function seal() {
    if (sealed) return;
    sealed = true;
    zoomT = 1; rewindTarget = 1; burstFired = true;
    document.documentElement.classList.add('is-sealed');
    window.scrollTo(0, 0);
  }
  /* The take-off: releaseClock runs from the press (see the launch
     handler at the end), and onLiftOff is called once by the frame
     loop when the letters have all let go. */
  let releaseClock = null, onLiftOff = null;
  /* The name SCROLLS: once written, the page continues below it into
     the profile (who Ali is, the numbers, the button). The star name
     is drawn on the fixed canvas, so it is moved by uNameShift, and
     the HTML around it (hello, quote, links) by --name-scroll, both
     from nameShiftPx = how far the page is past the name screen.
     On the press the profile fades (--leave) and the name glides back
     to the centre (LEAVE_MS) before its letters let go. */
  const LEAVE_MS = 600, LEAVE_FADE_MS = 420, RELEASE_AFTER = 0.5;
  let nameShiftPx = 0, nameScreenY = 0, leaving = null, lastShift = -1, lastLeave = -1;
  const burstSection = document.getElementById('burst');
  function measureNameScreen() {
    // The scroll at which the name screen is exactly in view: the end
    // of #burst at the bottom of the viewport.
    if (burstSection && !sealed) nameScreenY = burstSection.offsetTop + burstSection.offsetHeight - window.innerHeight;
  }
  measureNameScreen();
  window.addEventListener('resize', measureNameScreen, { passive: true });
  function stepNameShift(now) {
    if (leaving) {
      const u = Math.min(1, (now - leaving.t0) / LEAVE_MS);
      const e = 1 - Math.pow(1 - u, 3);
      nameShiftPx = leaving.from * (1 - e);
      const lv = Math.min(1, (now - leaving.t0) / LEAVE_FADE_MS);
      if (lv !== lastLeave) { lastLeave = lv; document.documentElement.style.setProperty('--leave', lv.toFixed(3)); }
    } else nameShiftPx = sealed ? 0 : Math.max(0, window.scrollY - nameScreenY);
    const q = Math.round(nameShiftPx * 2) / 2;
    if (q !== lastShift) {
      lastShift = q;
      const r = document.documentElement.style;
      r.setProperty('--name-scroll', q + 'px');
      r.setProperty('--name-scroll-n', (q / Math.max(1, window.innerHeight)).toFixed(4));
    }
  }
  // Smoothed values the renderer actually uses, so a flick of the wheel
  // glides instead of snapping.
  let zoom = 0, burst = 0;
  let lastPublishedBurst = NaN, lastPublishedName = NaN;
  let lastPublishedRelease = NaN;
  let lastPublishedKoaik = NaN;
  let lastBursting = false;
  let swallowFeed = 0, coreGlow = 0;
  let leanX = 0, leanY = 0;
  let lastTime = performance.now();
  let running = false, visible = true;
  let starsDirty = true;      // posArr / attrArr changed since the last upload
  let frameNo = 0, drawnNight = 0;   // the backdrop's half rate (see frame)
  /* The black hole swallowing the sky (system.js drives it at the end
     of the collapse): where it is on screen, in uv, and how far. */
  let swallowAmt = 0;
  const swallowHole = [0.5, 0.5];
  /* The night (system.js, while a project is in focus): 0..1, how far
     the sky has stepped back — see NIGHT_BLUR / NIGHT_DIM. system.js
     eases it; here it is only read, once a frame, in the composite. */
  let skyNight = 0;
  window.galaxySky = {
    swallow(amount, u, v) { swallowAmt = Math.min(1, Math.max(0, amount)); swallowHole[0] = u; swallowHole[1] = v; },
    night(amount) { skyNight = Math.min(1, Math.max(0, amount)); },
  };

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
       0 .. 0.9 vh    the approach: the camera flies straight in along
                      the view axis while the disc rolls from 19 deg to
                      37 deg, opening from the bottom edge so the
                      galaxy is seen from the side rather than face-on.
                      It ends ~2.07x oversize with the stars reading as
                      discs rather than points.
       0.9 vh         BURST FIRES — a timed event, not scroll-driven.
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
     page needs hero + #intro + #burst ≥ 200vh for BURST_TRIGGER to land inside it.

     Each stage's progress is derived here so the renderer only reads
     smooth 0..1 values and never has to know about pixels. */
  function readScroll() {
    if (sealed) return;                 // frozen at the finished sky
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
    const ZOOM_START = 0.0;
    zoomT = Math.min(1, Math.max(0,
      (y / h - ZOOM_START) / (config.BURST_TRIGGER - ZOOM_START)));
    // Ease in: linear against scroll made the approach feel like it
    // decelerated, because equal steps cover less apparent distance the
    // closer the camera gets. A pure smoothstep, though, barely moved
    // for the first tenth of a screen — the very first scroll felt
    // dead — so it is mixed half with linear: it answers at once.
    zoomT = 0.5 * zoomT + 0.5 * zoomT * zoomT * (3 - 2 * zoomT);

    // Stage 2: the burst is NOT scroll-driven. Scrolling past the
    // trigger point fires it once and it then plays out on its own
    // clock — scrubbing an explosion back and forth with the wheel
    // robs it of any impact, and it should not need continued
    // scrolling to finish.
    const pos = y / h;
    if (!burstFired && pos >= config.BURST_TRIGGER) {
      burstFired = true;
      /* Resume from wherever the reverse left it rather than from 0.
         Resetting the clock mid-way snapped burst to ~0 on the next
         frame and teleported every star back into the disc. */
      burstClock = burst * config.BURST_DURATION;
    } else if (burstFired && pos < config.BURST_TRIGGER - config.BURST_HYSTERESIS) {
      burstFired = false;
    }
    // Where the reverse wants `burst` for this scroll position: 1 at
    // the trigger, 0 a REWIND_SPAN above it. The frame loop only ever
    // moves burst DOWN toward this — going up is the burst's own job.
    rewindTarget = Math.min(1, Math.max(0,
      (pos - (config.BURST_TRIGGER - config.BURST_REWIND_SPAN)) / config.BURST_REWIND_SPAN));
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

       Reversal then costs nothing: scrolling back up drives burst
       below the threshold and the simulation picks up exactly where it
       was parked — provided nothing the positions depend on moved in
       the meantime, which is why patternAngle advances below this
       line and nowhere else. */
    if (burst >= config.BURST_FREEZE) return;
    starsDirty = true;

    /* The pattern rotation is simulation state and advances ONLY when
       the simulation does. It used to tick in the frame loop
       unconditionally, so it kept turning for the whole time the
       field was parked as the name — and every star's position is
       cos/sin(angle + patternAngle), rebuilt from scratch each step,
       not integrated. On the way back, the frame the sim thawed it
       rebuilt the disc with all that accumulated rotation at once:
       0.070 rad/s over a 10s read is a 60 deg snap of the whole
       galaxy, right as the last stars settled. Advancing it here
       makes the thaw exactly continuous, and keeps the dust (which
       reads uPattern) aligned with the stars as it fades back in. */
    patternAngle += config.PATTERN_SPEED * dt;

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
      const armA = (pop === 4 || pop === 0) ? 0 : ridgeFast(r);
      const a = armA + angle[i] + patternAngle;
      // cos / sin from the tables (see ridgeFast): the angle in table
      // steps, wrapped by the mask, interpolated.
      const tf = a * TRIG_SCALE, tfl = Math.floor(tf);
      const tt = tf - tfl, tk = tfl & (TRIG_N - 1);
      const hx = (cosTab[tk] + (cosTab[tk + 1] - cosTab[tk]) * tt) * r;
      const hy = (sinTab[tk] + (sinTab[tk + 1] - sinTab[tk]) * tt) * r;

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

    /* 0. the sky's still part, once per canvas size */
    if (skyBaseDirty) {
      bindTarget(skyBaseRT);
      gl.disable(gl.BLEND);
      gl.useProgram(skyBaseProg.p);
      gl.uniform2f(skyBaseProg.u.uRes, vw, vh);
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      skyBaseDirty = false;
    }

    /* 1. scene -> HDR */
    bindTarget(sceneRT);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);

    gl.useProgram(skyProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, skyBaseRT.tex);
    gl.uniform1i(skyProg.u.uBase, 0);
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
    const dustVisible = config.DUST && burst * config.DUST_FADE < 1.0;
    gl.disable(gl.BLEND);
    if (dustVisible) {
    bindTarget(dustRT);
    gl.clearColor(0, 0, 0, 0);            // alpha is optical depth: none
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(0, 0, 0, 1);
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
    gl.uniform1f(dustProg.u.uArmSpread, config.ARM_SPREAD);
    gl.uniform1f(dustProg.u.uArmBias, config.ARM_BIAS);
    gl.uniform1f(dustProg.u.uDustOffset, config.DUST_OFFSET);
    gl.uniform1f(dustProg.u.uDustWidth, config.DUST_WIDTH);
    gl.uniform1f(dustProg.u.uBulgeRadius, config.BULGE_RADIUS);
    gl.uniform1f(dustProg.u.uBulgeGlow, config.BULGE_GLOW);
    gl.uniform1f(dustProg.u.uAbsorb, config.DUST_ABSORB);
    gl.uniform1f(dustProg.u.uArms, config.ARMS);
    gl.uniform1f(dustProg.u.uTightness, config.ARM_TIGHTNESS);
    gl.uniform1f(dustProg.u.uArmStart, config.ARM_START);
    gl.uniform1f(dustProg.u.uArmFloor, config.ARM_FLOOR);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* Back to the scene, additively. The order from here is what
       lets the lanes read as lanes: the half of the field BEHIND the
       disc plane goes down first, then the dust darkens everything so
       far (sky included) and adds its own glow, then the near half of
       the field goes on top, unabsorbed. */
    bindTarget(sceneRT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.useProgram(starProg.p);
    gl.bindVertexArray(starVAO);
    // Only when simulate() moved them: frozen (the whole time the name
    // or the settled sky is up) the buffers already hold these values.
    if (starsDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, posArr);
      gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, attrArr);
      starsDirty = false;
    }
    if (tintDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, tintArr);
      gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf);   // set alongside the tint
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, kindArr);
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
    gl.uniform1f(starProg.u.uRelease, release);
    if (starProg.u.uNameShift) gl.uniform1f(starProg.u.uNameShift, 2 * nameShiftPx / Math.max(1, window.innerHeight));
    gl.uniform1f(starProg.u.uPattern, patternAngle);

    const drawStars = half => {
      gl.useProgram(starProg.p);
      gl.uniform1f(starProg.u.uHalf, half);
      // The field has fully dissolved by burst 0.55; skip it after.
      if (burst < 0.55) {
        gl.bindVertexArray(fieldVAO);
        // The offsets simulateField wrote this frame.
        gl.bindBuffer(gl.ARRAY_BUFFER, fieldOff[fieldCur]);
        gl.enableVertexAttribArray(6);
        gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 0, 0);
        gl.uniform1f(starProg.u.uMigrate, 0);
        gl.drawArrays(gl.POINTS, 0, F);
      }
      gl.bindVertexArray(starVAO);
      gl.uniform1f(starProg.u.uMigrate, 1);
      gl.drawArrays(gl.POINTS, 0, N);
    };
    const dustPass = prog => {
      gl.useProgram(prog.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dustRT.tex);
      gl.uniform1i(prog.u.uSrc, 0);
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    if (dustVisible) {
      drawStars(-1);
      gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
      gl.useProgram(dustAbsorbProg.p);
      gl.uniform3fv(dustAbsorbProg.u.uExt, config.DUST_TINT);
      dustPass(dustAbsorbProg);
      gl.blendFunc(gl.ONE, gl.ONE);
      dustPass(upsampleProg);
      drawStars(1);
    } else {
      drawStars(0);
    }

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
    // The night reads the scene out of focus from its mips. They are
    // made here, for this pass alone, and only while it is night: the
    // filter goes back below, so the bright pass never samples them.
    const nightBlur = skyNight * config.NIGHT_BLUR * dpr;
    if (nightBlur > 0) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    for (let i = 0; i < bloomRT.length; i++) {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, bloomRT[i].down.tex);
      gl.uniform1i(compositeProg.u['uBloom' + i], 1 + i);
    }
    gl.uniform1f(compositeProg.u.uExposure, config.EXPOSURE);
    gl.uniform1f(compositeProg.u.uBloomStrength, config.BLOOM_STRENGTH);
    gl.uniform2f(compositeProg.u.uRes, vw, vh);
    gl.uniform2f(compositeProg.u.uHole, swallowHole[0], swallowHole[1]);
    gl.uniform1f(compositeProg.u.uSwallow, swallowAmt);
    gl.uniform1f(compositeProg.u.uNight, skyNight);
    gl.uniform1f(compositeProg.u.uNightBlur, nightBlur);
    gl.uniform1f(compositeProg.u.uNightDim, config.NIGHT_DIM);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    if (nightBlur > 0) {
      gl.activeTexture(gl.TEXTURE0);                         // still the scene on unit 0
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }

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
    const aq = Math.round(aliT * 500) / 500;
    if (aq !== lastPublishedName) {
      lastPublishedName = aq;
      document.documentElement.style.setProperty('--name-ali', aq.toFixed(3));
    }

    const koaikT = smooth01(Math.max(0, (burst - 0.86) / 0.14));
    const kq = Math.round(koaikT * 500) / 500;
    if (kq !== lastPublishedKoaik) {
      lastPublishedKoaik = kq;
      document.documentElement.style.setProperty('--name-koaik', kq.toFixed(3));
      // .is-written: the name is complete; the launch layer becomes
      // visible (its opacity rides --name-koaik, this gates the box).
      document.documentElement.classList.toggle('is-written', kq >= 0.999 || reduceMotion);
    }

    const bq = Math.round(burst * 500) / 500;
    if (bq !== lastPublishedBurst) {
      lastPublishedBurst = bq;
      document.documentElement.style.setProperty('--burst', bq.toFixed(3));
    }
    // .is-bursting: the burst is playing FORWARD on its own clock (not
    // the scroll-up rewind) — the "Wait" guide shows only then.
    const bursting = burstFired && burst > 0 && burst < 1;
    if (bursting !== lastBursting) {
      lastBursting = bursting;
      document.documentElement.classList.toggle('is-bursting', bursting);
    }

    /* --release fades the name block out as the stars leave it, and
       .is-released lets whatever follows take the pointer. */
    const rq = Math.round(release * 500) / 500;
    if (rq !== lastPublishedRelease) {
      lastPublishedRelease = rq;
      document.documentElement.style.setProperty('--release', rq.toFixed(3));
      document.documentElement.classList.toggle('is-released', rq > 0.5);
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
      stepNameShift(performance.now());
      draw(0);
      requestAnimationFrame(frame);
      return;
    }

    driftX += (targetDrift - driftX) * Math.min(1, dt * 4.5);
    // Ease the scroll-driven stages so a flick of the wheel glides.
    // 6.0: the approach is short now, and a slower ease would leave the
    // camera still closing in when the burst fires.
    zoom   += (zoomT   - zoom)   * Math.min(1, dt * 6.0);
    // The burst plays on its own timeline once fired. Un-fired, it
    // tracks the scroll-derived target back down (never up), eased
    // just enough that wheel steps do not show as jumps.
    if (burstFired) {
      if (burst < 1) {
        burstClock += dt;
        burst = Math.min(1, burstClock / config.BURST_DURATION);
      }
    } else if (burst > rewindTarget) {
      burst += (rewindTarget - burst) * Math.min(1, dt * config.BURST_REWIND_EASE);
      if (burst - rewindTarget < 0.001) burst = rewindTarget;
    }
    // The release is the take-off, timed from the press.
    stepNameShift(performance.now());
    if (releaseClock !== null) {
      releaseClock += dt;
      releaseT = smooth01(Math.max(0, releaseClock) / config.RELEASE_TIME);
    }
    const releaseGoal = releaseT * smooth01((burst - 0.90) / 0.10);
    release += (releaseGoal - release) * Math.min(1, dt * 6.0);
    // The letters have let go: hand over to the warp, once.
    if (onLiftOff && release >= 0.985) { const f = onLiftOff; onLiftOff = null; f(); }
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
    simulateField(dt);

    // The core flares as it feeds: rises fast, settles slower.
    const feed = Math.min(1, Math.max(0,
      (swallowFeed - config.SWALLOW_BASE) /
      (config.SWALLOW_PEAK - config.SWALLOW_BASE)));
    coreGlow += (feed - coreGlow) *
                Math.min(1, dt * (feed > coreGlow ? 5.0 : 1.4));

    /* A backdrop is drawn every second frame. Once the burst is over
       the scene only twinkles; while it sits behind the profile (the
       name and its stars scrolled away) or behind the system, half the
       rate cannot be seen and frees the GPU for what is in front. Full
       rate comes back for anything that moves fast: the night easing,
       the swallow, the leave. NOT for meteors: one is in the air most
       of the time (measured: 26–30 frames in 30), so waiting for a
       clear sky meant the half rate almost never happened; a streak
       stepping twice as far per drawn frame still reads as a streak.
       Not drawing keeps the last frame on the canvas. */
    const backdrop = burst >= 1 && swallowAmt === 0 &&
      Math.abs(skyNight - drawnNight) < 0.002 &&   // the ease never quite lands
      (launched ? release >= 0.999
                : (!leaving && nameShiftPx > window.innerHeight * 0.75));
    if (!(backdrop && (frameNo++ & 1))) {
      draw(now / 1000);
      drawnNight = skyNight;
    }
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
     LAUNCH — the orbit mark at the end of the profile
     ============================================================
     The system lives on its own page (system.html) and the mark is a real
     link to it. A plain click is taken here to play the take-off
     first; anything else (a modified click, no WebGL2, no script) is
     the link's own business and simply opens the page.

       1. the page locks (.is-leaving) and the profile fades (--leave),
          the mark with it — the button itself does NOTHING on the
          press (the user had a take-off animation removed) — while
          the name glides back down to the centre (LEAVE_MS);
       2. the page is sealed once the profile is invisible, and the
          letters let go (the release, RELEASE_TIME, RELEASE_AFTER in);
       3. when they have gone the frame loop calls liftOff, which
          follows the link. system.html opens on the warp.

     Under reduced motion there is no take-off: straight to the page. */
  const launchBtn = document.getElementById('launchBtn');
  if (launchBtn && !SKY_ONLY) {
    const root = document.documentElement;
    const go = () => { window.location.assign(launchBtn.href); };
    launchBtn.addEventListener('click', e => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (launched) return;
      launched = true;
      if (reduceMotion) { go(); return; }

      root.classList.add('is-leaving');          // scroll locked; the profile fades on --leave
      /* The leave: the profile fades (LEAVE_FADE_MS) while the name
         glides back down to the centre (LEAVE_MS); the page is sealed
         once the profile is invisible, so its scroll jump is unseen;
         the letters let go RELEASE_AFTER seconds in, and the frame
         loop calls liftOff once the release has played. */
      /* The glide starts from just above the screen, not from where the
         name really is: the profile is several screens long now, and
         the name coming back from three screens up in LEAVE_MS was a
         streak, not a glide. Both places are off-screen, so the cut
         from one to the other is unseen. */
      leaving = { t0: performance.now(), from: Math.min(nameShiftPx, window.innerHeight * 0.9) };
      setTimeout(seal, LEAVE_FADE_MS + 20);
      releaseClock = -RELEASE_AFTER;
      onLiftOff = go;
    });
    /* Coming BACK to this page from the system (the back button) can
       restore it from the back-forward cache exactly as it was left:
       sealed, the profile faded out, the name gone. Start over. */
    window.addEventListener('pageshow', e => { if (e.persisted && launched) window.location.reload(); });
  }

  /* ============================================================
     ARRIVING AT A SECTION — galaxy.html#about
     ============================================================
     The top bar on the other pages (posts.html, activities.html)
     links to this page's sections. Someone coming for "Education"
     must not be made to fly the approach and wait for the burst
     first, so with such a hash the page opens with the name already
     written: burst done, the profile there. profile.js, which runs
     after this and fills the sections, does the scrolling. As in
     the sky-only state, simulate() runs once first so the settled
     stars have positions. Scrolling back up from there still rewinds
     the burst, as always. */
  if (!SKY_ONLY && !reduceMotion && /^#(about|stack|education|build)$/.test(window.location.hash)) {
    simulate(0);
    burstFired = true; burstClock = config.BURST_DURATION; burst = 1;
    zoom = 1; zoomT = 1; rewindTarget = 1;
    document.documentElement.classList.add('is-written');
  }

  /* ============================================================
     SKY ONLY — system.html
     ============================================================
     There this script draws only the backdrop: the sky as the
     take-off left it — burst done, the name released, the page
     sealed. Nothing scrolls and nothing is written; the frame loop
     settles at the backdrop's half rate, and window.galaxySky (the
     night, the swallow) works as before. simulate() runs ONCE first:
     frozen at burst 1 it would never fill the position buffers the
     settled stars are drawn from. */
  if (SKY_ONLY) {
    simulate(0);
    burstFired = true; burstClock = config.BURST_DURATION; burst = 1;
    zoom = 1; zoomT = 1; rewindTarget = 1;
    sealed = true; launched = true;
    releaseT = 1; release = 1;
  }

  paintOnce();
  wake();
})();
