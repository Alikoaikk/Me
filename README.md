# alikoaik.com

Personal portfolio site for Ali Koaik. Zero dependencies — no framework,
no bundler, no package manager. Every page is plain HTML, CSS and
JavaScript, and the hero galaxy is hand-written WebGL2.

## Quick start

```bash
make serve          # http://localhost:8080
```

Or open `src/index.html` directly in a browser — nothing needs building
to view the site locally.

## Make targets

| Target        | What it does                                        |
| ------------- | --------------------------------------------------- |
| `make serve`  | Serves `src/` on `$PORT` (default 8080)             |
| `make build`  | Stages `src/` + `CNAME` into `dist/`                |
| `make check`  | Verifies every local `.js`/`.css` reference resolves |
| `make clean`  | Removes `dist/`                                      |
| `make deploy` | Publishes `dist/` to the `gh-pages` branch           |
| `make help`   | Lists the targets                                    |

## Layout

```
├── CNAME               # alikoaik.com
├── Makefile
├── README.md
├── docs/
│   ├── ARCHITECTURE.md # how the pages, data and renderers fit together
│   └── USER-STORY.md   # the experience scene by scene: what moves, who drives
├── assets/             # non-served source material (currently empty)
├── tools/render/       # headless render + A/B harness (dev only, see its README)
└── src/                # everything the site serves
    ├── index.html      # main page — sections injected by js/main.js
    ├── projects.html   # standalone projects page, own inline script
    ├── galaxy.html     # WebGL2 galaxy hero
    ├── css/
    │   ├── style.css   # design tokens + all shared styles
    │   └── galaxy.css  # galaxy hero overrides
    └── js/
        ├── data.js     # single source of truth for all content
        ├── main.js     # renders index.html
        ├── warp.js     # launch sequence: 3D ship, light-speed streaks, landing
        ├── profile.js  # the name screen's links and the profile below it (who Ali is, the numbers)
        ├── hud.js      # the system's text: caption, pilot chip, hint, the panel, the fallback
        ├── system.js   # the Koaik system: three.js scene, Koaik's generated world, camera rig, controls, picking (ES module)
        ├── emblems.js  # each project as a living 3D model of itself: push_swap sorting, cub3D raycasting… (ES module)
        ├── vendor/three/ # three.js r186 (MIT): core, module, OrbitControls — see its README
        ├── galaxy/
        │   ├── galaxy.js        # WebGL2 HDR galaxy
        │   └── galaxy.legacy.js # WebGL1 fallback, loaded at runtime
        └── effects/
            ├── globe.js         # used by index.html
            └── fluid.js         # not currently referenced by any page
```

`dist/` is generated and gitignored.

## Editing content

All copy — personal info, projects, skills, education — lives in
`src/js/data.js` as `window.portfolioData`. Change it there; both
`main.js` and the inline script in `projects.html` read from it.

## Deployment

> [!IMPORTANT]
> The pages moved from the repo root into `src/`, so **GitHub Pages must
> be repointed or the site will stop serving**. Pages can only serve from
> a branch root or `/docs` — it cannot serve from `/src` or `/dist`.

Run `make deploy` (publishes the built tree to the `gh-pages` branch),
then in **Settings → Pages** set the source to the `gh-pages` branch,
root folder. `CNAME` is copied into the build, so the custom domain
survives each deploy.

Until that switch is made, the live site still serves the old
root-level files from the previously published commit.
