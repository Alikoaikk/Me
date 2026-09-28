/* ============================================================
   THE KOAIK SYSTEM — the destination, and the portfolio as space
   ------------------------------------------------------------
   The warp lands the reader above Koaik (Ali's own world). The camera
   then pulls back and Koaik turns out to be the star of a system:
   every finished project is a planet on its own orbit around it. The
   reader can move through the system — drag to orbit, scroll or pinch
   to zoom, arrow keys / WASD to fly — hover a planet for its name, and
   click or tap one to fly to it and open its panel (hud.js). Clicking
   Koaik opens the pilot's card.

   three.js (vendored, js/vendor/three) does the scene, the camera,
   the controls and the picking. Every world is GENERATED: no image
   files. Two bake passes per body write an equirectangular surface
   (colour + altitude) and an aux map (slopes, clouds, lights) from 3D
   simplex noise, parameterised by a LOOK — sea level, palette, caps,
   clouds, glow, gas banding — so nine projects give nine different
   planets from one shader. Per frame each body is a textured sphere
   with relief, drifting clouds and their shadows, a glint on liquid,
   lights (or lava) on the night side, an atmosphere rim; Koaik also
   wears a corona. The galaxy canvas stays fixed underneath as the
   sky: this canvas is transparent.

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
    /* Koaik. Three numbers pick everything about it. */
    SEED:       [3.7, 11.2, 5.9],
    SUN_R:      1.0,                    // world units; everything is scaled to this
    BAKE_W:     2048,                   // Koaik's map width (POT); height is half
    BUMP:       0.075,                  // relief strength
    CLOUD_DRIFT: 0.18,                  // cloud layer's extra spin, fraction of the spin
    TILT:       21 * Math.PI / 180,
    SPIN:       0.07,                   // rad/s, Koaik
    HALO:       1.45,                   // corona quad radius, in radii
    HALO_COLOR: [0.85, 0.78, 0.62],     // warm: this world is the star of the system
    HALO_STRENGTH: 0.9,

    /* The camera. */
    FOV:        45,                     // degrees
    FILL:       0.72,                   // arrival: Koaik's diameter / limiting viewport dimension
    RAISE:      0.05,                   // arrival: Koaik above the middle, in view heights
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
    FOCUS_DIST_SUN: 3.1,
    FOCUS_FILL_PORTRAIT: 0.62,          // planet view on a tall screen: body diameter / screen width, at most
    SUNWARD:    0.55,                   // planet view: how far toward the lit side the camera swings
    LET_GO:     14,                     // zooming out past this many radii releases a focused planet
    MIN_DIST:   1.6,                    // zoom limits, in the focused body's radii
    MAX_DIST:   60,
    FLY_SPEED:  0.9,                    // keyboard flight, in (distance to target) per second
    FLY_BOOST:  3.0,                    // with Shift
    FLY_DAMP:   5.0,
    IDLE_MS:    7000,                   // untouched this long at the overview: the view drifts
    DRIFT:      0.22,                   // that drift, in OrbitControls autoRotate units (2 = one turn per 30 s)

    /* The orbits. */
    ORBIT_0:    2.5,                    // innermost radius
    ORBIT_STEP: 1.0,
    EMBLEM_R:   0.55,                   // a project's size (radius of its solid parts), world units
    EMBLEM_SPIN: 0.14,                  // rad/s, its slow turn when not selected
    EMBLEM_FACE: 3.0,                   // how briskly a selected project turns to face the reader
    DETAIL_PX:  26,                     // below this on-screen radius, skip canvas redraws
    PERIOD_0:   48,                     // seconds for the innermost; Kepler (r^1.5) beyond

    SEGMENTS:   96,
    RINGS:      64,
  };

  /* ── Koaik's look ──  (the projects are emblems: see emblems.js)
     Colours are sRGB 0..1 (the bake writes them; the globe shader
     linearises). sea: below this noise height is liquid; base: where
     land altitude starts (so a dry world can have no sea but normal
     hills); cap: polar caps; cloud: 1 = Koaik's cover; glow: night
     lights (or lava) colour and strength; rim: atmosphere colour;
     band: 1 = gas giant (bands instead of terrain). */
  const LOOKS = {
    terra:  { sea: 0.035, base: 0.035, shelf: [.16,.47,.62], deep: [.035,.12,.34], sand: [.80,.72,.50], grass: [.24,.42,.17], forest: [.12,.30,.12], dry: [.62,.50,.30], rock: [.42,.38,.33], snow: [.93,.95,.97], cap: [.90,.94,.98], capAmt: 1, cloud: 1, glow: [1,.80,.50], glowAmt: 2.4, rim: [.30,.56,1.0], spec: 1 },
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

  const QUAD_VS = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  /* Shared by both bake passes: the map's uv -> a unit direction, and
     the terrain. The uv convention MUST match the sphere's (see
     makeSphere below and the tangents in the globe shader). */
  const BAKE_COMMON = NOISE + `
    uniform vec3 uSeed;
    uniform float uSea, uBase, uBand;
    const float PI = 3.14159265;
    vec3 dirFromUv(vec2 uv) {
      float th = (1.0 - uv.x) * 2.0 * PI;
      float lat = (0.5 - uv.y) * PI;
      float cl = cos(lat);
      return vec3(cl * cos(th), sin(lat), cl * sin(th));
    }
    float fbm(vec3 q, int oct) {
      float h = 0.0, a = 0.5, f = 1.0;
      for (int i = 0; i < 8; i++) {
        if (i >= oct) break;
        h += a * snoise(q * f);
        f *= 2.03; a *= 0.5;
      }
      return h;
    }
    /* Signed height: < uSea is liquid. Broad continents from low
       octaves, ridged mountain chains added only on land. */
    float terrain(vec3 p) {
      vec3 q = p * 1.45 + uSeed;
      float h = fbm(q, 7);
      float land = smoothstep(uSea - 0.02, uSea + 0.22, h);
      float r = 1.0 - abs(snoise(q * 2.6 + 7.7));
      r = r * r * (0.6 + 0.4 * snoise(q * 5.1 - 2.2));
      return h + 0.34 * r * land;
    }
    /* Gas giants: latitude bands, warped, no relief. */
    float bands(vec3 p) {
      float w = 0.35 * fbm(p * 1.6 + uSeed, 4);
      return 0.5 + 0.5 * sin((p.y + w) * 9.0 + 0.6 * snoise(p * 3.0 + uSeed.yzx));
    }`;

  /* Pass 1 → surface: rgb colour, a = altitude (0 liquid, else land
     0.08..1). Colour comes from height, latitude, and a moisture
     field that puts dry lowlands on some continents. */
  const BAKE_SURF_FS = `
    precision highp float;
    varying vec2 vUv;
    ${BAKE_COMMON}
    uniform vec3 uShelf, uDeep, uSand, uGrass, uForest, uDry, uRock, uSnow, uCap;
    uniform vec3 uBandA, uBandB, uBandC;
    uniform float uCapAmt;
    void main() {
      vec3 p = dirFromUv(vUv);
      float lat = abs(p.y);
      vec3 col; float alt;
      if (uBand > 0.5) {
        float b = bands(p);
        float d = 0.5 + 0.5 * fbm(p * 4.0 + uSeed.zxy, 3);
        col = mix(uBandA, uBandB, smoothstep(0.2, 0.8, b));
        col = mix(col, uBandC, smoothstep(0.55, 0.95, d * b));
        alt = 0.3;
      } else {
        float h = terrain(p);
        float moist = 0.5 + 0.5 * fbm(p * 2.2 + uSeed.zxy, 4);
        if (h < uSea) {
          float d = clamp((uSea - h) / 0.30, 0.0, 1.0);
          col = mix(uShelf, uDeep, smoothstep(0.0, 0.32, d));
          alt = 0.0;
        } else {
          float a = clamp((h - uBase) / 0.62, 0.0, 1.0);
          vec3 low = mix(uGrass, uForest, smoothstep(0.35, 0.75, moist));
          low = mix(uDry, low, smoothstep(0.28, 0.5, moist + 0.35 * lat));
          col = mix(uSand, low, smoothstep(0.0, 0.05, a));
          col = mix(col, uRock, smoothstep(0.34, 0.60, a));
          col = mix(col, uSnow, smoothstep(0.74, 0.90, a + 0.35 * pow(lat, 3.0)));
          alt = 0.08 + 0.92 * a;
        }
        // Polar caps, with a ragged noisy edge.
        float cap = smoothstep(0.80, 0.86, lat + 0.05 * snoise(p * 9.0 + uSeed)) * uCapAmt;
        col = mix(col, uCap, cap);
        alt = mix(alt, max(alt, 0.12), cap);
      }
      gl_FragColor = vec4(col, alt);
    }`;

  /* Pass 2 → aux: r,g = slope along u and v (0.5 = flat), b = cloud
     cover, a = night lights. Slopes come from finite differences of
     the terrain in the same uv space the globe shader's tangents
     follow. */
  const BAKE_AUX_FS = `
    precision highp float;
    varying vec2 vUv;
    ${BAKE_COMMON}
    uniform float uTexel, uCloudAmt, uLightsAmt;
    void main() {
      vec3 p = dirFromUv(vUv);
      float su = 0.0, sv = 0.0, lights = 0.0, cloud;
      if (uBand > 0.5) {
        // Streaky weather along the bands, thinner at the poles.
        float c = fbm(vec3(p.x, p.y * 5.0, p.z) * 2.1 + uSeed.yzx, 5) * 0.8 + 0.25 * fbm(p * 6.5 - uSeed, 3);
        float shift = (1.0 - uCloudAmt) * 0.3;
        cloud = smoothstep(0.03 + shift, 0.42 + shift, c) * (1.0 - 0.5 * pow(abs(p.y), 4.0));
      } else {
        float h  = max(terrain(p), uSea);
        float e = uTexel;
        float cl = max(cos((0.5 - vUv.y) * PI), 0.05);
        float hu = max(terrain(dirFromUv(vUv + vec2(e, 0.0))), uSea);
        float hv = max(terrain(dirFromUv(vUv + vec2(0.0, e))), uSea);
        su = (hu - h) / (e * 2.0 * PI * cl);   // per radian of arc
        sv = (hv - h) / (e * PI);
        // Clouds: two scales of fbm, thresholded, thinner at the poles.
        float c = fbm(p * 2.1 + uSeed.yzx, 5) * 0.8 + 0.25 * fbm(p * 6.5 - uSeed, 3);
        float shift = (1.0 - uCloudAmt) * 0.3;
        cloud = smoothstep(0.03 + shift, 0.42 + shift, c) * (1.0 - 0.5 * pow(abs(p.y), 4.0));
        // Lights: clusters on low land, mostly near the coasts.
        float hRaw = terrain(p);
        float lowland = smoothstep(uSea, uSea + 0.01, hRaw) * (1.0 - smoothstep(uSea + 0.10, uSea + 0.30, hRaw));
        float cluster = smoothstep(0.45, 0.85, snoise(p * 7.0 + uSeed.zyx));
        float dots = smoothstep(0.35, 0.9, snoise(p * 48.0 + uSeed) * 0.6 + snoise(p * 120.0) * 0.4);
        lights = lowland * cluster * dots * (1.0 - smoothstep(0.7, 0.85, abs(p.y))) * uLightsAmt;
      }
      gl_FragColor = vec4(0.5 + clamp(su / 24.0, -0.5, 0.5),
                          0.5 + clamp(sv / 24.0, -0.5, 0.5),
                          cloud, lights);
    }`;

  /* The globe. Tangents along +u and +v of the map (matching
     dirFromUv in the bake) are carried to view space per vertex, so
     the baked slopes can bend the normal there. */
  const GLOBE_VS = `
    varying vec3 vN, vTu, vTv, vP;
    varying vec2 vUv;
    void main() {
      vec4 p = modelViewMatrix * vec4(position, 1.0);
      vP = p.xyz;
      vec3 No = normalize(position);
      vec3 Tu = normalize(vec3(No.z, 0.0, -No.x));
      vec3 Tv = normalize(cross(Tu, No));
      vN  = normalMatrix * No;
      vTu = normalMatrix * Tu;
      vTv = normalMatrix * Tv;
      vUv = uv;
      gl_Position = projectionMatrix * p;
    }`;

  const GLOBE_FS = `
    precision highp float;
    uniform sampler2D uSurf, uAux;
    uniform vec3 uLight, uGlowColor, uRimColor;
    uniform float uCloudShift, uGlowAmt, uSpec, uFade, uAmbient;
    varying vec3 vN, vTu, vTv, vP;
    varying vec2 vUv;
    void main() {
      vec3 N0 = normalize(vN);
      vec3 V = normalize(-vP);
      vec3 L = normalize(uLight);

      vec4 surf = texture2D(uSurf, vUv);
      vec4 aux  = texture2D(uAux, vUv);
      float water = 1.0 - smoothstep(0.02, 0.06, surf.a);

      float su = (aux.r - 0.5) * 24.0, sv = (aux.g - 0.5) * 24.0;
      vec3 N = normalize(N0 - ${config.BUMP.toFixed(4)} * (su * normalize(vTu) + sv * normalize(vTv)));

      float ndl0 = dot(N0, L);
      float lit  = smoothstep(-0.10, 0.28, ndl0);          // soft terminator
      float diff = max(dot(N, L), 0.0) * (1.0 - water) + max(ndl0, 0.0) * water;

      vec3 base = pow(surf.rgb, vec3(2.2));
      vec3 col = base * (uAmbient + 1.15 * diff);

      // Clouds drift over the surface; their shadow trails them.
      vec2 cuv = vec2(vUv.x + uCloudShift, vUv.y);
      float cloud = texture2D(uAux, cuv).b;
      float shade = texture2D(uAux, cuv + vec2(0.006, -0.004)).b;
      col *= 1.0 - 0.45 * shade * lit;

      // Glint on the liquid, tight and modest.
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N0, H), 0.0), 220.0) * water * 0.16 * lit * (1.0 - cloud) * uSpec;
      col += vec3(0.80, 0.90, 1.0) * spec;

      // Lights (or lava) where the sun is down and the sky is clear.
      col += uGlowColor * aux.a * uGlowAmt * (1.0 - lit) * (1.0 - cloud * 0.8);

      // The cloud layer itself, lit like the sphere, over everything.
      vec3 cloudCol = vec3(0.98, 0.99, 1.0) * (0.03 + 1.05 * max(ndl0, 0.0));
      col = mix(col, cloudCol, cloud * 0.92);

      // Atmosphere on the disc: a rim, brighter on the day side.
      float fres = pow(1.0 - max(dot(N0, V), 0.0), 3.0);
      col += uRimColor * fres * (0.08 + 0.60 * lit);

      col = pow(col, vec3(1.0 / 2.2));
      gl_FragColor = vec4(col * uFade, uFade);   // premultiplied
    }`;

  /* The corona: a camera-facing quad through the body's centre, drawn
     after the globe with the depth test on, so the near half of the
     sphere hides it and it only shows past the limb. */
  const HALO_VS = `
    uniform float uHalo;
    varying vec2 vQ;
    void main() {
      vQ = (uv * 2.0 - 1.0) * uHalo;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const HALO_FS = `
    precision highp float;
    uniform vec2 uLightXY;
    uniform vec3 uColor;
    uniform float uHalo, uStrength, uFade;
    varying vec2 vQ;
    void main() {
      float d = length(vQ);
      float t = clamp((uHalo - d) / (uHalo - 1.0), 0.0, 1.0);
      float i = t * t * t;
      float sun = 0.40 + 0.60 * smoothstep(-0.7, 0.7, dot(normalize(vQ), uLightXY));
      float a = i * sun * uStrength * uFade;
      gl_FragColor = vec4(uColor * a, a);   // premultiplied
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

  /* ── Geometry: a sphere whose uv is the inverse of dirFromUv ── */
  function makeSphere(seg, rings) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= rings; i++) {
      const phi = Math.PI * i / rings, sp = Math.sin(phi), cp = Math.cos(phi);
      for (let j = 0; j <= seg; j++) {
        const th = 2 * Math.PI * j / seg;
        pos.push(sp * Math.cos(th), cp, sp * Math.sin(th));
        /* u = 1 - th / 2pi, v = phi / pi: east on the map is
           screen-right from the front. */
        uv.push(1 - j / seg, i / rings);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);   // counter-clockwise from outside
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  const sphereGeo = makeSphere(config.SEGMENTS, config.RINGS);
  const quadGeo = new THREE.PlaneGeometry(2, 2);

  /* ── Baking ── */
  const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeScene = new THREE.Scene();
  const bakeQuad = new THREE.Mesh(quadGeo, null);
  bakeScene.add(bakeQuad);
  const surfMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS, fragmentShader: BAKE_SURF_FS, depthTest: false, depthWrite: false,
    uniforms: { uSeed: { value: new THREE.Vector3() }, uSea: { value: 0 }, uBase: { value: 0 }, uBand: { value: 0 }, uCapAmt: { value: 1 },
      uShelf: { value: new THREE.Vector3() }, uDeep: { value: new THREE.Vector3() }, uSand: { value: new THREE.Vector3() }, uGrass: { value: new THREE.Vector3() },
      uForest: { value: new THREE.Vector3() }, uDry: { value: new THREE.Vector3() }, uRock: { value: new THREE.Vector3() }, uSnow: { value: new THREE.Vector3() }, uCap: { value: new THREE.Vector3() },
      uBandA: { value: new THREE.Vector3() }, uBandB: { value: new THREE.Vector3() }, uBandC: { value: new THREE.Vector3() } },
  });
  const auxMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS, fragmentShader: BAKE_AUX_FS, depthTest: false, depthWrite: false,
    uniforms: { uSeed: { value: new THREE.Vector3() }, uSea: { value: 0 }, uBase: { value: 0 }, uBand: { value: 0 },
      uTexel: { value: 1 / 2048 }, uCloudAmt: { value: 1 }, uLightsAmt: { value: 1 } },
  });
  function bake(material, w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()), colorSpace: THREE.NoColorSpace,
    });
    bakeQuad.material = material;
    renderer.setRenderTarget(rt);
    renderer.render(bakeScene, bakeCam);
    renderer.setRenderTarget(null);
    return rt.texture;
  }
  function bakeWorld(look, seed, w) {
    const u = surfMat.uniforms;
    u.uSeed.value.set(seed[0], seed[1], seed[2]);
    u.uSea.value = look.sea; u.uBase.value = look.base; u.uBand.value = look.band ? 1 : 0; u.uCapAmt.value = look.capAmt;
    for (const k of ['shelf', 'deep', 'sand', 'grass', 'forest', 'dry', 'rock', 'snow', 'cap', 'bandA', 'bandB', 'bandC']) {
      const key = 'u' + k[0].toUpperCase() + k.slice(1);
      const c = look[k] || [0, 0, 0];
      u[key].value.set(c[0], c[1], c[2]);
    }
    const a = auxMat.uniforms;
    a.uSeed.value.copy(u.uSeed.value);
    a.uSea.value = look.sea; a.uBase.value = look.base; a.uBand.value = look.band ? 1 : 0;
    a.uTexel.value = 1 / w; a.uCloudAmt.value = look.cloud; a.uLightsAmt.value = look.glowAmt > 0 ? 1 : 0;
    const surf = bake(surfMat, w, w / 2);
    const aux = bake(auxMat, w, w / 2);
    return { surf, aux };
  }

  /* ── Scene ── */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.FOV, 1, 0.05, 400);
  scene.add(camera);

  /* Light for the emblems: Koaik is the sun, so a point light sits in
     it (no falloff: the outer orbits must not go dark); a soft ambient
     and a weak fill that rides with the camera keep the night sides
     readable. Koaik itself is a ShaderMaterial and ignores all three. */
  scene.add(new THREE.PointLight(0xfff0dc, 3.2, 0, 0));
  scene.add(new THREE.AmbientLight(0x8a9ac0, 0.55));
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
  fill.position.set(0.3, 0.4, 0); fill.target.position.set(0, 0, -1);
  camera.add(fill, fill.target);
  const bodies = [];      // every world, Koaik first
  const planets = [];     // the projects

  function makeBody(look, seed, radius, w, opts = {}) {
    const maps = bakeWorld(look, seed, w);
    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOBE_VS, fragmentShader: GLOBE_FS, transparent: true, premultipliedAlpha: true,
      uniforms: {
        uSurf: { value: maps.surf }, uAux: { value: maps.aux },
        uLight: { value: new THREE.Vector3(0, 0, 1) }, uCloudShift: { value: 0 },
        uGlowColor: { value: v3(look.glow) }, uGlowAmt: { value: look.glowAmt },
        uRimColor: { value: v3(look.rim) }, uSpec: { value: look.spec }, uFade: { value: 1 },
        uAmbient: { value: opts.ambient ?? 0.02 },
      },
    });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.scale.setScalar(opts.halo ? radius : 0);   // the projects grow in during the pull-back
    mesh.renderOrder = 1;
    const group = new THREE.Group();   // position only; the mesh spins inside it
    group.add(mesh);
    let halo = null;
    if (opts.halo) {
      const hm = new THREE.ShaderMaterial({
        vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, premultipliedAlpha: true, depthWrite: false,
        uniforms: { uHalo: { value: config.HALO }, uLightXY: { value: new THREE.Vector2(-0.6, 0.5) },
          uColor: { value: v3(config.HALO_COLOR) }, uStrength: { value: config.HALO_STRENGTH }, uFade: { value: 1 } },
      });
      halo = new THREE.Mesh(quadGeo, hm);
      halo.scale.setScalar(radius * config.HALO);
      halo.renderOrder = 2;
      group.add(halo);
    }
    const body = { group, mesh, mat, halo, radius, look, spin: 0, cloud: 0, tilt: opts.tilt ?? config.TILT, spinRate: opts.spinRate ?? config.SPIN };
    bodies.push(body);
    scene.add(group);
    return body;
  }

  /* Koaik, the star of the system: fully lit from wherever the reader
     looks (a sun has no night side), warm corona. */
  let sun = null;
  const sunLightView = new THREE.Vector3(-0.22, 0.28, 0.93).normalize();

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
  function makePlanet(i) {
    const pr = projects[i];
    const w = pr.world || {};
    const radius = w.radius || config.EMBLEM_R;
    const em = makeEmblem(pr);
    const group = new THREE.Group();
    em.root.scale.setScalar(0);
    const body = { group, mesh: em.root, radius, emblem: em, spin: i * 1.3, pitch: 0 };
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
    // dark chord through Koaik and its corona on arrival.
    const ringMat = new THREE.LineBasicMaterial({ color: 0x9aa3b8, transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat);
    ring.geometry.setDrawRange(0, 0);
    plane.add(ring);
    plane.add(group);
    staging.add(em.root);
    const planet = { index: i, body, kind: em.kind, orbitR, period, phase, plane, ring, ringMat, orbitPts: ORBIT_PTS, born: 0, rPx: 0 };
    planets[i] = planet;
    return planet;
  }
  function goLive() {
    const done = () => { for (const p of planets) if (p) p.body.group.add(p.body.mesh); emblemsLive = true; };
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
      b.addEventListener('click', e => { e.stopPropagation(); select(kind === 'pilot' ? 'pilot' : index); });
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
      l.el.style.opacity = ((0.55 + 0.45 * Math.min(1, rPx / 18)) * l.in).toFixed(2);
    });
    if (reticle) {
      if (markOn && markR < h) {
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
  controls.minDistance = config.SUN_R * config.MIN_DIST;
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

  /* Arrival: the camera distance at which Koaik's disc spans FILL of
     the limiting dimension; the angular radius of a sphere at d is
     asin(r/d). */
  function arrivalPose() {
    const fov = THREE.MathUtils.degToRad(config.FOV);
    const halfH = Math.tan(fov / 2);
    const limit = aspect < 1 ? Math.atan(halfH * aspect) : fov / 2;
    const theta = Math.atan(config.FILL * Math.tan(limit));
    const d = config.SUN_R / Math.sin(theta);
    const viewH = 2 * d * halfH;
    return { pos: new THREE.Vector3(0, -config.RAISE * viewH * 0.5, d), target: new THREE.Vector3(0, -config.RAISE * viewH, 0) };
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
    if (!ready || flight) return;          // only the scripted arrival blocks; a move in progress is re-aimed
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
    controls.minDistance = config.SUN_R * config.MIN_DIST;
    if (!quiet) dispatch('system:select', { kind: 'none', index: -1, project: null });
  }
  function overview() {
    if (!ready || flight) return;
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
      const r = body.mesh.scale.x * (body === sun ? 1.0 : 1.1);
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
    if (!ready || flight) return;
    const moved = Math.hypot(e.clientX - pressX, e.clientY - pressY);
    if (moved > 6 || performance.now() - pressT > 500) return;
    const r = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - r.left, e.clientY - r.top);
    if (hit === null) return;
    select(hit);
  });
  canvas.addEventListener('pointermove', e => {
    if (!ready || flight) return;
    // A real drag during a move hands the camera back to the reader.
    if (pressed && rig.active && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 6) rigCancel();
    if (e.pointerType === 'touch') return;
    const r = canvas.getBoundingClientRect();
    setHot(pick(e.clientX - r.left, e.clientY - r.top));
  });
  canvas.addEventListener('wheel', () => { if (rig.active) rigCancel(); }, { passive: true });
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
    if (!ready || flight || reduceMotion) return;
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
    mapCtx.fillStyle = '#F2D28B'; mapCtx.beginPath(); mapCtx.arc(cx, cy, 3.5, 0, Math.PI * 2); mapCtx.fill();
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

    // Koaik: grow in, then hold.
    const rev = reduceMotion ? 1 : !revealAt ? 0 : Math.min(1, (now - revealAt) / config.REVEAL_MS);
    const s = reduceMotion ? 1 : 0.02 + 0.98 * easeOutCubic(rev);
    sun.mesh.scale.setScalar(config.SUN_R * s);
    if (sun.halo) sun.halo.scale.setScalar(config.SUN_R * s * config.HALO);
    if (sun.halo) sun.halo.quaternion.copy(camera.quaternion);

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
      p.ring.geometry.setDrawRange(0, Math.max(0, Math.min(p.orbitPts + 1, drawn)));
      p.born = !emblemsLive ? 0 : reduceMotion ? 1 : smooth01((pull - start - 0.10) / 0.28);
      if (emblemsLive) p.body.mesh.scale.setScalar(Math.max(1e-4, p.body.radius * easeOutBack(p.born)));
      p.ringMat.opacity = (p.index === focus ? 0.55 : p.index === hot ? 0.45 : 0.20) * Math.min(1, q * 1.5);
    }
    // Koaik's corona breathes, very slightly.
    if (sun.halo) sun.halo.material.uniforms.uStrength.value = config.HALO_STRENGTH * (1 + (reduceMotion ? 0 : 0.06 * Math.sin(time * 0.9)));
    // The caption: in with the reveal, out with the pull-back.
    const pin = Math.round(smooth01((rev - 0.55) / 0.45) * (1 - smooth01(pull / 0.4)) * 100) / 100;
    if (pin !== lastIn) { lastIn = pin; root.style.setProperty('--planet-in', pin.toFixed(2)); }

    // Motion.
    if (!reduceMotion) {
      sun.spin += sun.spinRate * dt;
      sun.cloud += sun.spinRate * config.CLOUD_DRIFT * dt / (2 * Math.PI);
    }
    sun.mesh.rotation.set(0, sun.spin, -sun.tilt, 'ZYX');
    sun.mat.uniforms.uCloudShift.value = sun.cloud;
    for (const p of planets) {
      if (!p) continue;
      const a = p.phase + (reduceMotion ? 0 : time * 2 * Math.PI / p.period);
      p.body.group.position.set(Math.cos(a) * p.orbitR, 0, Math.sin(a) * p.orbitR);
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
    sun.mat.uniforms.uLight.value.copy(sunLightView);

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
      sun = makeBody(LOOKS.terra, config.SEED, config.SUN_R, config.BAKE_W, { halo: true, ambient: 0.05 });
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
    select, overview,
    state: () => ({ ready, focus, hot, planets: planets.filter(Boolean).length, dist: +camera.position.distanceTo(controls.target).toFixed(2), flying: !!flight || rig.active }),
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
