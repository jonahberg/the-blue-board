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

/** `yellow` is the caution/scheduled status; `amber` is the editorial gold accent. */
export type Tone = 'green' | 'yellow' | 'accent' | 'amber' | 'neutral' | 'dim';

/**
 * Foreground colour for a tone.
 *
 * The SVG map and legend set this on the wrapping element and draw their shapes
 * with `fill="currentColor"` / `stroke="currentColor"`, so one map serves text,
 * fills and strokes alike.
 */
export const TONE_TEXT: Record<Tone, string> = {
  green: 'text-emerald-400',
  yellow: 'text-yellow-400',
  accent: 'text-sky-400',
  amber: 'text-amber-400',
  neutral: 'text-muted-foreground',
  dim: 'text-muted-foreground',
};

/** Badge chrome: tint background + toned border + solid text. */
export const TONE_BADGE: Record<Tone, string> = {
  green: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-400',
  yellow: 'border-yellow-400/25 bg-yellow-400/10 text-yellow-400',
  accent: 'border-sky-400/25 bg-sky-400/10 text-sky-400',
  amber: 'border-amber-400/25 bg-amber-400/10 text-amber-400',
  neutral: 'border-border bg-muted text-muted-foreground',
  dim: 'border-border bg-muted/50 text-muted-foreground',
};

/** Solid fill for the segmented bars on the trackers index cards. */
export const TONE_BAR: Record<Tone, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-yellow-400',
  accent: 'bg-sky-400',
  amber: 'bg-amber-400',
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
