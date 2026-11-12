// @vitest-environment jsdom
// Flight numbers on content pages link to their flight page (src/scripts/flight-link.ts): the hub
// board, the fleet pages' airborne strip, and the flight page's own lists. Anything that is not a
// United flight number stays text, and a list that refreshes keeps a keyboard reader's place.
//
// ONE rule (v1.28.0): which printed numbers link is src/lib/flight-link.js `flightLink()`, the
// dashboard's own, so a number links on a hub page exactly when it links on the dashboard. The
// content pages had their own `flightHref()` that also linked a bare "5789" (and a number passed as
// a number); the parity table below pins every case, including those two, to the library.
import { describe, expect, it } from 'vitest';

import { flightLink } from '../src/lib/flight-link.js';
import { replaceChildrenKeepingFocus, setFlightLink, splitFlightIdents } from '../src/scripts/flight-link';

/** Everything either rule has ever been asked about, links and non-links alike. */
const CASES: unknown[] = [
  'UA5789', 'UAL929', 'UA0123', 'ua 576', 'UA-576', ' UA576 ', 'UAL0576',
  '5789', '0576', 576, '', '—', '?', 'DL1234', 'UA', 'UA0', 'UA12345', 'UA526H',
  'SKW5123', 'RPA3508', 'OO4737', 'GJS4321', 'UAX9', null, undefined,
];

describe('content pages use the dashboard\'s flight-link rule', () => {
  it('setFlightLink gives an href exactly when flightLink() does, and the same one', () => {
    for (const raw of CASES) {
      const a = document.createElement('a');
      setFlightLink(a, raw as string);
      expect(a.getAttribute('href'), String(raw)).toBe(flightLink(raw)?.href ?? null);
    }
  });

  it('a bare number does not link on a content page either: it does not say whose flight it is', () => {
    const a = document.createElement('a');
    setFlightLink(a, '5789');
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.textContent).toBe('5789');
  });

  it('points a United number at its page, in the canonical form', () => {
    const href = (raw: string) => {
      const a = document.createElement('a');
      setFlightLink(a, raw);
      return a.getAttribute('href');
    };
    expect(href('UA5789')).toBe('/flight/UA5789');
    expect(href('UAL929')).toBe('/flight/UA929');
    expect(href('UA0123')).toBe('/flight/UA123');
  });
});

describe('splitFlightIdents', () => {
  it('splits a timeline sentence around the inbound flight', () => {
    expect(splitFlightIdents('Aircraft arrived from Tulsa (UA5442)')).toEqual([
      { text: 'Aircraft arrived from Tulsa (' },
      { text: 'UA5442', href: '/flight/UA5442' },
      { text: ')' },
    ]);
  });

  it('leaves text with no flight number whole, and never links a non-United code', () => {
    expect(splitFlightIdents('Scheduled departure, Terminal 2')).toEqual([{ text: 'Scheduled departure, Terminal 2' }]);
    expect(splitFlightIdents('DL1234 and UAX9')).toEqual([{ text: 'DL1234 and UAX9' }]);
    expect(splitFlightIdents('')).toEqual([{ text: '' }]);
  });

  it('keeps every character, in order', () => {
    const text = 'UA1 then UA2 (and UA3)';
    expect(splitFlightIdents(text).map((p) => p.text).join('')).toBe(text);
    expect(splitFlightIdents(text).filter((p) => p.href)).toHaveLength(3);
  });
});

describe('setFlightLink', () => {
  it('gives the template link an href only for a number with a page', () => {
    const a = document.createElement('a');
    setFlightLink(a, 'UA4416');
    expect(a.getAttribute('href')).toBe('/flight/UA4416');
    expect(a.textContent).toBe('UA4416');
    setFlightLink(a, '—');
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.textContent).toBe('—');
  });

  it('leaves the page the reader is on as text', () => {
    const a = document.createElement('a');
    setFlightLink(a, 'UA929', 'UA929');
    expect(a.hasAttribute('href')).toBe(false);
    setFlightLink(a, 'UA930', 'UA929');
    expect(a.getAttribute('href')).toBe('/flight/UA930');
  });
});

describe('replaceChildrenKeepingFocus', () => {
  const row = (href: string) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = href;
    a.textContent = href;
    li.append(a);
    return li;
  };

  it('moves focus to the same flight in the refreshed list', () => {
    const list = document.createElement('ol');
    document.body.append(list);
    list.replaceChildren(row('/flight/UA1'), row('/flight/UA2'));
    list.querySelectorAll('a')[1].focus();
    replaceChildrenKeepingFocus(list, [row('/flight/UA0'), row('/flight/UA2')]);
    expect(document.activeElement?.getAttribute('href')).toBe('/flight/UA2');
    expect(list.contains(document.activeElement)).toBe(true);
  });

  it('keeps focus in the list when that flight rolled off, and leaves focus elsewhere alone', () => {
    const list = document.createElement('ol');
    const outside = document.createElement('button');
    document.body.append(list, outside);
    list.replaceChildren(row('/flight/UA1'));
    list.querySelector('a')!.focus();
    replaceChildrenKeepingFocus(list, [row('/flight/UA7'), row('/flight/UA8')]);
    expect(document.activeElement?.getAttribute('href')).toBe('/flight/UA7');

    outside.focus();
    replaceChildrenKeepingFocus(list, [row('/flight/UA9')]);
    expect(document.activeElement).toBe(outside);
  });
});
