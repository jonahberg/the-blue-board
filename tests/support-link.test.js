import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLACEMENT_LABEL_RE,
  STRIPE_MONTHLY_URL,
  STRIPE_SUPPORT_URL,
  SUPPORT_AMOUNTS,
  SUPPORT_AMOUNT_LINKS,
  SUPPORT_MEDIA,
  SUPPORT_UTM_SOURCE,
  hasMonthlySupport,
  monthlySupportUrl,
  supportAmountUrl,
  supportUrl,
} from '../src/lib/support-link.js';
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

  it('appends source, medium and the placement as utm_content, and the placement as client_reference_id', () => {
    expect(supportUrl('footer')).toBe(
      `${STRIPE}?utm_source=theblueboard&utm_medium=site&utm_content=footer&client_reference_id=footer`,
    );
    expect(supportUrl('deep-use-prompt')).toBe(
      `${STRIPE}?utm_source=theblueboard&utm_medium=site&utm_content=deep-use-prompt&client_reference_id=deep-use-prompt`,
    );
  });

  it('has exactly one "?" and a parseable query, whatever the placement', () => {
    for (const label of ['footer', 'fleet-index-top', 'a b&c=d?e', 'x'.repeat(60)]) {
      const href = supportUrl(label);
      expect(href.split('?')).toHaveLength(2);
      const url = new URL(href);
      expect(`${url.origin}${url.pathname}`).toBe(STRIPE);
      const utm = ['utm_source', 'utm_medium', 'utm_content'];
      expect([...url.searchParams.keys()]).toEqual(PLACEMENT_LABEL_RE.test(label.slice(0, 40)) ? [...utm, 'client_reference_id'] : utm);
    }
  });

  it('sends client_reference_id only for a label Stripe will keep (letters, digits, - and _, up to 40)', () => {
    // Stripe silently drops any other client_reference_id; the webhook stores what passes this rule.
    expect(PLACEMENT_LABEL_RE.test('deep-use-prompt')).toBe(true);
    expect(PLACEMENT_LABEL_RE.test('readme_top')).toBe(true);
    expect(new URL(supportUrl('a b&c=d?e')).searchParams.has('client_reference_id')).toBe(false);
    expect(new URL(supportUrl('x'.repeat(60))).searchParams.get('client_reference_id')).toBe('x'.repeat(40));
    expect(new URL(supportUrl('')).searchParams.get('client_reference_id')).toBe('other');
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
      `${STRIPE}?utm_source=theblueboard&utm_medium=email&utm_content=welcome-email&client_reference_id=welcome-email`,
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

describe('the fixed-amount links ($5, $10, $17, $100; Nov 11 2026)', () => {
  // The owner's four live Payment Links, character for character (paths are case-sensitive).
  const FIXED = {
    5: 'https://buy.stripe.com/fZu4gy6Xxd7d9Ca288gEg01',
    10: 'https://buy.stripe.com/28EcN495F8QXaGe8wwgEg02',
    17: 'https://buy.stripe.com/28EeVc2Hh6IPbKiaEEgEg03',
    100: 'https://buy.stripe.com/8x228q81BaZ58y69AAgEg04',
  };

  it('are the four amounts, each its own link, none of them the any-amount link', () => {
    expect(SUPPORT_AMOUNTS).toEqual([5, 10, 17, 100]);
    expect({ ...SUPPORT_AMOUNT_LINKS }).toEqual(FIXED);
    expect(new Set(Object.values(SUPPORT_AMOUNT_LINKS)).size).toBe(4);
    expect(Object.values(SUPPORT_AMOUNT_LINKS)).not.toContain(STRIPE);
    expect(Object.isFrozen(SUPPORT_AMOUNT_LINKS)).toBe(true);
  });

  it('are tagged exactly like supportUrl: source, medium, utm_content and client_reference_id', () => {
    expect(supportAmountUrl(17, 'about-17')).toBe(
      `${FIXED[17]}?utm_source=theblueboard&utm_medium=site&utm_content=about-17&client_reference_id=about-17`,
    );
    expect(supportAmountUrl(5, 'welcome-email', { medium: 'email' })).toBe(
      `${FIXED[5]}?utm_source=theblueboard&utm_medium=email&utm_content=welcome-email&client_reference_id=welcome-email`,
    );
    expect(new URL(supportAmountUrl(100, '  ')).searchParams.get('utm_content')).toBe('other');
    expect(new URL(supportAmountUrl(10, 'a b&c')).searchParams.has('client_reference_id')).toBe(false);
    expect(new URL(supportAmountUrl(10, 'fleet-end-10', { medium: 'carrier-pigeon' })).searchParams.get('utm_medium')).toBe('site');
  });

  it('return null for an amount with no link (not offered, null, empty, or not https)', () => {
    expect(supportAmountUrl(25, 'about-25')).toBeNull();
    const links = { 5: null, 10: '', 17: 'http://buy.stripe.com/x', 100: 'https://buy.stripe.com/test100' };
    expect(supportAmountUrl(5, 'x', { links })).toBeNull();
    expect(supportAmountUrl(10, 'x', { links })).toBeNull();
    expect(supportAmountUrl(17, 'x', { links })).toBeNull();
    expect(supportAmountUrl(100, 'x', { links })).toBe('https://buy.stripe.com/test100?utm_source=theblueboard&utm_medium=site&utm_content=x&client_reference_id=x');
  });

  it('are links the support_click tracker counts', () => {
    for (const amount of SUPPORT_AMOUNTS) expect(isSupportUrl(supportAmountUrl(amount, `about-${amount}`))).toBe(true);
  });
});

describe('the monthly link ("cover a day every month")', () => {
  it('is empty for now, so no monthly option is offered', () => {
    expect(STRIPE_MONTHLY_URL).toBe('');
    expect(hasMonthlySupport()).toBe(false);
    expect(monthlySupportUrl('about-monthly')).toBeNull();
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
      for (const m of src.matchAll(/(?:supportUrl\(|coverButtonHref\([^,()]+,)\s*'([^']+)'\s*\)/g)) {
        const label = m[1];
        // The opening tag around the call: from its "<" to the first ">" that is not an arrow.
        const start = src.lastIndexOf('<', m.index);
        const end = src.slice(m.index).search(/(?<!=)>/);
        const tag = src.slice(start, m.index + end);
        expect(tag, `${path}: '${label}'`).toMatch(new RegExp(`\\b(data-)?support="${label}"`));
        // …and it is a label Stripe keeps as client_reference_id, so the payment records it.
        expect(label, `${path}: supportUrl('${label}')`).toMatch(PLACEMENT_LABEL_RE);
        labels.push(label);
      }
    }
    expect(labels.length).toBeGreaterThanOrEqual(9);
    expect(new Set(labels).size, 'two placements share a label').toBe(labels.length);
  });
});
