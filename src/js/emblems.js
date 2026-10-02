/* ============================================================
   EMBLEMS — each project as a small, living model of itself
   ------------------------------------------------------------
   The bodies that orbit Koaik are not planets: each one IS its
   project, running its own logic where that reads well —
     push_swap     two stacks of numbered bars running the real radix sort
     cub3D         a textured maze, a player casting real DDA rays, and
                   the first-person view those rays produce
     minishell     a terminal typing a shell session
     pipex         infile → cmd1 | cmd2 → outfile, data flowing in the pipe
     so_long       a floating tile island: a wizard collects snitches,
                   reaches the exit, the move counter ticks
     philosophers  the dining philosophers simulation, forks and log
     C_FULL_LIB    a ring of books around the libft.a archive
     CPP modules   the diamond inheritance, calls pulsing along it
     music app     a spinning record inside a beat-driven equalizer ring
   and a generic crystal for anything else.

   makeEmblem(project) returns { kind, root, update(ctx), front }.
   front: 'yaw' turns to face a reader who selects it, 'full' also
   tilts toward them (a screen); false keeps turning slowly.
   root is normalised to fit a unit sphere at the origin; system.js
   scales it to the body radius, places it on its orbit and yaws it.
   update(ctx) runs every frame: ctx = { dt, t, camera, detail } —
   `detail` is false while the emblem is tiny on screen, so canvas
   redraws (the terminal, the raycaster view) are skipped then.

   Lit by the scene's lights (system.js puts a point light in Koaik);
   text and screens are canvas textures on sprites or unlit planes.
   Choose the emblem with `world: { emblem: '<kind>' }` on a project
   in data.js; otherwise it is matched by the project's name.
   ============================================================ */
import * as THREE from 'three';

const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const SANS = '"Space Grotesk", system-ui, sans-serif';
// accent — keep in step with --accent / --accent-dim (css/style.css)
const ACCENT = '#9CC4FF', BLUE = '#6F9CE8', ACCENT_PALE = '#DDEBFF';
// Warm that belongs to a PROJECT (pasta and the 'eating' state, gilt on
// the book spines, the record's equaliser) — not the site accent.
const WARM = '#F2D28B';
const TEXT = '#E6E9F2', MUTED = '#9AA3B8', GREEN = '#6EE7A0';

/* ── Helpers ── */
function rng(seed) {                       // mulberry32: deterministic textures
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw, pixel) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (draw) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (pixel) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.userData = { canvas: c, g };
  return t;
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({
  color, roughness: o.r ?? 0.55, metalness: o.m ?? 0.05, emissive: o.e ?? 0x000000,
  emissiveIntensity: o.ei ?? 1, flatShading: !!o.flat, map: o.map || null,
  transparent: !!o.t, opacity: o.o ?? 1, side: o.side ?? THREE.FrontSide, depthWrite: o.dw ?? true,
});
/* ── Fewer draw calls ──
   three.js draws a mesh that has a material ARRAY once per geometry
   group, so a box with six materials is six draw calls even when four
   of its faces share one — and the nine emblems together were 755
   calls a frame, most of what the system cost. Two tools:
   packGroups() reorders a mesh's index so that each distinct material
   is one group ([side ×4, front ×2] → 2 calls); makeEmblem runs it on
   every mesh, so builders need not care. instances() makes the copies
   of one static mesh (a map's walls, an island's tiles) a single
   InstancedMesh. */
