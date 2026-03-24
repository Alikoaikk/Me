# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the site

No build step — open `index.html` directly in a browser, or serve with any static file server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

The projects page is a separate file: `projects.html`.

## Architecture

This is a zero-dependency static portfolio site. No framework, no bundler, no package manager.

### Data flow

All content lives in `data.js`, which exposes a single global `window.portfolioData` object. Both `main.js` (for `index.html`) and the inline script in `projects.html` read from this object and inject HTML into pre-existing DOM placeholder elements.

### File roles

- **`data.js`** — Single source of truth for all content: personal info, projects, skills, education. Edit this to change any portfolio content.
- **`main.js`** — Renders every section of `index.html` (hero, about, skills, projects, education, contact, footer). Also handles: typewriter animation, scroll reveal (IntersectionObserver), navbar scroll behavior, and hamburger menu.
- **`fluid.js`** — Self-contained WebGL fluid simulation (Navier-Stokes) for the hero background canvas (`#heroCanvas`). Wrapped in an IIFE. Mouse events are bound to the parent `<section id="hero">` (not the canvas itself) because the canvas sits behind `.hero-content`. Config constants at the top control all simulation behavior.
- **`style.css`** — All styles for both pages. Uses CSS custom properties (design tokens) defined in `:root`.
- **`index.html`** — Main page shell with empty placeholder elements; content injected by `main.js`.
- **`projects.html`** — Standalone projects page; has its own inline script that reads `portfolioData` and renders cards directly.

### Education card hover

Uses CSS opacity crossfade (not 3D flip). `.edu-card-front` fades to `opacity: 0` and `.edu-card-back` fades in on hover. The 3D flip approach was abandoned because `backdrop-filter` on the front face creates a stacking context that breaks `backface-visibility: hidden`.

### Scroll reveal

Sections in `index.html` use a `.reveal` class + IntersectionObserver in `main.js`. Elements without `.reveal` appear immediately. The projects page (`projects.html`) has no scroll reveal — all cards render instantly.
