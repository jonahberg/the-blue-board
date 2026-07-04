# Design System — The Blue Board

The Blue Board uses a dark NOC (Network Operations Center) aesthetic with cockpit-instrument warmth. Inspired by airline ops centers and aviation instrument panels — data-dense and functional, but with typographic personality and a warm amber secondary accent that gives the product its own face.

## Product Context
- **What this is:** Fan-built real-time operations dashboard for United Airlines — flight tracking, AI delay prediction, fleet data, weather, schedules
- **Who it's for:** Aviation enthusiasts and United frequent flyers who want ops-center-level visibility
- **Space/industry:** Aviation data / flight tracking (FlightRadar24, FlightAware, Flighty, ADSB Exchange)
- **Project type:** Data-dense web app / dashboard

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian with Retro-Futuristic accents
- **Decoration level:** Intentional — subtle atmospheric depth via panel gradients and richer border treatment. Not glossy, not glassmorphism. Think: the difference between a flat photo of a cockpit and being in the cockpit at night.
- **Mood:** Professional and precise, but clearly crafted by someone who loves aviation. Warm enough to spend hours in. The anti-template.
- **Reference sites:** Competitive research conducted against FlightRadar24, FlightAware, Flighty, ADSB Exchange. All converge on either corporate blue or raw utility. The Blue Board differentiates with typography and amber warmth.

## Typography

| Role | Font | Size | Weight | Notes |
|------|------|------|--------|-------|
| Display/Hero (h1) | Satoshi | 22px | 700 | `letter-spacing: -.5px`, `text-wrap: balance`. Geometric, modern, precise. |
| Headings (h2) | Satoshi | 16px | 700 | Section dividers, with bottom border |
| Headings (h3) | Satoshi | 13px | 600 | `color: var(--ua-accent)` |
| Navigation | Satoshi | 11-12px | 500-600 | Tab labels, nav items, pill text |
| Body text | DM Sans | 13px | 400 | `line-height: 1.7` on content pages, `1.4` on dashboard. Warmer and more refined than Inter. |
| Body emphasis | DM Sans | 13px | 500 | Inline emphasis, strong text |
| Data/metadata | JetBrains Mono | 10-11px | 400-600 | Dates, categories, stats, IATA codes. `text-transform: uppercase; letter-spacing: .5px` |
| Stat values | JetBrains Mono | 20-24px | 700 | Large numbers in stat cards. Featured stats use `color: var(--ua-amber)`. |
| Code/technical | JetBrains Mono | 12px | 400 | Registrations, flight numbers in data contexts |

- **Loading:** Satoshi via Fontshare CDN (`api.fontshare.com`). DM Sans and JetBrains Mono via Google Fonts. All self-hosted as WOFF2 in `/fonts/` for production to eliminate FOUT.
- **Scale:** 9px (micro labels) / 10px (mono labels) / 11px (nav, metadata) / 12px (small body) / 13px (body) / 16px (h2) / 20-24px (stat values, h1 mobile) / 22px (h1)

### Why these fonts
- **Satoshi** replaces Inter for all headings and navigation. Geometric with subtle personality — it reads as intentional and modern, not default. Nobody in flight tracking has invested in display typography.
- **DM Sans** replaces Inter for body text. Better optical correction, slightly warmer tone. The difference is subtle but cumulative — after reading a hub page or fleet table, the product feels more refined.
- **JetBrains Mono** stays. Perfect for aviation data: IATA codes, tail numbers, timestamps, stats.

## Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--ua-blue` | `#005DAA` | United Airlines brand blue. Primary accent, CTAs, active states. |
| `--ua-dark` | `#0B1018` | Page background. Deep blue-black with atmospheric depth. |
| `--ua-panel` | `#111A27` | Card/panel backgrounds. Elevated surface with slight blue warmth. |
| `--ua-panel-elevated` | `#152032` | Higher-elevation surfaces (headers, popovers). |
| `--ua-border` | `#1E2940` | All borders and dividers. Blue-tinted, not gray. |
| `--ua-border-subtle` | `#172236` | Lighter borders for table rows, inner dividers. |
| `--ua-text` | `#E2E8F0` | Primary text. High contrast on dark backgrounds. |
| `--ua-muted` | `#94A3B8` | Secondary text: dates, metadata, labels, subtitles. |
| `--ua-dim` | `#64748B` | Tertiary text: placeholder, disabled, micro-labels. |
| `--ua-accent` | `#6BAAED` | Links, interactive text, hover states. Slightly deeper than the old `#8ab4f8` — more intentional, less washed out. |
| `--ua-amber` | `#C4A35A` | **NEW.** Cockpit instrument amber. Featured stat values, highlight borders, hover warmth, premium callouts. Use sparingly — this is the personality color. |
| `--ua-amber-soft` | `rgba(196, 163, 90, 0.12)` | Amber background tint for badges and hover states. |
| `--ua-violet` | `#A78BFA` | Starlink-equipped aircraft markers on maps. Owner-approved Jul 4 2026. Not for text or buttons. |
| `--ua-blue-soft` | `rgba(0, 93, 170, 0.12)` | Blue background tint for active states. |
| `--ua-green` | `#22C55E` | Live indicators, positive status, on-time. |
| `--ua-yellow` | `#EAB308` | Warnings, moderate delays. |
| `--ua-red` | `#EF4444` | Critical alerts, cancellations, severe delays. |

### Color approach
- **Restrained** — blue primary + amber secondary + deep neutrals. Color is meaningful, never decorative.
- The amber secondary (`--ua-amber`) is borrowed from cockpit instrument lighting. Warm amber against cool blue is a classic aviation palette that no competitor uses. It gives the dashboard soul.
- **Amber usage rules:** Stat values on featured cards, `border-left` on highlight boxes, hover warmth on interactive elements, section labels. **NOT** buttons (use `--ua-blue`), **NOT** large backgrounds (too heavy), **NOT** body text.
- Neutrals shifted from generic slate-gray to atmospheric blue-black. Background `#0B1018`, panel `#111A27`, border `#1E2940` — all carry a subtle blue tint that makes the dark theme feel intentional rather than default.

### Dark mode
This is a dark-only product. No light mode. `color-scheme: dark` on `<html>`.

## Spacing
- **Base unit:** 4px
- **Density:** Compact (ops dashboard) / Comfortable (content pages)
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)
- Dashboard panels: `padding: 14-20px`, `gap: 12px` between cards
- Content pages: `margin-bottom: 40px` between sections

## Layout
- **Approach:** Grid-disciplined
- **Container:** `max-width: 900px`, `padding: 20px 16px`, centered.
- **Content measure:** Body text capped at ~680px for optimal readability.
- **Sections:** Separated by `border-top: 1px solid var(--ua-border)` with `padding-top: 24px; margin-bottom: 40px`.
- **Cards:** `background: linear-gradient(180deg, var(--ua-panel) 0%, rgba(17, 26, 39, 0.6) 100%); border: 1px solid var(--ua-border); border-radius: 6px; padding: 14-20px`. The subtle gradient adds atmospheric depth without breaking the flat aesthetic.
- **Featured/highlight:** `border-left: 3px solid var(--ua-amber)` on highlight boxes and featured cards. (Changed from `--ua-blue` — amber is now the feature/emphasis color.)
- **Border radius:** sm: 3-4px (badges, pills), md: 6px (cards, panels), lg: 10px (modals), full: 20px (jump nav pills)

## Motion
- **Approach:** Minimal-functional
- **Easing:** enter(`ease-out`) exit(`ease-in`) move(`ease-in-out`)
- **Duration:** micro(50-100ms) short(150-200ms)
- Hover transitions: 150ms ease on border-color, color, background
- The live pulse indicator is the only animation. Everything else is instant or near-instant.

## Components

### Breadcrumb Navigation
`font-family: Satoshi; font-size: 11px; font-weight: 500`, `color: var(--ua-muted)`, links in `var(--ua-accent)`. Pattern: `← The Blue Board / Section / Page`.