const packedGeo = new WeakMap();           // geometry → Map(pattern → its packed copy)
function packGroups(mesh) {
  const mats = mesh.material, geo = mesh.geometry;
  if (!Array.isArray(mats) || !geo || !geo.index || !geo.groups.length) return;
  const uniq = [...new Set(geo.groups.map(g => mats[g.materialIndex]))];
  if (uniq.length === geo.groups.length) return;
  const pattern = geo.groups.map(g => uniq.indexOf(mats[g.materialIndex])).join();
  let byPattern = packedGeo.get(geo);
  if (!byPattern) packedGeo.set(geo, byPattern = new Map());
  let out = byPattern.get(pattern);
  if (!out) {
    const src = geo.index.array, idx = new src.constructor(src.length);
    out = geo.clone(); out.clearGroups();
    let at = 0;
    uniq.forEach((m, k) => {
      const start = at;
      for (const g of geo.groups) if (mats[g.materialIndex] === m) { idx.set(src.subarray(g.start, g.start + g.count), at); at += g.count; }
      if (uniq.length > 1) out.addGroup(start, at - start, k);
    });
    out.setIndex(new THREE.BufferAttribute(idx.slice(0, at), 1));
    byPattern.set(pattern, out);
  }
  mesh.geometry = out;
  mesh.material = uniq.length === 1 ? uniq[0] : uniq;
}
function instances(geo, mat, positions) {
  const im = new THREE.InstancedMesh(geo, mat, positions.length), m = new THREE.Matrix4();
  positions.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])));
  im.instanceMatrix.needsUpdate = true;
  return im;
}
/* A text sprite (always faces the camera) with a redrawable canvas. */
function board(w, h, worldH, draw) {
  const t = canvasTex(w, h);
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.set(worldH * w / h, worldH, 1);
  s.renderOrder = 4;
  const api = {
    sprite: s, tex: t,
    draw(fn) { const g = t.userData.g; g.clearRect(0, 0, w, h); fn(g, w, h); t.needsUpdate = true; },
  };
  if (draw) api.draw(draw);
  return api;
}
function glyph(text, color, worldH, font) {
  return board(128, 128, worldH, g => {
    g.font = font || `600 64px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color; g.fillText(text, 64, 68);
    g.shadowBlur = 0; g.fillText(text, 64, 68);
  }).sprite;
}
function pill(g, x, y, w, h, r, fill, stroke) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
}
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = t => Math.min(1, Math.max(0, t));
const approach = (cur, goal, rate, dt) => cur + (goal - cur) * (1 - Math.exp(-rate * dt));

/* ============================================================
   PUSH_SWAP — two stacks, real radix sort, one op every 0.2 s
   ============================================================ */
function pushSwap() {
  const root = new THREE.Group();
  const VALS = [42, -7, 13, 99, 0, 256, -42, 7, 64, 21];
  const N = VALS.length;
  const sorted = [...VALS].sort((a, b) => a - b);
  const H = 0.13, GAP = 0.035, STEP = H + GAP, XA = -0.56, XB = 0.56, BASE = -0.8, DEPTH = 0.34;
  const cLo = new THREE.Color('#4F7BFF'), cHi = new THREE.Color(ACCENT_PALE);
  const slabs = sorted.map((v, rank) => {
    const w = 0.30 + 0.66 * (rank + 1) / N;
    const col = cLo.clone().lerp(cHi, rank / (N - 1));
    const hex = '#' + col.getHexString();
    const ch = 48, cw = Math.round(ch * w / H);
    const face = canvasTex(cw, ch, g => {
      g.fillStyle = hex; g.fillRect(0, 0, cw, ch);
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, 0, cw, 5);
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, ch - 6, cw, 6);
      g.fillStyle = '#0B0E16'; g.font = `600 30px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(v), cw / 2, ch / 2 + 1);
    });
    const side = std(col, { r: 0.4, e: col, ei: 0.14 });
    const front = new THREE.MeshStandardMaterial({ map: face, roughness: 0.4, emissive: col, emissiveIntensity: 0.10 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, DEPTH), [side, side, side, side, front, front]);
    root.add(m);
    return { rank, m, from: new THREE.Vector3(), to: new THREE.Vector3(), t0: -1, dur: 0, arcY: 0, arcZ: 0 };
  });
  // The base: two named stacks on one platform.
  const baseTex = canvasTex(512, 40, g => {
    g.fillStyle = '#121622'; g.fillRect(0, 0, 512, 40);
    g.font = `500 22px ${MONO}`; g.fillStyle = MUTED; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('stack a', 128, 21); g.fillText('stack b', 384, 21);
  });
  const baseSide = std('#121622', { r: 0.5, m: 0.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.62),
    [baseSide, baseSide, baseSide, baseSide, new THREE.MeshStandardMaterial({ map: baseTex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: baseTex, roughness: 0.6 })]);
  base.position.y = BASE - 0.045;
  root.add(base);
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(base.geometry), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.45 }));
  rim.position.copy(base.position); root.add(rim);
  // The op readout above the stacks.
  const readout = board(512, 150, 0.46);
  readout.sprite.position.set(0, BASE + N * STEP + 0.34, 0);
  root.add(readout.sprite);
  function drawReadout(op, bit, count, note) {
    readout.draw((g, w, h) => {
      pill(g, 4, 4, w - 8, h - 8, 22, 'rgba(10,13,22,0.78)', 'rgba(156,196,255,0.45)');
      g.textBaseline = 'middle'; g.textAlign = 'left';
      g.font = `500 22px ${MONO}`; g.fillStyle = MUTED; g.fillText(note || `radix · bit ${bit}`, 30, 42);
      g.font = `600 58px ${MONO}`; g.fillStyle = ACCENT; g.fillText(op, 30, 100);
      g.textAlign = 'right'; g.font = `500 26px ${MONO}`; g.fillStyle = TEXT; g.fillText(`ops ${count}`, w - 30, 100);
    });
  }

  function slot(stack, i, len) {
    return new THREE.Vector3(stack === 'a' ? XA : XB, BASE + (len - 1 - i) * STEP + H / 2 + 0.005, 0);
  }
  function radixOps(start) {
    const a = [...start], b = [], ops = [];
    const bits = Math.ceil(Math.log2(N));
    for (let bit = 0; bit < bits; bit++) {
      for (let k = 0; k < N; k++) {
        if (((a[0] >> bit) & 1) === 0) { b.unshift(a.shift()); ops.push({ op: 'pb', bit, a: [...a], b: [...b], moved: b[0], arc: 'y' }); }
        else { a.push(a.shift()); ops.push({ op: 'ra', bit, a: [...a], b: [...b], moved: a[a.length - 1], arc: 'z' }); }
      }
      while (b.length) { a.unshift(b.shift()); ops.push({ op: 'pa', bit, a: [...a], b: [...b], moved: a[0], arc: 'y' }); }
    }
    return ops;
  }
  const random = rng(7);
  const shuffled = () => { const r = [...Array(N).keys()]; for (let i = N - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

  let clock = 0, state = { a: shuffled(), b: [] }, ops = radixOps(state.a), k = 0, next = 0.8, phase = 'run', count = 0;
  const OP_T = 0.2;
  function layout(st, moved, arc, dur) {
    st.a.forEach((r, i) => aim(slabs[r], slot('a', i, st.a.length), r === moved ? arc : null, dur));
    st.b.forEach((r, i) => aim(slabs[r], slot('b', i, st.b.length), r === moved ? arc : null, dur));
  }
  function aim(s, to, arc, dur) {
    s.from.copy(s.m.position); s.to.copy(to); s.t0 = clock; s.dur = dur;
    s.arcY = arc === 'y' ? 0.24 : 0; s.arcZ = arc === 'z' ? 0.42 : (arc === 'shuffle' ? 0.3 : 0);
  }
  // Start in place, no animation.
  state.a.forEach((r, i) => slabs[r].m.position.copy(slot('a', i, N)));
  drawReadout('—', 0, 0, 'radix sort');

  function update(ctx) {
    const dt = ctx.dt; clock += dt;
    if (dt > 0 && clock >= next) {
      if (phase === 'run') {
        if (k < ops.length) {
          const o = ops[k++]; count++;
          layout(o, o.moved, o.arc, OP_T * 0.92);
          if (ctx.detail) drawReadout(o.op, o.bit, count);
          next = clock + OP_T;
        } else { phase = 'done'; next = clock + 1.8; if (ctx.detail) drawReadout('sorted ✓', 0, count, 'a is in order'); }
      } else {
        // Shuffle and go again.
        state = { a: shuffled(), b: [] }; ops = radixOps(state.a); k = 0; count = 0;
        state.a.forEach((r, i) => aim(slabs[r], slot('a', i, N), 'shuffle', 0.7));
        phase = 'run'; next = clock + 1.0;
        if (ctx.detail) drawReadout('—', 0, 0, 'shuffle');
      }
    }
    for (const s of slabs) {
      if (s.t0 < 0) continue;
      const u = clamp01((clock - s.t0) / Math.max(0.001, s.dur)), e = ease(u), arc = Math.sin(Math.PI * u);
      s.m.position.lerpVectors(s.from, s.to, e);
      s.m.position.y += s.arcY * arc; s.m.position.z += s.arcZ * arc;
    }
  }
  return { root, update, front: 'yaw' };
}

/* ============================================================
   CUB3D — a .cub map, four wall textures, a player casting DDA rays,
   and the first-person frame those rays render
   ============================================================ */
function cub3d() {
  const root = new THREE.Group();
  const MAP = ['11111111', '10000011', '10110001', '10010101', '10000101', '11011001', '10000001', '11111111'];
  const R = MAP.length, C = MAP[0].length, CELL = 0.25, WALL_H = 0.27;
  const wallAt = (x, y) => x < 0 || y < 0 || x >= C || y >= R || MAP[y][x] === '1';
  const X = mx => (mx - C / 2) * CELL, Z = my => (my - R / 2) * CELL;

  // Four wall textures (NO / SO / WE / EA), pixel art.
  function bricks(seed, mortar, cols, rowH, brickW) {
    return canvasTex(32, 32, g => {
      const r = rng(seed);
      g.fillStyle = mortar; g.fillRect(0, 0, 32, 32);
      for (let y = 0, row = 0; y < 32; y += rowH, row++) {
        for (let x = -(row % 2) * brickW / 2; x < 32; x += brickW) {
          const c = cols[Math.floor(r() * cols.length)];
          g.fillStyle = c; g.fillRect(x + 1, y + 1, brickW - 1, rowH - 1);
          for (let n = 0; n < 5; n++) { g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.12})`; g.fillRect(x + 1 + Math.floor(r() * (brickW - 2)), y + 1 + Math.floor(r() * (rowH - 2)), 1, 1); }
        }
      }
    }, true);
  }
  const NO = bricks(11, '#3a2a24', ['#8a3b2e', '#9c4634', '#7a3226'], 8, 16);          // red brick
  const SO = bricks(12, '#2c3036', ['#6f757d', '#7d838b', '#646a72'], 8, 8);           // grey stone
  const WE = canvasTex(32, 32, g => {                                                   // wood planks
    const r = rng(13);
    for (let x = 0; x < 32; x += 8) { g.fillStyle = ['#7a5230', '#6b4728', '#86603a'][x / 8 % 3]; g.fillRect(x, 0, 8, 32); g.fillStyle = '#3a2616'; g.fillRect(x, 0, 1, 32);
      for (let n = 0; n < 6; n++) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 2 + Math.floor(r() * 5), Math.floor(r() * 32), 1, 3); } }
  }, true);
  const EA = bricks(14, '#1f2a33', ['#3d5a6c', '#46677a', '#355060'], 8, 16);          // blue stone
  const texFor = { NO, SO, WE, EA };
  const topMat = std('#23262e', { r: 0.8 });
  const mat = t => new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  const wallMats = [mat(EA), mat(WE), topMat, topMat, mat(SO), mat(NO)];   // +x E, -x W, +y, -y, +z S, -z N
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const walls = [];
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (MAP[y][x] === '1') walls.push([X(x + 0.5), WALL_H / 2, Z(y + 0.5)]);
  root.add(instances(wallGeo, wallMats, walls));
  const floorTex = canvasTex(16, 16, g => { g.fillStyle = '#2a2d33'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#33373e'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8); }, true);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(C / 2, R / 2);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(C * CELL, 0.04, R * CELL), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
  floor.position.y = -0.02; root.add(floor);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(C * CELL + 0.08, 0.06, R * CELL + 0.08), std('#0e1118', { r: 0.4, m: 0.5 }));
  slab.position.y = -0.07; root.add(slab);
  const slabRim = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.45 }));
  slabRim.position.copy(slab.position); root.add(slabRim);

  // DDA (lodev): from (px, py) along (dx, dy); returns distance, side, map cell, exact hit.
  function dda(px, py, dx, dy) {
    let mx = Math.floor(px), my = Math.floor(py);
    const ddx = Math.abs(1 / (dx || 1e-9)), ddy = Math.abs(1 / (dy || 1e-9));
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    let sdx = (dx < 0 ? px - mx : mx + 1 - px) * ddx, sdy = (dy < 0 ? py - my : my + 1 - py) * ddy, side = 0;
    for (let i = 0; i < 64; i++) {
      if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
      if (wallAt(mx, my)) break;
    }
    const dist = side === 0 ? sdx - ddx : sdy - ddy;
    return { dist, side, hx: px + dx * dist, hy: py + dy * dist, face: side === 0 ? (dx > 0 ? 'WE' : 'EA') : (dy > 0 ? 'NO' : 'SO') };
  }

  // The player and its patrol, in map units.
  const PATH = [[1.5, 1.5], [5.5, 1.5], [5.5, 2.5], [6.5, 2.5], [6.5, 6.5], [2.5, 6.5], [2.5, 4.5], [1.5, 4.5]];
  const segs = PATH.map((p, i) => { const q = PATH[(i + 1) % PATH.length]; return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }; });
  const total = segs.reduce((s, x) => s + x.len, 0);
  const player = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 14), std('#FFD54A', { e: '#FFB300', ei: 0.6, r: 0.3 }));
  player.rotation.x = Math.PI / 2;                     // lie flat, tip toward +z…
  const playerYaw = new THREE.Group(); playerYaw.add(player); playerYaw.position.y = 0.07; root.add(playerYaw);

  // The ray fan: lines to each hit, and a faint filled cone under them.
  const NR = 30, FOV = 66 * Math.PI / 180;
  const linePos = new Float32Array(NR * 2 * 3);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  lines.geometry.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  root.add(lines);
  const fanPos = new Float32Array((NR + 1) * 3), fanIdx = [];
  for (let i = 1; i < NR; i++) fanIdx.push(0, i, i + 1);
  const fan = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x3fb6ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  fan.geometry.setAttribute('position', new THREE.BufferAttribute(fanPos, 3)); fan.geometry.setIndex(fanIdx);
  root.add(fan);

  // The screen: what the player sees, raycast into a canvas.
  const SW = 192, SH = 108;
  const screen = board(SW + 16, SH + 34, 0.62);
  screen.sprite.position.set(0, 0.78, 0);
  root.add(screen.sprite);
  function drawView(px, py, ang) {
    const dx = Math.cos(ang), dy = Math.sin(ang), plx = -dy * 0.66, ply = dx * 0.66;
    screen.draw((g, w, h) => {
      pill(g, 1, 1, w - 2, h - 2, 10, '#0b0e16', 'rgba(127,232,255,0.6)');
      g.font = `500 13px ${MONO}`; g.fillStyle = '#7fe8ff'; g.textBaseline = 'middle'; g.fillText('cub3D', 10, 13);
      g.fillStyle = MUTED; g.textAlign = 'right'; g.fillText('map.cub', w - 10, 13); g.textAlign = 'left';
      const ox = 8, oy = 26;
      const sky = g.createLinearGradient(0, oy, 0, oy + SH / 2); sky.addColorStop(0, '#1d3b66'); sky.addColorStop(1, '#4d6f99');
      g.fillStyle = sky; g.fillRect(ox, oy, SW, SH / 2);
      g.fillStyle = '#3b3b40'; g.fillRect(ox, oy + SH / 2, SW, SH / 2);
      g.imageSmoothingEnabled = false;
      for (let x = 0; x < SW; x += 2) {
        const cam = 2 * x / SW - 1, rdx = dx + plx * cam, rdy = dy + ply * cam;
        const hit = dda(px, py, rdx, rdy);
        const lh = Math.min(SH * 3, SH / Math.max(0.05, hit.dist));
        const y0 = oy + SH / 2 - lh / 2;
        let wx = hit.side === 0 ? hit.hy : hit.hx; wx -= Math.floor(wx);
        const tc = texFor[hit.face].userData.canvas;
        const tx = Math.min(31, Math.floor(wx * 32));
        g.save(); g.beginPath(); g.rect(ox, oy, SW, SH); g.clip();
        g.drawImage(tc, tx, 0, 1, 32, ox + x, y0, 2, lh);
        if (hit.side === 1) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(ox + x, y0, 2, lh); }
        g.restore();
      }
      // crosshair
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(ox + SW / 2 - 4, oy + SH / 2, 8, 1); g.fillRect(ox + SW / 2, oy + SH / 2 - 4, 1, 8);
    });
  }

  let s = 0, look = 0, viewClock = 1;
  function update(ctx) {
    const dt = ctx.dt;
    s = (s + dt * 0.85) % total;
    look += dt;
    let d = s, seg = segs[0];
    for (const x of segs) { if (d <= x.len) { seg = x; break; } d -= x.len; }
    const u = d / seg.len;
    const px = seg.p[0] + (seg.q[0] - seg.p[0]) * u, py = seg.p[1] + (seg.q[1] - seg.p[1]) * u;
    const heading = Math.atan2(seg.q[1] - seg.p[1], seg.q[0] - seg.p[0]);
    const ang = heading + 0.45 * Math.sin(look * 1.3);
    playerYaw.position.set(X(px), 0.07, Z(py));
    playerYaw.rotation.y = -ang + Math.PI / 2;
    for (let i = 0; i < NR; i++) {
      const a = ang - FOV / 2 + FOV * i / (NR - 1);
      const hit = dda(px, py, Math.cos(a), Math.sin(a));
      linePos.set([X(px), 0.06, Z(py), X(hit.hx), 0.06, Z(hit.hy)], i * 6);
      fanPos.set([X(hit.hx), 0.05, Z(hit.hy)], (i + 1) * 3);
    }
    fanPos.set([X(px), 0.05, Z(py)], 0);
    lines.geometry.attributes.position.needsUpdate = true;
    fan.geometry.attributes.position.needsUpdate = true;
    viewClock += dt;
    if (ctx.detail && viewClock > 1 / 24) { viewClock = 0; drawView(px, py, ang); }
    else if (!screen.drawn) { screen.drawn = true; drawView(px, py, ang); }
  }
  return { root, update, front: false };
}

/* ============================================================
   MINISHELL — a terminal typing a shell session
   ============================================================ */
function minishell() {
  const root = new THREE.Group();
  const W = 640, H = 400;
  const screenTex = canvasTex(W, H);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.92, 1.26, 0.16), std('#10131c', { r: 0.35, m: 0.55 }));
  root.add(bezel);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(bezel.geometry), new THREE.LineBasicMaterial({ color: 0x6EE7A0, transparent: true, opacity: 0.35 }));
  root.add(edge);
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.125), screenMat); front.position.z = 0.081; root.add(front);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.125), screenMat); back.position.z = -0.081; back.rotation.y = Math.PI; root.add(back);
  // A slow ring of shell syntax around it.
  const ring = new THREE.Group(); ring.rotation.x = 0.32; ring.userData.deco = true; root.add(ring);
  const GL = ['$', '|', '>', '<<', '&&', '*', '$?', '>>', '~', '||'];
  GL.forEach((g, i) => { const sp = glyph(g, i % 2 ? ACCENT : GREEN, 0.2); const a = i / GL.length * Math.PI * 2; sp.position.set(Math.cos(a) * 1.28, 0, Math.sin(a) * 1.28); ring.add(sp); });

  const SCRIPT = [
    ['cmd', 'echo "Hello, 42"'], ['out', 'Hello, 42'],
    ['cmd', 'ls -l | grep .c | wc -l'], ['out', '      12'],
    ['cmd', 'export NAME=ali'],
    ['cmd', 'echo $NAME $?'], ['out', 'ali 0'],
    ['cmd', 'cat << EOF > notes.txt'], ['hd', 'pipes, redirections,'], ['hd', 'signals, builtins'], ['hd', 'EOF'],
    ['cmd', 'cat notes.txt | tr a-z A-Z'], ['out', 'PIPES, REDIRECTIONS,'], ['out', 'SIGNALS, BUILTINS'],
    ['cmd', 'cd .. && pwd'], ['out', '/home/ali'],
    ['cmd', 'exit'], ['out', 'exit'],
  ];
  const PROMPT = 'minishell$ ';
  let done = [], line = 0, chars = 0, wait = 0.6, cursor = 0, dirty = true;
  const OPS = /(\|\||&&|<<|>>|[|<>]|\$\?|\$[A-Z_]+)/g;
  function paint() {
    const g = screenTex.userData.g;
    g.fillStyle = '#07090d'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#141925'; g.fillRect(0, 0, W, 34);
    [['#ff5f57', 20], ['#febc2e', 42], ['#28c840', 64]].forEach(([c, x]) => { g.fillStyle = c; g.beginPath(); g.arc(x, 17, 6.5, 0, 7); g.fill(); });
    g.font = `500 17px ${MONO}`; g.fillStyle = MUTED; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('minishell — bash-like', W / 2, 17);
    g.textAlign = 'left'; g.font = `500 21px ${MONO}`;
    const cur = line < SCRIPT.length ? SCRIPT[line] : null;
    const rows = done.slice();
    if (cur) rows.push([cur[0], cur[1].slice(0, cur[0] === 'cmd' ? chars : cur[1].length), true]);
    const LH = 27, MAX = Math.floor((H - 44) / LH);
    const view = rows.slice(-MAX);
    view.forEach(([kind, text, live], i) => {
      const y = 50 + i * LH + LH / 2;
      let x = 16;
      const put = (s, c) => { g.fillStyle = c; g.fillText(s, x, y); x += g.measureText(s).width; };
      if (kind === 'cmd') {
        put(PROMPT, GREEN);
        let last = 0; text.replace(OPS, (m, _1, off) => { put(text.slice(last, off), TEXT); put(m, ACCENT); last = off + m.length; return m; });
        put(text.slice(last), TEXT);
        if (live && cursor % 1 < 0.5) { g.fillStyle = TEXT; g.fillRect(x + 2, y - 11, 11, 22); }
      } else if (kind === 'hd') { put('> ', MUTED); put(text, '#c9cfdb'); }
      else put(text, '#b8c0cf');
    });
    screenTex.needsUpdate = true;
  }
  paint();
  function update(ctx) {
    const dt = ctx.dt; if (!dt) return;
    cursor += dt * 1.1;
    wait -= dt;
    if (wait <= 0) {
      if (line >= SCRIPT.length) { done = []; line = 0; chars = 0; wait = 0.8; dirty = true; }
      else {
        const [kind, text] = SCRIPT[line];
        if (kind === 'cmd' && chars < text.length) { chars++; wait = 0.045 + (text[chars - 1] === ' ' ? 0.04 : 0); dirty = true; }
        else {
          done.push([kind, text]); line++; chars = 0; dirty = true;
          const nx = SCRIPT[line];
          wait = !nx ? 2.4 : nx[0] === 'cmd' ? (kind === 'cmd' ? 0.5 : 0.9) : 0.12;
        }
      }
    }
    if (ctx.detail && (dirty || Math.floor(cursor * 2) !== Math.floor((cursor - dt * 1.1) * 2))) { dirty = false; paint(); }
    ring.rotation.y += dt * 0.25;
  }
  return { root, update, front: 'full' };
}

/* ============================================================
   PIPEX — < infile cmd1 | cmd2 > outfile, data flowing through
   ============================================================ */
function pipex() {
  const root = new THREE.Group();
  const P = [[-0.95, -0.45, 0.05], [-0.8, 0.1, 0.35], [-0.4, 0.5, 0.25], [0.0, 0.3, -0.2], [0.05, -0.15, -0.35], [0.4, -0.5, -0.1], [0.78, -0.2, 0.25], [0.95, 0.42, 0.05]]
    .map(a => new THREE.Vector3(...a));
  const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
  const outer = new THREE.Mesh(new THREE.TubeGeometry(curve, 260, 0.075, 20, false),
    std('#a9bbdc', { m: 0.85, r: 0.25, t: true, o: 0.42, dw: false }));
  outer.renderOrder = 2; root.add(outer);
  const dash = canvasTex(256, 8, g => { const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, 'rgba(90,160,255,0)'); gr.addColorStop(0.55, 'rgba(120,190,255,1)'); gr.addColorStop(0.7, 'rgba(230,245,255,1)'); gr.addColorStop(1, 'rgba(90,160,255,0)'); g.fillStyle = '#0b1a33'; g.fillRect(0, 0, 256, 8); g.fillStyle = gr; g.fillRect(0, 0, 256, 8); });
  dash.wrapS = THREE.RepeatWrapping; dash.repeat.set(16, 1);
  const inner = new THREE.Mesh(new THREE.TubeGeometry(curve, 260, 0.036, 10, false), new THREE.MeshBasicMaterial({ map: dash }));
  root.add(inner);
  const packets = [...Array(7)].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xE8F4FF })); root.add(m); return m; });
  // Files: two sheets of paper with text.
  function doc(name, pos, ry) {
    const t = canvasTex(160, 200, g => {
      g.fillStyle = '#f3f0e8'; g.fillRect(0, 0, 160, 200);
      g.fillStyle = '#d9d3c4'; g.beginPath(); g.moveTo(124, 0); g.lineTo(160, 36); g.lineTo(124, 36); g.closePath(); g.fill();
      g.font = `600 22px ${MONO}`; g.fillStyle = '#1b2233'; g.fillText(name, 14, 30);
      g.fillStyle = '#b9b3a4'; for (let i = 0; i < 7; i++) g.fillRect(14, 62 + i * 18, 60 + ((i * 37) % 70), 5);
    });
    const paper = std('#e9e4d8', { r: 0.8 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.03), [paper, paper, paper, paper, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 })]);
    m.position.copy(pos); m.rotation.y = ry; root.add(m);
    return m;
  }
  doc('infile', P[0].clone().add(new THREE.Vector3(-0.1, -0.02, 0)), 0.4);
  doc('outfile', P[7].clone().add(new THREE.Vector3(0.1, 0.02, 0)), -0.4);
  // Processes: glossy nodes with a turning ring.
  const rings = [];
  for (const i of [2, 5]) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 20), std('#1a2030', { m: 0.6, r: 0.22, e: '#0d1a33', ei: 1 }));
    n.position.copy(P[i]); root.add(n);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 8, 48), new THREE.MeshBasicMaterial({ color: 0x6F9CE8 }));
    r.position.copy(P[i]); root.add(r); rings.push(r);
  }
  const tag = (text, pos, color) => { const b = board(256, 72, 0.16, g => { g.font = `600 40px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8; g.fillText(text, 128, 38); }); b.sprite.position.copy(pos); root.add(b.sprite); };
  tag('< infile', P[0].clone().add(new THREE.Vector3(-0.1, 0.34, 0)), TEXT);
  tag('cmd1', P[2].clone().add(new THREE.Vector3(0, 0.3, 0)), BLUE);
  tag('cmd2', P[5].clone().add(new THREE.Vector3(0, -0.3, 0)), BLUE);
  tag('> outfile', P[7].clone().add(new THREE.Vector3(0.1, 0.34, 0)), TEXT);
  tag('|', curve.getPointAt(0.5).add(new THREE.Vector3(0.14, 0.12, 0)), ACCENT);
  let t = 0;
  function update(ctx) {
    t += ctx.dt;
    dash.offset.x = -t * 0.9;
    packets.forEach((m, i) => m.position.copy(curve.getPointAt(((t * 0.11) + i / packets.length) % 1)));
    rings.forEach((r, i) => { r.rotation.x = t * (0.8 + i * 0.3); r.rotation.y = t * 0.5; });
  }
  return { root, update, front: false };
}

/* ============================================================
   SO_LONG — a floating .ber island: collect, exit, count moves
   ============================================================ */
function soLong() {
  const root = new THREE.Group();
  const MAP = ['1111111', '1P00C01', '1011101', '1C0C0E1', '1111111'];
  const R = MAP.length, C = MAP[0].length, CELL = 0.28;
  const X = x => (x - (C - 1) / 2) * CELL, Z = y => (y - (R - 1) / 2) * CELL;
  const pix = (seed, pal) => canvasTex(16, 16, g => { const r = rng(seed); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = pal[Math.floor(r() * pal.length)]; g.fillRect(x, y, 1, 1); } }, true);
  const grass = pix(21, ['#3f8a3a', '#4a9a41', '#377d33', '#56a84a', '#3f8a3a']);
  const stone = pix(22, ['#6c6f76', '#7b7e86', '#5d6068', '#868991']);
  const dirt = pix(23, ['#6b4a2e', '#5c3f27', '#7a5534']);
  const dirtMat = std(0xffffff, { map: dirt, r: 0.9 }), grassMat = std(0xffffff, { map: grass, r: 0.9 });
  const grassMats = [dirtMat, dirtMat, grassMat, dirtMat, dirtMat, dirtMat];   // grass on top (+y), dirt round it
  const stoneMat = std(0xffffff, { map: stone, r: 0.85 });
  const tileGeo = new THREE.BoxGeometry(CELL, 0.1, CELL), wallGeo = new THREE.BoxGeometry(CELL, 0.16, CELL);
  const snitches = [], open = [], tiles = [], walls = [];
  let start = null, exit = null;
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    const ch = MAP[y][x];
    tiles.push([X(x), -0.05, Z(y)]);
    if (ch === '1') walls.push([X(x), 0.08, Z(y)]);
    if (ch === 'P') start = [x, y];
    if (ch === 'E') exit = [x, y];
    if (ch === 'C') {
      const g = new THREE.Group(); g.position.set(X(x), 0.14, Z(y));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), std('#FFCC33', { m: 0.9, r: 0.25, e: '#7a5200', ei: 0.6 })));
      const wingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.035), wingMat); wl.position.x = -0.07;
      const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.035), wingMat); wr.position.x = 0.07;
      g.add(wl, wr); root.add(g);
      snitches.push({ x, y, g, wl, wr, got: false });
    }
    if (ch !== '1') open.push([x, y]);
  }
  root.add(instances(tileGeo, grassMats, tiles), instances(wallGeo, stoneMat, walls));
  // Floating-island underside.
  const under = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.95, 7), std('#5a4030', { flat: true, r: 0.95 }));
  under.rotation.x = Math.PI; under.scale.set(1, 1, 0.72); under.position.y = -0.1 - 0.95 / 2; root.add(under);
  // The exit portal.
  const portal = new THREE.Group(); portal.position.set(X(exit[0]), 0.16, Z(exit[1]));
  const ringMat = std('#9b6bff', { e: '#6b3bff', ei: 0.3, m: 0.3, r: 0.3 });
  portal.add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 10, 32), ringMat));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.09, 32), new THREE.MeshBasicMaterial({ color: 0x8a5bff, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  portal.add(disc); root.add(portal);
  // The wizard: robe, head, hat, a Gryffindor scarf.
  const wiz = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.17, 16), std('#23233a', { r: 0.8 })); robe.position.y = 0.085; wiz.add(robe);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 20), std('#a8262c', { r: 0.7 })); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.165; wiz.add(scarf);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), std('#e8c4a0', { r: 0.7 })); head.position.y = 0.2; wiz.add(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.12, 16), std('#3b2a66', { r: 0.7 })); hat.position.y = 0.285; hat.rotation.z = 0.15; wiz.add(hat);
  root.add(wiz);
  const counter = board(360, 90, 0.22);
  counter.sprite.position.set(0, 0.62, 0); root.add(counter.sprite);
  function drawCounter(moves, got) {
    counter.draw((g, w, h) => {
      pill(g, 3, 3, w - 6, h - 6, 18, 'rgba(10,13,22,0.8)', 'rgba(156,196,255,0.45)');
      g.font = `500 30px ${MONO}`; g.textBaseline = 'middle'; g.fillStyle = TEXT; g.textAlign = 'left'; g.fillText(`moves ${moves}`, 22, h / 2 + 1);
      g.textAlign = 'right'; g.fillStyle = ACCENT; g.fillText(`✦ ${got}/${snitches.length}`, w - 22, h / 2 + 1);
    });
  }
  // The route: collect every snitch (BFS between points), then the exit.
  function bfs(a, b) {
    const key = p => p[0] + ',' + p[1], prev = new Map([[key(a), null]]), q = [a];
    while (q.length) { const c = q.shift(); if (c[0] === b[0] && c[1] === b[1]) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c[0] + dx, c[1] + dy]; if (MAP[n[1]][n[0]] === '1' || prev.has(key(n))) continue; prev.set(key(n), c); q.push(n); } }
    const path = []; let c = b; while (c) { path.unshift(c); c = prev.get(key(c)); } return path.slice(1);
  }
  let route = [], cur = start.slice();
  { let at = start; for (const sn of [snitches[0], snitches[1], snitches[2]].sort((p, q) => Math.hypot(p.x - start[0], p.y - start[1]) - Math.hypot(q.x - start[0], q.y - start[1]))) { route.push(...bfs(at, [sn.x, sn.y])); at = [sn.x, sn.y]; } route.push(...bfs(at, exit)); }
  let step = 0, hop = 0, moves = 0, got = 0, phase = 'walk', clock = 0, from = start.slice();
  wiz.position.set(X(start[0]), 0, Z(start[1]));
  drawCounter(0, 0);
  const HOP = 0.34;
  function update(ctx) {
    const dt = ctx.dt; clock += dt;
    for (const s of snitches) {
      const k = s.got ? 0 : 1;
      s.g.scale.setScalar(approach(s.g.scale.x, k, 10, dt) || 0.0001);
      s.g.position.y = 0.15 + 0.03 * Math.sin(clock * 3 + s.x);
      s.g.rotation.y += dt * 2.2;
      const f = Math.sin(clock * 38 + s.y) * 0.9; s.wl.rotation.y = f; s.wr.rotation.y = -f;
    }
    const allGot = got === snitches.length;
    ringMat.emissiveIntensity = allGot ? 1.4 + 0.6 * Math.sin(clock * 6) : 0.25;
    disc.material.opacity = allGot ? 0.7 : 0.25;
    portal.rotation.y += dt * (allGot ? 2.5 : 0.4);
    if (phase === 'walk' && dt > 0) {
      hop += dt / HOP;
      const to = route[step];
      const e = ease(Math.min(1, hop));
      wiz.position.set(X(from[0] + (to[0] - from[0]) * e), 0.07 * Math.sin(Math.PI * Math.min(1, hop)), Z(from[1] + (to[1] - from[1]) * e));
      wiz.rotation.y = Math.atan2(to[0] - from[0], to[1] - from[1]);
      if (hop >= 1.18) {
        hop = 0; moves++; from = to.slice(); step++;
        const sn = snitches.find(s => !s.got && s.x === to[0] && s.y === to[1]);
        if (sn) { sn.got = true; got++; }
        if (ctx.detail) drawCounter(moves, got);
        if (step >= route.length) { phase = 'exit'; clock = 0; }
      }
    } else if (phase === 'exit') {
      wiz.scale.setScalar(Math.max(0.0001, 1 - clock / 0.6));
      wiz.rotation.y += dt * 12;
      if (clock > 1.8) {        // reset the level
        phase = 'walk'; step = 0; hop = 0; moves = 0; got = 0; from = start.slice();
        snitches.forEach(s => { s.got = false; }); wiz.scale.setScalar(1);
        wiz.position.set(X(start[0]), 0, Z(start[1])); drawCounter(0, 0);
      }
    }
  }
  return { root, update, front: false };
}

