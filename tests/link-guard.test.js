import { describe, expect, it } from 'vitest';

import { TABS } from '../src/app/tabs';
import { HUB_ORDER } from '../src/lib/hub-health.js';
import {
  LINK_GUARD_ALLOW,
  LINK_GUARD_EXPECT,
  LINK_GUARD_TABS,
  LINK_GUARD_TAIL_SOURCES,
  coverageGaps,
  findNames,
  findUnlinkedNames,
  findUnlinkedNamesByRegion,
  tailsInPayload,
} from '../src/lib/link-guard.js';

const known = { hubs: [...HUB_ORDER], tails: new Set(['N78501', 'N613UX']) };
const where = 'starlink desktop-1440 #sl-board [data-link-row]';
const row = (text, linked = false, at = where) => ({ text, linked, where: at });

describe('findUnlinkedNames: a printed name in a row that is not a link', () => {
  it('reports an unlinked United flight number, and not a linked one', () => {
    expect(findUnlinkedNames([row('UA576')], known, [])).toEqual([{ text: 'UA576', kind: 'flight', where }]);
    expect(findUnlinkedNames([row('UA576', true)], known, [])).toEqual([]);
  });

  it('reports an unlinked tail the page knows, and an unlinked hub code', () => {
    expect(findUnlinkedNames([row('N78501')], known, [])).toEqual([{ text: 'N78501', kind: 'tail', where }]);
    expect(findUnlinkedNames([row('ORD')], known, [])).toEqual([{ text: 'ORD', kind: 'hub', where }]);
  });

  it('leaves alone what the rules leave unlinked: a non-hub airport, a callsign, a bare prefix, an unknown tail', () => {
    for (const text of ['LHR', 'SKW5415', 'UA', 'UCA5004', 'UA526H', 'N99999']) {
      expect(findUnlinkedNames([row(text)], known, []), text).toEqual([]);
    }
    expect(findUnlinkedNames([row('N78501')], { hubs: known.hubs, tails: new Set() }, [])).toEqual([]);
  });

  it('finds names inside a longer run of text, and only whole words', () => {
    expect(findUnlinkedNames([row('SCHED · inbound on UA3508')], known, [])).toEqual([
      { text: 'UA3508', kind: 'flight', where },
    ]);
    expect(findUnlinkedNames([row('ORD→DSM 13:05 CDT')], known, []).map((n) => n.text)).toEqual(['ORD']);
    expect(findUnlinkedNames([row('UAL347 · ORD-DEN')], known, []).map((n) => n.text)).toEqual([
      'UAL347',
      'ORD',
      'DEN',
    ]);
    expect(findUnlinkedNames([row('UA 576'), row('N-613UX')], known, []).map((n) => n.kind)).toEqual(['flight', 'tail']);
    // A hub inside a word, a lower-case word and a tail inside a longer token are not names.
    for (const text of ['WORDS', 'DENIED', 'ord', 'xN78501', 'UA576x']) {
      expect(findUnlinkedNames([row(text)], known, []), text).toEqual([]);
    }
  });

  it('skips a name whose row matches an allowlist entry', () => {
    const allow = [{ where: /#sl-board/, reason: 'a stated reason' }];
    expect(findUnlinkedNames([row('UA576')], known, allow)).toEqual([]);
    expect(findUnlinkedNames([row('UA576', false, 'starlink mobile-390 "Roster" tr')], known, allow)).toHaveLength(1);
  });

  it('throws on an allowlist entry without a reason, even when nothing would be skipped', () => {
    expect(() => findUnlinkedNames([], known, [{ where: /#sl-board/, reason: '' }])).toThrow(/reason/);
    expect(() => findUnlinkedNames([], known, [{ where: /#sl-board/, reason: '   ' }])).toThrow(/reason/);
    expect(() => findUnlinkedNames([], known, [{ where: '#sl-board', reason: 'x' }])).toThrow(/RegExp/);
  });

  it('a global-flag allowlist pattern matches every row, not every other one', () => {
    const allow = [{ where: /#sl-board/g, reason: 'a stated reason' }];
    expect(findUnlinkedNames([row('UA1'), row('UA2'), row('UA3')], known, allow)).toEqual([]);
  });
});

describe('findNames: every name the check examined, linked or not', () => {
  it('counts linked names too, so a run can say how much it looked at', () => {
    const names = findNames([row('UA576', true), row('N78501', true), row('ORD'), row('Mainline')], known);
    expect(names.map(({ kind, linked }) => `${kind}:${linked}`)).toEqual(['flight:true', 'tail:true', 'hub:false']);
  });
});

describe('tailsInPayload: the tails a page loaded', () => {
  it('reads every `tail` and the keys of `flightsByTail`, canonical and US-only', () => {
    const roster = { aircraft: [{ tail: 'N78501' }, { tail: 'n-613ux' }, { tail: 'JA873A' }], fleetStats: {} };
    expect(tailsInPayload(roster).sort()).toEqual(['N613UX', 'N78501']);
    expect(tailsInPayload({ flightsByTail: { N37502: [{ flight_number: 'UAL1' }] } })).toEqual(['N37502']);
    expect(tailsInPayload([{ tail: 'N12345' }])).toEqual(['N12345']);
    expect(tailsInPayload({ disputed: [{ tail: 'N77012', aircraft: '777' }] })).toEqual(['N77012']);
  });

  it("reads the fleet database's `r`, its registration field", () => {
    expect(tailsInPayload([{ r: 'N4888U', t: 'A319' }, { r: 'N37502', t: '737 MAX 9' }]).sort()).toEqual(['N37502', 'N4888U']);
    expect(LINK_GUARD_TAIL_SOURCES.some((re) => re.test('https://theblueboard.co/data/fleet.json'))).toBe(true);
  });

  it('returns nothing for a payload without tails', () => {
    for (const payload of [null, undefined, 42, 'N78501', {}, [], { tail: 7 }]) {
      expect(tailsInPayload(payload), JSON.stringify(payload)).toEqual([]);
    }
  });
});

describe('coverageGaps: a run that examined nothing does not pass', () => {
  const full = { rows: 40, names: { flight: 5, tail: 30, hub: 9 }, knownTails: 573 };

  it('is empty when the tab showed every kind it must', () => {
    expect(coverageGaps('starlink', full)).toEqual([]);
  });

  it('names each gap: no rows, no known tails, a kind the tab must show and did not', () => {
    expect(coverageGaps('starlink', { ...full, rows: 0 })).toEqual([expect.stringMatching(/no rows/)]);
    expect(coverageGaps('starlink', { ...full, knownTails: 0 })).toEqual([expect.stringMatching(/no known tails/)]);
    expect(coverageGaps('starlink', { ...full, names: { flight: 0, tail: 30, hub: 0 } })).toEqual([
      expect.stringMatching(/flight/),
      expect.stringMatching(/hub/),
    ]);
  });

  it('a tab without stated kinds still needs one name of some kind', () => {
    expect(coverageGaps('unlisted', { ...full, names: { flight: 0, tail: 0, hub: 0 } })).toEqual([
      expect.stringMatching(/no names/),
    ]);
    expect(coverageGaps('unlisted', { ...full, names: { flight: 0, tail: 1, hub: 0 } })).toEqual([]);
  });
});

describe('the guard configuration', () => {
  it('guards every tab whose rows print names, and says what each must show', () => {
    expect([...LINK_GUARD_TABS].sort()).toEqual(['fleet', 'live', 'schedule', 'starlink', 'stats', 'weather']);
    for (const tab of LINK_GUARD_TABS) {
      expect(TABS.some((t) => t.id === tab), tab).toBe(true);
      expect(LINK_GUARD_EXPECT[tab], tab).toBeDefined();
    }
    expect(LINK_GUARD_EXPECT.starlink).toEqual(['flight', 'tail', 'hub']);
    expect(LINK_GUARD_EXPECT.fleet).toEqual(['tail']);
    // Left out, each for a stated reason (My Flights would need a watched flight; Sources prints no names).
    expect(LINK_GUARD_TABS).not.toContain('myflight');
    expect(LINK_GUARD_TABS).not.toContain('sources');
  });

  it('every allowlist entry is a pattern with a reason', () => {
    for (const entry of LINK_GUARD_ALLOW) {
      expect(entry.where).toBeInstanceOf(RegExp);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });

  // An entry excuses the one element a view marked for it, never the row the names sit in.
  it.each([
    ['fleet desktop-1440 #fleet-lookup-zone td[data-link-row=status-note]', 'SFO Stored 10/30/26', true],
    ['fleet desktop-1440 #fleet-lookup-zone tr', 'N37502 SFO', false],
    ['fleet mobile-390 (panel) span[data-link-row=health-category]', 'Future GUM', true],
    ['fleet mobile-390 (panel) li', 'GUM 3', false],
    ['weather tablet-768 #nas-section li', 'EWR ground stop/delay program possible', true],
    ['weather tablet-768 #nas-section span[data-link-row]', 'EWR', false],
    ['weather tablet-768 #hub-card-EWR div[data-link-row]', 'EWR', false],
    ['schedule desktop-1440 #schedule-board tr', 'UA576 N37502 DEN', false],
  ])('%s: "%s" is excused: %s', (at, text, excused) => {
    expect(findUnlinkedNames([row(text, false, at)], { ...known, tails: new Set(['N37502']) }, LINK_GUARD_ALLOW).length === 0).toBe(excused);
  });
});

describe('findUnlinkedNamesByRegion: each region checked with its own hub', () => {
  const at = 'schedule desktop-1440 (panel) tr';
  const run = (text, self) => ({ text, linked: false, where: at, self });

  it("a plain hub equal to its own region's hub is excused, and only there", () => {
    expect(findUnlinkedNamesByRegion([run('ORD → DEN', 'ORD'), run('ORD', 'SFO'), run('SFO')], known, []).map((n) => n.text)).toEqual([
      'DEN',
      'ORD',
      'SFO',
    ]);
    expect(findUnlinkedNamesByRegion([run('SFO → LAX', 'sfo ')], known, []).map((n) => n.text)).toEqual(['LAX']);
  });

  it('without regions it is findUnlinkedNames with no self, and it still checks the allowlist', () => {
    const rows = [row('UA576'), row('ORD'), row('N78501', true)];
    expect(findUnlinkedNamesByRegion(rows, known, [])).toEqual(findUnlinkedNames(rows, known, []));
    expect(() => findUnlinkedNamesByRegion([], known, [{ where: /x/, reason: '' }])).toThrow(/reason/);
  });
});

describe('findUnlinkedNames with self: the view\'s own name prints plain by rule (ruling 1)', () => {
  const board = 'schedule desktop-1440 #schedule-board tr';
  const at = (text) => row(text, false, board);

  it("a plain hub code equal to the view's own hub is not a violation", () => {
    expect(findUnlinkedNames([at('ORD → DEN')], known, [], { hub: 'ORD' })).toEqual([{ text: 'DEN', kind: 'hub', where: board }]);
    expect(findUnlinkedNames([at('ORD')], known, [], { hub: 'ord ' })).toEqual([]);
  });

  it('every other name in the same rows is still checked', () => {
    expect(findUnlinkedNames([at('UA576 ORD N78501')], known, [], { hub: 'ORD' }).map((n) => n.text)).toEqual(['UA576', 'N78501']);
  });

  it('no self, or an empty or missing hub: the behaviour without it', () => {
    for (const self of [undefined, {}, { hub: null }, { hub: '' }]) {
      expect(findUnlinkedNames([at('ORD')], known, [], self), JSON.stringify(self)).toEqual([{ text: 'ORD', kind: 'hub', where: board }]);
    }
  });

  it('only a hub is excused: a flight number or tail that happens to match is still reported', () => {
    expect(findUnlinkedNames([at('N78501')], known, [], { hub: 'N78501' })).toEqual([{ text: 'N78501', kind: 'tail', where: board }]);
  });

  it('the allowlist is still checked for reasons when self is given', () => {
    expect(() => findUnlinkedNames([], known, [{ where: /x/ }], { hub: 'ORD' })).toThrow(/a reason is required/);
  });
});
