/**
 * The support strip's early moments (Nov 22 2026, src/lib/support-moment.js): a visit from a
 * social post (`utm_medium=social` in the query or after the '#', or a Reddit / FlyerTalk / X
 * referrer) gets the strip's time moment at 60 s instead of five minutes; the second distinct
 * flight is a moment of its own; the first trigger keeps its name; and only a 'donate' visit ever
 * shows the strip early.
 */

import { describe, expect, it } from 'vitest';

import { TRIGGER_TIME_MS } from '../src/lib/engagement.js';
import {
  EARLY_FLIGHT_COUNT,
  POST_REFERRER_HOSTS,
  POST_TRIGGER_TIME_MS,
  SUPPORT_STRIP_TRIGGERS,
  arrivedFromPost,
  firstTrigger,
  flightsMomentArmed,
  isPostReferrerHost,
  reachedEarlyFlights,
  stripTimeTriggerMs,
  supportStripMayShow,
} from '../src/lib/support-moment.js';

describe('the constants', () => {
  it('are 60 seconds, the second flight, five hosts and four trigger names', () => {
    expect(POST_TRIGGER_TIME_MS).toBe(60_000);
    expect(EARLY_FLIGHT_COUNT).toBe(2);
    expect([...POST_REFERRER_HOSTS]).toEqual(['reddit.com', 'flyertalk.com', 'x.com', 'twitter.com', 't.co']);
    expect([...SUPPORT_STRIP_TRIGGERS]).toEqual(['time', 'clicks', 'flights', 'post']);
  });
});

describe('arrivedFromPost — the landing address', () => {
  it('is true for the owner\'s tagged links, in the query', () => {
    expect(arrivedFromPost({ search: '?utm_source=reddit&utm_medium=social&utm_campaign=thanksgiving' })).toBe(true);
    expect(arrivedFromPost({ search: '?utm_source=flyertalk&utm_medium=social' })).toBe(true);
    expect(arrivedFromPost({ search: '?utm_medium=Social' })).toBe(true);
  });

  it('is true when the tags are trapped after the "#", the shape tab-hash.js tolerates', () => {
    expect(arrivedFromPost({ hash: '#live?utm_source=reddit&utm_medium=social' })).toBe(true);
    expect(arrivedFromPost({ hash: '#schedule&utm_medium=social' })).toBe(true);
  });

  it('is false for other mediums and for no tags', () => {
    expect(arrivedFromPost({ search: '?utm_source=email&utm_medium=email' })).toBe(false);
    expect(arrivedFromPost({ search: '?utm_medium=socials' })).toBe(false);
    expect(arrivedFromPost({ search: '?utm_source=social' })).toBe(false);
    expect(arrivedFromPost({ hash: '#fleet' })).toBe(false);
    expect(arrivedFromPost({})).toBe(false);
    expect(arrivedFromPost()).toBe(false);
  });
});

describe('arrivedFromPost — the referrer', () => {
  it('is true for the five hosts and their subdomains', () => {
    for (const referrer of [
      'https://www.reddit.com/',
      'https://old.reddit.com/r/unitedairlines/comments/abc/',
      'https://reddit.com/',
      'https://out.reddit.com/t3_abc',
      'https://www.flyertalk.com/forum/united-airlines-mileageplus-725/',
      'https://flyertalk.com/',
      'https://x.com/',
      'https://mobile.x.com/someone/status/1',
      'https://twitter.com/',
      'https://mobile.twitter.com/',
      'https://t.co/abc123',
    ]) {
      expect(arrivedFromPost({ referrer }), referrer).toBe(true);
    }
  });

  it('matches on a dot boundary only: no look-alike suffixes', () => {
    for (const referrer of [
      'https://netflix.com/',
      'https://microsoft.co/',
      'https://reddit.com.evil.com/',
      'https://notreddit.com/',
      'https://myflyertalk.com/',
      'https://box.com/',
      'https://www.google.com/',
      'https://theblueboard.co/',
    ]) {
      expect(arrivedFromPost({ referrer }), referrer).toBe(false);
    }
  });

  it('is false for an empty or unreadable referrer', () => {
    for (const referrer of ['', 'not a url', 'reddit.com', '://', undefined, null]) {
      expect(arrivedFromPost({ referrer }), String(referrer)).toBe(false);
    }
  });

  it('isPostReferrerHost ignores case and a trailing dot', () => {
    expect(isPostReferrerHost('OLD.Reddit.COM')).toBe(true);
    expect(isPostReferrerHost('www.reddit.com.')).toBe(true);
    expect(isPostReferrerHost('')).toBe(false);
    expect(isPostReferrerHost(null)).toBe(false);
  });
});

describe('the moments', () => {
  it('a post visit waits 60 s; any other visit waits T1\'s five minutes', () => {
    expect(stripTimeTriggerMs(true)).toBe(60_000);
    expect(stripTimeTriggerMs(false)).toBe(TRIGGER_TIME_MS);
    expect(TRIGGER_TIME_MS).toBe(5 * 60_000);
  });

  it('the second distinct flight is the moment; the first is not', () => {
    expect(reachedEarlyFlights(0)).toBe(false);
    expect(reachedEarlyFlights(1)).toBe(false);
    expect(reachedEarlyFlights(2)).toBe(true);
    expect(reachedEarlyFlights(7)).toBe(true);
    expect(reachedEarlyFlights(Number.NaN)).toBe(false);
  });

  it('the flights moment waits for the second flight\'s panel to close', () => {
    // Two or more flights opened, and none open now: the strip would be on screen.
    expect(flightsMomentArmed({ distinctFlights: 2, flightOpen: false })).toBe(true);
    expect(flightsMomentArmed({ distinctFlights: 5, flightOpen: false })).toBe(true);
    // A panel (or the phone's flight sheet) is open: a strip now would sit behind it.
    expect(flightsMomentArmed({ distinctFlights: 2, flightOpen: true })).toBe(false);
    expect(flightsMomentArmed({ distinctFlights: 9, flightOpen: true })).toBe(false);
    // One flight, opened and closed, is not the moment.
    expect(flightsMomentArmed({ distinctFlights: 1, flightOpen: false })).toBe(false);
    expect(flightsMomentArmed({ distinctFlights: 0, flightOpen: false })).toBe(false);
  });

  it('the first trigger keeps its name; nothing outside the four is ever reported', () => {
    expect(firstTrigger(null, 'post')).toBe('post');
    expect(firstTrigger('post', 'time')).toBe('post');
    expect(firstTrigger('flights', 'clicks')).toBe('flights');
    expect(firstTrigger(null, 'https://www.reddit.com/')).toBeNull();
    expect(firstTrigger(null, 'UA929')).toBeNull();
    expect(firstTrigger(null, null)).toBeNull();
  });
});

describe('supportStripMayShow — one ask per visit, the latch decides', () => {
  it('shows the strip for a moment only on a donate visit', () => {
    for (const trigger of SUPPORT_STRIP_TRIGGERS) {
      expect(supportStripMayShow({ ask: 'donate', trigger }), trigger).toBe(true);
      expect(supportStripMayShow({ ask: 'email', trigger }), trigger).toBe(false);
      expect(supportStripMayShow({ ask: 'waitlist', trigger }), trigger).toBe(false);
      expect(supportStripMayShow({ ask: null, trigger }), trigger).toBe(false);
    }
  });

  it('shows nothing before a moment', () => {
    expect(supportStripMayShow({ ask: 'donate', trigger: null })).toBe(false);
    expect(supportStripMayShow({ ask: 'donate', trigger: undefined })).toBe(false);
  });
});
