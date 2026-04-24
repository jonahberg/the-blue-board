import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeHeaderValue } from '../src/lib/escape.js';

describe('escapeHtml', () => {
  it('escapes the core five HTML-dangerous characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('neutralizes a malicious gate string from FR24/FlightAware (bug #3)', () => {
    // Representative payload from the ultrareview: a gate like "B<img src=x onerror=...>"
    const malicious = 'B<img src=x onerror=alert(1)>';
    const safe = escapeHtml(malicious);
    expect(safe).toBe('B&lt;img src=x onerror=alert(1)&gt;');
    expect(safe).not.toContain('<img');
  });

  it('orders & before < so ampersand does not re-escape', () => {
    // If & were escaped last, "<" would become "&lt;" → "&amp;lt;" — wrong.
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('returns empty string for non-strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(123)).toBe('');
    expect(escapeHtml({})).toBe('');
  });

  it('is safe to embed as an href attribute value', () => {
    // The news-notify email builder uses escapeHtml on articleUrl for the
    // href. Quotes in the URL must not break out of the attribute.
    const url = 'https://example.com/x"onerror=alert(1)';
    const safe = escapeHtml(url);
    expect(safe).not.toContain('"');
    expect(safe).toContain('&quot;');
  });
});

describe('sanitizeHeaderValue', () => {
  it('strips CR/LF to prevent SMTP header injection', () => {
    // news-notify uses sanitizeHeaderValue on the subject (bug #5 follow-up).
    expect(sanitizeHeaderValue('Title\r\nBcc: attacker@example.com')).toBe(
      'Title Bcc: attacker@example.com'.replace(' ', '')
    );
    // More rigorous: no CR or LF in output.
    const injected = 'Title\r\nBcc: attacker@example.com';
    const clean = sanitizeHeaderValue(injected);
    expect(clean).not.toMatch(/[\r\n]/);
  });

  it('strips other control characters', () => {
    expect(sanitizeHeaderValue('A\x00B\x07C')).toBe('ABC');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeHeaderValue('  hello  ')).toBe('hello');
  });

  it('returns empty for non-strings', () => {
    expect(sanitizeHeaderValue(null)).toBe('');
    expect(sanitizeHeaderValue(undefined)).toBe('');
  });
});
