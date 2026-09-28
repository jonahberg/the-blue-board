/**
 * The tracker status palette, as complete Tailwind class strings.
 *
 * Tailwind scans source files for literal class names, so every value here must
 * be a whole, unbroken utility string — never assembled with interpolation, or
 * the class is silently absent from the built stylesheet. Six consumers share
 * these maps (StatusBadge, TrackerMap, StatStrip, TrackerPulse, the trackers
 * index cards and the detail pages), which is exactly why they live in one file.
 *
 * Status is never carried by colour alone: every badge pairs a tone with its
 * text label, and the map pairs it with a marker SHAPE (dot / diamond / ring).
 * The tones below are the second channel, not the only one.
 */

/**
 * `yellow` is the in-progress/scheduled status. `amber` was an editorial gold accent; the
 * amber secondary is retired (DESIGN.md), so it now renders exactly as `yellow` — the only
 * places it survives (the index summary's Scheduled/Building counts) mean the same thing.
 * `accent` is "announced": informative, not a problem (`bb-info`).
 */
export type Tone = 'green' | 'yellow' | 'accent' | 'amber' | 'neutral' | 'dim';

/**
 * Foreground colour for a tone.
 *
 * The SVG map and legend set this on the wrapping element and draw their shapes
 * with `fill="currentColor"` / `stroke="currentColor"`, so one map serves text,
 * fills and strokes alike.
 */
export const TONE_TEXT: Record<Tone, string> = {
  green: 'text-bb-ok',
  yellow: 'text-bb-warn',
  accent: 'text-bb-info',
  amber: 'text-bb-warn',
  neutral: 'text-muted-foreground',
  dim: 'text-muted-foreground',
};

/** Badge chrome: tint background + toned border + solid text. */
export const TONE_BADGE: Record<Tone, string> = {
  green: 'border-bb-ok/25 bg-bb-ok/10 text-bb-ok',
  yellow: 'border-bb-warn/25 bg-bb-warn/10 text-bb-warn',
  accent: 'border-bb-info/25 bg-bb-info/10 text-bb-info',
  amber: 'border-bb-warn/25 bg-bb-warn/10 text-bb-warn',
  neutral: 'border-border bg-muted text-muted-foreground',
  dim: 'border-border bg-muted/50 text-muted-foreground',
};

/** Solid fill for the segmented bars on the trackers index cards. */
export const TONE_BAR: Record<Tone, string> = {
  green: 'bg-bb-ok',
  yellow: 'bg-bb-warn',
  accent: 'bg-bb-info',
  amber: 'bg-bb-warn',
  neutral: 'bg-muted-foreground',
  dim: 'bg-muted-foreground',
};

/** A stat value with no tone stays in body colour. */
export const STAT_TONE: Record<string, string> = {
  ...TONE_TEXT,
  default: 'text-foreground',
};

/** Safe lookup — unknown tones fall back to the neutral treatment. */
export function toneClass(map: Record<string, string>, tone: string | undefined): string {
  return (tone && map[tone]) || map.neutral || map.default || '';
}
