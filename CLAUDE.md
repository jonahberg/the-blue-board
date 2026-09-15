# The Blue Board — Project Instructions

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Testing
Run the test suite with `bun run test` (which runs `bunx vitest run`), NEVER bare `bun test`.
Bun's built-in test runner reports ~28 false failures and silently drops ~33 tests here because
the suite is written for vitest's API (vi.stubEnv, fake timers, vi.mock). The canonical, green
command is `bun run test`. `tsc --noEmit` (via `bun run typecheck`) and `bun run build` must also
pass before any PR. This note overrides the global "use `bun test`" default for this repo.

## Architecture

Astro (`output: 'static'`) + one React island + Tailwind v4 + shadcn/ui. Since v1.8.0 there is
no second build and no `legacy/` tree.

- **`src/app/`** — the dashboard, a single `client:only="react"` island mounted by
  `src/pages/index.astro`. `Dashboard.tsx` composes the shell (`shell/`), the tab registry
  (`tabs.ts`) lazy-loads one view per tab (`views/`), and `state/` holds the providers.
  Overlays live in `features/`.
- **`src/lib/`** — every piece of logic that can be tested without a DOM: scoring, parsing,
  formatting, filtering, SEO metadata, plus the status/phase/category colour constants.
  **New logic belongs here with a test, not inline in a component.**
- **`src/components/`** — `ui/` is shadcn (edit in place, don't wrap), `site/` and
  `trackers/` are Astro building blocks. Content pages render through
  `site/BaseLayout.astro`, which owns the `<head>`, the header, the footer and the skip
  link — a page should never hand-write head tags.
- **`api/`** — Vercel functions. Never import `src/data/facts.js` or any bare `.json` from
  here (Node ESM throws on a bare JSON import; `tests/api-esm-json-imports.test.js` guards it).
- **CSP** is `script-src 'self' https://va.vercel-scripts.com` (the Vercel Analytics beacon is the one third-party script) plus sha256 hashes for Astro's two inline island scripts.
  `scripts/verify-csp-hashes.mjs` runs in `bun run build` and fails it when a hash in `dist/`
  is missing from `vercel.json` — that failure is the system working. No CDN, no inline
  `<script>`, no `on*=` attributes.
- **`bun run build` rewrites `src/data/starlink-live.json`.** Run
  `git checkout -- src/data/starlink-live.json` before committing.
