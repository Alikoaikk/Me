# The trip — user story of `galaxy.html`

The whole site is one journey. The reader arrives in front of a galaxy,
scrolls into it, watches it write the name, lets the name go, presses
the one button, crosses space at light speed, lands on a world, and
discovers it is the star of a system whose planets are the projects.
Then they fly.

This document is the story as it is meant to play, scene by scene: what
the reader sees, what moves, who is in control, how long it takes, and
what ends the scene. `docs/ARCHITECTURE.md` says how it is built; this
says how it should feel. Rewritten 2026-09-24 after the whole flow was
rendered end to end with `tools/render/flow.js`.

## Motion identity

One personality for the whole page, so every scene feels like the same
film.

| Constant | Value | Why |
|---|---|---|
| Personality | **Premium** — slow, controlled, no overshoot | A signature, not a toy. Nothing bounces. |
| Signature easing | `cubic-bezier(0.4, 0, 0.2, 1)` for entrances; `cubic-bezier(0.3, 0, 1, 1)` for exits | Entrances decelerate into place; exits accelerate away and are shorter. |
| Duration palette | quick 0.3 s · standard 0.55 s · slow 0.9 s · theatrical 2–4 s | Micro-feedback, reveals, crossfades, and the two set pieces (burst, warp). |
| Who drives | **Scroll-driven** wherever the reader is exploring; **timed** only where the site takes over (the burst, the launch) | The reader is never fighting the page: either they hold the wheel or the page has clearly taken it. Never both at once. |
| Reverse | Scroll-driven beats run backwards until the button is pressed; from the press the trip is **one-way** | The approach and the burst can be scrubbed both ways from the name screen. After the press there is no way back to the galaxy, only forward. |
| Colour | Gold is the galaxy's bulge and the reader's own marks (nodes, labels, the ship); blue-white is the arms; nothing else gets a colour | One palette from the first frame to the last. |
| Three layers | Primary (the thing the reader follows) · secondary (its shadow: the quote, the caption, the node) · ambient (the sky is always alive: drift, shooting stars, cloud drift) | A flat scene has one layer; every scene here has three. |

## The cast

- **The sky** — the galaxy canvas (`galaxy.js`), fixed behind everything, alive from the first frame to the last: 15.5k simulated stars plus a 48k GPU field, slow drift, occasional shooting stars, a wake under the cursor.
- **The name** — `ALI KOAIK`, drawn only by stars; there is no text fill.
- **The quote** — one line of Interstellar under the name, rotating.
- **The button** — the Endurance ring, "Press here to start the trip". The only control on the page.
- **The warp** — the launch overlay (`warp.js`): streaks, flash, and the jump.
- **Koaik** — Ali's own world, a generated planet and the star of the system (`system.js`): relief, drifting clouds, a glint on the sea, a warm corona.
- **The nine emblems** — the projects, each a living model of itself on its own orbit (`emblems.js`).
- **The HUD** — the pilot chip, the map, the hint, the labels, and the card a selected body opens (`hud.js`).

## The scenes

Scroll positions are in viewport heights (vh). The page is 200 vh tall
until the name is written (max scroll 1.00) and one screen after the
launch.

### 0 · Arrival — at rest

**Sees:** the galaxy alone on black, tilted, its bulge just off centre.
No headline, no nav, no scroll cue (a deliberate choice; see *Open
decisions*). Shooting stars cross now and then. The cursor leaves a
wake in the stars.
**Moves:** ambient only — the disc turns very slowly, the field breathes.
**Control:** the reader's. Nothing happens until they scroll.
**Ends:** when they do.

### 1 · The approach — 0 to 0.9 vh

**Sees:** the camera pushes into the disc. The galaxy grows until the
arms leave the frame and the bulge fills the screen.
**Moves:** the zoom is scroll-driven (`ZOOM_PUSH`), so the reader's hand
is the throttle. Scrolling back pulls out again.
**Control:** the reader's.
**Ends:** at 0.90 vh, `BURST_TRIGGER`.

### 2 · The burst — timed, 2.8 s

**Sees:** the galaxy detonates. Its stars leave the disc and fly across
the screen; the field dissolves behind them; the stars land one by one
and write `ALI KOAIK` in the middle of the sky. As the last letter
closes, a line from Interstellar resolves beneath it.
**Moves:** everything, once. This is the first set piece and the one
moment the page takes the wheel: the burst runs on its own clock
(`BURST_DURATION`), not on scroll, so it always plays at full speed.
**Secondary:** the quote crossfades every 5.2 s with a 0.9 s lift.
**Control:** the site's, for under three seconds. Scrolling up afterwards
rewinds it over 0.6 vh (`BURST_REWIND_SPAN`) — the stars fly back
into the disc.
**Ends:** when the name is complete (`--burst` = 1).

### 3 · The name screen, and who Ali is

