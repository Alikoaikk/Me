/* ============================================================
   THE KOAIK SYSTEM — the destination, and the portfolio as space
   ------------------------------------------------------------
   The warp lands the reader beside Koaik: a MINI black hole, its
   shadow ringed by a hot accretion disk and the far side of that disk
   lensed over and under it. The camera pulls back and Koaik turns out
   to be the heart of a system: every finished project is a living
   model of itself (emblems.js) on its own orbit around it. The reader
   can move through the system — drag to orbit, scroll or pinch to
   zoom, arrow keys / WASD to fly — hover a project for its name, and
   click or tap one to fly to it and open its panel (hud.js).
   Clicking Koaik COLLAPSES the system: every project spirals in and is
   swallowed, then the whole sky falls in after them, the hole implodes
   and flashes, and the reader is taken to the next page (beyond.html). The pilot's card opens from the
   chip in the corner (select('pilot')).

   three.js (vendored, js/vendor/three) does the scene, the camera,
   the controls and the picking. Nothing is an image file: the hole
   and its disk are shaders (simplex noise), the projects are built
   geometry and canvases. The galaxy canvas stays fixed underneath as
   the sky: this canvas is transparent, except for the hole's shadow.

   Entry points for the launch sequence (warp.js):
     window.koaik.arm()     hold Koaik at scale 0, unseen; bake
     window.koaik.reveal()  grow it in from a point over REVEAL_MS,
                            then pull back into the system
   (Not window.planet: <section id="planet"> already IS window.planet
   by named access, so a failed module would leave an element there.)
   Publishes --planet-in (0..1) for the arrival caption, adds
   .is-system to the section once the reader has the controls, and
   dispatches system:ready / system:select / system:hover events on
   the section for hud.js. window.system is the debug/test surface.
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeEmblem } from './emblems.js';

(function main() {
  'use strict';

  const section = document.getElementById('planet');
  const canvas = document.getElementById('planetCanvas');
  const labelsEl = document.getElementById('sysLabels');
  const mapEl = document.getElementById('sysMap');
  if (!section || !canvas) return;

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const data = window.portfolioData || {};
  const projects = Array.isArray(data.projects) ? data.projects : [];

  const config = {
    /* Koaik: a MINI black hole, smaller than the projects around it. */
    BH_R:       0.20,                   // the shadow's radius, world units
    BH_DISK_IN: 1.45,                   // accretion disk, in shadow radii
    BH_DISK_OUT: 4.3,
    LENS_K:     2.6,                    // the orbits' Einstein radius, in shadow radii
    ORBIT_WIDTH: 5.0,                   // the orbit ribbon's glow, CSS px across
    MIN_NEAR:   0.35,                   // closest the camera may get to anything, world units

    /* The camera. */
    FOV:        45,                     // degrees
    FILL:       0.72,                   // arrival: the disk's diameter / limiting viewport dimension
    ARRIVE_EL:  13 * Math.PI / 180,     // arrival: just above the disk, so it reads as a disk
    REVEAL_MS:  2000,
    PULLBACK_DELAY_MS: 450,             // after the reveal: a beat on the world alone
    PULLBACK_MS: 3400,                  // the swoop out to the overview
    ELEVATION:  32 * Math.PI / 180,     // overview: camera above the orbital plane
    ELEVATION_PORTRAIT: 52 * Math.PI / 180,
    AZIMUTH:   -18 * Math.PI / 180,
    FIT:        1.12,                   // overview: outer orbit × this fits the view width
    /* Interactive moves (a planet, the pilot, home) are not tweens but
       critically damped springs chasing a goal that may itself move
       (an orbiting planet): they respond on the first frame, never
       overshoot, can be re-aimed mid-flight without a stop, and land
       without a snap. Each is a smooth time in seconds: ~90 % of the
       way in 2× it, ~98 % in 3×. */
    RIG_TARGET: 0.38,                   // where the camera looks
    RIG_RADIUS: 0.50,                   // how far it is (in log space, so zooming feels even)
    RIG_ANGLE:  0.44,                   // which side it looks from
    RIG_CARD_AT: 0.75,                  // open the card at this fraction of the way
    FRAME_SHIFT: 0.34,                  // smooth time of the re-framing when the card opens / closes
    FOCUS_DIST: 5.0,                    // planet view: distance in planet radii
    FOCUS_DIST_SUN: 7.5,                // in Koaik's `radius` (the lensed arc), so the whole disk fits
    FOCUS_FILL_PORTRAIT: 0.62,          // planet view on a tall screen: body diameter / screen width, at most
    SUNWARD:    0.55,                   // planet view: how far toward the lit side the camera swings
    LET_GO:     14,                     // zooming out past this many radii releases a focused planet
    MIN_DIST:   1.6,                    // zoom limits, in the focused body's radii
    MAX_DIST:   80,                     // must clear the portrait overview (~68 at ORBIT_STEP 1.3)
    FLY_SPEED:  0.9,                    // keyboard flight, in (distance to target) per second
    FLY_BOOST:  3.0,                    // with Shift
    FLY_DAMP:   5.0,
    IDLE_MS:    7000,                   // untouched this long at the overview: the view drifts
    DRIFT:      0.22,                   // that drift, in OrbitControls autoRotate units (2 = one turn per 30 s)

    /* The orbits. */
    ORBIT_0:    2.5,                    // innermost radius
    ORBIT_STEP: 1.3,                    // gap between neighbouring orbits
    EMBLEM_R:   0.55,                   // a project's size (radius of its solid parts), world units
    EMBLEM_SPIN: 0.14,                  // rad/s, its slow turn when not selected
    EMBLEM_FACE: 3.0,                   // how briskly a selected project turns to face the reader
    DETAIL_PX:  26,                     // below this on-screen radius, skip canvas redraws
    PERIOD_0:   48,                     // seconds for the innermost; Kepler (r^1.5) beyond


    /* The collapse (click Koaik), one way: every project spirals in,
       is stretched and swallowed, inner first; then the whole sky
       (galaxy.js) falls in; the hole implodes and flashes, the screen
       goes black, and the reader is taken to NEXT_PAGE. Seconds. */
    FALL_START: 0.15,                   // first project starts falling
    FALL_STAGGER: 0.11,                 // next one this much later
    FALL_DUR:   1.5,                    // one project's fall (+0.07 per orbit out)
    SKY_DELAY:  0.1,                    // after the last project is in, the sky starts to go
    SKY_DUR:    2.8,                    // the whole sky falls in
    IMPLODE:    0.55,                   // the hole shrinks to a point (ends as the sky is gone), then the flash
    TO_BLACK:   0.6,                    // flash → black
    LEAVE_HOLD: 0.25,                   // a beat of black, then the new page
    SWIRL_MAX:  14,                     // rad/s cap on the extra spin of a falling project
    NEXT_PAGE:  'beyond.html',
  };

  /* ── Shaders ── */

  /* 3D simplex noise — Ian McEwan / Ashima Arts, MIT. */
  const NOISE = `
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
                 i.z + vec4(0.0, i1.z, i2.z, 1.0))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0))
               + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0) * 2.0 + 1.0;
      vec4 s1 = floor(b1) * 2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
    }`;

  /* ── Koaik, the black hole ──
     Four parts, all in units of the shadow's radius (the group is
     scaled to BH_R): the SHADOW, an opaque black disc facing the
     camera that writes depth through the centre, so the near half of
     the disk passes in front of it and the far half and anything
     behind are swallowed; the DISK, a flat ring in the orbital plane,
     hot and streaked, differential rotation, brighter on the side
     coming toward the reader; the GLOW, a camera-facing quad with the
     photon ring, the far side of the disk lensed over and under the
     shadow (along the screen direction of the disk's axis) and a soft
     halo — plus the collapse flash; and the SHOCK, a ring in the
     orbital plane the size of the system, for the collapse. */
  const DISK_VS = `
    varying vec2 vQ;
    varying vec3 vVel, vP;
    void main() {
      vQ = position.xy;                           // ring geometry lies in xy before the mesh's -90° tilt
      vec3 tang = normalize(vec3(-position.y, position.x, 0.0));
      vVel = normalize(normalMatrix * tang);      // orbital velocity, view space
      vec4 p = modelViewMatrix * vec4(position, 1.0);
      vP = p.xyz;
      gl_Position = projectionMatrix * p;
    }`;
  const DISK_FS = `
    precision highp float;
    uniform float uTime, uFeed, uIn, uOut, uFade;
    varying vec2 vQ;
    varying vec3 vVel, vP;
    ${NOISE}
    /* Keplerian shear winds any pattern tighter forever; two copies
       half a period apart are cross-faded so it never over-winds. */
    float swirl(float r, float th, float t) {
      float a = th + t * 2.4 * pow(uIn / r, 1.5);
      vec2 c = vec2(cos(a), sin(a)) * r;
      return 0.6 * snoise(vec3(c * 2.2, 1.7)) + 0.4 * snoise(vec3(c * 6.0, 5.3));
    }
    void main() {
      float r = length(vQ), th = atan(vQ.y, vQ.x);
      float rn = clamp((r - uIn) / (uOut - uIn), 0.0, 1.0);
      const float T = 14.0;
      float t1 = mod(uTime, T), t2 = mod(uTime + T * 0.5, T);
      float w = abs(1.0 - 2.0 * t1 / T);
      float n = mix(swirl(r, th, t1), swirl(r, th, t2), 1.0 - w);
      float I = pow(1.0 - rn, 1.7) * (0.55 + 0.75 * (0.5 + 0.5 * n));
      I *= smoothstep(0.0, 0.06, rn) * (1.0 - smoothstep(0.75, 1.0, rn));
      // Beaming: the side moving toward the reader is brighter and whiter.
      float d = dot(vVel, normalize(-vP));
      float beam = pow(1.0 + 0.38 * d, 3.0);
      vec3 hot = vec3(1.0, 0.93, 0.80), warm = vec3(1.0, 0.56, 0.20), cool = vec3(0.55, 0.16, 0.06);
      vec3 col = mix(hot, warm, smoothstep(0.0, 0.35, rn));
      col = mix(col, cool, smoothstep(0.45, 1.0, rn));
      col = mix(col, vec3(0.85, 0.92, 1.0), 0.25 * max(d, 0.0));
      gl_FragColor = vec4(col * I * beam * uFeed * uFade * 1.25, 0.0);   // additive (premultiplied, a = 0)
    }`;
  const BILL_VS = `
    uniform float uSize;
    varying vec2 vQ;
    void main() {
      vQ = (uv * 2.0 - 1.0) * uSize;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const GLOW_FS = `
    precision highp float;
    uniform vec2 uAxis;          // the disk's axis on screen (unit), for the lensed arcs
    uniform float uFace, uTime, uFeed, uFlash, uFade, uSize;
    varying vec2 vQ;
    ${NOISE}
    void main() {
      float d = length(vQ);
      vec2 dir = vQ / max(d, 1e-4);
      // Photon ring: thin, white-gold, hugging the shadow.
      float ring = exp(-pow((d - 1.04) / 0.035, 2.0)) * 1.3;
      // The far side of the disk, bent over the top and under the
      // bottom: along the axis when edge-on, a full ring face-on.
      float along = pow(abs(dot(dir, uAxis)), 1.4);
      float wgt = mix(along, 0.55, uFace);
      float band = smoothstep(1.05, 1.12, d) * (1.0 - smoothstep(1.18, 1.9, d));
      float n = 0.5 + 0.5 * snoise(vec3(dir * 3.0, uTime * 0.35));
      float lens = band * wgt * (0.6 + 0.6 * n) * 2.0;
      vec3 col = vec3(1.0, 0.86, 0.62) * ring + vec3(1.0, 0.62, 0.28) * lens;
      col += vec3(1.0, 0.55, 0.25) * 0.10 * exp(-(d - 1.0) * 1.3) * step(1.0, d);
      col *= uFeed;
      // The collapse flash: a white bloom from the centre.
      col += vec3(1.0, 0.96, 0.9) * uFlash * (exp(-d * 0.45) * 1.6 + exp(-d * 0.08) * 0.35);
      col *= 1.0 - smoothstep(0.6, 1.0, d / uSize);     // nothing at the quad's edge
      gl_FragColor = vec4(col * uFade, 0.0);
    }`;
  const SHOCK_FS = `
    precision highp float;
    uniform float uR, uA;
    varying vec2 vQ;             // -1..1 over the system
    void main() {
      float d = length(vQ);
      float w = 0.018 + 0.05 * uR;
      float ring = exp(-pow((d - uR) / w, 2.0)) + 0.35 * exp(-pow((d - uR * 0.82) / (w * 2.5), 2.0));
      ring *= 1.0 - smoothstep(0.85, 1.0, d);
      vec3 col = mix(vec3(1.0, 0.9, 0.75), vec3(0.55, 0.7, 1.0), uR);
      gl_FragColor = vec4(col * ring * uA, 0.0);
    }`;

  /* ── Renderer ── */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    console.error(e);
    fail();
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));   // nine worlds + the galaxy behind: 1.5× is plenty
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = true;

  function fail() {
    section.classList.add('planet--css');
    root.style.setProperty('--planet-in', '1');
    section.dispatchEvent(new Event('system:fallback'));
  }

  const quadGeo = new THREE.PlaneGeometry(2, 2);

  /* ── Scene ── */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.FOV, 1, 0.05, 400);
  scene.add(camera);

  /* Light for the emblems: Koaik's accretion disk is the system's
     light, so a warm point light sits in it (no falloff: the outer
     orbits must not go dark); a soft ambient and a weak fill that
     rides with the camera keep the night sides readable. The black
     hole itself is ShaderMaterials and ignores all three. */
  const coreLight = new THREE.PointLight(0xffe2bf, 3.2, 0, 0);
  scene.add(coreLight);
  scene.add(new THREE.AmbientLight(0x8a9ac0, 0.55));
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
  fill.position.set(0.3, 0.4, 0); fill.target.position.set(0, 0, -1);
  camera.add(fill, fill.target);
  const planets = [];     // the projects

  /* Koaik, the black hole (shaders above). `mesh` is the scaled core
     group, so `mesh.scale.x` is the shadow's radius on screen — the
     picking and the reveal read it as they read a planet's. `radius`
     is how far the visible thing reaches above its centre (the lensed
     arc), for the label and the camera's framing. */
  let sun = null;
  function makeBlackHole() {
    const core = new THREE.Group();
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    shadow.renderOrder = 1;                                 // first: it writes the depth the disk is tested against
    const diskMat = new THREE.ShaderMaterial({
      vertexShader: DISK_VS, fragmentShader: DISK_FS, transparent: true, premultipliedAlpha: true,
      depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uFeed: { value: 1 }, uIn: { value: config.BH_DISK_IN }, uOut: { value: config.BH_DISK_OUT }, uFade: { value: 1 } },
    });
    const disk = new THREE.Mesh(new THREE.RingGeometry(config.BH_DISK_IN, config.BH_DISK_OUT, 160, 8), diskMat);
    disk.rotation.x = -Math.PI / 2;                         // into the orbital plane
    disk.renderOrder = 2;
    const GLOW = 3.2;
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: BILL_VS, fragmentShader: GLOW_FS, transparent: true, premultipliedAlpha: true, depthWrite: false,
      uniforms: { uSize: { value: GLOW }, uAxis: { value: new THREE.Vector2(0, 1) }, uFace: { value: 0 }, uTime: { value: 0 },
        uFeed: { value: 1 }, uFlash: { value: 0 }, uFade: { value: 1 } },
    });
    const glow = new THREE.Mesh(quadGeo, glowMat);
    glow.scale.setScalar(GLOW);
    glow.renderOrder = 3;
    core.add(shadow, disk, glow);
    core.scale.setScalar(0);
    const group = new THREE.Group();
    group.add(core);
    scene.add(group);
    return { group, mesh: core, shadow, disk, glow, radius: config.BH_R * 2.0 };
  }
  /* The collapse shockwave: a ring in the orbital plane, the size of
     the whole system, shown only during the collapse. */
  const shockMat = new THREE.ShaderMaterial({
    vertexShader: BILL_VS, fragmentShader: SHOCK_FS, transparent: true, premultipliedAlpha: true, depthWrite: false,
    uniforms: { uSize: { value: 1 }, uR: { value: 0 }, uA: { value: 0 } },
  });
  const shock = new THREE.Mesh(quadGeo, shockMat);
  shock.rotation.x = -Math.PI / 2;
  shock.renderOrder = 4;
  shock.visible = false;
  scene.add(shock);
  /* The collapse flash: its own billboard, not the hole's glow (the
     hole is a point by then). Only the flash term: no feed, no rings. */
  const FLASH_SIZE = 30;                     // in shadow radii
  const flashMesh = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
    vertexShader: BILL_VS, fragmentShader: GLOW_FS, transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: false,
    uniforms: { uSize: { value: FLASH_SIZE }, uAxis: { value: new THREE.Vector2(0, 1) }, uFace: { value: 0 }, uTime: { value: 0 },
      uFeed: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 1 } },
  }));
  flashMesh.scale.setScalar(FLASH_SIZE * config.BH_R);
  flashMesh.renderOrder = 5;
  flashMesh.visible = false;
  scene.add(flashMesh);

  /* Orbits and the projects' planets, made lazily after the sun. */
  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);
  const outerOrbit = config.ORBIT_0 + config.ORBIT_STEP * Math.max(0, projects.length - 1);
  let planetsMade = 0;
  /* A project's body is its EMBLEM (emblems.js): a small model of the
     project itself, lit by the scene's lights. It is built staged:
     all emblems go into `staging` first and are compiled together
     (compileAsync, parallel where the driver allows), and only join
     their orbits once compiled — so no shader compiles mid-animation. */
  const staging = new THREE.Scene();
  let emblemsLive = false;

  /* ── The orbits, lit and bent by the hole ──
     Each orbit is a screen-space RIBBON (two vertices per point,
     extruded across the line in pixels), not a 1px GL line: a soft
     glow with a bright core. It is LIT by the hole — warm and bright
     near the disk, cool and dim far out — with faint packets of light
     running along it the way the planets go. And it is LENSED: the
     part of an orbit that passes behind Koaik is pushed out from the
     hole on screen by the point-lens image equation
       θ = (β + √(β² + 4θE²)) / 2
     with θE growing as √ of how far behind the hole the point is, so
     orbits bend into arcs round the shadow and brighten there
     (magnification). Nothing is lensed in front of the hole, and the
     deflection is zero at the hole's own depth, so there is no kink.
     All orbits share `orbitU` (the hole, its lens size, the time). */
  const ORBIT_VS = `
    attribute vec3 aNext;
    attribute float aSide;
    attribute float aU;
    uniform vec2 uRes;
    uniform float uWidth;
    uniform vec3 uHole;
    uniform float uLens;           // Einstein radius in px for a source far behind
    uniform float uLensDepth;      // how far behind (view units) θE reaches full size
    uniform float uNear;
    varying float vSide;
    varying float vU;
    varying float vLight;
    varying float vMag;
    vec2 toPx(vec4 c) { return c.xy / c.w * 0.5 * uRes; }
    vec2 lens(vec2 s, vec2 h, float dz, out float mag) {
      float te = uLens * sqrt(clamp(dz / uLensDepth, 0.0, 1.0));
      vec2 d = s - h;
      float b = max(length(d), 1e-3);
      mag = 1.0;
      if (te < 1e-3) return s;
      float r = 0.5 * (b + sqrt(b * b + 4.0 * te * te));
      float u = b / te;
      mag = (u * u + 2.0) / (u * sqrt(u * u + 4.0));
      return h + d / b * r;
    }
    void main() {
      vec4 w0 = modelMatrix * vec4(position, 1.0);
      vec4 w1 = modelMatrix * vec4(aNext, 1.0);
      vec4 v0 = viewMatrix * w0, v1 = viewMatrix * w1;
      vSide = aSide; vU = aU;
      // Light from the disk: inverse-ish square, softened at the core.
      float dh = length(w0.xyz - uHole);
      vLight = 1.0 / (1.0 + pow(dh / 3.2, 2.2));
      if (v0.z > -uNear) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vMag = 1.0; return; }
      // Keep the direction usable when the next point is behind the camera.
      if (v1.z > -uNear) v1 = v0 + (v1 - v0) * ((-uNear - v0.z) / (v1.z - v0.z) * 0.99);
      vec4 vh = viewMatrix * vec4(uHole, 1.0);
      vec4 c0 = projectionMatrix * v0, c1 = projectionMatrix * v1, ch = projectionMatrix * vh;
      vec2 h = toPx(ch);
      float m0, m1;
      vec2 s0 = lens(toPx(c0), h, vh.z - v0.z, m0);
      vec2 s1 = lens(toPx(c1), h, vh.z - v1.z, m1);
      vMag = m0;
      vec2 dir = s1 - s0;
      float dl = length(dir);
      dir = dl > 1e-4 ? dir / dl : vec2(1.0, 0.0);
      vec2 s = s0 + vec2(-dir.y, dir.x) * aSide * uWidth * 0.5;
      gl_Position = vec4(s / (0.5 * uRes) * c0.w, c0.z, c0.w);
    }`;
  const ORBIT_FS = `
    uniform float uOpacity;
    uniform float uTime;
    uniform float uSeed;
    varying float vSide;
    varying float vU;
    varying float vLight;
    varying float vMag;
    void main() {
      // A bright core and a soft glow across the ribbon.
      float x = abs(vSide);
      float prof = exp(-x * x * 18.0) + 0.28 * exp(-x * x * 3.0);
      // Packets of light running the planets' way (decreasing u).
      float f = fract((vU + uTime * 0.022 + uSeed) * 6.0);
      float pk = pow(max(0.0, 1.0 - abs(f - 0.5) * 2.0), 10.0);
      vec3 cool = vec3(0.56, 0.64, 0.86);
      vec3 warm = vec3(1.00, 0.74, 0.46);
      float L = clamp(vLight, 0.0, 1.0);
      vec3 col = mix(cool, warm, smoothstep(0.0, 0.55, L));
      float mag = min(vMag, 4.0);
      float I = uOpacity * (0.42 + 1.5 * L + 0.55 * pk) * mag;
      vec3 c = col * I * prof;
      // Added onto a transparent canvas composited over the galaxy:
      // alpha must grow with the light or the page would not see it.
      gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
    }`;
  const orbitU = {
    uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 4 }, uHole: { value: new THREE.Vector3() },
    uLens: { value: 0 }, uLensDepth: { value: 6 }, uNear: { value: 0.05 }, uTime: { value: 0 },
  };
  function makeOrbitRibbon(pts) {
    const n = pts.length;                                   // first point repeated at the end
    const pos = new Float32Array(n * 2 * 3), nxt = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2), u = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[k + 1 < n ? k + 1 : 1];
      for (let s = 0; s < 2; s++) {
        const j = k * 2 + s;
        pos.set([a.x, a.y, a.z], j * 3); nxt.set([b.x, b.y, b.z], j * 3);
        side[j] = s ? 1 : -1; u[j] = k / (n - 1);
      }
    }
    const idx = [];
    for (let k = 0; k < n - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    g.setIndex(idx);
    return g;
  }

  function makePlanet(i) {
    const pr = projects[i];
    const w = pr.world || {};
    const radius = w.radius || config.EMBLEM_R;
    const em = makeEmblem(pr);
    const group = new THREE.Group();
    // group > stretchA > stretchB > emblem. A is turned to the radial
    // direction and scaled, B turns back: a pure stretch toward the
    // black hole with no net rotation (identity outside the collapse).
    const stretchA = new THREE.Group(), stretchB = new THREE.Group();
    stretchA.add(stretchB); group.add(stretchA);
    em.root.scale.setScalar(0);
    const body = { group, stretchA, stretchB, mesh: em.root, radius, emblem: em, spin: i * 1.3, pitch: 0 };
    const orbitR = config.ORBIT_0 + config.ORBIT_STEP * i;
    const period = config.PERIOD_0 * Math.pow(orbitR / config.ORBIT_0, 1.5);
    const incl = (0.03 + 0.10 * ((i * 5) % 4) / 3) * (i % 2 ? 1 : -1);
    const node = (i * 2.399963);             // where the tilt is, golden-angle spread
    // The plane is turned by `node`, so the angle within it must
    // carry its own spread on top: world angle = phase − node.
    const phase = node + 0.7 + i * 2.399963;
    // The orbit: a tilted plane, its ring drawn in it.
    const plane = new THREE.Group();
    plane.rotation.set(0, node, 0, 'YXZ');
    plane.rotateX(incl);
    orbitGroup.add(plane);
    // An open line with the first point repeated, not a LineLoop, so
    // it can draw itself with drawRange during the pull-back.
    const ORBIT_PTS = 256;
    const pts = [];
    for (let k = 0; k <= ORBIT_PTS; k++) { const a = -(k / ORBIT_PTS) * Math.PI * 2 + phase; pts.push(new THREE.Vector3(Math.cos(a) * orbitR, 0, Math.sin(a) * orbitR)); }
    // depthWrite off: an invisible line that still wrote depth cut a
    // dark chord through Koaik on arrival.
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: ORBIT_VS, fragmentShader: ORBIT_FS, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: { ...orbitU, uOpacity: { value: 0 }, uSeed: { value: i * 0.137 } },
    });
    const ring = new THREE.Mesh(makeOrbitRibbon(pts), ringMat);
    ring.frustumCulled = false;                           // the lens moves it off its bounds
    ring.geometry.setDrawRange(0, 0);
    plane.add(ring);
    plane.add(group);
    staging.add(em.root);
    const planet = { index: i, body, kind: em.kind, orbitR, period, phase, plane, ring, ringMat, orbitPts: ORBIT_PTS, born: 0, rPx: 0, fall: 0, swirl: 0 };
    planets[i] = planet;
    return planet;
  }
  function goLive() {
    const done = () => { for (const p of planets) if (p) p.body.stretchB.add(p.body.mesh); emblemsLive = true; };
    for (const p of planets) if (p) p.body.mesh.scale.setScalar(p.body.radius);     // compile at real size
    (renderer.compileAsync ? renderer.compileAsync(staging, camera, scene) : Promise.resolve(renderer.compile(staging, camera, scene)))
      .catch(e => console.warn('emblems: compile', e)).then(done);
  }

  /* ── Labels (HTML, projected) ── */
  const labels = [];
  let reticle = null;
  function makeLabels() {
    if (!labelsEl) return;
    labelsEl.innerHTML = '';
    reticle = document.createElement('div');
    reticle.className = 'sys-reticle';
    reticle.setAttribute('aria-hidden', 'true');
    labelsEl.appendChild(reticle);
    const mk = (text, kind, index) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sys-label' + (kind === 'pilot' ? ' sys-label--sun' : '');
      b.innerHTML = `<span class="sys-label-dot" aria-hidden="true"></span><span class="sys-label-text"></span>`;
      b.querySelector('.sys-label-text').textContent = text;
      b.addEventListener('click', e => { e.stopPropagation(); if (kind === 'pilot') startCollapse(); else select(index); });
      b.addEventListener('pointerenter', () => setHot(kind === 'pilot' ? 'pilot' : index));
      b.addEventListener('pointerleave', () => setHot(null));
      labelsEl.appendChild(b);
      return { el: b, kind, index, in: 0 };
    };
    labels.push(mk(data.planet ? data.planet.name : 'Koaik', 'pilot', -1));
    projects.forEach((pr, i) => labels.push(mk(pr.name, 'project', i)));
  }
  const _lv = new THREE.Vector3();
  let readyAt = 0;
  function placeLabels(w, h, now, dt) {
    if (!labelsEl) return;
    const halfH = Math.tan(THREE.MathUtils.degToRad(config.FOV) / 2);
    const mark = focus !== null ? focus : hot;      // what the reticle sits on
    let markX = 0, markY = 0, markR = 0, markOn = false;
    labels.forEach((l, k) => {
      const body = l.kind === 'pilot' ? sun : (planets[l.index] && planets[l.index].body);
      if (!body || !ready) { l.el.style.display = 'none'; return; }
      // Each label eases in a little after the last, once the system is live.
      const since = (now - readyAt) / 1000 - 0.08 * k;
      l.in = reduceMotion ? 1 : smooth01(since / 0.6);
      body.group.getWorldPosition(_lv);
      const dist = _lv.distanceTo(camera.position);
      _lv.project(camera);
      const behind = _lv.z > 1 || _lv.z < -1;
      if (behind) { l.el.style.display = 'none'; return; }
      const rPx = body.radius / (dist * halfH) * (h / 2);        // projected radius
      const cx = (_lv.x * 0.5 + 0.5) * w, cy = (-_lv.y * 0.5 + 0.5) * h;
      const x = cx, y = cy - rPx - 12;
      const key = l.kind === 'pilot' ? 'pilot' : l.index;
      if (key === mark) { markX = cx; markY = cy; markR = rPx; markOn = true; }
      if (x < -80 || x > w + 80 || y < -40 || y > h + 40) { l.el.style.display = 'none'; return; }
      l.el.style.display = '';
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${(y + (1 - l.in) * 8).toFixed(1)}px) translate(-50%, -100%)`;
      // Far and small: quieter, never hidden (they are the map).
      const gone = collapse ? (l.kind === 'pilot' ? 0 : 1 - smooth01(planets[l.index].fall / 0.25)) : 1;
      l.el.style.opacity = ((0.55 + 0.45 * Math.min(1, rPx / 18)) * l.in * gone).toFixed(2);
      l.el.style.visibility = gone < 0.02 ? 'hidden' : '';
    });
    if (reticle) {
      if (markOn && markR < h && !collapse) {
        const d = Math.max(28, markR * 2 + 18);
        reticle.style.display = '';
        reticle.style.width = reticle.style.height = d.toFixed(0) + 'px';
        // Placed by left/top, NOT transform: the CSS `rotate` that turns it
        // composes on top of `transform`, so a translate there would be
        // rotated too and swing the ring round the layer's corner.
        reticle.style.left = (markX - d / 2).toFixed(1) + 'px';
        reticle.style.top = (markY - d / 2).toFixed(1) + 'px';
        reticle.classList.toggle('is-locked', focus !== null);
      } else reticle.style.display = 'none';
    }
  }

  /* ── State ── */
  let vw = 0, vh = 0, aspect = 1;
  let armed = false, revealAt = 0, pullAt = 0, ready = false, lastIn = -1;
  let time = 0, lastNow = 0;
  let focus = null;            // 'pilot' | planet index | null
  let hot = null;
  let flight = null;           // the scripted arrival only (see fly)
  let trackValid = false;      // following a selected body: is trackPrev from the last frame?
  /* The emblems draw text into canvases: wait for the page's fonts. */
  let fontsReady = !document.fonts;
  if (document.fonts) Promise.race([
    Promise.all([document.fonts.load(`500 20px "JetBrains Mono"`), document.fonts.load(`600 20px "Space Grotesk"`)]),
    new Promise(r => setTimeout(r, 2500)),
  ]).catch(() => {}).then(() => { fontsReady = true; });
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;
  controls.zoomToCursor = true;          // the wheel zooms toward what you point at
  controls.enablePan = true;             // right-drag / two fingers: slide sideways
  controls.screenSpacePanning = true;
  controls.panSpeed = 0.7;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.minDistance = config.MIN_NEAR;
  controls.maxDistance = config.MAX_DIST;
  controls.maxPolarAngle = Math.PI * 0.98;
  controls.autoRotateSpeed = config.DRIFT;
  // Any touch of the controls ends the idle drift for a while.
  let lastTouch = 0;
  controls.addEventListener('start', () => { lastTouch = performance.now(); controls.autoRotate = false; });

  const smooth01 = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutBack = t => { const c = 1.4; return t <= 0 ? 0 : 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function resize() {
    const w = section.clientWidth, h = section.clientHeight;
    if (!w || !h) return false;
    if (w !== vw || h !== vh) {
      vw = w; vh = h; aspect = w / h;
      renderer.setSize(w, h, false);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      shift.open = !shift.open;   // re-measure the card at the new size (resize only runs after the module has loaded)
    }
    return true;
  }

  /* Arrival: the camera distance at which the disk spans FILL of the
     limiting dimension, a little above its plane. */
  function arrivalPose() {
    const fov = THREE.MathUtils.degToRad(config.FOV);
    const halfH = Math.tan(fov / 2);
    const limit = aspect < 1 ? Math.atan(halfH * aspect) : fov / 2;
    const d = config.BH_R * config.BH_DISK_OUT / (config.FILL * Math.tan(limit));
    const el = config.ARRIVE_EL;
    return { pos: new THREE.Vector3(0, Math.sin(el) * d, Math.cos(el) * d), target: new THREE.Vector3(0, 0, 0) };
  }
  /* Overview: above the plane, the outer orbit fitting the width. */
  function overviewPose() {
    const fov = THREE.MathUtils.degToRad(config.FOV);
    const halfH = Math.tan(fov / 2);
    const portrait = aspect < 1;
    const el = portrait ? config.ELEVATION_PORTRAIT : config.ELEVATION;
    const fitR = outerOrbit * config.FIT * (portrait ? 0.9 : 1);
    // Fit the width, and the plane's foreshortened height, whichever is further.
    const d = Math.max(fitR / (halfH * aspect), fitR * Math.sin(el) * 1.15 / halfH);
    const pos = new THREE.Vector3(Math.sin(config.AZIMUTH) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(config.AZIMUTH) * Math.cos(el) * d);
    return { pos, target: new THREE.Vector3(0, 0, 0) };
  }
  function focusPose(body, distR) {
    const p = new THREE.Vector3(); body.group.getWorldPosition(p);
    const dir = camera.position.clone().sub(p);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.4, 1);
    dir.normalize();
    // Swing toward the lit side (the sun's side) so the world arrives
    // in daylight, and never edge-on.
    if (body !== sun) { const sunward = new THREE.Vector3().sub(p).normalize(); dir.lerp(sunward, config.SUNWARD).normalize(); }
    dir.y = Math.max(dir.y, 0.32); dir.normalize();
    // On a tall screen the width is the limit: back off until the body
    // spans at most FOCUS_FILL_PORTRAIT of it.
    let d = body.radius * distR;
    if (aspect < 1) {
      const halfW = Math.atan(Math.tan(THREE.MathUtils.degToRad(config.FOV) / 2) * aspect);
      d = Math.max(d, body.radius / Math.sin(Math.atan(config.FOCUS_FILL_PORTRAIT * Math.tan(halfW))));
    }
    return { pos: p.clone().add(dir.multiplyScalar(d)), target: p };
  }

  /* A flight interpolates the camera in orbit terms around a moving
     target — distance, azimuth, elevation — so it swings out and
     round rather than sliding in a straight line, and the distance
     eases on its own curve so the swoop settles last. */
  const _sphA = new THREE.Spherical(), _sphB = new THREE.Spherical(), _off = new THREE.Vector3();
  function fly(pose, ms, then, at) {
    _off.copy(camera.position).sub(controls.target); _sphA.setFromVector3(_off);
    _off.copy(pose.pos).sub(pose.target); _sphB.setFromVector3(_off);
    let dTheta = _sphB.theta - _sphA.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    flight = { r0: _sphA.radius, r1: _sphB.radius, th0: _sphA.theta, dTh: dTheta, ph0: _sphA.phi, ph1: _sphB.phi,
      tFrom: controls.target.clone(), tTo: pose.target.clone(), t0: performance.now(), ms, then, at, atDone: false };
    controls.enabled = false;
    controls.autoRotate = false;
  }
  const _sph = new THREE.Spherical();
  function stepFlight(now) {
    if (!flight) return;
    const u = Math.min(1, (now - flight.t0) / flight.ms);
    const t = easeInOut(u);
    const tr = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;   // distance: quadratic, gentler at the ends
    _sph.set(flight.r0 + (flight.r1 - flight.r0) * tr, flight.ph0 + (flight.ph1 - flight.ph0) * t, flight.th0 + flight.dTh * t);
    controls.target.lerpVectors(flight.tFrom, flight.tTo, t);
    camera.position.setFromSpherical(_sph).add(controls.target);
    camera.lookAt(controls.target);
    if (flight.at && !flight.atDone && u >= 0.62) { flight.atDone = true; flight.at(); }
    if (u >= 1) { const f = flight; flight = null; controls.enabled = ready; if (f.then) f.then(); }
  }

  /* ── The rig: interactive camera moves ──
     State in orbit terms around the look-at point: the look-at point
     as an offset `e` from an ANCHOR (the goal body's live position, or
     a fixed point), and the camera's log-distance, polar and azimuth
     angles around it. Each channel is a critically damped spring
     (SmoothDamp) toward its goal. Because `e` is relative to the
     anchor, a moving planet is followed exactly — there is no lag to
     catch up at the end, so no snap. */
  function smoothDamp(cur, goal, vel, T, dt, k) {
    const w = 2 / T, x = w * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const ch = cur - goal, tmp = (vel[k] + w * ch) * dt;
    vel[k] = (vel[k] - w * tmp) * ex;
    let out = goal + (ch + tmp) * ex;
    if ((goal - cur > 0) === (out > goal)) { out = goal; vel[k] = 0; }   // never overshoot
    return out;
  }
  const rig = {
    active: false, body: null, anchor: new THREE.Vector3(), fixed: new THREE.Vector3(),
    e: new THREE.Vector3(), lr: 0, ph: 0, th: 0,
    goal: { lr: 0, ph: 0, th: 0 }, v: { ex: 0, ey: 0, ez: 0, lr: 0, ph: 0, th: 0 },
    e0: 1, lr0: 1, onNear: null, nearFired: false,
  };
  const _rs = new THREE.Spherical();
  function rigAnchor(out) { if (rig.body) rig.body.group.getWorldPosition(out); else out.copy(rig.fixed); return out; }
  /* Aim the rig at a pose. body: follow it (or null for a fixed point). */
  function rigTo(pose, body, onNear) {
    const wasActive = rig.active;
    rig.body = body || null;
    rig.fixed.copy(pose.target);
    rigAnchor(rig.anchor);
    if (!wasActive) {
      // Take over from wherever the camera is; drop the controls' own
      // leftover momentum so it does not resume after the move.
      _off.copy(camera.position).sub(controls.target); _rs.setFromVector3(_off);
      rig.lr = Math.log(Math.max(1e-3, _rs.radius)); rig.ph = _rs.phi; rig.th = _rs.theta;
      for (const k in rig.v) rig.v[k] = 0;
      killMomentum();
    }
    // Re-express the look-at point relative to the new anchor (keeps
    // the camera exactly where it is: no jump on a re-aim).
    rig.e.copy(controls.target).sub(rig.anchor);
    _off.copy(pose.pos).sub(pose.target); _rs.setFromVector3(_off);
    rig.goal.lr = Math.log(Math.max(1e-3, _rs.radius));
    rig.goal.ph = THREE.MathUtils.clamp(_rs.phi, 0.06, Math.PI - 0.06);
    let dTh = _rs.theta - rig.th;                         // the short way round
    dTh = Math.atan2(Math.sin(dTh), Math.cos(dTh));
    rig.goal.th = rig.th + dTh;
    rig.e0 = Math.max(1e-3, rig.e.length()); rig.lr0 = Math.max(1e-3, Math.abs(rig.lr - rig.goal.lr));
    rig.onNear = onNear || null; rig.nearFired = false;
    rig.active = true;
    controls.autoRotate = false;
    if (reduceMotion) { rig.e.set(0, 0, 0); rig.lr = rig.goal.lr; rig.ph = rig.goal.ph; rig.th = rig.goal.th; }
  }
  function killMomentum() {
    // OrbitControls (r186) keeps its damped motion in these; zeroing
    // them stops a drag that ended just before a move from carrying on
    // after it.
    if (controls._sphericalDelta) controls._sphericalDelta.set(0, 0, 0);
    if (controls._panOffset) controls._panOffset.set(0, 0, 0);
    if ('_scale' in controls) controls._scale = 1;
  }
  /* The reader took over mid-move (drag, wheel, keys): stop where we
     are. A body we had not reached yet is let go; one we had reached
     stays selected and keeps being followed. */
  function rigCancel() {
    if (!rig.active) return;
    rig.active = false;
    if (!rig.nearFired && focus !== null) letGo(true);
  }
  function stepRig(dt) {
    if (!rig.active) return;
    rigAnchor(rig.anchor);
    const v = rig.v;
    rig.e.set(smoothDamp(rig.e.x, 0, v, config.RIG_TARGET, dt, 'ex'),
              smoothDamp(rig.e.y, 0, v, config.RIG_TARGET, dt, 'ey'),
              smoothDamp(rig.e.z, 0, v, config.RIG_TARGET, dt, 'ez'));
    rig.lr = smoothDamp(rig.lr, rig.goal.lr, v, config.RIG_RADIUS, dt, 'lr');
    rig.ph = smoothDamp(rig.ph, rig.goal.ph, v, config.RIG_ANGLE, dt, 'ph');
    rig.th = smoothDamp(rig.th, rig.goal.th, v, config.RIG_ANGLE, dt, 'th');
    controls.target.copy(rig.anchor).add(rig.e);
    _rs.set(Math.exp(rig.lr), rig.ph, rig.th);
    camera.position.setFromSpherical(_rs).add(controls.target);
    camera.lookAt(controls.target);
    const progress = 1 - Math.max(rig.e.length() / rig.e0, Math.abs(rig.lr - rig.goal.lr) / rig.lr0);
    if (!rig.nearFired && progress >= config.RIG_CARD_AT) { rig.nearFired = true; if (rig.onNear) rig.onNear(); }
    const still = rig.e.length() < 1e-4 && Math.abs(rig.lr - rig.goal.lr) < 1e-4 &&
      Math.abs(rig.ph - rig.goal.ph) < 1e-4 && Math.abs(rig.th - rig.goal.th) < 1e-4;
    if (still) {
      rig.active = false;
      if (!rig.nearFired) { rig.nearFired = true; if (rig.onNear) rig.onNear(); }
      killMomentum();
      trackValid = false;
    }
  }

  /* ── Framing beside the card ──
     When a card is open the selected body should sit in the free part
     of the screen, not under the card: the projection is shifted with
     setViewOffset (left by half the card on a wide screen, up by half
     the sheet on a tall one), eased with the same damping. The camera
     itself does not move, so the orbit controls are unaffected, and
     picking and labels use the shifted projection too. The card's size
     is read once when it opens, never per frame (no forced layout). */
  const panelEl = document.getElementById('sysPanel');
  const shift = { x: 0, y: 0, gx: 0, gy: 0, v: { x: 0, y: 0 }, open: false };
  function stepShift(dt) {
    const open = !!(panelEl && panelEl.classList.contains('is-open') && focus !== null);
    if (open !== shift.open) {
      shift.open = open;
      if (open) {
        const w = panelEl.offsetWidth, h = panelEl.offsetHeight;
        if (aspect >= 1) { shift.gx = Math.min(vw * 0.3, (w + 24) / 2); shift.gy = 0; }
        else { shift.gx = 0; shift.gy = Math.min(vh * 0.32, (h + 12) / 2); }
      } else { shift.gx = 0; shift.gy = 0; }
    }
    if (reduceMotion) { shift.x = shift.gx; shift.y = shift.gy; }
    else {
      shift.x = smoothDamp(shift.x, shift.gx, shift.v, config.FRAME_SHIFT, dt, 'x');
      shift.y = smoothDamp(shift.y, shift.gy, shift.v, config.FRAME_SHIFT, dt, 'y');
    }
    if (Math.abs(shift.x) > 0.05 || Math.abs(shift.y) > 0.05) camera.setViewOffset(vw, vh, shift.x, shift.y, vw, vh);
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  }

  /* ── Selection ── */
  function dispatch(name, detail) { section.dispatchEvent(new CustomEvent(name, { detail })); }
  function setHot(h) {
    if (h === hot) return;
    hot = h;
    canvas.style.cursor = h === null ? '' : 'pointer';
    for (const l of labels) l.el.classList.toggle('is-hot', (l.kind === 'pilot' ? 'pilot' : l.index) === h);
    dispatch('system:hover', { target: h });
  }
  function select(what) {
    if (!ready || flight || collapse) return;          // only the scripted arrival blocks; a move in progress is re-aimed
    if (what === focus) return;
    focus = what;
    for (const l of labels) l.el.classList.toggle('is-active', (l.kind === 'pilot' ? 'pilot' : l.index) === what);
    dispatch('system:select', { kind: 'none', index: -1, project: null });   // any open card closes first
    if (what === 'pilot') {
      controls.minDistance = sun.radius * config.MIN_DIST;
      rigTo(focusPose(sun, config.FOCUS_DIST_SUN), sun,
        () => dispatch('system:select', { kind: 'pilot', index: -1, project: null }));
    } else if (typeof what === 'number' && planets[what]) {
      const pl = planets[what];
      controls.minDistance = pl.body.radius * config.MIN_DIST;
      rigTo(focusPose(pl.body, config.FOCUS_DIST), pl.body,
        () => dispatch('system:select', { kind: 'project', index: what, project: projects[what] }));
    }
  }
  function letGo(quiet) {
    focus = null;
    for (const l of labels) l.el.classList.remove('is-active');
    controls.minDistance = config.MIN_NEAR;
    if (!quiet) dispatch('system:select', { kind: 'none', index: -1, project: null });
  }
  function overview() {
    if (!ready || flight || collapse) return;
    letGo();
    rigTo(overviewPose(), null, () => { lastTouch = performance.now() - config.IDLE_MS + 3000; });
  }

  /* Picking: a click is a press and release within a few pixels. */
  /* Picking: an analytic ray/sphere test per body — exact, and cheap
     enough for every pointermove (a triangle raycast against ten
     12k-triangle spheres was not). A small margin makes little
     planets easier to hit. */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const _pc = new THREE.Vector3(), _hit = new THREE.Vector3();
  function pick(x, y) {
    ndc.set((x / vw) * 2 - 1, -(y / vh) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null, bestD = Infinity;
    const test = (body, key) => {
      body.group.getWorldPosition(_pc);
      const r = body.mesh.scale.x * (body === sun ? 3.0 : 1.1);   // the hole: the inner disk counts
      const sph = new THREE.Sphere(_pc, r);
      if (ray.ray.intersectSphere(sph, _hit)) { const d = _hit.distanceTo(ray.ray.origin); if (d < bestD) { bestD = d; best = key; } }
    };
    if (sun) test(sun, 'pilot');
    for (const p of planets) if (p && p.born > 0.5) test(p.body, p.index);
    return best;
  }
  let pressX = 0, pressY = 0, pressT = 0, pressed = false;
  canvas.addEventListener('pointerdown', e => { pressX = e.clientX; pressY = e.clientY; pressT = performance.now(); pressed = true; });
  window.addEventListener('pointerup', () => { pressed = false; });
  canvas.addEventListener('pointerup', e => {
    if (!ready || flight || collapse) return;
    const moved = Math.hypot(e.clientX - pressX, e.clientY - pressY);
    if (moved > 6 || performance.now() - pressT > 500) return;
    const r = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - r.left, e.clientY - r.top);
    if (hit === null) return;
    if (hit === 'pilot') startCollapse();     // Koaik is the black hole: a click swallows the system
    else select(hit);
  });
  canvas.addEventListener('pointermove', e => {
    if (!ready || flight || collapse) return;
    // A real drag during a move hands the camera back to the reader.
    if (pressed && rig.active && !collapse && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 6) rigCancel();
    if (e.pointerType === 'touch') return;
    const r = canvas.getBoundingClientRect();
    setHot(pick(e.clientX - r.left, e.clientY - r.top));
  });
  canvas.addEventListener('wheel', () => { if (rig.active && !collapse) rigCancel(); }, { passive: true });
  canvas.addEventListener('pointerleave', () => setHot(null));

  /* Keyboard flight: WASD / arrows move the camera and its target
     together, so orbiting afterwards is around wherever you are.
     Q/E climb and dive; Escape backs out of a planet. */
  const keys = new Set();
  const vel = new THREE.Vector3();
  let boost = false;
  /* By PHYSICAL key (e.code), so WASD/QE sit in the same place on any
     layout: e.key is 'ي' for D on Arabic, 'q' for A on AZERTY… */
  const FLY_CODES = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyE: 'e',
    ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright' };
  const flyKey = e => FLY_CODES[e.code] || null;
  window.addEventListener('keydown', e => {
    if (!ready || (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable]'))) return;
    if (collapse) return;
    if (e.key === 'Escape') { if (focus !== null) overview(); return; }
    if (e.key === 'Shift') { boost = true; return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;   // browser shortcuts; macOS also drops the keyup of a key released under Cmd
    const k = flyKey(e);
    if (k) { keys.add(k); e.preventDefault(); lastTouch = performance.now(); controls.autoRotate = false; }
  });
  window.addEventListener('keyup', e => { if (e.key === 'Shift') boost = false; const k = flyKey(e); if (k) keys.delete(k); });
  window.addEventListener('blur', () => { keys.clear(); boost = false; });
  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _acc = new THREE.Vector3();
  function stepKeys(dt) {
    if (!ready || flight || collapse || reduceMotion) return;
    if (keys.size && rig.active) rigCancel();
    _acc.set(0, 0, 0);
    // W/S along the line of sight (so you fly where you look), A/D
    // sideways on the level, Q/E straight down and up.
    camera.getWorldDirection(_f).normalize();
    _r.crossVectors(_f, _u); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize();
    if (keys.has('w') || keys.has('arrowup')) _acc.add(_f);
    if (keys.has('s') || keys.has('arrowdown')) _acc.sub(_f);
    if (keys.has('d') || keys.has('arrowright')) _acc.add(_r);
    if (keys.has('a') || keys.has('arrowleft')) _acc.sub(_r);
    if (keys.has('e')) _acc.add(_u);
    if (keys.has('q')) _acc.sub(_u);
    const dist = camera.position.distanceTo(controls.target);
    const speed = config.FLY_SPEED * Math.max(0.6, dist) * (boost ? config.FLY_BOOST : 1);
    if (_acc.lengthSq() > 0) { _acc.normalize().multiplyScalar(speed * config.FLY_DAMP * dt); vel.add(_acc); }
    vel.multiplyScalar(Math.max(0, 1 - config.FLY_DAMP * dt));
    if (vel.lengthSq() > 1e-8) {
      const step = vel.clone().multiplyScalar(dt);
      camera.position.add(step); controls.target.add(step);
      if (focus !== null) letGo();
    }
  }

  /* ── The map (2D, bottom corner) ── */
  const mapCtx = mapEl ? mapEl.getContext('2d') : null;
  const _mp = new THREE.Vector3();
  function drawMap() {
    if (!mapCtx || !ready) return;
    const W = mapEl.width, H = mapEl.height, cx = W / 2, cy = H / 2;
    const k = (W / 2 - 8) / (outerOrbit + 0.4);
    mapCtx.clearRect(0, 0, W, H);
    mapCtx.strokeStyle = 'rgba(255,255,255,0.14)'; mapCtx.lineWidth = 1;
    for (const p of planets) { if (!p) continue; mapCtx.beginPath(); mapCtx.arc(cx, cy, p.orbitR * k, 0, Math.PI * 2); mapCtx.stroke(); }
    mapCtx.fillStyle = '#000'; mapCtx.strokeStyle = '#F2D28B'; mapCtx.beginPath(); mapCtx.arc(cx, cy, 3, 0, Math.PI * 2); mapCtx.fill(); mapCtx.stroke();
    for (const p of planets) {
      if (!p) continue; p.body.group.getWorldPosition(_mp);
      mapCtx.fillStyle = focus === p.index ? '#F2D28B' : (hot === p.index ? '#FFFFFF' : 'rgba(230,233,242,0.85)');
      mapCtx.beginPath(); mapCtx.arc(cx + _mp.x * k, cy + _mp.z * k, focus === p.index ? 3 : 2, 0, Math.PI * 2); mapCtx.fill();
    }
    // The camera: a dot with its view line.
    const cxp = cx + camera.position.x * k, cyp = cy + camera.position.z * k;
    const txp = cx + controls.target.x * k, typ = cy + controls.target.z * k;
    mapCtx.strokeStyle = 'rgba(143,180,255,0.6)'; mapCtx.beginPath(); mapCtx.moveTo(cxp, cyp); mapCtx.lineTo(txp, typ); mapCtx.stroke();
    mapCtx.fillStyle = '#8FB4FF'; mapCtx.beginPath(); mapCtx.arc(Math.max(2, Math.min(W - 2, cxp)), Math.max(2, Math.min(H - 2, cyp)), 2.5, 0, Math.PI * 2); mapCtx.fill();
  }

  /* ── The collapse ──
     Clicking Koaik swallows everything, and there is no way back:
     it ends on NEXT_PAGE. All of it is a function of the seconds since
     the click (so it cannot drift): each project's `fall` (0 on its
     orbit, 1 inside the hole) goes up inner-first; then the sky itself
     falls in (galaxy.js, `window.galaxySky.swallow`, aimed at the hole
     on screen); the hole implodes, flashes, sends a shockwave through
     the empty orbits; the screen goes black (`.sys-void`) and the page
     changes. The camera is taken to the overview for it, the controls
     and the HUD are gone. */
  let collapse = null;                 // { t0, T, left } while it plays
  const easeInCubic = t => t * t * t;
  let voidEl = null;
  function collapseTimes() {
    const n = Math.max(1, planets.filter(Boolean).length);
    const endIn = config.FALL_START + config.FALL_STAGGER * (n - 1) + config.FALL_DUR + 0.07 * (n - 1);
    const sky0 = endIn + config.SKY_DELAY, sky1 = sky0 + config.SKY_DUR;
    const flash = sky1, implode = flash - config.IMPLODE;
    const black = flash + config.TO_BLACK;
    return { endIn, sky0, sky1, implode, flash, black, leave: black + config.LEAVE_HOLD };
  }
  function startCollapse() {
    if (!ready || flight || collapse || !emblemsLive) return;
    collapse = { t0: performance.now(), T: collapseTimes(), left: false };
    setHot(null);
    letGo();                                   // closes any card
    controls.enabled = false;
    keys.clear(); vel.set(0, 0, 0);
    rigTo(overviewPose(), null);
    section.classList.add('is-collapsing');
    if (!voidEl) { voidEl = document.createElement('div'); voidEl.className = 'sys-void'; voidEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(voidEl); }
    dispatch('system:collapse', { phase: 'start' });
  }
  /* Coming BACK to this page from the next one (bfcache) would restore
     the swallowed, black screen: start the page over instead. */
  window.addEventListener('pageshow', e => { if (e.persisted && collapse) location.reload(); });
  /* Per frame: sets every project's fall, drives the sky, returns the
     hole's own state. */
  const COLL_IDLE = { core: 1, feed: 1, flash: 0, shockR: 0, shockA: 0 };
  const _hole = new THREE.Vector3();
  function stepCollapse(now) {
    if (!collapse) return COLL_IDLE;
    const ct = (now - collapse.t0) / 1000, T = collapse.T;
    let sum = 0, n = 0;
    for (const p of planets) {
      if (!p) continue;
      const i = p.index;
      const u = Math.min(1, Math.max(0, (ct - config.FALL_START - config.FALL_STAGGER * i) / (config.FALL_DUR + 0.07 * i)));
      p.fall = u * u;                                          // accelerating in
      sum += p.fall; n++;
    }
    const mean = n ? sum / n : 0;
    // The sky: eased in, so it starts as a creep and ends as a rush.
    const sky = Math.min(1, Math.max(0, (ct - T.sky0) / config.SKY_DUR));
    const skyAmt = reduceMotion ? 0 : sky * sky * (3 - 2 * sky) * 0.6 + easeInCubic(sky) * 0.4;
    if (window.galaxySky) {
      sun.group.getWorldPosition(_hole).project(camera);
      window.galaxySky.swallow(skyAmt, _hole.x * 0.5 + 0.5, _hole.y * 0.5 + 0.5);
    }
    let core = 1, feed = 1 + 1.8 * mean + 1.6 * skyAmt;
    if (ct >= T.implode && ct < T.flash) { const u = (ct - T.implode) / config.IMPLODE; core = 1 - 0.97 * easeInCubic(u); feed += 2 * u; }
    else if (ct >= T.flash) core = 0;
    const tf = ct - T.flash;
    const flash = tf < 0 ? 0 : Math.exp(-tf * 3.2);
    const sr = tf < 0 ? 0 : Math.min(1, tf / 2.0);
    const shockR = 0.8 * easeOutCubic(sr), shockA = tf < 0 || sr >= 1 ? 0 : Math.pow(1 - sr, 2.0) * 1.2;
    // Black: over the flash's tail (reduced motion: a plain fade from the start of the sky).
    const b = reduceMotion ? smooth01((ct - T.sky0) / 1.2) : smooth01((ct - T.flash) / config.TO_BLACK);
    if (voidEl) voidEl.style.opacity = b.toFixed(3);
    if (ct >= (reduceMotion ? T.sky0 + 1.4 : T.leave) && !collapse.left) {
      collapse.left = true;
      dispatch('system:collapse', { phase: 'end' });
      location.assign(config.NEXT_PAGE);
    }
    return { core, feed, flash: reduceMotion ? 0 : flash, shockR, shockA: reduceMotion ? 0 : shockA };
  }
  /* The hole, per frame: billboards face the reader; the lensed arcs
     follow the disk's axis on screen; the disk turns (in its shader). */
  const _axis = new THREE.Vector3();
  function stepBlackHole(cs) {
    sun.shadow.quaternion.copy(camera.quaternion);
    sun.glow.quaternion.copy(camera.quaternion);
    flashMesh.quaternion.copy(camera.quaternion);
    _axis.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    const g = sun.glow.material.uniforms, dk = sun.disk.material.uniforms;
    const len = Math.hypot(_axis.x, _axis.y);
    if (len > 1e-4) g.uAxis.value.set(_axis.x / len, _axis.y / len);
    g.uFace.value = Math.abs(_axis.z);
    g.uTime.value = dk.uTime.value = orbitU.uTime.value = time;
    // The orbits' lens: the hole's Einstein radius in drawing-buffer px.
    // Scales with the shadow, so it shrinks with it in the collapse.
    renderer.getDrawingBufferSize(orbitU.uRes.value);
    sun.group.getWorldPosition(orbitU.uHole.value);
    const pxPerUnit = orbitU.uRes.value.y * 0.5 / (Math.tan(THREE.MathUtils.degToRad(config.FOV) / 2) * Math.max(0.1, camera.position.distanceTo(orbitU.uHole.value)));
    orbitU.uLens.value = config.LENS_K * sun.mesh.scale.x * pxPerUnit;
    orbitU.uWidth.value = config.ORBIT_WIDTH * renderer.getPixelRatio();
    g.uFeed.value = dk.uFeed.value = cs.feed;
    coreLight.intensity = 3.2 * Math.min(1.6, 0.25 + 0.75 * cs.core * cs.feed) + 30 * cs.flash;
    flashMesh.visible = cs.flash > 0.002;
    flashMesh.material.uniforms.uFlash.value = cs.flash;
    shock.visible = cs.shockA > 0.002;
    shock.scale.setScalar(outerOrbit * 1.6);
    shockMat.uniforms.uR.value = cs.shockR;
    shockMat.uniforms.uA.value = cs.shockA;
  }

  /* ── The frame ── */
  const _tmp = new THREE.Vector3(), _loc = new THREE.Vector3();
  const trackPrev = new THREE.Vector3(), _trk = new THREE.Vector3();
  function frame(now) {
    if (document.hidden || !resize()) return;
    const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016);
    lastNow = now;
    if (!armed && !reduceMotion) { renderer.clear(); return; }
    if (!sun) return;
    if (!reduceMotion) time += dt;

    // Build the projects one per frame, after Koaik (and once the
    // fonts their canvases use are in), then compile them together.
    if (fontsReady && planetsMade < projects.length) {
      makePlanet(planetsMade); planetsMade++;
      if (planetsMade === projects.length) { makeLabels(); goLive(); }
    }

    // Koaik: grow in, then hold (and shrink to a point in the collapse).
    const rev = reduceMotion ? 1 : !revealAt ? 0 : Math.min(1, (now - revealAt) / config.REVEAL_MS);
    const s = reduceMotion ? 1 : 0.02 + 0.98 * easeOutCubic(rev);
    const cs = stepCollapse(now);
    sun.mesh.scale.setScalar(Math.max(1e-4, config.BH_R * s * cs.core));

    // The pull-back: a beat after the reveal, out to the overview.
    if (!pullAt && (reduceMotion || (revealAt && now - revealAt >= config.REVEAL_MS + config.PULLBACK_DELAY_MS))) {
      pullAt = now;
      if (reduceMotion) { const o = overviewPose(); camera.position.copy(o.pos); controls.target.copy(o.target); camera.lookAt(o.target); becomeReady(); }
      else fly(overviewPose(), config.PULLBACK_MS, becomeReady);
    }
    const pull = !pullAt ? 0 : reduceMotion ? 1 : Math.min(1, (now - pullAt) / config.PULLBACK_MS);
    // The system is revealed in order as the camera pulls back: each
    // orbit draws itself from its planet's position, then the planet
    // grows in on it, the next one a beat behind — inner to outer.
    for (const p of planets) {
      if (!p) continue;
      const start = 0.22 + 0.06 * p.index;
      const q = reduceMotion ? 1 : smooth01((pull - start) / 0.30);
      const drawn = Math.round(q * p.orbitPts) + 1;
      p.ring.geometry.setDrawRange(0, 6 * Math.max(0, Math.min(p.orbitPts, drawn - 1)));   // indices: 6 per segment
      p.born = !emblemsLive ? 0 : reduceMotion ? 1 : smooth01((pull - start - 0.10) / 0.28);
      // In the collapse: stretched toward the hole, then gone into it.
      const f = p.fall;
      const gone = 1 - smooth01((f - 0.78) / 0.22);
      if (emblemsLive) p.body.mesh.scale.setScalar(Math.max(1e-4, p.body.radius * easeOutBack(p.born) * gone));
      const st = reduceMotion ? 1 : 1 + 2.6 * smooth01((f - 0.35) / 0.55);
      p.body.stretchA.scale.set(st, 1 / Math.sqrt(st), 1 / Math.sqrt(st));
      p.ring.scale.setScalar(reduceMotion ? 1 : Math.max(1e-3, 1 - f));
      p.ringMat.uniforms.uOpacity.value = (p.index === focus ? 1.0 : p.index === hot ? 0.80 : 0.50) * Math.min(1, q * 1.5) * (1 - smooth01(f / 0.7));
    }
    // The caption: in with the reveal, out with the pull-back.
    const pin = Math.round(smooth01((rev - 0.55) / 0.45) * (1 - smooth01(pull / 0.4)) * 100) / 100;
    if (pin !== lastIn) { lastIn = pin; root.style.setProperty('--planet-in', pin.toFixed(2)); }

    // Motion. A falling project speeds up as it closes in (Kepler,
    // capped); the extra angle it gains is kept, so it comes back out
    // of the hole wherever the spiral left it, with no jump.
    for (const p of planets) {
      if (!p) continue;
      const w = 2 * Math.PI / p.period;
      const rf = reduceMotion ? 1 : 1 - p.fall;
      if (!reduceMotion && p.fall > 0) p.swirl += dt * Math.min(config.SWIRL_MAX, w * (Math.pow(1 / Math.max(rf, 0.05), 1.5) - 1));
      const a = p.phase + (reduceMotion ? 0 : time * w) + p.swirl;
      p.body.group.position.set(Math.cos(a) * p.orbitR * rf, 0, Math.sin(a) * p.orbitR * rf);
      p.body.stretchA.rotation.y = -a;       // radial frame for the stretch…
      p.body.stretchB.rotation.y = a;        // …and back, so the emblem itself does not turn
    }

    // Camera: a flight, the reader's flying, or the controls; when a
    // body is in focus the target rides along with it, and zooming
    // far enough out lets it go. Left alone at the overview, the view
    // drifts slowly round the system.
    stepFlight(now);
    stepKeys(dt);
    stepRig(dt);
    // Following a selected body: carry the camera by the body's own
    // frame-to-frame motion, so whatever view the reader has made
    // around it is kept, and nothing ever jumps to re-centre.
    if (!flight && !rig.active && focus !== null) {
      const body = focus === 'pilot' ? sun : planets[focus].body;
      body.group.getWorldPosition(_tmp);
      if (trackValid) { _trk.copy(_tmp).sub(trackPrev); controls.target.add(_trk); camera.position.add(_trk); }
      trackPrev.copy(_tmp); trackValid = true;
      if (camera.position.distanceTo(body.group.getWorldPosition(_tmp)) > body.radius * config.LET_GO) letGo();
    } else trackValid = false;
    if (ready && !flight && !rig.active && focus === null && !reduceMotion && !keys.size && now - lastTouch > config.IDLE_MS) controls.autoRotate = true;
    if (controls.enabled && !rig.active) controls.update();
    stepShift(dt);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    stepBlackHole(cs);

    // The emblems: a slow turn, or — when selected and it has a front
    // (a screen, numbers) — turning to face the reader; then their own
    // animation, with canvas redraws only while big enough to read.
    const halfH = Math.tan(THREE.MathUtils.degToRad(config.FOV) / 2);
    for (const p of planets) {
      if (!p || !emblemsLive || p.born <= 0) continue;
      const b = p.body, em = b.emblem;
      b.group.getWorldPosition(_tmp);
      p.rPx = b.radius / (_tmp.distanceTo(camera.position) * halfH) * (vh / 2);
      const kf = 1 - Math.exp(-config.EMBLEM_FACE * dt);
      let pitchGoal = 0;
      if (em.front && focus === p.index) {
        _loc.copy(camera.position); b.group.worldToLocal(_loc);
        let goal = Math.atan2(_loc.x, _loc.z), d = goal - b.spin;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        b.spin += d * kf;
        // A screen also tilts back to meet a reader looking down on it.
        if (em.front === 'full') pitchGoal = -0.85 * Math.atan2(_loc.y, Math.hypot(_loc.x, _loc.z));
      } else if (!reduceMotion) b.spin += config.EMBLEM_SPIN * dt;
      b.pitch += (pitchGoal - b.pitch) * kf;
      b.mesh.rotation.set(b.pitch, b.spin, 0, 'YXZ');
      em.update({ dt: reduceMotion ? 0 : dt, t: time, camera, detail: p.rPx > config.DETAIL_PX });
    }

    renderer.render(scene, camera);
    placeLabels(vw, vh, now, dt);
    drawMap();
  }
  function becomeReady() {
    if (ready) return;
    ready = true;
    readyAt = performance.now();
    lastTouch = readyAt;
    controls.enabled = true;
    section.classList.add('is-system');
    dispatch('system:ready', {});
  }

  /* ── Build Koaik and start ── */
  function build() {
    if (sun) return;
    try {
      sun = makeBlackHole();
    } catch (e) { console.error(e); fail(); return; }
    const a = arrivalPose();
    camera.position.copy(a.pos); controls.target.copy(a.target); camera.lookAt(a.target);
    if (!projects.length) makeLabels();
  }
  renderer.setAnimationLoop(frame);
  window.addEventListener('resize', () => { resize(); });

  window.koaik = {
    arm() {
      if (reduceMotion) return;
      armed = true; revealAt = 0; pullAt = 0;
      lastIn = 0; root.style.setProperty('--planet-in', '0');
      resize();
      build();
    },
    reveal() {
      if (!armed || !sun) return;
      revealAt = performance.now();
    },
  };
  /* Reduced motion: no arrival, the system is simply there once the
     section exists. */
  if (reduceMotion) { armed = true; resize(); build(); }

  window.system = {
    select, overview, collapse: startCollapse,
    state: () => ({ ready, focus, hot, planets: planets.filter(Boolean).length, dist: +camera.position.distanceTo(controls.target).toFixed(2), flying: !!flight || rig.active,
      collapsing: collapse ? +((performance.now() - collapse.t0) / 1000).toFixed(2) : null }),
    /* For the harness: where the camera is and where a body sits on
       screen (NDC), so motion can be measured frame by frame. */
    pose: (which) => {
      const body = which === 'pilot' ? sun : (planets[which] && planets[which].body);
      const out = { cam: camera.position.toArray().map(v => +v.toFixed(4)), target: controls.target.toArray().map(v => +v.toFixed(4)) };
      if (body) { const p = new THREE.Vector3(); body.group.getWorldPosition(p); out.body = p.toArray().map(v => +v.toFixed(4)); out.dist = +p.distanceTo(camera.position).toFixed(4); p.project(camera); out.ndc = [+p.x.toFixed(4), +p.y.toFixed(4)]; }
      return out;
    },
    bodies: () => planets.filter(Boolean).map(p => ({ index: p.index, name: projects[p.index].name, emblem: p.kind, orbitR: +p.orbitR.toFixed(2), radius: p.body.radius, live: emblemsLive })),
  };
})();
