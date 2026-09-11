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

## Branch note — `feat/shadcn-rebuild` (Sep 2026)
On this branch the site is being rebuilt on Tailwind v4 + shadcn/ui with Jonah's explicit
approval. DESIGN.md describes the OLD system until WP12 rewrites it; until then the design
authority is `docs/superpowers/specs/2026-09-11-shadcn-rebuild-design.md` and the plan in
`docs/superpowers/plans/2026-09-11-shadcn-rebuild.md`. The three inventory files next to the
spec are the parity contract: nothing they list may be dropped except TSA.
