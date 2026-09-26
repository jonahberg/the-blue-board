# The Blue Board — shadcn/ui rebuild: design spec

**Date:** 2026-09-11 · **Branch:** `feat/shadcn-rebuild` · **Owner:** Jonah Berg
**Status:** approved direction ("full transformation project", "complete transfer", "don't lose any features", "remove TSA from the site overall").

## 1. Goal

Rebuild theblueboard.co on one design system — Tailwind v4 + shadcn/ui (`radix-nova` preset:
Geist / Geist Mono, neutral base, a single United-blue primary, dark by default) — without
losing any user-facing feature of the current site except the TSA checkpoint guide, which is
removed entirely. The prototype at `~/bb-shadcn` (Sep 10) is the visual/UX reference; its
TypeScript re-ports of `src/lib` logic are NOT carried over.

**Scope assumption (stated, not asked):** every feature of the dashboard and the Astro pages
is in scope, including the ones the prototype skipped (My Flight + watch list + push, Sources,
AI delay explanations, onboarding, PWA/offline, tip strip, support meter, news banner, legal
popover, mobile bottom nav). Only TSA is dropped.

## 2. Architecture

### 2.1 One Astro build, React islands
- `astro.config.mjs` gains `@astrojs/react` and the `@tailwindcss/vite` plugin. `output`
  stays `static`; `build.format` stays `file`.
- `src/pages/index.astro` replaces `public/index.html`. Astro renders server-side everything a
  crawler or agent reads today: `<head>` meta/OG/Twitter/canonical/preloads, the `sr-only`
  page brief with the page `<h1>`, the `sr-only` hub/site nav, the `<noscript>` block, and the
  JSON-LD at the end of `<body>`. The interactive dashboard mounts as
  `<Dashboard client:only="react">` with a `slot="fallback"` skeleton.
- Why not a second Vite app: `middleware.ts` excludes `_astro/` but not `/assets/`, so a
  separate Vite build would invoke the middleware on every chunk; two builds would need a
  copy step and a second CSS pipeline; `stamp-seo-build-date.mjs` and `run-astro-dev.mjs`
  exist only because a static HTML file cannot import `src/data` — an Astro page imports
  `src/data/starlink-live.json`, `src/data/facts.js` and `getLastModified()` directly, so
  both hacks retire.
- `vite.dashboard.config.js`, `src/dashboard/main.js`, `public/js/dashboard.js`,
  `public/css/style.css`, `public/js/*.js` page scripts and the Satoshi/DM Sans/JetBrains
  fonts are deleted at the END of the migration (strangler pattern), never at the start.

### 2.2 Source layout (new)
```
src/
  styles/global.css          Tailwind v4 entry + shadcn tokens (from ~/bb-shadcn/src/index.css)
  components/ui/*.tsx        shadcn components (owned source, radix-nova)
  components/site/*.astro    shared Astro chrome: SiteHeader, SiteFooter, Seo, Breadcrumbs
  components/site/*.tsx      small React islands used by content pages (HubLiveData,
                             NewarkLive, SupportMeter, NewsBanner, WaitlistForm, PushOptIn)
  app/                       the dashboard island
    Dashboard.tsx            root: providers + shell + tabs
    shell/*.tsx              header, ticker, hub-health strip, tab bar, mobile nav, banners
    views/*.tsx              live, my-flight, schedule, fleet, starlink, weather, stats, sources
    features/*.tsx           flight sheet, search palette, watch panel, delay-explain dialog,
                             aircraft detail dialog, onboarding, disclaimer, legal, tip strip
    map/*.ts(x)              Leaflet map, markers, radar layer, basemap (uses src/lib/basemap.js)
    state/*.ts               contexts, hooks (useFeed, useJson, useWatchList, useHomeAirport…)
    data/*.ts                thin typed wrappers over /api/* and /data/*.json
  lib/*.js                   UNCHANGED pure logic, plus new modules extracted from main.js
  data/*                     UNCHANGED
  layouts/*.astro            restyled on the new tokens
  pages/*                    restyled; index.astro added; tsa.astro deleted
```