/* ============================================================
   PHILOSOPHERS — the dining table, forks as mutexes, the log
   ============================================================ */
function philosophers() {
  const root = new THREE.Group();
  const N = 5;
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 56), std('#6b4a2e', { r: 0.6 }));
  root.add(table);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.5, 20), std('#4a321f', { r: 0.7 })); ped.position.y = -0.28; root.add(ped);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.04, 32), std('#4a321f', { r: 0.7 })); foot.position.y = -0.53; root.add(foot);
  const seatA = i => i * Math.PI * 2 / N - Math.PI / 2;
  const plateMat = std('#f2efe8', { r: 0.35 }), pastaMat = std('#f0c75e', { r: 0.6 });
  for (let i = 0; i < N; i++) {
    const a = seatA(i);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.02, 28), plateMat); plate.position.set(Math.cos(a) * 0.4, 0.04, Math.sin(a) * 0.4); root.add(plate);
    const pasta = new THREE.Mesh(new THREE.TorusKnotGeometry(0.045, 0.013, 64, 6, 2, 3), pastaMat); pasta.position.set(Math.cos(a) * 0.4, 0.075, Math.sin(a) * 0.4); pasta.rotation.x = Math.PI / 2; pasta.scale.y = 0.6; root.add(pasta);
  }
  // Forks between seats: fork j sits between philosopher j and j+1.
  const metal = std('#d8dde6', { m: 0.9, r: 0.25 });
  const forks = [...Array(N)].map((_, j) => {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.008, 0.15), metal); handle.position.z = -0.03; g.add(handle);
    for (const dx of [-0.012, 0, 0.012]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.008, 0.06), metal); t.position.set(dx, 0, 0.075); g.add(t); }
    root.add(g);
    const a = seatA(j) + Math.PI / N;
    return { g, a, owner: -1, rest: new THREE.Vector3(Math.cos(a) * 0.42, 0.04, Math.sin(a) * 0.42) };
  });
  const COL = { think: new THREE.Color(BLUE), eat: new THREE.Color(WARM), sleep: new THREE.Color('#B48CFF') };
  const philos = [...Array(N)].map((_, i) => {
    const a = seatA(i), g = new THREE.Group();
    const mat = std(BLUE, { r: 0.5, e: BLUE, ei: 0.25 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.14, 6, 14), mat); body.position.y = 0.02; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.065, 18, 14), mat); head.position.y = 0.2; g.add(head);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 36), new THREE.MeshBasicMaterial({ color: 0x6F9CE8, transparent: true, opacity: 0.8 }));
    halo.rotation.x = Math.PI / 2; halo.position.y = 0.32; g.add(halo);
    g.position.set(Math.cos(a) * 0.84, 0, Math.sin(a) * 0.84); root.add(g);
    return { i, a, g, mat, halo, head, state: 'think', until: 0.2 + i * 0.13 };
  });
  const log = board(520, 150, 0.34);
  log.sprite.position.set(0, 0.62, 0); root.add(log.sprite);
  const lines = [];
  function drawLog() {
    log.draw((g, w, h) => {
      pill(g, 3, 3, w - 6, h - 6, 18, 'rgba(10,13,22,0.82)', 'rgba(111,156,232,0.45)');
      g.font = `500 25px ${MONO}`; g.textBaseline = 'middle';
      lines.slice(-4).forEach((l, i) => { g.fillStyle = l.color; g.fillText(l.text, 20, 26 + i * 33); });
    });
  }
  let ms = 0;
  function say(p, what) {
    lines.push({ text: `${String(Math.floor(ms)).padStart(5, ' ')} ${p.i + 1} ${what}`, color: what.includes('eat') ? WARM : what.includes('sleep') ? '#C8A8FF' : what.includes('fork') ? MUTED : BLUE });
    if (lines.length > 8) lines.shift();
  }
  const EAT = 1.25, SLEEP = 1.0, THINK = 0.25;
  let dirty = true;
  function update(ctx) {
    const dt = ctx.dt; ms += dt * 1000;
    const t = ms / 1000;
    for (const p of philos) {
      if (t < p.until) continue;
      if (p.state === 'eat') { forks[(p.i + N - 1) % N].owner = -1; forks[p.i].owner = -1; p.state = 'sleep'; p.until = t + SLEEP; say(p, 'is sleeping'); dirty = true; }
      else if (p.state === 'sleep') { p.state = 'think'; p.until = t + THINK; say(p, 'is thinking'); dirty = true; }
      else {
        const l = forks[(p.i + N - 1) % N], r = forks[p.i];
        if (l.owner === -1 && r.owner === -1) {          // both mutexes, or neither
          l.owner = p.i; r.owner = p.i; say(p, 'has taken a fork'); say(p, 'has taken a fork'); say(p, 'is eating');
          p.state = 'eat'; p.until = t + EAT; dirty = true;
        }
      }
    }
    for (const p of philos) {
      const c = COL[p.state];
      p.mat.color.lerp(c, 1 - Math.exp(-8 * dt)); p.mat.emissive.copy(p.mat.color);
      p.halo.material.color.copy(p.mat.color);
      p.halo.rotation.z += dt * (p.state === 'eat' ? 3 : 0.6);
      p.head.position.y = 0.2 + (p.state === 'sleep' ? -0.02 + 0.01 * Math.sin(t * 3 + p.i) : 0);
    }
    for (const f of forks) {
      let target, yaw = -f.a + Math.PI / 2, tilt = 0;
      if (f.owner >= 0) {
        const p = philos[f.owner], side = forks[p.i] === f ? 1 : -1;
        const a = p.a + side * 0.2;
        target = new THREE.Vector3(Math.cos(a) * 0.66, 0.16, Math.sin(a) * 0.66);
        yaw = -p.a + Math.PI / 2; tilt = -0.8;
      } else target = f.rest;
      f.g.position.lerp(target, 1 - Math.exp(-10 * dt));
      f.g.rotation.set(tilt, yaw, 0, 'YXZ');
    }
    if (ctx.detail && dirty) { dirty = false; drawLog(); }
  }
  return { root, update, front: false };
}

