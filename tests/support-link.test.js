import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { STRIPE_SUPPORT_URL, SUPPORT_MEDIA, SUPPORT_UTM_SOURCE, supportUrl } from '../src/lib/support-link.js';
import { isSupportUrl, supportPlacement } from '../src/lib/support-tracking.js';

// The donation link (src/lib/support-link.js). One-time donations moved from Buy Me a Coffee to
// a Stripe Payment Link on Nov 10 2026, and every link carries its placement as utm_content so a
// payment can be traced to the placement that led to it — the same label the support_click event
// reports. These tests pin the URL, the parameters, and that nothing outside the helper types
// either URL by hand.

const STRIPE = 'https://buy.stripe.com/14AaEW6Xx4AH9Ca7ssgEg00';

describe('supportUrl', () => {
  it('is the owner\'s Stripe Payment Link, character for character (the path is case-sensitive)', () => {
    expect(STRIPE_SUPPORT_URL).toBe(STRIPE);
    expect(SUPPORT_UTM_SOURCE).toBe('theblueboard');
  });

  it('appends source, medium and the placement as utm_content', () => {
    expect(supportUrl('footer')).toBe(
      `${STRIPE}?utm_source=theblueboard&utm_medium=site&utm_content=footer`,
    );
    expect(supportUrl('deep-use-prompt')).toBe(
      `${STRIPE}?utm_source=theblueboard&utm_medium=site&utm_content=deep-use-prompt`,
    );
  });

  it('has exactly one "?" and a parseable query, whatever the placement', () => {
    for (const label of ['footer', 'fleet-index-top', 'a b&c=d?e', 'x'.repeat(60)]) {
      const href = supportUrl(label);
      expect(href.split('?')).toHaveLength(2);
      const url = new URL(href);
      expect(`${url.origin}${url.pathname}`).toBe(STRIPE);
      expect([...url.searchParams.keys()]).toEqual(['utm_source', 'utm_medium', 'utm_content']);
    }
  });

  it('encodes the placement, trimmed and capped at 40 characters like the click label', () => {
    expect(new URL(supportUrl('a b&c=d?e')).searchParams.get('utm_content')).toBe('a b&c=d?e');
    expect(supportUrl('a b&c=d?e')).toContain('utm_content=a+b%26c%3Dd%3Fe');
    expect(new URL(supportUrl('  footer  ')).searchParams.get('utm_content')).toBe('footer');
    expect(new URL(supportUrl('x'.repeat(60))).searchParams.get('utm_content')).toBe('x'.repeat(40));
  });

  it('labels a missing or blank placement "other", as the click tracker does', () => {
    expect(new URL(supportUrl('')).searchParams.get('utm_content')).toBe('other');
    expect(new URL(supportUrl('   ')).searchParams.get('utm_content')).toBe('other');
    expect(new URL(supportUrl(undefined)).searchParams.get('utm_content')).toBe('other');
  });

  it('marks email links utm_medium=email and README links utm_medium=github', () => {
    expect(SUPPORT_MEDIA).toEqual(['site', 'email', 'github']);
    expect(supportUrl('welcome-email', { medium: 'email' })).toBe(
      `${STRIPE}?utm_source=theblueboard&utm_medium=email&utm_content=welcome-email`,
    );
    expect(new URL(supportUrl('readme-top', { medium: 'github' })).searchParams.get('utm_medium')).toBe('github');
  });

  it('falls back to utm_medium=site for an unknown medium instead of throwing in a render', () => {
    expect(new URL(supportUrl('footer', { medium: 'carrier-pigeon' })).searchParams.get('utm_medium')).toBe('site');
  });

  it('is a link the support_click tracker counts, labelled by data-support', () => {
    const href = supportUrl('footer');
    expect(isSupportUrl(href)).toBe(true);
    const anchor = { href, getAttribute: (name) => (name === 'data-support' ? 'footer' : null) };
    expect(supportPlacement(anchor)).toBe('footer');
  });
});

// ── Nobody types either URL by hand ──

const ROOT = process.cwd();
const SCANNED_DIRS = ['src', 'api', 'public', 'scripts', '.github'];
const TEXT = /\.(astro|tsx?|jsx?|mjs|json|txt|md|ya?ml|xml|html|webmanifest|css)$/;

function textFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return textFiles(path);
    return TEXT.test(name) ? [path] : [];
  });
}

const files = [...SCANNED_DIRS.flatMap(textFiles), 'README.md'].map((path) => ({
  path,
  src: readFileSync(join(ROOT, path), 'utf8'),
}));

function hits(re) {
  return files.flatMap(({ path, src }) => [...src.matchAll(re)].map(() => path));
}

describe('donation links in the repo', () => {
  it('writes the Stripe URL only in src/lib/support-link.js (and the README, pinned below)', () => {
    // A link (host + path); the tracker's bare host check in support-tracking.js is not a link.
    const where = [...new Set(hits(/buy\.stripe\.com\//g))].sort();
    expect(where).toEqual(['README.md', 'src/lib/support-link.js']);
  });

  it('keeps the README links equal to the helper\'s output', () => {
    const readme = files.find((f) => f.path === 'README.md').src;
    expect(readme.match(/https:\/\/buy\.stripe\.com\/[^)\s]+/g)).toEqual([
      supportUrl('readme-top', { medium: 'github' }),
      supportUrl('readme-end', { medium: 'github' }),
    ]);
  });

  it('has no one-time Buy Me a Coffee link left', () => {
    expect(hits(/buymeacoffee\.com\/notjbg(?!\/membership)\b/g)).toEqual([]);
  });

  it('leaves the monthly-membership links on Buy Me a Coffee only where the owner has them', () => {
    // No Stripe monthly link exists yet and two members are still billed on Buy Me a Coffee.
    // A new membership link should be a decision, not a copy-paste.
    expect(hits(/buymeacoffee\.com\/notjbg\/membership/g).sort()).toEqual([
      'README.md',
      'src/app/features/DisclaimerDialog.tsx',
    ]);
  });

  it('gives every on-site link the same label in utm_content and data-support, once each', () => {
    const labels = [];
    for (const { path, src } of files) {
      if (!/\.(astro|tsx)$/.test(path)) continue;
      for (const m of src.matchAll(/supportUrl\(\s*'([^']+)'\s*\)/g)) {
        const label = m[1];
        // The opening tag around the call: from its "<" to the first ">" that is not an arrow.
        const start = src.lastIndexOf('<', m.index);
        const end = src.slice(m.index).search(/(?<!=)>/);
        const tag = src.slice(start, m.index + end);
        expect(tag, `${path}: supportUrl('${label}')`).toMatch(new RegExp(`\\b(data-)?support="${label}"`));
        labels.push(label);
      }
    }
    expect(labels.length).toBeGreaterThanOrEqual(9);
    expect(new Set(labels).size, 'two placements share a label').toBe(labels.length);
  });
});