### 2.3 Logic stays in `src/lib` (JS) — the React app imports it
- `tsconfig.json` gets `allowJs: true`, `jsx: react-jsx`, `@/*` paths. React code imports
  `src/lib/*.js` directly (JSDoc types where useful). This keeps the ~80 vitest suites as the
  single source of truth for behaviour.
- Logic that today lives only in `main.js` is extracted FIRST into pure `src/lib/*.js`
  modules with vitest tests, while `main.js` still imports them (zero UI change). The React
  port then imports the same modules. The inventory (§5) names each such block.

### 2.4 Design system
- Tokens: shadcn `radix-nova` CSS variables from the prototype (`--primary` = United blue
  `oklch(0.66 0.17 255)` in dark; light palette kept for `prefers-color-scheme: light` only if
  cheap — dark is the product default and `color-scheme: dark` stays on `<html>`).
- Fonts: `@fontsource-variable/geist` + `@fontsource-variable/geist-mono`, bundled by Vite
  under `_astro/` (satisfies `font-src 'self'`). Old woff2 files and preloads are removed.
- Status colours (green/amber/red, flight categories, phases) always ship with an icon or
  text label — never colour alone (carries over the existing a11y rule).
- `DESIGN.md` is rewritten to describe this system; repo `CLAUDE.md` keeps pointing at it.

### 2.5 Platform contracts that must keep working
- CSP in `vercel.json` (`script-src 'self' https://va.vercel-scripts.com`, `style-src 'self'
  'unsafe-inline'`, `font-src 'self'`, img/connect allowlists). Leaflet is bundled from npm
  (unpkg removed from CSP and dns-prefetch). No inline scripts.
- `middleware.ts` Markdown negotiation and `_agent/` twins; `llms.txt`/`llms-full.txt`;
  sitemaps; RSS; `Accept: text/markdown` on `/`.
- Deep links: `/?flight=UA1234`, hub-page query params into the dashboard, watch-list
  notification links. `#tab` hashes may be ADDED, never required.
- PWA: `manifest.json`, `sw.js` (precache list changes to hashed `_astro/` assets — see
  inventory), offline banner, push subscription flow.
- All existing tests are updated, never deleted, except TSA tests which are deleted with the
  feature. `bun run test`, `bun run typecheck`, `bun run build` are the merge gates.
- Public copy: author name is "Jonah Berg" only. CARTO key never committed; read from
  `VITE_CARTO_BASEMAP_KEY` (Vercel Production env) via `src/lib/basemap.js`.

## 3. TSA removal
Delete the feature end-to-end: `api/tsa.ts`, `api/cron/refresh-tsa.ts`, their `vercel.json`
entries, `src/pages/tsa.astro`, `src/data/tsa/*`, `public/js/tsa-gate.js`, tests, routes in
`site-routes.js` / sitemap / llms / agent-markdown / nav / footer / index brief, and OG image.
News posts that mention TSA are content and stay. Add a 301 for `/tsa` → `/hubs` in
`vercel.json` redirects so old links do not 404.

## 4. Process
- Fable orchestrates and reviews; Opus subagents implement one work package each in this
  worktree; a fresh Opus reviewer audits parity against §5 at the end.
- Every package: `bun run test` + `bun run typecheck` + `bun run build` green, then one commit.
- Milestone previews: Jonah runs `vercel deploy` from this worktree (it is linked to
  united-noc-vercel); merge = production deploy and a failed prod build fails no GitHub check,
  so the PR body must show a local green build and a verified preview.
- Version bump to 1.8.0 + CHANGELOG entry in the final package.

## 5. Parity contract
The feature inventories in `docs/superpowers/specs/2026-09-11-inventory-*.md` are the
checklist. Every item must map to a file in the new tree or be listed in the PR as an
intentional drop (only TSA is pre-approved).
