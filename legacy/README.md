# `legacy/` — the pre-rebuild dashboard, kept for reference

These two files are the shipped v1.7.x dashboard's markup and stylesheet, moved out of
`public/` (where they were served) so they stop being built while the React port reads from
them:

- `index.html` — the DOM structure, SEO blocks and JSON-LD the homepage shipped with. The
  crawlable copy and the six structured-data blocks now live in `src/lib/home-seo.js`, and
  `src/pages/index.astro` renders them; this file is the source that was ported from.
- `style.css` — the old stylesheet. Its z-index ladder is **not** carried over (the rebuild
  uses normal flow plus `isolate` on map wrappers), but its breakpoints, its Leaflet
  overrides and its behaviour-encoding rules are the reference for the remaining tabs.

`src/dashboard/main.js` is the third reference and stays where it is until it is deleted.

Nothing here is served, imported or bundled. Work packages 3–10 port the remaining tabs
against these files; **Task 12 deletes this directory** along with `src/dashboard/`.