/* ============================================================
   C_FULL_LIB — books around the libft.a archive
   ============================================================ */
function libft() {
  const root = new THREE.Group();
  const coreTex = canvasTex(256, 256, g => {
    g.fillStyle = '#12151f'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = ACCENT; g.lineWidth = 6; g.strokeRect(10, 10, 236, 236);
    g.font = `600 46px ${MONO}`; g.fillStyle = ACCENT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('libft.a', 128, 110);
    g.font = `500 22px ${MONO}`; g.fillStyle = MUTED; g.fillText('ar rcs', 128, 160);
  });
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ map: coreTex, roughness: 0.5, metalness: 0.3, emissive: 0x101a2a, emissiveIntensity: 0.6 }));
  root.add(core);
  const coreEdge = new THREE.LineSegments(new THREE.EdgesGeometry(core.geometry), new THREE.LineBasicMaterial({ color: ACCENT }));
  core.add(coreEdge);
  const NAMES = ['libft', 'ft_printf', 'get_next_line', 'ft_split', 'ft_strjoin', 'ft_memcpy', 'ft_itoa', 'ft_lstmap', 'ft_atoi'];
  const COLS = ['#7a2233', '#1f3a66', '#2d5a3a', '#8a6a1f', '#1f5c63', '#5a2d63', '#44505e', '#8a3f1f', '#3a3f7a'];
  const ring = new THREE.Group(); root.add(ring);
  const pages = std('#efe7d2', { r: 0.9 });
  const books = NAMES.map((name, i) => {
    const h = 0.52 + ((i * 37) % 5) * 0.03, th = 0.1 + ((i * 13) % 3) * 0.015;
    const spine = canvasTex(64, 320, g => {
      g.fillStyle = COLS[i]; g.fillRect(0, 0, 64, 320);
      g.fillStyle = WARM; g.fillRect(0, 18, 64, 4); g.fillRect(0, 298, 64, 4);
      g.save(); g.translate(34, 160); g.rotate(-Math.PI / 2);
      g.font = `600 ${name.length > 10 ? 22 : 26}px ${MONO}`; g.fillStyle = '#f3e6c4'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 0, 0);
      g.restore();
    });
    const cover = std(COLS[i], { r: 0.75 });
    const spineMat = new THREE.MeshStandardMaterial({ map: spine, roughness: 0.7 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(th, h, 0.4), [cover, cover, pages, pages, spineMat, pages]);
    const holder = new THREE.Group(); holder.add(m); ring.add(holder);
    const a = i / NAMES.length * Math.PI * 2;
    holder.rotation.y = Math.PI / 2 - a;
    m.rotation.z = ((i * 7) % 5 - 2) * 0.04;
    return { m, a, out: 0 };
  });
  const linkMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 });
  const link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), linkMat);
  ring.add(link);
  let t = 0;
  function update(ctx) {
    t += ctx.dt;
    ring.rotation.y = t * 0.22;
    core.rotation.y = -t * 0.35; core.rotation.x = 0.35;
    const active = Math.floor(t / 2.2) % books.length, ph = (t % 2.2) / 2.2;
    books.forEach((b, i) => {
      const goal = i === active ? Math.sin(Math.PI * ph) : 0;
      b.out = approach(b.out, goal, 9, ctx.dt);
      const R = 0.66 + 0.24 * b.out;
      b.m.position.set(0, 0.03 * Math.sin(t * 1.4 + i), R);
    });
    const b = books[active], a = b.a, R = 0.66 + 0.24 * b.out;
    const pos = link.geometry.attributes.position;
    pos.setXYZ(1, Math.cos(a) * (R - 0.2), 0, Math.sin(a) * (R - 0.2)); pos.needsUpdate = true;
    linkMat.opacity = 0.9 * b.out;
  }
  return { root, update, front: false };
}

