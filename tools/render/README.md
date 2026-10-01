# tools/render — headless visual verification

Chrome headless under SwiftShader (software GL), driven by
`puppeteer-core`. Stills only: ~15 fps, so motion is judged by
reasoning, not by watching. Not part of the site; nothing here ships.

Setup (once per machine; the repo has no package.json on purpose):

    npm i --prefix /tmp puppeteer-core
    export NODE_PATH=/tmp/node_modules

Serve the source first, on a port of your own:

    (cd src && python3 -m http.server 8123 >/dev/null 2>&1 &)

Scripts — all paths are absolute or relative to where you run them:

- `render.js <url> <out.png> [scrollVh=0] [settleMs=4000]`
  One still. Prints JSON with `--burst`/`--zoom` and console errors
  (the favicon 404 is noise). `W=390 H=844` env vars set the viewport.
  Useful views of `galaxy.html`: hero `0 4500`, approach `0.6 5000`,
  post-burst name `1.0 24000`, journey `4.35 24000` / `6.3 24000`.
  The burst runs on its own clock and the frame loop clamps `dt`, so
  at SwiftShader speed it needs ~24s of settle to reach `burst 1.000`.
- `flow.js <outdir> [W H]`
  The whole reader flow in ONE browser session, the way a reader
  actually gets it: hero → approach → the name (24s settle; the page
  written) → a scroll-up (allowed; the burst rewinds) and back → on
  into the profile → its end → `.click()` on the button → the release → the warp → the arrival →
  waits for `.is-system` → the system → `window.system.select(3)` →
  `select('pilot')` → a wheel (the page is one screen now). Eleven
  stills plus a JSON state line for each (`y`, `max`, the published
  vars, `warping`, `window.system.state()`). Under SwiftShader the
  nine worlds take ~10 s to bake. After launch `y` reads 0 at the planet: the trip
  is one-way and the sections above have collapsed. `URL=` overrides
  the page. Takes 2–3 minutes
  under SwiftShader. Use this, not `render.js` with a forced
  `.is-launched`, whenever the sky behind the planet matters: a direct
  jump never fires the burst, so the disc sits intact and bright
  behind it, which is not what the reader sees.
- REAL GPU. Headless Chrome on this Mac can use the M2 through Metal
  (`--use-angle=metal --enable-gpu --ignore-gpu-blocklist`), which runs
  at a true 60 fps — use it for anything about smoothness; SwiftShader
  cannot judge motion.
- `prof.js [W H variant]` (real GPU) — times every requestAnimationFrame
  callback and the gaps between frames through: the idle overview, a
  flight to planet 3, the time there, back, a flight to the pilot.
  Reports average / p95 / max frame gap and every frame over 20 ms with
  its time. `variant` = `noblur` / `nopanel` / `noemoji` to bisect.
- `motion.js <label> <target> [retarget]` (real GPU) — frame-by-frame
  camera sampling through one selection: first movement, the worst
  single-frame jump vs its neighbours (a snap; 1.0 = none), settle
  time relative to the orbiting body, card-open time, final framing.
  `retarget` re-selects 600 ms in.
- `ab-hover-det.js <url> <out.png> <scrollVh> x0 y0 x1 y1 [postFrames]`
  Deterministic sweep: seeds `Math.random` and hand-steps
  `requestAnimationFrame`/`performance.now`, so two runs are
  frame-identical except for a source change. Sweep the cursor at
  scroll 0 (the pointer maps to the disc there). Prints console errors.
- `diff.js <baseUrl> <a.png> <b.png> <diff.png> x0 y0 x1 y1 band`
  Pixel diff of two stills served from `<baseUrl>` (serve this folder
  on a second port for `blank.html` and the PNGs). Reports mean
  difference inside a band around the sweep line vs outside; the
  ratio is the signal. Writes an amplified diff map.

A/B recipe: render "on", `sed` the knob off, render "off", `sed` it
back, diff. Always `grep` afterwards that the knob was restored.