**Sees:** "HELLO, I'M" in gold above the name, the name in stars, the
Interstellar line beneath it, and under that three pills: GitHub,
LinkedIn, Email. At the foot of the screen a small "Who I am" cue with
a chevron breathing downward.
**Moves:** the greeting, the quote and the links resolve with the last
letter, so identity lands first. Scrolling on, the whole block — the
star name included — slides up with the page, and from here it reads
like a normal site. A glass top bar drops in (AK · About · Stack ·
Education · Projects, a gold drop under the section in view), and
four sections follow: `// about` — "Who I am", the brief, the bio,
status and links beside Ali's portrait in a floating circle with four
numbers in orbit around it (projects, 42 level, languages,
universities; they count up once, and each is a link to its section);
`// stack` — languages, tools & IDEs, technologies on one line of
flight; `// education` — "Academic path", a card per school that
turns to its story on hover; `// projects` — "What I build", one
sentence and the Endurance ring with "Press here to start the trip".
Each section comes in once, as a whole, when it is reached.
**Control:** the reader's. The profile only exists once the name is
written, so nothing can be scrolled past while the stars are still
writing it. Scrolling back up returns to the name (the top bar leaves)
and, further, to the galaxy (the burst rewinds). The bar's links and
the orbiting numbers jump between sections; the button is the only way
forward.
**Ends:** on the press.

### 4 · Take-off — the leave and the release

**Sees:** on the press the profile fades away and the name glides back
down to the centre of the sky; a beat later its letters let go, the
stars that made them sliding back into the field, until the sky is
just sky.
**Moves:** the fade 0.4 s, the glide 0.6 s, the release 1.2 s starting
0.5 s in — then the warp at once.
**Control:** the site's. This is the one-way door: the page is locked
and sealed, and there is no way back to the galaxy from here.

### 5 · Launch — the warp, timed 3.6 s

**Sees:** the stars begin to streak toward the reader. The streaks
grow, red and blue fringes appear at the edges, a tunnel of light opens
at the centre. At 1.1 s a white flash. Light speed holds for 1.2 s,
then the streaks shorten and thin, and behind the last of them a world
grows in from a point.
**Moves:** everything; there is no ship on screen (the reader *is* the
ship). Second set piece, timed.
**Control:** the site's. Scrolling is locked for 3.6 s and touch is
refused.
**Ends:** at 3.6 s, overlay gone, scrolling unlocked. The hero section
has collapsed too, so the planet is now the top of the page.

### 6 · Arrival at Koaik

**Sees:** the planet floats in the middle of the screen, lit from the
upper left, with a warm corona. Continents, snow on the peaks, clouds
drifting over them with their shadows, a glint on the sea. Under it:
`ARRIVAL — KOAIK`, "Ali's own world".
**Moves:** the globe grows in over 2 s (started at 2.1 s into the
launch, so it is already there as the streaks clear), then turns slowly.
**Control:** none yet; a beat to take the world in.
**Ends:** after that beat, the camera pulls back.

### 7 · The system

**Sees:** the camera swings up and back over 3.4 s, the caption fades,
and Koaik turns out to be the star of a system. From the inside out,
each orbit draws itself from where its planet will be, and the planet
grows in on it a beat behind, one per project. They are not planets:
each is a small living model of the project it stands for: push_swap's two stacks of numbered bars sorting
themselves with radix, one operation at a time; cub3D's textured maze
with a player casting rays and, above it, the first-person view those
rays render; minishell's terminal typing a session; pipex's pipe from
infile through cmd1 | cmd2 to outfile with data flowing in it;
so_long's floating island where a wizard collects golden snitches and
reaches the portal; the philosophers at their table taking forks and
logging; a ring of books around libft.a; the C++ diamond inheritance
with calls pulsing along it; a record spinning inside an equalizer
ring. Each carries its name. Top left, the pilot chip: name and
status. Bottom right, a map of the system with the reader's position.
Above it, a `⌂ System` button that returns to this view. Bottom
centre, the hint: drag to orbit, scroll to zoom, right-drag to slide,
W A S D to fly with Shift to boost, click a planet. The names ease in
one after another.
**Moves:** the projects orbit, slowly and at Kepler speeds; each turns
slowly and runs its own animation; Koaik's corona breathes. Hovering a planet
lights its label and its orbit and puts a slowly turning dashed
reticle around it. Left alone for seven seconds, the whole view drifts
slowly round the system until the reader touches anything.
**Control:** the reader's, entirely, from here on. Drag to orbit the
camera, scroll or pinch to zoom toward the pointer, right-drag or two
fingers to slide sideways, W A S D to fly along the line of sight (Q
and E down and up, Shift to boost), touch on a phone. The page itself
never scrolls.
**Ends:** it does not; this is where the reader lives now.

### 8 · A planet, or the pilot

