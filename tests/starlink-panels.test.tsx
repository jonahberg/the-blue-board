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

describe('DeparturesBoard flight numbers (Nov 2026)', () => {
  function renderBoard(onOpenAircraft = vi.fn()) {
    const board = buildDeparturesBoard(
      {
        N34562: [{ flight_number: 'UAL2278', origin: 'SFO', destination: 'ORD', departure_ts: NOW + 60 * 60 }],
        N801SK: [{ flight_number: 'SKW5408', origin: 'SFO', destination: 'BOI', departure_ts: NOW + 90 * 60 }],
      },
      {
        N34562: { type: 'A321neo', fleet: 'Mainline', operator: 'United Airlines' },
        N801SK: { type: 'E175', fleet: 'Express', operator: 'SkyWest' },
      },
      {},
      ['SFO'],
      { now: NOW },
    ) as BoardModel;
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
        onOpenAircraft={onOpenAircraft}
        onTrack={() => {}}
      />,
    );
    return onOpenAircraft;
  }

  it('a United number links to its flight page; an operating callsign is plain text', () => {
    renderBoard();
    const link = screen.getByRole('link', { name: 'UAL2278' });
    expect(link.getAttribute('href')).toBe('/flight/UA2278');
    expect(screen.queryByRole('link', { name: 'SKW5408' })).toBeNull();
    const plain = screen.getByText('SKW5408');
    expect(plain.tagName).toBe('SPAN');
    expect(plain.className).not.toMatch(/text-primary/);
  });

  it('the aircraft details button is separate from the link and still opens the aircraft', () => {
    const onOpenAircraft = renderBoard();
    const button = screen.getByRole('button', { name: /Aircraft details: .*N34562/ });
    expect(button.contains(screen.getByRole('link', { name: 'UAL2278' }))).toBe(false);
    fireEvent.click(button);
    expect(onOpenAircraft).toHaveBeenCalledWith('N34562');
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

  it('never opens with its left edge through a bar or its count label (Nov 2026: "162*" read "62*")', async () => {
    const { buildVelocityChart } = await import('../src/lib/starlink-chart.js');
    const { VelocityChart } = await import('../src/app/views/starlink/VelocityChart');
    const months = Array.from({ length: 18 }, (_, i) => ({
      ym: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
      label: i % 12 === 0 ? `JAN ${25 + i / 12}` : 'MON',
      express: i === 9 ? 160 : 3,
      mainline: 10,
      total: i === 9 ? 170 : 13,
      cumulative: 13 * (i + 1),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = buildVelocityChart(months, 0) as any;
    const svgWidth = 620;
    const scale = svgWidth / model.width;
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const rect = Element.prototype.getBoundingClientRect;
    // Every right-pinned offset a phone could land on, from 300 px to 430 px wide.
    for (let client = 300; client <= 430; client += 7) {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => svgWidth });
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => client });
      Element.prototype.getBoundingClientRect = function () {
        return { width: this.tagName.toLowerCase() === 'svg' ? svgWidth : 0 } as DOMRect;
      };
      try {
        const { unmount } = render(<VelocityChart model={model} pace={null} />);
        const left = screen.getByTestId('sl-chart-scroller').scrollLeft;
        expect(left).toBeLessThanOrEqual(svgWidth - client);
        for (const bar of model.bars) {
          const half = bar.countLabel ? (bar.countLabel.text.length * (bar.capped ? 10 : 9) * 0.62) / 2 : 0;
          // The lib's zig-zag runs from x - 2 in 8-unit teeth across the bar (starlink-chart.js).
          const zigTo = bar.zigzag ? bar.x - 2 + 8 * Math.ceil((bar.width + 4) / 8) : bar.x + bar.width;
          const from = Math.min(bar.x - (bar.zigzag ? 2 : 0), bar.countLabel ? bar.countLabel.x - half : bar.x) * scale;
          const to = Math.max(bar.x + bar.width, zigTo, bar.countLabel ? bar.countLabel.x + half : 0) * scale;
          expect(left > from && left < to).toBe(false);
        }
        unmount();
      } finally {
        Element.prototype.getBoundingClientRect = rect;
        if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw);
        if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
      }
    }
  });
});