/* ============================================================
   CPP MODULES — the diamond: ClapTrap ← Scav/Frag ← DiamondTrap
   ============================================================ */
function cpp() {
  const root = new THREE.Group();
  function card(name, sub, members) {
    return board(380, 230, 0.4, (g, w, h) => {
      pill(g, 3, 3, w - 6, h - 6, 20, 'rgba(22,14,40,0.92)', 'rgba(180,140,255,0.75)');
      g.fillStyle = 'rgba(180,140,255,0.18)'; g.beginPath(); g.roundRect(3, 3, w - 6, 64, [20, 20, 0, 0]); g.fill();
      g.textBaseline = 'middle';
      g.font = `500 20px ${MONO}`; g.fillStyle = '#C8A8FF'; g.fillText('class', 22, 24);
      g.font = `600 30px ${SANS}`; g.fillStyle = TEXT; g.fillText(name, 22, 50);
      g.font = `500 19px ${MONO}`; g.fillStyle = MUTED; if (sub) g.fillText(sub, 22, 92);
      members.forEach((m, i) => { g.fillStyle = m[0] === '#' ? '#C8A8FF' : ACCENT; g.fillText(m, 22, 126 + i * 30); });
    }).sprite;
  }
  const nodes = {
    diamond: { pos: new THREE.Vector3(0, 0.66, 0), s: card('DiamondTrap', ': ScavTrap, FragTrap', ['+ whoAmI()', '+ attack()']) },
    scav: { pos: new THREE.Vector3(-0.66, 0, 0.22), s: card('ScavTrap', ': public ClapTrap', ['+ guardGate()', '+ attack()']) },
    frag: { pos: new THREE.Vector3(0.66, 0, -0.22), s: card('FragTrap', ': public ClapTrap', ['+ highFivesGuys()']) },
    clap: { pos: new THREE.Vector3(0, -0.66, 0), s: card('ClapTrap', '', ['# _hitPoints', '+ takeDamage()', '+ beRepaired()']) },
  };
  for (const k in nodes) { nodes[k].s.position.copy(nodes[k].pos); root.add(nodes[k].s); }
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xB48CFF });
  const EDGES = [['diamond', 'scav'], ['diamond', 'frag'], ['scav', 'clap'], ['frag', 'clap']];
  const pulses = [];
  EDGES.forEach(([c, p], i) => {
    const a = nodes[c].pos, b = nodes[p].pos, dir = b.clone().sub(a).normalize();
    const A = a.clone().addScaledVector(dir, 0.24), B = b.clone().addScaledVector(dir, -0.28);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(A, B), 8, 0.011, 8, false), edgeMat); root.add(tube);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 16), edgeMat);
    head.position.copy(B); head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); root.add(head);
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), new THREE.MeshBasicMaterial({ color: 0x9CC4FF })); root.add(pulse);
    pulses.push({ pulse, A, B, off: i * 0.25 });
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshBasicMaterial({ color: 0xB48CFF, wireframe: true, transparent: true, opacity: 0.55 }));
  root.add(core);
  const ring = new THREE.Group(); ring.rotation.x = 0.4; ring.userData.deco = true; root.add(ring);
  ['virtual', 'public:', 'const &', '::', 'new', 'delete', 'override', 'template<T>'].forEach((w, i, all) => {
    const b = board(256, 64, 0.1, g => { g.font = `500 32px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(200,168,255,0.85)'; g.fillText(w, 128, 34); });
    const a = i / all.length * Math.PI * 2; b.sprite.position.set(Math.cos(a) * 1.08, 0, Math.sin(a) * 1.08); ring.add(b.sprite);
  });
  let t = 0;
  function update(ctx) {
    t += ctx.dt;
    core.rotation.x = t * 0.4; core.rotation.y = t * 0.6;
    ring.rotation.y = -t * 0.2;
    for (const p of pulses) { const u = (t * 0.45 + p.off) % 1; p.pulse.position.lerpVectors(p.A, p.B, ease(u)); p.pulse.scale.setScalar(0.6 + 0.6 * Math.sin(Math.PI * u)); }
  }
  return { root, update, front: false };
}

/* ============================================================
   PYTHON MUSIC APP — a record on the platter, an equalizer ring
   ============================================================ */
function music() {
  const root = new THREE.Group();
  const deck = new THREE.Group(); deck.rotation.x = 0.28; root.add(deck);
  const vinylTop = canvasTex(512, 512, g => {
    g.fillStyle = '#0b0b0e'; g.beginPath(); g.arc(256, 256, 256, 0, 7); g.fill();
    for (let r = 250; r > 110; r -= 3) { g.strokeStyle = `rgba(255,255,255,${0.025 + 0.03 * ((r * 7) % 3 === 0)})`; g.lineWidth = 1; g.beginPath(); g.arc(256, 256, r, 0, 7); g.stroke(); }
    const sheen = g.createConicGradient ? g.createConicGradient(0.6, 256, 256) : null;
    if (sheen) { sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.08, 'rgba(255,255,255,0.10)'); sheen.addColorStop(0.16, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)'); sheen.addColorStop(0.58, 'rgba(255,255,255,0.08)'); sheen.addColorStop(0.66, 'rgba(255,255,255,0)'); g.fillStyle = sheen; g.beginPath(); g.arc(256, 256, 250, 0, 7); g.fill(); }
    const lg = g.createRadialGradient(256, 256, 10, 256, 256, 100); lg.addColorStop(0, '#ffd46b'); lg.addColorStop(1, '#e86a8f');
    g.fillStyle = lg; g.beginPath(); g.arc(256, 256, 100, 0, 7); g.fill();
    g.fillStyle = '#1b1b24'; g.font = `700 44px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PY ♫', 256, 236);
    g.font = `500 18px ${MONO}`; g.fillText('SIDE A · 33⅓', 256, 280);
    g.fillStyle = '#0b0b0e'; g.beginPath(); g.arc(256, 256, 7, 0, 7); g.fill();
  });
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.03, 96),
    [std('#111', { r: 0.4 }), new THREE.MeshStandardMaterial({ map: vinylTop, roughness: 0.28, metalness: 0.2 }), std('#111', { r: 0.4 })]);
  deck.add(vinyl);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.78, 0.06, 64), std('#2a2d35', { m: 0.8, r: 0.3 }));
  platter.position.y = -0.045; deck.add(platter);
  // Tonearm.
  const silver = std('#d6dbe4', { m: 0.95, r: 0.2 });
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 20), silver); pivot.position.set(0.72, 0.03, -0.55); deck.add(pivot);
  const arm = new THREE.Group(); arm.position.set(0.72, 0.08, -0.55); deck.add(arm);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 10), silver); rod.rotation.x = Math.PI / 2; rod.position.z = 0.36; arm.add(rod);
  const headshell = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.1), silver); headshell.position.set(0, -0.02, 0.72); arm.add(headshell);
  arm.rotation.y = -0.62;
  // The equalizer ring.
  const NB = 44;
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 1, 0.045), new THREE.MeshBasicMaterial({ color: 0xffffff }), NB);
  const cA = new THREE.Color('#FF7EB6'), cB = new THREE.Color(WARM), cC = new THREE.Color(BLUE);
  for (let i = 0; i < NB; i++) { const u = i / NB; bars.setColorAt(i, u < 0.5 ? cA.clone().lerp(cB, u * 2) : cB.clone().lerp(cC, (u - 0.5) * 2)); }
  deck.add(bars);
  const levels = new Float32Array(NB);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const notes = [...Array(5)].map((_, i) => { const sp = glyph(i % 2 ? '♫' : '♪', i % 2 ? ACCENT : '#FF9CC6', 0.22, `600 80px ${SANS}`); deck.add(sp); return { sp, t: i * 0.7 }; });
  let t = 0;
  function update(ctx) {
    const dt = ctx.dt; t += dt;
    vinyl.rotation.y -= dt * 1.9;
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.05)), 10);
    for (let i = 0; i < NB; i++) {
      const band = i / NB;
      const goal = 0.08 + 0.26 * (0.5 + 0.5 * Math.sin(t * (2.3 + band * 3.1) + i * 0.9)) * (1 - band * 0.35) + 0.32 * beat * (1 - band);
      levels[i] = goal > levels[i] ? approach(levels[i], goal, 30, dt) : approach(levels[i], goal, 5, dt);
      const a = i / NB * Math.PI * 2;
      pos.set(Math.cos(a) * 0.93, levels[i] / 2 - 0.05, Math.sin(a) * 0.93);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      scl.set(1, Math.max(0.02, levels[i]), 1);
      bars.setMatrixAt(i, m4.compose(pos, q, scl));
    }
    bars.instanceMatrix.needsUpdate = true;
    for (const n of notes) {
      n.t = (n.t + dt * 0.35) % 3.5;
      const k = n.t / 3.5, a = n.sp.id * 1.7;
      n.sp.position.set(Math.cos(a) * 0.35, 0.1 + k * 0.9, Math.sin(a) * 0.35);
      n.sp.material.opacity = Math.sin(Math.PI * k);
    }
  }
  return { root, update, front: false };
}

