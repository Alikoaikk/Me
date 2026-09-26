# Architecture

A static, zero-dependency site. No build step is required to run it —
`make build` only copies files so the deployed tree has the pages at its
root.

## Data flow

All content lives in `src/js/data.js`, which exposes a single global
`window.portfolioData`. Both `main.js` (for `index.html`) and the inline
script in `projects.html` read from that object and inject HTML into
pre-existing DOM placeholder elements. There is no templating layer and
no state store — each page renders once on load.

## File roles

- **`src/js/data.js`** — Single source of truth for all content:
  personal info, projects, skills, education. Edit this to change any
  portfolio content.
- **`src/js/main.js`** — Renders every section of `index.html` (hero,
  about, skills, projects, education, contact, footer). Also handles the
  typewriter animation, scroll reveal (IntersectionObserver), navbar
  scroll behavior and the hamburger menu.
- **`src/js/galaxy/galaxy.js`** — WebGL2 HDR spiral galaxy for the hero.
  No libraries, no textures, no external assets. Renders scene to an
  RGBA16F buffer, thresholds, blurs across mips, then tone-maps with an
  ACES curve, so bright stars bloom the way they do on a camera sensor
  rather than clipping to flat white. Two star populations — see
  *Populations* below. The volumetric dust pass is present but off
  (`config.DUST`).
- **`src/js/warp.js`** — the launch sequence, run from the "start the
  trip" button, on a fixed 2D canvas overlay (`#warp`). No ship, by
  the user's decision (two were tried and rejected): the reader is the
  ship. A depth field of stars streaks toward the camera as the speed
  ramps up over ~1.1 s, a white flash hides a one-step `scrollTo` to
  the planet section, ~1.2 s at full speed with chromatic fringes,
  then deceleration as the planet grows in behind the last streaks.
  3.6 s total. The root carries `.is-warping` meanwhile, which locks
  user scrolling. Publishes `--warp-fade` (the name block multiplies
  it into its opacity). `renderAt(t)` paints the overlay at an exact
  moment for the headless harness. Never touches the galaxy.
- **`src/js/system.js`** — the Koaik system, an ES module on three.js
  (vendored under `src/js/vendor/three/`, loaded through the import
  map in `galaxy.html`). Koaik grows in on arrival, then the camera
  pulls back to show it as the star of a system whose bodies are the
  projects from `portfolioData.projects`, one orbit each. Koaik is
  GENERATED: two bake passes into render targets (colour+altitude,
  slopes+clouds+lights) from simplex noise, then a globe shader. The
  projects are EMBLEMS from `emblems.js` — each a small animated model
  of the project itself (push_swap's stacks running radix sort,
  cub3D's maze and live raycast view, minishell's typing terminal…),
  lit by a point light inside Koaik, compiled off-screen before they
  appear, and chosen by name or by `world: { emblem }` in data.js. OrbitControls plus keyboard flight, raycast
  hover and click, HTML labels projected onto the canvas, a 2D map.
  Entry points `window.koaik.arm()/reveal()` for warp.js; events
  `system:ready` / `system:select` / `system:hover` / `system:fallback`
  on the section; `window.system` for tests.
- **`src/js/profile.js`** — the text of the name screen and of the
  profile below it: the GitHub / LinkedIn / Email links under the
  name, and who Ali is (brief, bio, status, the four numbers with a
  count-up, the schools) ending on the launch button. `galaxy.js`
  scrolls the star-written name up with the page (`uNameShift` in the
  star shader, `--name-scroll` for the HTML around it) and, on the
  press, fades the profile (`--leave`) and glides the name back to the
  centre before the release.