**Sees:** clicking or tapping a planet (or its label) sets the camera
moving on the very next frame; it swings round and closes in, following
the planet along its orbit, and settles on its sunlit side in about
1.5 s with a gold reticle locked on it. Three quarters of the way in, a
card slides in from the side (a sheet from the bottom on a phone) and
the view eases over so the planet sits in the free space beside it: mission number and orbit, the project's name and
icon, its description, tech tags, links to the demo and the source,
and "Back to the system". The camera keeps the planet centred as it
travels on its orbit; the reader can still orbit around and zoom in
on it. Clicking Koaik, its label, or the chip opens the pilot's card
instead: portrait, name, degree and location, status, a brief, and
the readouts counting up.
**Moves:** the move is a spring, not a timed tween: it starts at once,
never overshoots and lands without a jolt. Clicking another planet
mid-flight simply re-aims it, with no stop. The card's parts arrive in
order; the selected orbit brightens. Dragging or scrolling mid-flight
hands the camera straight back to the reader.
**Control:** the reader's. "Back to the system", the `⌂ System`
button, the map, or Escape fly back to the overview; zooming far out
or flying away simply lets the planet go.

## The reverse path

Before the seal, every scroll-driven beat is symmetric, so scrolling up
is a rewind:

- while the name is still being written: below `BURST_TRIGGER −
  hysteresis` the burst rewinds over 0.9 vh; the stars fly back into
  the arms and the field re-forms.
- disc → arrival: the zoom pulls out.

From the press the trip is one-way. The sections above collapse and
the sky is frozen at its finished state: the reader can never scroll
back to the name or the galaxy. After launch the planet is the whole
page. To see the galaxy again, reload.

## Accessibility and fallbacks

- **Reduced motion:** no burst and no release — the name is simply
  there with the button under it; the press is a plain jump to the
  planet; the system is simply there, nothing orbits or spins, the
  controls still work; the ring drifts instead of spinning.
- **Keyboard:** the button is a real `<button>` with a focus ring; the
  planet labels are buttons too, so the system can be browsed by Tab
  and Enter; W A S D / arrows fly, Escape backs out.
- **Touch:** the launch refuses `touchmove` while it runs; the gate is
  the page end, so it needs no handler.
- **No WebGL2:** `galaxy.legacy.js` is injected for the sky. **No
  WebGL at all, or no module support:** the system is a plain list of
  the same cards, and the name and button are shown without the star
  reveal.
- **Screen readers:** the sky and overlays are `aria-hidden`; the name
  block is labelled; the rotating quote is `aria-live="off"`.

## What publishes what

| Token / class | Owner | Range | Read by |
|---|---|---|---|
| `--burst` | galaxy.js | 0–1 | (internal; the disc) |
| `--name-ali`, `--name-koaik` | galaxy.js | 0–1 | the name, the quote |
| `.is-written` | galaxy.js (or at once under reduced motion / no WebGL2) | name complete | the profile exists; the links and cue show |
| `--name-scroll`, `--name-scroll-n`, `uNameShift` | galaxy.js | px past the name screen | the star name and its HTML scroll up with the page; the cue fades |
| `.is-leaving`, `--leave` | galaxy.js | on press, 0→1 in 0.42 s | locks the page; fades the profile and the name's HTML |
| `--release` | galaxy.js | 0–1, timed from the press | fades the name and the button as the stars leave |
| `.is-released` | galaxy.js | release > 0.5 | hides the name block |
| `.is-sealed` | galaxy.js | on the press | collapses the approach and burst; freezes the scroll read; no way back |
| `.is-launched` | galaxy.js | on press | makes the planet exist; collapses the hero so the planet is the whole page |
| `.is-warping`, `--warp-fade` | warp.js | 3.6 s | locks scroll; fades name and button |
| `.is-arrived` | warp.js (or galaxy.js without the warp) | after the launch | retires the button's layer for good |
| `--planet-in` | system.js | 0–1 | the arrival caption |
| `.is-system` on `#planet`, `system:ready` | system.js | when the pull-back lands | the HUD fades in |
| `system:select` (`kind`, `index`) | system.js | on a click, a label, the chip, or back | hud.js opens or closes the card |

## How to watch it

Nothing has been watched in a real browser at 60 fps yet. Headless:

    (cd src && python3 -m http.server 8123 &)
    NODE_PATH=/tmp/node_modules node tools/render/flow.js /tmp/flow

renders the thirteen beats above in one session, the way a reader gets
them. Stills prove states, not motion; the timed pieces (burst, launch)
and the cascade need a real browser to judge.

## Open decisions

- **A scroll cue on arrival.** The first screen gives no hint that the
  page scrolls; `galaxy.html` says this is by design and a nav is
  coming. A single breathing chevron at the bottom, gone on the first
  scroll, would be in keeping with the rest and is the one thing a
  first-time reader may need. Not added.