/* ============================================================
   GENERIC — any other project: a crystal with its icon
   ============================================================ */
function generic(project) {
  const root = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), new THREE.MeshBasicMaterial({ color: 0x6F9CE8, wireframe: true, transparent: true, opacity: 0.5 }));
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), std('#2a3a66', { e: '#3a5aa0', ei: 0.8, flat: true, r: 0.3 }));
  root.add(shell, core);
  if (project.icon) { const s = glyph(project.icon, TEXT, 0.5, `64px ${SANS}`); root.add(s); }
  let t = 0;
  return { root, update(ctx) { t += ctx.dt; shell.rotation.y = t * 0.3; core.rotation.x = t * 0.5; core.rotation.y = t * 0.4; }, front: false };
}

const MAKERS = { pushswap: pushSwap, cub3d, minishell, pipex, solong: soLong, philosophers, libft, cpp, music, generic };

export function emblemKind(project) {
  const w = project.world || {};
  if (w.emblem && MAKERS[w.emblem]) return w.emblem;
  const n = String(project.name || '').toLowerCase();
  if (/push.?swap/.test(n)) return 'pushswap';
  if (/cub3d/.test(n)) return 'cub3d';
  if (/pipex/.test(n)) return 'pipex';
  if (/minishell|shell/.test(n)) return 'minishell';
  if (/so.?long/.test(n)) return 'solong';
  if (/philo/.test(n)) return 'philosophers';
  if (/cpp|c\+\+/.test(n)) return 'cpp';
  if (/music|audio|sound|player/.test(n)) return 'music';
  if (/lib|printf|next.?line/.test(n)) return 'libft';
  return 'generic';
}