- **`src/js/hud.js`** — the system's text: fills the arrival caption,
  the pilot chip and the hint, opens the panel (a project's card, or
  the pilot's card with count-up) on `system:select`, and renders the
  same content as a plain list when there is no WebGL or the module
  never ran (`file://`).
- **`src/js/galaxy/galaxy.legacy.js`** — WebGL1 particle fallback. Not
  referenced by any page; `galaxy.js` injects it at runtime when a WebGL2
  context cannot be created. See *Fallback path* below.
- **`src/js/effects/globe.js`** — Loaded by `index.html`.
- **`src/js/effects/fluid.js`** — Self-contained WebGL fluid simulation
  (Navier-Stokes) for a hero background canvas (`#heroCanvas`), wrapped
  in an IIFE. **Not referenced by any page today** — kept because the
  galaxy hero superseded it. Config constants at the top control all
  simulation behavior.
- **`src/css/style.css`** — All shared styles for every page. Uses CSS
  custom properties (design tokens) defined in `:root`.
- **`src/css/galaxy.css`** — Galaxy hero overrides.
- **`src/index.html`** — Page shell with empty placeholders; content
  injected by `main.js`.
- **`src/projects.html`** — Standalone projects page with its own inline
  script that reads `portfolioData` and renders cards directly.

## Path conventions

Pages reference their assets relative to `src/`, e.g.
`css/style.css`, `js/effects/globe.js`. Because `make build` copies
`src/` to the root of `dist/`, these same relative paths resolve both
when serving `src/` directly and when serving the built tree.

## Fallback path

`galaxy.js` is the only script that loads another script at runtime. It
resolves `galaxy.legacy.js` against its **own** URL rather than the
page's:

```js
const SCRIPT_URL = (document.currentScript && document.currentScript.src)
  || location.href;
// ...
fallback.src = new URL('galaxy.legacy.js', SCRIPT_URL).href;
```

`document.currentScript` is only set while the script executes
synchronously, which is why the value is captured at the top of the IIFE
rather than read at the point of use. Keeping the two galaxy files
siblings means the fallback keeps resolving wherever the hero page
lives; if they are ever separated, this is the line to update.

When even WebGL1 is unavailable, `galaxy.js` sets `data-no-webgl` on the
document element and CSS paints the name conventionally. This matters
more than a usual fallback: the name has no fill and no stroke — the
stars *are* the letterforms — so without it the hero is a blank screen
with no name on it.

## Populations

The galaxy is two sets of points drawn by the same shader:

- **Live** (`STAR_COUNT`, 15.5k) — simulated on the CPU every frame:
  infall, respawn at the rim, and the cursor wake. These are the stars
  that migrate to the sky and write the name in the burst. The CPU
  cost of `simulate()` is what caps this count.
- **Field** (`FIELD_COUNT`, 48k) — placed once from the same
  distributions (`sampleDisc`), uploaded once, and never touched by
  the CPU again. Its rigid rotation is applied in the vertex shader
  from `uPattern`, so it turns with the live stars and freezes with
  them. It leans on the smooth populations (bulge, interarm) and is
  fainter and smaller than a live star: it is the unresolved light of
  a photograph, and it is what makes the arms bands rather than
  strings and the bulge a gradient rather than a dot. In the burst it
  does not travel — it dissolves where it stands (`uMigrate = 0`), so
  the sky is not flooded with tens of thousands of extra arrivals.

  The field answers the cursor exactly as the live stars do. Its wake
  and return spring are a line-for-line port of the ones in
  `simulate()`, run as a WebGL2 **transform-feedback** pass
  (`simulateField`) over an offset/velocity pair that ping-pongs
  between two buffer sets each frame. The render pass reads the set
  just written as `aOff`. It is frozen on the same condition as the
  live simulation, so the two populations never diverge in the burst.
  One physics rule for every star in the galaxy, and still nothing on
  the CPU.

Every star carries a `kind` (`aKind`): 0 an ordinary point, 1 an HII
nebula (a wide soft pink blob, no core, no spikes), 2 a giant
(six-point diffraction and a faint blue ring). Arm stars are split
between two primary ridges and, with `SECONDARY_FRACTION`, two fainter
secondary ridges midway between them — a half-integer arm index in
`armRidge` is the whole mechanism.

## Coupled geometry

The galaxy name reveal is mirrored in two places: `NAME_FONT`,
`NAME_CENTER_Y` and `ZOOM_PUSH` in `galaxy.js` have counterparts in
`galaxy.css` (see the comments marked CRITICAL there). `galaxy.js`
publishes `--burst`, `--name-ali` and `--name-koaik` as CSS custom
properties, at 1/500 resolution and with **no CSS transitions** on the
consumers: the values are already eased on the JS side, and a
transition retargeted every frame trails the canvas instead of
smoothing it. Changing one side without the other desynchronises the
reveal.

The arm ridge (`armRidge`) is also duplicated between JS and GLSL,
wobble terms included, so the dust field and the particles agree on
where the arms are.

## Scroll and the burst

The approach (zoom) is scroll-driven and eased. The burst is an
**event**: crossing `BURST_TRIGGER` starts a clock and it plays out on
its own. The reverse is scroll-driven again — above the trigger,
`burst` follows the scroll position back down over `BURST_REWIND_SPAN`
viewport heights, eased just enough to hide wheel steps, so the galaxy
reassembles in step with the finger and holds wherever it is left.
Re-crossing the trigger resumes the clock from the current value
rather than restarting it.

The **release** is the take-off, timed from the button press
(`RELEASE_TIME` 1.8 s, `releaseClock` in the frame loop): each fill
star's home slides from its letterform to the sky spot it would
otherwise have had, staggered per star so the word frays outward, and
every fill-specific value (size, brightness floor, bow) crossfades to
the sky value with it. It is gated on `burst >= 0.9` — a name cannot
dissolve before it is written. `--release` fades the name block (and
`.is-released` hides it) and the launch button with it; when the
release has played (`release >= 0.985`) the frame loop calls
`onLiftOff` once, which marks `.is-launched` and starts the warp.

The written name is a **gate**. The planet section is `display: none`
until `galaxy.js` adds
`.is-launched` to the root on the button's click, so before that the
document simply ends at `#burst` and the browser's own scroll bound
holds the reader on the button: nothing to clamp, nothing to fight.
The click expands both sections and hands over to `warp.js`, whose
sequence lands the page on the planet (scrolled there in one step
under the jump flash); without `warp.js`, or under reduced motion, it
scrolls to the planet's top instead. The
section heights are load-bearing: hero 100 + intro 180 + burst 90 =
370vh puts the page end at 2.70vh, just past the burst trigger at
2.60.

The trip is **one-way from the button**. Until it is pressed the
reader may scroll back up from the name to the galaxy (the burst
rewinds). On the press `galaxy.js` `seal()` freezes its scroll read at
the finished sky and adds `.is-sealed`, which collapses
`#intro` and `#burst` to nothing (padding included; `style.css` pads
sections at ID-level specificity, hence the `:not()` selectors in
`galaxy.css`). The page is then one screen and cannot be scrolled back
to the galaxy. Before that the page simply ends on the name and quote
with the launch button under them (`.launch-layer`, on the name's anchor, resolving on
`--name-koaik` and gated by `.is-written`). Pressing the button plays
the **release** — the fill stars slide out of the letters back into
the sky, timed over `RELEASE_TIME` from the press, the button fading
on `--release` — and when it has played the frame loop lifts off:
`.is-launched` collapses `#hero` as well, so after
launch the planet's top is 0 and the page is one screen, and the browser's
own bound keeps the reader from scrolling above the planet. Shrinking
the document makes the browser clamp `scrollY` to the new end, so the
launch handler puts it back to 0 explicitly; the warp's jump to the
planet is then a no-op.

While `burst >= BURST_FREEZE` the simulation is skipped so every star
has one fixed origin. `patternAngle` advances **inside** `simulate()`,
below that check, and nowhere else: star positions are rebuilt from it
each step rather than integrated, so letting it tick while frozen made
the whole disc snap by the accumulated rotation the frame the sim
thawed.

## Education card hover

Uses a CSS opacity crossfade, not a 3D flip. `.edu-card-front` fades to
`opacity: 0` while `.edu-card-back` fades in on hover. The 3D flip
approach was abandoned because `backdrop-filter` on the front face
creates a stacking context that breaks `backface-visibility: hidden`.

## Scroll reveal

Sections in `index.html` use a `.reveal` class plus an
IntersectionObserver in `main.js`; elements without `.reveal` appear
immediately. `projects.html` has no scroll reveal — all cards render
instantly.
