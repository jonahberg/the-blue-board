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

describe('VelocityChart', () => {
  it('opens scrolled to the newest months and paints count labels over the line (F29/F76)', async () => {
    const { buildVelocityChart } = await import('../src/lib/starlink-chart.js');
    const { VelocityChart } = await import('../src/app/views/starlink/VelocityChart');
    const months = Array.from({ length: 18 }, (_, i) => ({
      ym: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
      label: i % 12 === 0 ? `JAN ${25 + i / 12}` : 'MON',
      express: 3,
      mainline: 10,
      total: 13,
      cumulative: 13 * (i + 1),
    }));
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 628 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 342 });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(<VelocityChart model={buildVelocityChart(months, 0) as any} pace={null} />);
      expect(screen.getByTestId('sl-chart-scroller').scrollLeft).toBe(628 - 342);
    } finally {
      if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw);
      if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
    }
    const svg = document.getElementById('sl-chart') as unknown as SVGElement;
    const line = svg.querySelector('path[fill="none"][stroke-width="2"]') as Element;
    const label = [...svg.querySelectorAll('text')].find((t) => t.textContent === '13') as Element;
    // DOCUMENT_POSITION_FOLLOWING: the label is painted after (on top of) the line.
    expect(line.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.getAttribute('paint-order')).toBe('stroke');
  });
});