/* Build, then normalise into a unit sphere at the origin — measured
   on the SOLID parts only: sprites (readouts, labels) and groups marked
   userData.deco (orbiting glyph rings) float outside it, so the model
   itself fills its space instead of shrinking to make room for them. */
function solidBounds(obj, box, tmp) {
  if (obj.userData && obj.userData.deco) return;
  if (obj.isInstancedMesh) { obj.computeBoundingBox(); box.union(tmp.copy(obj.boundingBox).applyMatrix4(obj.matrixWorld)); }
  else if ((obj.isMesh || obj.isLine) && !obj.isSprite && obj.geometry) {
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    box.union(tmp.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld));
  }
  for (const c of obj.children) solidBounds(c, box, tmp);
}
export function makeEmblem(project) {
  const kind = emblemKind(project);
  const made = MAKERS[kind](project);
  made.root.traverse(o => { if (o.isMesh) packGroups(o); });
  made.update({ dt: 0, t: 0, camera: null, detail: true });
  const inner = made.root;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3();
  solidBounds(inner, box, new THREE.Box3());
  if (box.isEmpty()) box.setFromObject(inner);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const holder = new THREE.Group();
  inner.position.sub(sph.center);
  holder.add(inner);
  holder.scale.setScalar(1 / Math.max(1e-3, sph.radius));
  const root = new THREE.Group();
  root.add(holder);
  return { kind, root, update: made.update, front: made.front };
}
