// United blue does two jobs on the dark theme: ink (links, rings, bars) on the dark surfaces,
// and a fill behind white text (buttons, CTAs, badges, the skip link). Those need opposite
// lightness, so they are two tokens — `--primary` and `--primary-fill` — and this test
// resolves both from the real `.dark` block and holds each pair to WCAG AA (4.5:1).
// The v1.8.0 rebuild used `--primary` for both and every filled CTA measured 2.99:1.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

function darkTokens() {
  const block = css.match(/\n\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const tokens = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

/** `oklch(L C H)` → linear sRGB, clamped (Björn Ottosson's reference matrices). */
function oklchToLinearRgb(value) {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) throw new Error(`not a plain oklch() colour: ${value}`);
  const [L, C, H] = m.slice(1).map(Number);
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
}

const luminance = (value) => {
  const [r, g, b] = oklchToLinearRgb(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('dark-theme primary contrast', () => {
  const t = darkTokens();

  it('reproduces the audited 2.99:1 failure for white on --primary (sanity check of the maths)', () => {
    expect(contrast(t['primary-foreground'], t.primary)).toBeCloseTo(3.0, 1);
  });

  it('white text on --primary-fill clears 4.5:1', () => {
    expect(contrast(t['primary-foreground'], t['primary-fill'])).toBeGreaterThanOrEqual(4.5);
  });

  it('--primary as text clears 4.5:1 on both --background and --card', () => {
    expect(contrast(t.primary, t.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.primary, t.card)).toBeGreaterThanOrEqual(4.5);
  });

  it('--primary-fill keeps the United-blue hue of --primary', () => {
    const hue = (v) => Number(v.match(/([\d.]+)\s*\)$/)[1]);
    expect(hue(t['primary-fill'])).toBe(hue(t.primary));
  });
});

describe('filled surfaces use --primary-fill', () => {
  function* walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) yield* walk(path);
      else if (/\.(tsx|ts|astro|css)$/.test(name)) yield path;
    }
  }

  it('no element pairs a solid bg-primary with text-primary-foreground', () => {
    const offenders = [];
    for (const file of walk(new URL('../src', import.meta.url).pathname)) {
      // Checkbox ticks and switch thumbs are graphics (3:1 rule), not text.
      if (/ui\/(checkbox|switch)\.tsx$/.test(file)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/text-primary-foreground/.test(line) && /(?<![\w-])bg-primary(?![\w-])/.test(line)) {
            offenders.push(`${file}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
