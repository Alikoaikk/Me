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
- **`src/js/galaxy/galaxy.js`** — WebGL2 HDR volumetric spiral galaxy for
  the hero. No libraries, no textures, no external assets. Renders scene
  to an RGBA16F buffer, thresholds, blurs across mips, then tone-maps
  with an ACES curve, so bright stars bloom the way they do on a camera
  sensor rather than clipping to flat white.
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

## Coupled geometry

The galaxy name reveal is mirrored in two places: `NAME_FONT`,
`NAME_CENTER_Y` and `ZOOM_PUSH` in `galaxy.js` have counterparts in
`galaxy.css` (see the comments marked CRITICAL there). `galaxy.js` also
publishes `--zoom` and `--nucleus-x` as CSS custom properties from its
own projection, so the CSS bloom tracks the canvas. Changing one side
without the other desynchronises the reveal.

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
