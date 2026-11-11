import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { supportUrl } from '../src/lib/support-link.js';
import { isSupportUrl, supportPlacement } from '../src/lib/support-tracking.js';

// The reader-supported ask on the content pages (src/components/site/SupportNote.astro).
// Its whole point is attribution: each placement's `data-support` label is what tells
// `fleet-top` clicks from `hub-end` clicks in Web Analytics. A copy-pasted label would
// silently merge two placements' numbers, so the labels are pinned here.

const COMPONENT = 'src/components/site/SupportNote.astro';

function astroFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return astroFiles(path);
    return path.endsWith('.astro') ? [path] : [];
  });
}

const usages = astroFiles('src').flatMap((file) => {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/<SupportNote\b[^>]*?placement="([^"]+)"/gs)].map((m) => ({
    file,
    label: m[1],
  }));
});

describe('SupportNote placements', () => {
  it('is placed on the fleet and hub pages, top and end', () => {
    const labels = usages.map((u) => u.label).sort();
    expect(labels).toEqual(
      [
        'fleet-end',
        'fleet-index-end',
        'fleet-index-top',
        'fleet-top',
        'hub-end',
        'hub-top',
        'hubs-index-end',
        'hubs-index-top',
      ].sort(),
    );
  });

  it('gives every placement a unique, short, lowercase label', () => {
    const labels = usages.map((u) => u.label);
    expect(new Set(labels).size, 'two placements share a data-support label').toBe(labels.length);
    for (const { file, label } of usages) {
      expect(label, `${file}: ${label}`).toMatch(/^[a-z][a-z-]*$/);
      expect(label.length, `${file}: ${label}`).toBeLessThanOrEqual(40);
    }
  });

  it('links to the Stripe donation page, tagged with the placement the click tracker reports', () => {
    const src = readFileSync(COMPONENT, 'utf8');
    expect(src).toMatch(/const href = supportUrl\(placement\);/);
    const markup = src.split('---').slice(2).join('---');
    expect(markup.match(/href=\{href\}/g)).toHaveLength(2);
    const href = supportUrl('fleet-top');
    expect(new URL(href).searchParams.get('utm_content')).toBe('fleet-top');
    expect(isSupportUrl(href)).toBe(true);
    const anchor = {
      href,
      getAttribute: (name) => (name === 'data-support' ? 'fleet-top' : null),
    };
    expect(supportPlacement(anchor)).toBe('fleet-top');
  });

  it('stays CSP-safe and follows the owner wording (donate, not coffee)', () => {
    const src = readFileSync(COMPONENT, 'utf8');
    const markup = src.split('---').slice(2).join('---');
    expect(markup).not.toMatch(/<script|<style|\son[a-z]+=/i);
    expect(markup).toMatch(/data-support=\{placement\}/);
    expect(markup).toMatch(/rel="noopener noreferrer"/);
    expect(markup.toLowerCase()).not.toContain('coffee');
    expect(markup).toContain('Donate');
  });
});
