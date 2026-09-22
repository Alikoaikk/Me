/* ============================================================
   GALAXY — tilted spiral disc for the hero background
   ------------------------------------------------------------
   Self-contained WebGL scene. No libraries, no textures.

   Each star keeps a "home" position on a logarithmic spiral arm
   and a separate displacement offset. Stars circulate by advancing
   their own angle within a FIXED disc plane — the disc itself never
   rotates, so the galaxy never appears to tilt toward edge-on.
   The cursor's swept path pushes the offsets; an over-damped spring
   eases them home, reforming the spiral once the mouse stops.

   The disc rotates RIGIDLY: every star shares one angle offset, so the
   spiral's shape is fixed by construction and can never wind up. Real
   galaxies rotate differentially, which shears arms apart (measured at
   +438° of winding in two minutes and a spiral smeared to nothing);
   rigid rotation is the deliberate stylised choice here.

   Disc stars spiral INWARD, fade out at the nucleus, and re-enter at
   the rim. Two details make that work without wrecking the spiral:

     - angle[] stores each star's offset FROM its arm, not an absolute
       angle. The arm's angle is a function of radius (~30 deg of swing
       per step inward), so a star that keeps a fixed angle while its
       radius shrinks slides off its arm along a straight radial line
       and tears the spiral apart. Rebuilding the angle from the offset
       each frame keeps every star on its arm the whole way in.

     - Recycled stars respawn AT THE RIM, not across the whole profile.
       Re-sampling everywhere let infall drain the outer disc (8.3% ->
       0.9% of stars in a minute) until the arms collapsed into a blob.
       Rim respawn balances the inflow; arm contrast then holds steady
       over at least four minutes.

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
    // Density is what lets the arms resolve into structure rather than
    // scattered dots, but simulate() is O(n) and now recomputes each
    // star's arm angle every frame (radius changes as stars fall in, so
    // it cannot be cached). Measured 16.2ms at 48k against a 16.7ms
    // budget — too tight for weaker machines; 34k restores real margin.
    STAR_COUNT:      34000,

    /* ── Structure, following a real Sc-type grand-design spiral ── */
    // Four arms, loosely wound. A two-armed M51 wind (5.5) packs the
    // arms into a near-solid ring at this scale and buries the dust
    // lanes, spurs and HII knots; four looser arms give more distinct
    // lines with the gaps that let all that structure read.
    ARMS:            6,        // many-armed: maximum number of visible lines
    ARM_TIGHTNESS:   3.20,     // ≈17° pitch angle
    // Rigid-body rotation: a full turn takes about 75 seconds.
    PATTERN_SPEED:   0.084,
    ARM_SPREAD:      0.22,     // angular half-width of an arm
    ARM_BIAS:        0.30,     // shift toward the convex (outer) side
    DISC_RADIUS:     1.0,      // visible rim
    // Real discs fall off with Rd ≈ 0.3 R, but sampling stars that way
    // starves the rim visually (the outer disc would get ~1% of them).
    // A longer scale length spreads the population so the arms read at
    // full extent, while the profile still declines outward.
    DISC_SCALE:      0.44,     // exponential scale length
    BULGE_RADIUS:    0.26,     // Re < Rd, as observed
    ARM_START:       0.18,     // arms begin at the bulge's edge
    ARM_FLOOR:       0.099,    // arm angle stops winding below this
    ARM_MIN:         0.20,     // arms begin tapering in here
    ARM_FADE:        0.30,     // radius over which arm density ramps up
    CORE_RADIUS:     0.030,    // stars are consumed inside this
    SWALLOW_REACH:   0.20,     // how far out the core's pull shows
    SWALLOW_FLARE:   2.6,      // how much a falling star brightens
    // Measured feed range at this star count: ~650 (quiet) to ~3900
    // (a burst), median ~990. Mapping BASE..PEAK onto 0..1 keeps the
    // glow swinging instead of pinning; an earlier scale of 140 clipped
    // every frame to 1.0 and the corona just sat permanently inflated.
    SWALLOW_BASE:    820,
    SWALLOW_PEAK:    3200,
    INFALL:          0.030,    // radial drift toward the centre, per second
    RIM_LO:          0.80,     // recycled stars re-enter between here and the rim
    THICKNESS:       0.050,    // vertical scatter of the disc

    /* ── Populations (fractions of the whole) ── */
    // A tight, brilliant ball at the very centre. Given its own
    // population because the bulge alone tapers too gradually to read
    // as a distinct nucleus.
    NUCLEUS_FRACTION: 0.11,
    NUCLEUS_RADIUS:   0.042,
    BULGE_FRACTION:  0.20,     // old red spheroid
    INTERARM:        0.40,     // smooth older disc between the arms
    SPUR_FRACTION:   0.11,     // feathers branching off the arms
    // The remainder (~36%) lands in the arms themselves.

    /* ── Dust lanes: on the concave (inner) edge, where gas piles up ── */
    DUST_OFFSET:     0.55,     // lane position, in arm half-widths
    DUST_WIDTH:      0.38,     // lane thickness, in arm half-widths
    DUST_OPACITY:    0.94,     // share of stars the lane displaces

    /* ── Star-forming knots, just outside the dust lane ── */
    HII_RATE:        0.085,    // share of arm stars in HII regions
    HII_KNOTS:       44,       // distinct star-forming complexes per arm

    /* ── Feathers/spurs ── */
    SPURS_PER_ARM:   9,
    SPUR_LENGTH:     0.16,
    SPUR_PITCH:      0.42,     // how sharply a spur peels off its arm

    // Face-on: the disc faces the viewer squarely, so the spiral reads
    // as a circle rather than an ellipse. A token tilt keeps a trace of
    // depth without squashing it. FIXED, never animated.
    TILT:            0.16,
    POINT_SIZE:      0.94,
    SCROLL_DRIFT:    0.62,     // disc units the galaxy pans while scrolling

    // Cursor interaction. The wake is a swept capsule between the
    // previous and current cursor position, so fast movement affects
    // everything it passes over instead of only the end point.
    PUSH_RADIUS:     0.34,     // world units on the disc plane
    PUSH_STRENGTH:   0.26,     // gentle: stars are nudged, not flung
    SWIRL:           0.55,     // share of the impulse applied tangentially
    WAKE_DECAY:      1.7,      // how fast the stirring fades once the cursor stops
    // Slightly over-critically damped (c > 2*sqrt(k)), so stars ease
    // home over ~4s with no overshoot or wobble. Lowering the damping
    // below ~2.2 here makes the field visibly oscillate.
    RETURN_SPRING:   1.20,
    RETURN_DAMPING:  2.30,
    MAX_OFFSET:      0.34,     // clamp so a fast sweep can't fling stars away
  };

  // Blown-out nucleus: hot white at the centre fading through cream.
  // Blended into stars near the galactic centre so the core reads as
  // an overexposed bloom rather than countable points.
  const CORE_TINT = new Float32Array([1.000, 0.984, 0.949]);

  /* ============================================================
     STAR CLASSES

     Two dominant hues, deliberately opposed: hot blue-white young
     stars against warm amber older ones. That cool-to-warm contrast
     against near-black gives the field its colour identity.

     Luminosity spans a wide range so a few stars read as bright
     pinpoints while the rest merge into the disc's glow — a narrow
     range makes every star look identical.

     Crucially, brightness is NOT tied to hue. An earlier ordering ran
     warm-faint to cool-bright, which left the amber stars at 60% of
     the count but only 25% of the emitted light, and the whole field
     rendered monochrome white. Each hue now spans the full brightness
     range: the split is ~63% warm / 37% cool by light.
     ============================================================ */
  const STAR_TYPES = [
    /* Warm family — deep red through amber, gold and cream */
    // name              weight  colour                   size   lum
    { k: 'deep red',     w: 0.07, c: [0.920, 0.300, 0.130], s: 0.60, l: 0.26 },
    { k: 'ember',        w: 0.06, c: [1.000, 0.420, 0.180], s: 0.66, l: 0.52 },
    { k: 'amber dim',    w: 0.10, c: [0.788, 0.463, 0.180], s: 0.66, l: 0.34 },
    { k: 'amber',        w: 0.09, c: [0.910, 0.588, 0.353], s: 0.86, l: 0.95 },
    { k: 'gold',         w: 0.06, c: [0.980, 0.760, 0.380], s: 0.96, l: 1.40 },
    { k: 'pale gold',    w: 0.05, c: [0.910, 0.851, 0.659], s: 0.98, l: 1.25 },
    { k: 'cream',        w: 0.05, c: [0.953, 0.902, 0.784], s: 0.92, l: 0.85 },
    { k: 'amber bright', w: 0.05, c: [0.950, 0.640, 0.330], s: 1.22, l: 2.40 },
    { k: 'rose',         w: 0.04, c: [1.000, 0.560, 0.620], s: 0.86, l: 1.05 },

    /* Cool family — teal and mint through blue-white to violet */
    { k: 'mint',         w: 0.05, c: [0.620, 0.950, 0.800], s: 0.66, l: 0.46 },
    { k: 'teal',         w: 0.06, c: [0.520, 0.860, 0.900], s: 0.70, l: 0.44 },
    { k: 'ice blue',     w: 0.06, c: [0.560, 0.880, 1.000], s: 0.76, l: 0.72 },
    { k: 'blue dim',     w: 0.08, c: [0.700, 0.820, 0.980], s: 0.70, l: 0.38 },
    { k: 'blue-white',   w: 0.07, c: [0.863, 0.933, 1.000], s: 1.00, l: 1.30 },
    { k: 'hot blue',     w: 0.04, c: [0.620, 0.780, 1.000], s: 1.32, l: 2.70 },
    { k: 'violet',       w: 0.04, c: [0.700, 0.620, 1.000], s: 1.08, l: 1.60 },

    // Rare anchor stars: a handful of larger, brighter points with a
    // stronger bloom, placed for visual weight along the arms.
    { k: 'anchor warm',  w: 0.02, c: [1.000, 0.780, 0.480], s: 1.90, l: 4.80 },
    { k: 'anchor cool',  w: 0.01, c: [0.700, 0.860, 1.000], s: 2.00, l: 5.20 },
  ];
