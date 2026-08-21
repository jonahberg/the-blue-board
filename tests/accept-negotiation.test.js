import { describe, expect, it } from 'vitest';

import { appendVaryAccept, parseAccept, preferredType } from '../src/lib/accept-negotiation.js';

const PRODUCES = ['text/html', 'text/markdown'];

describe('parseAccept', () => {
  it('reads types, q-values, and range specificity', () => {
    expect(parseAccept('text/markdown, text/html;q=0.8, */*;q=0.1')).toEqual([
      { type: 'text/markdown', q: 1, specificity: 2 },
      { type: 'text/html', q: 0.8, specificity: 2 },
      { type: '*/*', q: 0.1, specificity: 0 },
    ]);
  });

  it('lowercases type names and tolerates sloppy whitespace', () => {
    expect(parseAccept('  TEXT/Markdown ;  Q=0.5 ')).toEqual([
      { type: 'text/markdown', q: 0.5, specificity: 2 },
    ]);
  });

  it('ranks a subtype wildcard between an exact type and */*', () => {
    const [entry] = parseAccept('text/*');
    expect(entry.specificity).toBe(1);
  });

  it('clamps out-of-range q and keeps the RFC default of 1 for malformed q', () => {
    expect(parseAccept('text/html;q=9').at(0).q).toBe(1);
    expect(parseAccept('text/html;q=-3').at(0).q).toBe(0);
    expect(parseAccept('text/html;q=banana').at(0).q).toBe(1);
  });

  it('drops entries that are not media ranges', () => {
    expect(parseAccept('nonsense, text/html')).toEqual([
      { type: 'text/html', q: 1, specificity: 2 },
    ]);
  });
});

describe('preferredType — acceptmarkdown.com test vectors', () => {
  // https://acceptmarkdown.com/guides/accept-parsing — "Test vectors" table.
  const vectors = [
    ['text/markdown', PRODUCES, 'text/markdown'],
    ['text/markdown, text/html;q=0.8', PRODUCES, 'text/markdown'],
    ['text/html', PRODUCES, 'text/html'],
    ['text/markdown;q=0, text/html', PRODUCES, 'text/html'],
    ['text/markdown;q=0', ['text/markdown'], null],
    [null, PRODUCES, 'text/html'],
    ['*/*', PRODUCES, 'text/html'],
  ];

  for (const [header, produces, expected] of vectors) {
    it(`${header === null ? '(no Accept)' : header} → ${expected ?? '406'}`, () => {
      expect(preferredType(header, produces)).toBe(expected);
    });
  }
});

describe('preferredType — real-world headers', () => {
  it('serves HTML to Chrome', () => {
    const chrome = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
    expect(preferredType(chrome, PRODUCES)).toBe('text/html');
  });

  it('serves HTML to Firefox', () => {
    const firefox = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    expect(preferredType(firefox, PRODUCES)).toBe('text/html');
  });

  it('serves HTML to a bare fetch() call', () => {
    expect(preferredType('*/*', PRODUCES)).toBe('text/html');
  });

  it('serves Markdown when an agent lists it first', () => {
    expect(preferredType('text/markdown, text/html, */*', PRODUCES)).toBe('text/markdown');
  });

  it('serves Markdown for the bare agent header with a charset parameter', () => {
    expect(preferredType('text/markdown; charset=utf-8', PRODUCES)).toBe('text/markdown');
  });

  it('honours an explicit q=0 on HTML even when a wildcard would allow it', () => {
    // RFC 9110 §12.5.1: the more specific range wins regardless of q.
    expect(preferredType('text/html;q=0, */*', PRODUCES)).toBe('text/markdown');
  });

  it('406s only when every representation is refused', () => {
    expect(preferredType('application/pdf', PRODUCES)).toBe(null);
    expect(preferredType('text/html;q=0, text/markdown;q=0', PRODUCES)).toBe(null);
  });

  it('treats an empty or all-garbage Accept as no constraint, not a 406', () => {
    expect(preferredType('', PRODUCES)).toBe('text/html');
    expect(preferredType('nonsense', PRODUCES)).toBe('text/html');
  });

  it('breaks a q tie on the client stated order', () => {
    expect(preferredType('text/markdown;q=0.9, text/html;q=0.9', PRODUCES)).toBe('text/markdown');
    expect(preferredType('text/html;q=0.9, text/markdown;q=0.9', PRODUCES)).toBe('text/html');
  });

  it('falls back to the server default when only a subtype wildcard is offered', () => {
    expect(preferredType('text/*', PRODUCES)).toBe('text/html');
  });
});

describe('appendVaryAccept', () => {
  it('sets Vary when absent', () => {
    const headers = new Headers();
    appendVaryAccept(headers);
    expect(headers.get('Vary')).toBe('Accept');
  });

  it('appends without clobbering an existing value', () => {
    const headers = new Headers({ Vary: 'Accept-Encoding' });
    appendVaryAccept(headers);
    expect(headers.get('Vary')).toBe('Accept-Encoding, Accept');
  });

  it('is idempotent and case-insensitive', () => {
    const headers = new Headers({ Vary: 'accept, Accept-Encoding' });
    appendVaryAccept(headers);
    expect(headers.get('Vary')).toBe('accept, Accept-Encoding');
  });

  it('leaves Vary: * alone — it already disables shared caching', () => {
    const headers = new Headers({ Vary: '*' });
    appendVaryAccept(headers);
    expect(headers.get('Vary')).toBe('*');
  });
});