### Jump Navigation Pills
Rounded pills (`border-radius: 20px`) with `font-family: JetBrains Mono; font-size: 10px; font-weight: 600`, uppercase, `letter-spacing: .8px`. Hover: fill with `var(--ua-blue)`, lift `translateY(-1px)` with box-shadow.

### Cross-Nav (Hub Nav / Fleet Nav)
Rectangular pills (`border-radius: 4px`) with `font-family: JetBrains Mono; font-size: 11px; font-weight: 600`. Active state: `border-color: var(--ua-blue); color: var(--ua-blue); background: var(--ua-blue-soft)`.

### Highlight Box
`background: var(--ua-panel); border-left: 3px solid var(--ua-amber); padding: 12px 16px; border-radius: 0 6px 6px 0; font-size: 12px`. Title in `color: var(--ua-amber); font-family: Satoshi; font-weight: 600`. Used for IROPS alerts, CTAs, and callouts.

### Stat Cards
`background: var(--ua-panel); border: 1px solid var(--ua-border); border-radius: 6px; padding: 16px`. Featured variant: `border-left: 3px solid var(--ua-amber)` with stat value in `color: var(--ua-amber)`.

### Status Badges
`font-family: JetBrains Mono; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 3px`. Color-coded backgrounds at 12% opacity.

### Risk Badges
`font-family: JetBrains Mono; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 3px`. Green/yellow/red backgrounds at 10% opacity with 20% opacity border.

### Section Labels
`font-family: JetBrains Mono; font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ua-amber)`. Used above section headings for categorical context.

### Footer
Shared component (`src/components/Footer.astro`). Dark panel with disclaimer, data sources (FR24, AWC, FAA), donation CTA button, and social links. `font-size: 9px; font-family: DM Sans`.

## Responsive

Single breakpoint at **600px**.

- Headings: `h1` drops from 22px to 18px.
- Grids: 2-column → 1-column.
- Stat rows: stack vertically (2-column grid on mobile).
- Touch targets: minimum 44px hit area.

## Accessibility

- All interactive elements have visible focus states (`outline: 2px solid var(--ua-accent); outline-offset: 2px`).
- Color contrast: `--ua-text` on `--ua-dark` = 13.7:1 (AAA), `--ua-muted` on `--ua-dark` = 7.4:1 (AAA), `--ua-amber` on `--ua-dark` = 7.1:1 (AAA).
- Semantic HTML: `<article>`, `<nav>`, `<main>`, proper heading hierarchy.
- External links: `target="_blank" rel="noopener noreferrer"` with visual indicator.
- `color-scheme: dark` on `<html>` for native dark mode support.
- Status information never conveyed by color alone — always includes text label.

## Anti-Patterns (Avoid)

- No hero images or large photographs. This is a data-dense ops tool.
- No glassmorphism or heavy gradients. Subtle panel gradients for depth only.
- No colorful category badges. Differentiate by text label, not color.
- No drop shadows on cards. Border-only elevation (plus subtle gradient).
- No animations beyond subtle transitions (150-200ms) and the live pulse.
- No emoji overload. One functional emoji per label maximum.
- **No Inter.** Satoshi for headings/nav, DM Sans for body. Inter is the "I didn't choose a font" font.
- **No amber overuse.** Amber is the personality color — if it's everywhere, it's nowhere. Stat values, highlight borders, section labels. That's it.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-01-XX | Initial design system | Dark NOC aesthetic with Inter + JetBrains Mono |
| 2026-03-19 | Typography overhaul | Inter → Satoshi (display) + DM Sans (body). Inter was generic; new stack gives the product visual identity. |
| 2026-03-19 | Amber secondary accent | Added `--ua-amber` (#C4A35A) as cockpit-instrument secondary. Blue + amber is classic aviation; no competitor uses it. |
| 2026-03-19 | Neutral warmth shift | Background/panel/border shifted from generic slate to atmospheric blue-black. Panels get subtle gradient depth. |
| 2026-03-19 | Accent blue refinement | `#8ab4f8` → `#6BAAED`. Less washed out, more intentional. |
| 2026-03-19 | Highlight borders to amber | Featured/highlight `border-left` changed from `--ua-blue` to `--ua-amber`. Blue is for interactive; amber is for emphasis. |