;

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
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);   // additive: overlapping stars glow

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('galaxy: shader failed', gl.getShaderInfoLog(s));
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
      console.error('galaxy: link failed', gl.getProgramInfoLog(p));
      return null;
    }
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

  /* ── Stars ──
     aPos  : world position on the (untilted) disc, xyz
     aAttr : x = radius 0..1, y = variation seed, z = lifecycle alpha
     aTint : rgb = spectral colour, a = size multiplier
     aLum  : luminosity from the spectral class                         */
  const starProg = program(`
    precision highp float;
    attribute vec3 aPos;
    attribute vec3 aAttr;
    attribute vec4 aTint;
    attribute float aLum;
    uniform mat3 uRot;
    uniform float uCamDist;
    uniform float uScale;
    uniform float uAspect;
    uniform float uPointScale;
    uniform float uDrift;
    varying float vRadius;
    varying float vAlpha;
    varying vec3 vColor;
    varying float vSpike;
    varying float vBright;
    void main() {
      // Drift is applied in the disc plane before tilting, so the pan
      // slides the galaxy sideways without rotating it.
      vec3 world = aPos + vec3(uDrift, 0.0, 0.0);
      vec3 p = uRot * world;
      float w = uCamDist - p.z;
      vec2 ndc = vec2(p.x, p.y) * uScale / w;
      ndc.x /= uAspect;
      gl_Position = vec4(ndc, 0.0, 1.0);

      vRadius = aAttr.x;
      vColor  = aTint.rgb;

      // Compress the luminosity range for display without flattening
      // it: faint field stars keep a visible floor so the disc glows,
      // while giants stay several times brighter and read as distinct
      // pinpoints. A hard clamp here erases that contrast entirely.
      float shown = 0.26 + pow(aLum, 0.70) * 0.62;
      vAlpha = aAttr.z * shown;

      // Brightness also drives apparent size, as it does in a real
      // exposure — bright stars bloom wider than faint ones.
      vBright = smoothstep(1.6, 4.2, aLum);

      // Only genuinely bright stars earn diffraction spikes.
      vSpike = smoothstep(1.9, 3.6, aLum);

      float persp = uCamDist / w;
      gl_PointSize = uPointScale * persp * aTint.a *
                     (0.66 + pow(aLum, 0.52) * 0.42);
    }
  `, `
    precision highp float;
    uniform vec3 uCore;
    varying float vRadius;
    varying float vAlpha;
    varying vec3 vColor;
    varying float vSpike;
    varying float vBright;
    void main() {
      vec2 d = gl_PointCoord - vec2(0.5);
      float r2 = dot(d, d);
      if (r2 > 0.25) discard;

      // Soft round falloff with a hot central pixel.
      float disc = smoothstep(0.25, 0.0, r2);
      float core = pow(disc, 3.0);

      // Faint four-point diffraction spikes on the brightest stars.
      float dist = sqrt(r2);
      float spikes = 0.0;
      if (vSpike > 0.01) {
        vec2 ad = abs(d);
        float cross = max(
          smoothstep(0.035, 0.0, ad.x) * smoothstep(0.5, 0.0, ad.y),
          smoothstep(0.035, 0.0, ad.y) * smoothstep(0.5, 0.0, ad.x));
        spikes = cross * vSpike * 0.55;
      }

      // The star's own spectral colour, warmed slightly toward the core
      // of the galaxy so the bulge still reads amber overall.
      vec3 col = mix(vColor, uCore, (1.0 - smoothstep(0.0, 0.22, vRadius)) * 0.88);

      // Wide soft halo + tight core: the halos of many faint stars
      // overlap into the disc's diffuse glow, while bright stars still
      // resolve as points. Bright stars get a stronger halo, which is
      // the bloom that separates them from the field in a real photo.
      float halo = pow(disc, 0.65);
      float a = vAlpha * (halo * (0.22 + vBright * 0.24) +
                          disc * 0.34 + core * 0.72 + spikes);

      // Bright cores saturate toward white, the way an overexposed star
      // does — only the halo keeps the star's spectral colour.
      col = mix(col, vec3(1.0), core * vBright * 0.18);
      gl_FragColor = vec4(col * (0.82 + core * 0.55), a);
    }
  `);

  if (!starProg) return;

  /* ============================================================
     STAR FIELD
     Home positions live in polar form so rotation is a single add,
     and the spiral shape is preserved no matter how far a star is
     displaced by the cursor.
     ============================================================ */
  const N = config.STAR_COUNT;

  const radius   = new Float32Array(N);   // 0..1 on the disc
  const angle    = new Float32Array(N);   // current home angle
  const height   = new Float32Array(N);   // z offset (disc thickness)
  const seed     = new Float32Array(N);   // per-star motion variation
  const lum      = new Float32Array(N);   // luminosity from the spectral class
  // Which population a star belongs to (0 bulge, 1 arm, 2 spur,
  // 3 inter-arm, 4 nucleus). Needed in simulate(): only disc stars
  // spiral inward — the nucleus and bulge hold their radii.
  const popArr   = new Uint8Array(N);
  const life     = new Float32Array(N);   // 0..1 lifecycle position
  const lifeRate = new Float32Array(N);   // how fast this star ages

  // Displacement from the home position, plus its velocity.
  const offX = new Float32Array(N), offY = new Float32Array(N), offZ = new Float32Array(N);
  const velX = new Float32Array(N), velY = new Float32Array(N), velZ = new Float32Array(N);

  // Per-star appearance, written once at spawn: rgb + size multiplier.
  // Only re-uploaded when a star is recycled, not every frame.
  const tintArr = new Float32Array(N * 4);
  let tintDirty = true, lumDirty = true;

  // Interleaved buffers uploaded each frame.
  const posArr  = new Float32Array(N * 3);
  const attrArr = new Float32Array(N * 3);

  // Hue pools, each ordered faint -> bright. Sampling hue and
  // brightness independently is what keeps both colours visible;
  // a single brightness-ordered list let the blue end take the image.
  const WARM_TYPES = ['deep red', 'amber dim', 'ember', 'cream', 'rose',
                      'amber', 'pale gold', 'gold', 'amber bright',
                      'anchor warm']
    .map(k => STAR_TYPES.find(t => t.k === k));
  const COOL_TYPES = ['mint', 'teal', 'blue dim', 'ice blue', 'violet',
                      'blue-white', 'hot blue', 'anchor cool']
    .map(k => STAR_TYPES.find(t => t.k === k));

  function pickType(r, inBulge, inArm, ang) {
    // Hot blue stars are short-lived, so they never travel far from the
    // arms where they formed — which is why real spiral arms read bluer
    // than the red inter-arm disc. Blending toward a biased roll
    // (rather than scaling it) keeps every class present everywhere,
    // just in different proportions.
    // Probability this star is a COOL one. Hue is chosen separately
    // from brightness, so neither colour can dominate the light.
    let coolChance;
    if (inBulge) {
      coolChance = 0.12;                 // old bulge: strongly warm
    } else if (inArm) {
      // Arms skew blue (young stars), but band along their length —
      // a low-frequency wave shifts the local mix warm or cool, so the
      // arms clump into colour patches instead of an even blend.
      const band = Math.sin(ang * 2.7 + r * 9.0) * 0.5 + 0.5;
      coolChance = 0.34 + band * 0.44;
    } else {
      coolChance = 0.30;                 // inter-arm disc: warmer
    }

    const cool = Math.random() < coolChance;
    const pool = cool ? COOL_TYPES : WARM_TYPES;

    // Brightness within the chosen hue: mostly faint, with a tail.
    const u = Math.random();
    const idx = Math.min(pool.length - 1, Math.floor(Math.pow(u, 2.1) * pool.length));
    return pool[idx];
  }

  // Gaussian-ish sample in [-1, 1], concentrated at 0.
  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  }

  // Angular offset of the arm ridge at radius r, for a given arm.
  // Measured from ARM_START rather than r=0: in a real spiral the arms
  // begin at the bulge's edge, and winding them all the way to the
  // centre coils them into a tight knot that reads as a hard "S".
  function armRidge(r, arm) {
    // Plain log with a smooth floor. The softplus this replaces called
    // exp() as well, and armRidge now runs per star per frame (radius
    // changes as stars fall inward, so it cannot be cached) — that cost
    // 25.6ms/frame against a 16.7ms budget. This is ~2.5x faster and
    // differs only by a constant phase shift, which is invisible
    // because every star uses the same curve.
    const x = r > config.ARM_FLOOR ? r : config.ARM_FLOOR;
    return (arm / config.ARMS) * Math.PI * 2 +
           Math.log(x / config.ARM_START + 0.30) * config.ARM_TIGHTNESS;
  }


  /* Populations, following real Sc-type structure:
       BULGE  — old, red, spheroidal, centrally concentrated
       ARM    — young and blue, hugging the ridge, with HII knots
       SPUR   — "feathers" branching off arms at a shallow angle
       DISC   — smooth exponential inter-arm population, older and redder
     Dust lanes are carved on the concave (inner) edge of each arm,
     where gas piles up and star formation happens just outside them. */
  function spawnStar(i, freshLife) {
    const roll = Math.random();
    const B = config.BULGE_FRACTION, NU = config.NUCLEUS_FRACTION;
    let pop;
    if (roll < NU) pop = 4;                          // nucleus
    else if (roll < NU + B) pop = 0;                 // bulge
    else if (roll < NU + B + config.INTERARM) pop = 3;
    else if (roll < NU + B + config.INTERARM + config.SPUR_FRACTION) pop = 2;
    else pop = 1;

    let r, ang, thickness, hii = 0;

    if (pop === 4) {
      // ── Nucleus: a small sun ──
      // Cube-root of a uniform sample fills a SPHERE evenly; a plain
      // power law would crowd everything at the centre and leave the
      // edge ragged. The result reads as a solid glowing body rather
      // than a cluster of separate points.
      r = Math.cbrt(Math.random()) * config.NUCLEUS_RADIUS + 0.002;
      ang = Math.random() * Math.PI * 2;
      thickness = 4.2;                 // spherical, not disc-like
    } else if (pop === 0) {
      // ── Bulge: de Vaucouleurs-ish, steeply concentrated ──
      r = Math.pow(Math.random(), 3.1) * config.BULGE_RADIUS + 0.010;
      ang = Math.random() * Math.PI * 2;
      thickness = 2.8;
    } else {
      // ── Disc: exponential surface brightness (inverse-CDF sample) ──
      // Rejection-free approximation: r = -Rd * ln(1 - u * (1 - e^-k))
      if (freshLife) {
        // Recycled: re-enters at the rim to replace what fell inward.
        r = config.RIM_LO + Math.random() * (config.DISC_RADIUS - config.RIM_LO);
      } else {
        // Initial build: sample the full exponential profile.
        const k = config.DISC_RADIUS / config.DISC_SCALE;
        const u = Math.random();
        r = -config.DISC_SCALE * Math.log(1 - u * (1 - Math.exp(-k)));
      }
      if (r > config.DISC_RADIUS) r = config.DISC_RADIUS;
      // The disc starts outside the bulge; the inner hole is filled by
      // the bulge population, not by arms coiling into the centre.
      // Re-sampled across a band (not clamped) — clamping stacks every
      // rejected star on one radius and draws a bright hard crescent.
      if (r < config.ARM_START) {
        r = config.ARM_START * (0.55 + Math.random() * 0.75);
      }

      const arm = Math.floor(Math.random() * config.ARMS);
      const ridge = armRidge(r, arm);

      if (pop === 3) {
        // Inter-arm: fills the gap, but still falls off away from the
        // arms — a real disc is smooth, not uniformly random, so a flat
        // spread here reads as scattered noise over the structure.
        const gap = Math.PI * 2 / config.ARMS;
        ang = ridge + gauss() * gap * 0.42;
        thickness = 1.0;
      } else if (pop === 2) {
        // ── Feathers/spurs: short filaments peeling off the arm's
        //    trailing side at a shallow angle, a few per arm ──
        const along = Math.random();                 // position along the spur
        const spurIdx = Math.floor(Math.random() * config.SPURS_PER_ARM);
        // Anchor the spur at a repeatable point on the arm.
        const anchorR = config.ARM_MIN + 0.06 +
              (spurIdx / config.SPURS_PER_ARM) * (config.DISC_RADIUS - config.ARM_MIN - 0.18);
        const anchor = armRidge(anchorR, arm);
        r = anchorR + along * config.SPUR_LENGTH * (0.6 + Math.random() * 0.8);
        if (r > config.DISC_RADIUS) r = config.DISC_RADIUS;
        // Peels away from the ridge as it extends outward.
        ang = anchor + along * config.SPUR_PITCH + gauss() * 0.05;
        thickness = 0.8;
      } else {
        // ── Arm: tight Gaussian around the ridge ──
        // Arm density tapers in rather than starting at a hard radius.
        // A hard cut either stacks stars into bright blobs at the roots
        // (cut too low) or detaches the arms from the disc (too high);
        // a rejection probability rising over ARM_FADE gives a smooth
        // onset. A star that fails the test joins the inter-arm disc
        // instead, so the inner disc stays populated.
        const armProb = smooth01((r - config.ARM_MIN) / config.ARM_FADE);
        if (Math.random() > armProb) {
          pop = 3;
          const gapA = Math.PI * 2 / config.ARMS;
          ang = ridge + gauss() * gapA * 0.42;
          thickness = 1.0;
        } else {
          // Bias to the convex (outer) side: the concave side is where
          // the dust lane sits, so fewer stars show through there.
          const w = config.ARM_SPREAD * (0.55 + r * 0.75);
          let off = gauss() * w + config.ARM_BIAS * w;

          // Carve the dust lane on the arm's concave edge — the dark
          // dividing line that makes a spiral arm recognisable.
          const laneCentre = -config.ARM_BIAS * w - config.DUST_OFFSET * w;
          if (Math.abs(off - laneCentre) < config.DUST_WIDTH * w &&
              Math.random() < config.DUST_OPACITY) {
            // Nudge out of the lane rather than discarding the slot.
            off += (off > laneCentre ? 1 : -1) * config.DUST_WIDTH * w * 1.4;
          }

          ang = armRidge(r, arm) + off;
          thickness = 0.55;             // arms are the thinnest population

          // HII regions: bright star-forming knots just outside the
          // dust lane, on the arm's leading edge. Clumped, not uniform.
          if (Math.random() < config.HII_RATE) {
            hii = 1;
            // Pick the knot's radius FIRST — the ridge angle depends on
            // it, so setting r afterwards would place the knot off-arm.
            const knot = Math.floor(Math.random() * config.HII_KNOTS);
            r = config.ARM_MIN + (knot / config.HII_KNOTS) *
                (config.DISC_RADIUS - config.ARM_MIN) + gauss() * 0.020;
            const kw = config.ARM_SPREAD * (0.55 + r * 0.75);
            const kLane = -config.ARM_BIAS * kw - config.DUST_OFFSET * kw;
            ang = armRidge(r, arm) + kLane + config.DUST_WIDTH * kw * 2.0 +
                  gauss() * 0.030;
          }
        }
      }
    }

    radius[i] = r;
    popArr[i] = pop;
    // Store the offset FROM the arm, not the absolute angle: the arm's
    // angle depends on radius, so a star that spirals inward rebuilds
    // its position from this offset plus the arm's current angle.
    angle[i]  = (pop === 4 || pop === 0) ? ang : ang - armRidge(r, 0);
    // Disc thins outward; bulge is puffy. Arms are thinnest of all.
    height[i] = gauss() * config.THICKNESS * thickness * (1.0 - r * 0.45);
    seed[i]   = Math.random();          // motion variation, independent of class

    // ── Spectral class ──
    let type;
    if (hii) {
      // Star-forming knots are dominated by hot young blue stars.
      type = COOL_TYPES[Math.random() < 0.6 ? 2 : 1];
    } else {
      type = pickType(r, pop === 0 || pop === 4, pop === 1, ang);
    }

    const vary = 0.88 + Math.random() * 0.24;
    const t4 = i * 4;
    if (hii) {
      // HII regions glow pink-magenta: hot blue stars lighting up
      // hydrogen gas. This is the signature colour of a spiral's arms.
      tintArr[t4]     = 1.00;
      tintArr[t4 + 1] = 0.42;
      tintArr[t4 + 2] = 0.62;
      tintArr[t4 + 3] = type.s * vary * 1.35;
      lum[i] = type.l * 1.25 * (0.85 + Math.random() * 0.3);
    } else if (pop === 4) {
      // A small sun: white-hot at the centre, warming to gold at the
      // limb, so the ball has a photosphere edge rather than a flat
      // uniform disc.
      const edge = r / config.NUCLEUS_RADIUS;    // 0 centre .. 1 limb
      tintArr[t4]     = 1.00;
      tintArr[t4 + 1] = 0.99 - edge * 0.20;
      tintArr[t4 + 2] = 0.96 - edge * 0.46;
      tintArr[t4 + 3] = (1.05 - edge * 0.28) * vary;
      lum[i] = (4.2 - edge * 1.5) + Math.random() * 1.2;
    } else {
      tintArr[t4]     = type.c[0];
      tintArr[t4 + 1] = type.c[1];
      tintArr[t4 + 2] = type.c[2];
      tintArr[t4 + 3] = type.s * vary;
      lum[i] = type.l * (0.82 + Math.random() * 0.36);
    }
    tintDirty = lumDirty = true;

    // Lifecycle: fresh stars start at 0 (fading in at the rim). On first
    // build we scatter it so the disc is already populated mid-cycle.
    life[i]     = freshLife ? 0 : Math.random();
    // Long lives (roughly 20-45s), so turnover is a slow shimmer rather
    // than a visible churn of stars appearing and vanishing.
    lifeRate[i] = 0.022 + Math.random() * 0.028;

    offX[i] = offY[i] = offZ[i] = 0;
    velX[i] = velY[i] = velZ[i] = 0;
  }

  for (let i = 0; i < N; i++) spawnStar(i, false);

  /* ============================================================
     MATRIX HELPERS (3x3, column-major)
     ============================================================ */
  function rotX(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return new Float32Array([1, 0, 0, 0, c, s, 0, -s, c]);
  }

  function rotY(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]);
  }

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

  /* ============================================================
     RESIZE
     ============================================================ */
  const CAM_DIST = 3.0;
  let dpr = 1, aspect = 1, pointScale = 1, scale = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return false;

    // Derived values refresh on every call — the canvas may already
    // carry the right dimensions while these still hold defaults.
    aspect = w / h;

    // Size the disc so its rim reaches FILL of the viewport half-height.
    // The disc is centred at model z≈0, so a rim point projects to
    // r * scale / CAM_DIST; the tilt compresses that vertically by
    // cos(TILT), which has to be divided back out or the galaxy ends up
    // a fraction of its intended size.
    const FILL = 0.92;
    const vertical = Math.max(Math.cos(config.TILT), 0.25);

    // A tilted disc is wider on screen than it is tall, so width is the
    // binding constraint on portrait viewports. Solve both limits in NDC
    // and take whichever scale is smaller.
    const scaleForHeight = FILL * CAM_DIST / (config.DISC_RADIUS * vertical);
    const scaleForWidth  = FILL * CAM_DIST * aspect / config.DISC_RADIUS;
    scale = Math.min(scaleForHeight, scaleForWidth);
    pointScale = config.POINT_SIZE * dpr * Math.min(1.5, Math.max(0.7, h / 900));

    // Republish on resize: scale and aspect both feed the projection,
    // so a resize moves the nucleus even when the drift has not changed.
    lastPublishedDrift = NaN;

    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }

  /* ============================================================
     POINTER
     The cursor is projected onto the disc plane so the push is
     applied in the same space the stars live in.
     ============================================================ */
  const hero = canvas.closest('section') || canvas.parentElement;
  let pointerActive = false;
  let pointerX = 0, pointerY = 0;      // NDC-ish, -1..1, latest sample
  let prevPointerX = 0, prevPointerY = 0;

  function setPointer(clientX, clientY) {
    const r = hero.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    if (!pointerActive) {
      // First sample after entering: no phantom sweep from the old spot.
      pointerX = prevPointerX = nx;
      pointerY = prevPointerY = ny;
    } else {
      pointerX = nx;
      pointerY = ny;
    }
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
     ANIMATION STATE
     Declared before the observers, which may fire during setup.
     ============================================================ */
  // Horizontal offset of the whole disc, driven by page scroll. The
  // galaxy slides sideways like a camera pan; it never rotates.
  // The spiral pattern's own rotation. It turns rigidly and slowly,
  // independent of the stars, so the arms never wind up.
  let patternAngle = 0;
  let driftX = 0;
  let lastPublishedDrift = NaN;   // forces the first publish

  // How much the core swallowed this frame, and the smoothed glow that
  // follows it. The ball brightens as it feeds rather than pulsing on a
  // fixed timer, so the centre reacts to the stars falling into it.
  let swallowFeed = 0;
  let coreGlow = 0;
  let lastPublishedGlow = NaN;
  let scrollProgress = 0;     // 0 at the top, 1 once the hero is passed
  let lastTime = performance.now();
  let running = false;
  let visible = true;

  function wake() {
    if (running || document.hidden || !visible) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  // Watch the canvas, not the hero section. The canvas is fixed, so it
  // stays on screen after #hero scrolls past — observing #hero would
  // pause the loop while the galaxy is still visible behind the page.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      wake();
    }, { threshold: 0 }).observe(canvas);
  }
  document.addEventListener('visibilitychange', wake);

  /* ============================================================
     SIMULATION
     ============================================================ */
  const posBuffer = gl.createBuffer();
  const attrBuffer = gl.createBuffer();
  const tintBuffer = gl.createBuffer();
  const lumBuffer = gl.createBuffer();

  // The cursor's swept segment on the disc plane, in the stars' own
  // (unspun) frame: A = previous sample, B = current.
  let wakeAx = 0, wakeAy = 0, wakeBx = 0, wakeBy = 0;
  let wakeDirX = 0, wakeDirY = 0;   // unit direction of travel
  let wakeSpeed = 0;                // disc units per second
  let wakeEnergy = 0;               // decays after the cursor stops

  // Projects a screen point onto the disc plane, in the stars' home frame.
  function unprojectToDisc(px, py, out) {
    const w = CAM_DIST;                     // plane sits at model z≈0
    const worldX = px * aspect * w / scale;
    const worldY = py * w / scale;
    // The disc orientation is fixed, so undoing the tilt is enough to
    // land in the stars' own frame; the scroll drift is subtracted
    // because it offsets the disc on screen without rotating it.
    const ct = Math.cos(config.TILT);
    out[0] = worldX - driftX;
    out[1] = worldY / (ct || 1e-3);
  }

  const _a = [0, 0], _b = [0, 0];

  function updateWake(dt) {
    if (pointerActive) {
      unprojectToDisc(prevPointerX, prevPointerY, _a);
      unprojectToDisc(pointerX, pointerY, _b);
      wakeAx = _a[0]; wakeAy = _a[1];
      wakeBx = _b[0]; wakeBy = _b[1];

      const dx = wakeBx - wakeAx, dy = wakeBy - wakeAy;
      const len = Math.hypot(dx, dy);
      if (len > 1e-5 && dt > 0) {
        wakeDirX = dx / len;
        wakeDirY = dy / len;
        // Speed feeds the impulse, so a flick stirs harder than a crawl.
        wakeSpeed = len / dt;
        // Energy ramps up quickly but never instantly, which is what
        // removes the old version's on/off snap.
        const target = Math.min(1, wakeSpeed / 1.6);
        wakeEnergy += (target - wakeEnergy) * Math.min(1, dt * 9);
      }
      // Consume the sample; if the mouse stops, A and B converge and the
      // segment naturally shrinks to a point as the energy decays.
      prevPointerX = pointerX;
      prevPointerY = pointerY;
    }

    // Always decay — when the cursor stops or leaves, the stirring eases
    // out over ~0.4s instead of cutting off.
    wakeEnergy -= wakeEnergy * Math.min(1, config.WAKE_DECAY * dt);
    if (wakeEnergy < 0.002) wakeEnergy = 0;
  }

  function simulate(dt) {
    swallowFeed = 0;
    const pr2 = config.PUSH_RADIUS * config.PUSH_RADIUS;
    const maxOff2 = config.MAX_OFFSET * config.MAX_OFFSET;
    const spring = config.RETURN_SPRING;
    const damp = config.RETURN_DAMPING;

    for (let i = 0; i < N; i++) {
      // ── Lifecycle: spiral inward, vanish, return at the rim ──
      // Disc stars drift steadily toward the centre and are recycled
      // OUT AT THE RIM, not redistributed across the whole disc. That
      // distinction matters: an earlier version re-sampled the full
      // profile on respawn, so infall drained the outer disc (8.3% ->
      // 0.9% of stars in a minute) and the arms collapsed into a blob.
      // Feeding recycled stars back in at the rim balances the inflow
      // and the profile reaches a stable steady state.
      life[i] += lifeRate[i] * dt;

      if (popArr[i] !== 4 && popArr[i] !== 0) {
        radius[i] -= config.INFALL * dt * (0.35 + radius[i] * 0.85);
      }

      if (life[i] >= 1 || radius[i] <= config.CORE_RADIUS) {
        spawnStar(i, true);
      }

      const r = radius[i];

      // ── Position on the spiral ──
      // angle[] holds the star's OFFSET from its arm, not an absolute
      // angle. The arm's own angle is a function of radius, so a star
      // spiralling inward has to swing with it (about 30 degrees per
      // step inward at this pitch). Storing an absolute angle instead
      // drags falling stars off their arm along a straight radial line,
      // which is what tore the spiral apart.
      const armA = (popArr[i] === 4 || popArr[i] === 0)
        ? 0                                   // nucleus/bulge: no arm
        : armRidge(r, 0);
      const a = armA + angle[i] + patternAngle;

      const hx = Math.cos(a) * r;
      const hy = Math.sin(a) * r;

      // ── Cursor wake: distance to the swept segment, not a point ──
      if (wakeEnergy > 0) {
        const sx = hx + offX[i], sy = hy + offY[i];
        // Closest point on segment A→B.
        const abx = wakeBx - wakeAx, aby = wakeBy - wakeAy;
        const abLen2 = abx * abx + aby * aby;
        let t = 0;
        if (abLen2 > 1e-9) {
          t = ((sx - wakeAx) * abx + (sy - wakeAy) * aby) / abLen2;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
        }
        const cxp = wakeAx + abx * t, cyp = wakeAy + aby * t;
        const dx = sx - cxp, dy = sy - cyp;
        const d2 = dx * dx + dy * dy;

        if (d2 < pr2) {
          const d = Math.sqrt(d2) || 1e-6;
          // Smooth cubic falloff — no hard edge at the radius.
          const q = 1 - d / config.PUSH_RADIUS;
          const fall = q * q * (3 - 2 * q);
          const imp = config.PUSH_STRENGTH * fall * wakeEnergy * dt * 60;

          // Displace outward from the cursor's path...
          const outX = dx / d, outY = dy / d;
          // ...and carry the star along the direction of travel, which
          // is what makes a sweep feel like it drags the disc with it.
          const sw = config.SWIRL;
          velX[i] += (outX * (1 - sw) + wakeDirX * sw) * imp;
          velY[i] += (outY * (1 - sw) + wakeDirY * sw) * imp;
          // A little lift out of the disc plane adds volume to the wake.
          velZ[i] += (seed[i] - 0.5) * imp * 0.35;
        }
      }

      // ── Spring back to the home position ──
      velX[i] += (-spring * offX[i] - damp * velX[i]) * dt;
      velY[i] += (-spring * offY[i] - damp * velY[i]) * dt;
      velZ[i] += (-spring * offZ[i] - damp * velZ[i]) * dt;

      offX[i] += velX[i] * dt;
      offY[i] += velY[i] * dt;
      offZ[i] += velZ[i] * dt;

      // Clamp the displacement so a fast flick stirs the disc without
      // throwing stars clear of it; bleed the velocity at the limit so
      // they don't stick to the boundary.
      const om2 = offX[i] * offX[i] + offY[i] * offY[i];
      if (om2 > maxOff2) {
        const om = Math.sqrt(om2);
        const k = config.MAX_OFFSET / om;
        offX[i] *= k; offY[i] *= k;
        velX[i] *= 0.5; velY[i] *= 0.5;
      }

      // Keep every star at a fixed luminosity. The former lifecycle
      // fade and core flare made the field look as though it blinked.
      const alpha = 1;

      const o = i * 3;
      posArr[o]     = hx + offX[i];
      posArr[o + 1] = hy + offY[i];
      posArr[o + 2] = height[i] + offZ[i];

      attrArr[o]     = r;
      attrArr[o + 1] = seed[i];
      attrArr[o + 2] = alpha;
    }
  }

  function smooth01(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  /* ============================================================
     DRAW
     ============================================================ */
  function draw(time, rot) {
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(starProg.p);

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(starProg.a.aPos);
    gl.vertexAttribPointer(starProg.a.aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, attrBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, attrArr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(starProg.a.aAttr);
    gl.vertexAttribPointer(starProg.a.aAttr, 3, gl.FLOAT, false, 0, 0);

    // Spectral colour + size: written once at spawn, so this uploads
    // only when a star has been recycled.
    gl.bindBuffer(gl.ARRAY_BUFFER, tintBuffer);
    if (tintDirty) {
      gl.bufferData(gl.ARRAY_BUFFER, tintArr, gl.DYNAMIC_DRAW);
      tintDirty = false;
    }
    gl.enableVertexAttribArray(starProg.a.aTint);
    gl.vertexAttribPointer(starProg.a.aTint, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, lumBuffer);
    if (lumDirty) {
      gl.bufferData(gl.ARRAY_BUFFER, lum, gl.DYNAMIC_DRAW);
      lumDirty = false;
    }
    gl.enableVertexAttribArray(starProg.a.aLum);
    gl.vertexAttribPointer(starProg.a.aLum, 1, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix3fv(starProg.u.uRot, false, rot);
    gl.uniform1f(starProg.u.uCamDist, CAM_DIST);
    gl.uniform1f(starProg.u.uScale, scale);
    gl.uniform1f(starProg.u.uAspect, aspect);
    gl.uniform1f(starProg.u.uPointScale, pointScale);
    gl.uniform1f(starProg.u.uDrift, driftX);

    // Publish where the nucleus actually lands on screen, so the CSS
    // bloom can sit exactly on it. Duplicating this projection in CSS
    // let the two drift apart and the centre read as two glows.
    if (driftX !== lastPublishedDrift) {
      lastPublishedDrift = driftX;
      const ndcX = (driftX * scale / CAM_DIST) / aspect;
      document.documentElement.style.setProperty(
        '--nucleus-x', (ndcX * 50).toFixed(3) + 'vw');
    }

    // Publish the feeding glow so the CSS corona swells with it.
    const gq = Math.round(coreGlow * 50) / 50;      // quantised: avoids
    if (gq !== lastPublishedGlow) {                 // a write every frame
      lastPublishedGlow = gq;
      document.documentElement.style.setProperty('--core-glow', gq.toFixed(2));
    }
    gl.uniform3fv(starProg.u.uCore, CORE_TINT);

    gl.drawArrays(gl.POINTS, 0, N);
  }

  // The disc's orientation is FIXED. Stars circulate inside the plane
  // via their own angle, so the galaxy never tumbles toward edge-on or
  // face-on — only a horizontal drift offsets it while scrolling.
  const DISC_ROT = rotX(config.TILT);

  function currentRot() {
    return DISC_ROT;
  }

  /* ============================================================
     SCROLL DRIFT
     Scrolling past the hero pans the whole disc sideways, clearing
     the centre so the intro content can take the stage.
     ============================================================ */
  let targetDrift = 0;

  function readScroll() {
    const h = window.innerHeight || 1;
    // 0 while at the top, reaching 1 after one viewport of scrolling —
    // the pan completes as the intro panel takes the screen, then holds.
    scrollProgress = Math.min(1, Math.max(0, window.scrollY / h));
    // Ease-out so the galaxy leads the scroll, then settles.
    const eased = 1 - Math.pow(1 - scrollProgress, 2);
    targetDrift = eased * config.SCROLL_DRIFT;
  }

  function updateDrift(dt) {
    // Ease toward the scroll target so flicks of the wheel glide.
    driftX += (targetDrift - driftX) * Math.min(1, dt * 4.5);
  }

  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', readScroll, { passive: true });
  readScroll();

  // Paint one frame regardless of visibility, so a tab that loads in the
  // background isn't blank the moment it's brought forward.
  function paintOnce() {
    resize();
    simulate(0);
    draw(performance.now() / 1000, currentRot());
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
      // Static galaxy: no orbital motion or wake. Still
      // tracks scroll drift, which is a deliberate navigation cue
      // rather than decorative animation.
      updateDrift(dt);
      draw(0, currentRot());
      requestAnimationFrame(frame);
      return;
    }

    patternAngle += config.PATTERN_SPEED * dt;
    updateDrift(dt);
    updateWake(dt);
    simulate(dt);

    // Ease toward what the core just ate. Rising faster than it falls
    // gives a flare-then-settle response, the way something actually
    // brightens when it is fed.
    const feed = Math.min(1, Math.max(0,
      (swallowFeed - config.SWALLOW_BASE) /
      (config.SWALLOW_PEAK - config.SWALLOW_BASE)));
    const rate = feed > coreGlow ? 5.0 : 1.4;
    coreGlow += (feed - coreGlow) * Math.min(1, dt * rate);
    draw(now / 1000, currentRot());

    requestAnimationFrame(frame);
  }

  paintOnce();
  wake();
})();
