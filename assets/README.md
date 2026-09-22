# assets/

Binary and static assets — images, icons, fonts, downloadable files.

Currently **empty**: the site renders entirely from CSS, inline SVG and
Google Fonts, with the hero drawn procedurally in WebGL. No image,
icon or font file is checked in.

Anything added here is copied verbatim into `dist/` by `make build`
only if it is moved under `src/`. Assets that the pages load should
live in `src/assets/`; this folder is for source material that is not
served as-is (uncompressed artwork, design files).

Reference served assets from a page as `assets/<file>`.
