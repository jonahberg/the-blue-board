// @vitest-environment jsdom
// Flight numbers on content pages link to their flight page (src/scripts/flight-link.ts): the hub
// board, the fleet pages' airborne strip, and the flight page's own lists. Anything that is not a
// United flight number stays text, and a list that refreshes keeps a keyboard reader's place.
//
// ONE rule (v1.28.0): which printed numbers link is src/lib/flight-link.js `flightLink()`, the
// dashboard's own, so a number links on a hub page exactly when it links on the dashboard. The
// content pages had their own `flightHref()` that also linked a bare "5789" (and a number passed as
// a number); the parity table below pins every case, including those two, to the library.
import { describe, expect, it, vi } from 'vitest';

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

  // Hub links repeat in a refreshing list (a tail's legs chain: one leg's destination is the next
  // one's origin; the fleet strip's rows share SFO or EWR). Focus on the second ORD must come back
  // to the second ORD, not jump to the first.
  it('restores the same occurrence when two links share an href', () => {
    const list = document.createElement('ol');
    document.body.append(list);
    list.replaceChildren(row('/hubs/ord'), row('/flight/UA930'), row('/hubs/ord'));
    list.querySelectorAll('a')[2].focus();
    replaceChildrenKeepingFocus(list, [row('/hubs/ord'), row('/flight/UA930'), row('/hubs/ord')]);
    const links = [...list.querySelectorAll('a')];
    expect(document.activeElement).toBe(links[2]);
    expect(links.indexOf(document.activeElement as HTMLAnchorElement)).toBe(2);
  });

  it('falls back to the first link with that href when the refresh has fewer of them', () => {
    const list = document.createElement('ol');
    document.body.append(list);
    list.replaceChildren(row('/flight/UA1'), row('/hubs/ord'), row('/hubs/ord'));
    list.querySelectorAll('a')[2].focus();
    replaceChildrenKeepingFocus(list, [row('/flight/UA2'), row('/hubs/ord')]);
    expect(document.activeElement).toBe(list.querySelectorAll('a')[1]);
  });
});

