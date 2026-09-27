// @vitest-environment jsdom
/**
 * Starlink tab panels rendered from real board/hero models (F3/F98, F99).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDeparturesBoard } from '../src/lib/starlink-utils.js';
import { DeparturesBoard } from '../src/app/views/starlink/DeparturesBoard';
import { SlHero } from '../src/app/views/starlink/SlHero';
import type { BoardModel } from '../src/app/views/starlink/types';

afterEach(cleanup);

const NOW = 1_700_000_000;

describe('DeparturesBoard', () => {
  it('shows a future departure of an airborne tail as SCHED · inbound, tracking the inbound', () => {
    const board = buildDeparturesBoard(
      {
        N34562: [
          { flight_number: 'UAL2278', origin: 'SFO', destination: 'ORD', departure_ts: NOW + 98 * 60 },
        ],
      },
      { N34562: { type: 'A321neo', fleet: 'Mainline', operator: 'United Airlines' } },
      { N34562: { icao24: 'a4b1c2', origin: 'DEN', dest: 'SFO', flightIATA: 'UA1389' } },
      ['SFO'],
      { now: NOW },
    ) as BoardModel;
    const onTrack = vi.fn();
    render(
      <DeparturesBoard
        board={board}
        hubCodes={['SFO']}
        hub={null}
        onHub={() => {}}
        windowH={12}
        onWindow={() => {}}
        onShowAll={() => {}}
        freshness="updated 5m ago"
        tzAbbrev={() => 'PDT'}
        onOpenAircraft={() => {}}
        onTrack={onTrack}
      />,
    );
    expect(screen.queryByText('Airborne')).toBeNull();
    expect(screen.getByText('SCHED · inbound on UA1389')).toBeTruthy();
    fireEvent.click(screen.getByText('Track inbound'));
    expect(onTrack.mock.calls[0][0].inbound.icao24).toBe('a4b1c2');
  });
});

describe('SlHero verification sub-line (F99)', () => {
  it('names its own denominator, which is not the headline count', () => {
    render(
      <SlHero
        equipped={598}
        bars={null}
        newThisWeek={0}
        airborneCount={0}
        canFilterMap
        verified={594}
        checked={606}
        disputed={5}
        onJumpToLedger={() => {}}
        onShowOnMap={() => {}}
      />,
    );
    const sub = document.getElementById('sl-hero-verify-sub') as HTMLElement;
    expect(sub.textContent).toContain('594 of 606 checked verified');
    expect(sub.textContent).toContain('5 disputed');
  });
});