// Rows that carry `data-key` (a departure, an aircraft, a leg) are found again by key, so an
// earlier row with the same address leaving the list cannot move the reader to another row.
describe('replaceChildrenKeepingFocus in a list whose rows carry data-key', () => {
  /** A row: `data-key`, then a link per [href, data-f?], as a strip or board row has. */
  const keyed = (key: string, ...links: Array<[string, string?]>) => {
    const li = document.createElement('li');
    li.dataset.key = key;
    for (const [href, f] of links) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = href;
      if (f) a.dataset.f = f;
      li.append(a);
    }
    return li;
  };
  const rowOf = (el: Element | null) => (el as HTMLElement | null)?.closest<HTMLElement>('li')?.dataset.key;
  const mount = (...rows: HTMLElement[]) => {
    document.body.replaceChildren();
    const list = document.createElement('ul');
    document.body.append(list);
    list.replaceChildren(...rows);
    return list;
  };
  const strip = {
    ua1: () => keyed('N1', ['/flight/UA1', 'ident'], ['/hubs/sfo'], ['/?flight=UA1', 'link']),
    ua5: () => keyed('N5', ['/flight/UA5', 'ident'], ['/hubs/sfo'], ['/?flight=UA5', 'link']),
    ua9: () => keyed('N9', ['/flight/UA9', 'ident'], ['/hubs/ewr'], ['/hubs/sfo'], ['/?flight=UA9', 'link']),
    ua20: () => keyed('N20', ['/flight/UA20', 'ident'], ['/hubs/den'], ['/hubs/sfo'], ['/?flight=UA20', 'link']),
  };

  it('keeps focus on the same link in the same row when an earlier row with that address leaves, and sets it once', () => {
    // UA1 SFO→NRT, UA5 SFO→LHR, UA9 EWR→SFO; the reader is on UA9's SFO (the third /hubs/sfo).
    const list = mount(strip.ua1(), strip.ua5(), strip.ua9());
    const before = list.querySelector('[data-key="N9"] a[href="/hubs/sfo"]') as HTMLAnchorElement;
    before.focus();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      // UA1 has landed and UA20 DEN→SFO has joined: /hubs/sfo is now UA5's, UA9's, UA20's.
      replaceChildrenKeepingFocus(list, [strip.ua5(), strip.ua9(), strip.ua20()]);
      expect(rowOf(document.activeElement)).toBe('N9');
      expect(document.activeElement?.getAttribute('href')).toBe('/hubs/sfo');
      expect(before.isConnected).toBe(false);
      expect(focus).toHaveBeenCalledTimes(1);
    } finally {
      focus.mockRestore();
    }
  });

  it('a link with a data-f goes back to that field in the row, whatever its address now', () => {
    const list = mount(keyed('UA108', ['/flight/UA108', 'ident'], ['/hubs/ewr', 'dest']));
    (list.querySelector('[data-f="ident"]') as HTMLAnchorElement).focus();
    replaceChildrenKeepingFocus(list, [keyed('UA100', ['/flight/UA100', 'ident']), keyed('UA108', ['/flight/UA108', 'ident'], ['/hubs/ewr', 'dest'])]);
    expect(rowOf(document.activeElement)).toBe('UA108');
    expect((document.activeElement as HTMLElement).dataset.f).toBe('ident');
  });

  it('when the focused row has left, the same occurrence of the address, then its first copy, then the list\'s first link', () => {
    // The second /hubs/sfo (UA5's) was focused; UA5 has left: the second /hubs/sfo is now UA20's.
    let list = mount(strip.ua1(), strip.ua5(), strip.ua9());
    (list.querySelectorAll('a[href="/hubs/sfo"]')[1] as HTMLAnchorElement).focus();
    replaceChildrenKeepingFocus(list, [strip.ua1(), strip.ua9(), strip.ua20()]);
    expect(rowOf(document.activeElement)).toBe('N9');
    expect(document.activeElement).toBe(list.querySelectorAll('a[href="/hubs/sfo"]')[1]);

    // Fewer copies than before: the first one.
    list = mount(strip.ua1(), strip.ua5());
    (list.querySelectorAll('a[href="/hubs/sfo"]')[1] as HTMLAnchorElement).focus();
    replaceChildrenKeepingFocus(list, [strip.ua20()]);
    expect(rowOf(document.activeElement)).toBe('N20');
    expect(document.activeElement?.getAttribute('href')).toBe('/hubs/sfo');

    // No copy at all: the list's first link, so focus stays in the list.
    list = mount(strip.ua9());
    (list.querySelector('a[href="/hubs/ewr"]') as HTMLAnchorElement).focus();
    replaceChildrenKeepingFocus(list, [strip.ua5()]);
    expect(document.activeElement).toBe(list.querySelector('a'));
  });

  it('a repaint with nothing new replaces nothing and leaves focus alone', () => {
    const list = mount(strip.ua1(), strip.ua9());
    const before = list.querySelector('[data-key="N9"] a[href="/hubs/sfo"]') as HTMLAnchorElement;
    before.focus();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      replaceChildrenKeepingFocus(list, [strip.ua1(), strip.ua9()]);
      expect(before.isConnected).toBe(true);
      expect(document.activeElement).toBe(before);
      expect(focus).not.toHaveBeenCalled();
    } finally {
      focus.mockRestore();
    }
  });

  it('a row still on the list that lost the link the reader was on falls back the same way', () => {
    const list = mount(keyed('UA108', ['/flight/UA108', 'ident'], ['/hubs/ewr', 'dest']), keyed('UA109', ['/flight/UA109', 'ident'], ['/hubs/ewr', 'dest']));
    (list.querySelector('[data-key="UA108"] [data-f="dest"]') as HTMLAnchorElement).focus();
    replaceChildrenKeepingFocus(list, [keyed('UA108', ['/flight/UA108', 'ident']), keyed('UA109', ['/flight/UA109', 'ident'], ['/hubs/ewr', 'dest'])]);
    expect(document.activeElement?.getAttribute('href')).toBe('/hubs/ewr');
    expect(rowOf(document.activeElement)).toBe('UA109');
  });
});
