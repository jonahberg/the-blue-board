// @vitest-environment jsdom
/**
 * v1.14.0 Live-map chrome: the map key and the region chooser.
 *
 *  - The key's swatches are the markers' own fills and sizes (PLANE_LEGEND), it starts closed
 *    below md so it never covers a phone's map, and open from md up.
 *  - The region menu lists every preset, re-picking the checked region still asks for a move
 *    (a recentre after panning away), and a touch only opens it on click — never on the
 *    pointerdown that starts a sideways swipe of the toolbar.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RegionMenu } from '../src/app/views/live/MapControls';
import { MapLegend } from '../src/app/views/live/MapLegend';
import { MAP_REGIONS } from '../src/lib/map-regions.js';
import { PLANE_COLORS, PLANE_LEGEND } from '../src/lib/plane-icon.js';

function stubWidth(px: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min ? px >= Number(min[1]) : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    };
  }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  // @ts-expect-error — jsdom has no matchMedia by default; restore that.
  delete window.matchMedia;
});

describe('MapLegend', () => {
  it('starts closed on a phone: only the 44 px Key button shows', () => {
    stubWidth(390);
    render(<MapLegend longhaulLayer={false} starlinkRoster />);
    const button = screen.getByRole('button', { name: 'Key' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.className).toMatch(/\bmin-h-11\b/);
    const panel = document.getElementById(button.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(panel!.hidden).toBe(true);
  });

  it('opens and closes on tap', () => {
    stubWidth(390);
    render(<MapLegend longhaulLayer={false} starlinkRoster />);
    fireEvent.click(screen.getByRole('button', { name: 'Key' }));
    const hide = screen.getByRole('button', { name: 'Hide key' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'Map key' }).hidden).toBe(false);
    fireEvent.click(hide);
    expect(screen.getByRole('button', { name: 'Key' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('starts open from md up', () => {
    stubWidth(1280);
    render(<MapLegend longhaulLayer starlinkRoster />);
    expect(screen.getByRole('group', { name: 'Map key' }).hidden).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide key' })).toBeTruthy();
  });

  it('draws each swatch with the exact fill and size the marker uses', () => {
    stubWidth(1280);
    const { container } = render(<MapLegend longhaulLayer starlinkRoster />);
    const items = container.querySelectorAll('[data-legend]');
    expect(items).toHaveLength(PLANE_LEGEND.length);
    for (const row of PLANE_LEGEND) {
      const item = container.querySelector(`[data-legend="${row.id}"]`)!;
      expect(item.textContent).toBe(row.label);
      const svg = item.querySelector('svg')!;
      expect(svg.getAttribute('fill')).toBe(row.fill);
      expect(Number(svg.getAttribute('width'))).toBe(row.size);
    }
    const express = container.querySelector('[data-legend="express"] svg')!;
    expect(express.getAttribute('fill')).toBe(PLANE_COLORS.express);
    // Size is the Express cue that survives Starlink violet, and the key says so in words.
    expect(screen.getByText('Smaller icon = United Express')).toBeTruthy();
  });

  it('leaves out long-haul with the layer off and Starlink with no roster', () => {
    stubWidth(1280);
    const { container } = render(<MapLegend longhaulLayer={false} starlinkRoster={false} />);
    const ids = [...container.querySelectorAll('[data-legend]')].map((el) => el.getAttribute('data-legend'));
    expect(ids).toEqual(['watched', 'express', 'airborne', 'ground']);
  });
});

function trigger() {
  return screen.getByRole('button', { name: /Map region/ });
}

describe('RegionMenu', () => {
  it('names the current region in the trigger', () => {
    render(<RegionMenu region="oceania" onRegion={() => {}} />);
    expect(trigger().textContent).toContain('Oceania');
    cleanup();
    render(<RegionMenu region="pacific" onRegion={() => {}} />);
    expect(trigger().textContent).toContain('Pacific');
  });

  it('falls back to the US for an unknown region id (edge case)', () => {
    render(<RegionMenu region="atlantis" onRegion={() => {}} />);
    expect(trigger().textContent).toContain('US');
  });

  it('opens from the keyboard and lists every preset with the current one checked', async () => {
    render(<RegionMenu region="europe" onRegion={() => {}} />);
    await act(async () => {
      fireEvent.keyDown(trigger(), { key: 'Enter' });
    });
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(MAP_REGIONS.map((region) => region.label));
    const checked = items.filter((item) => item.getAttribute('aria-checked') === 'true');
    expect(checked.map((item) => item.textContent)).toEqual(['Atlantic & Europe']);
  });

  it('asks for a move on every pick — including the region already checked', async () => {
    const onRegion = vi.fn();
    render(<RegionMenu region="europe" onRegion={onRegion} />);
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.keyDown(trigger(), { key: 'Enter' });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Atlantic & Europe' }));
      });
    }
    expect(onRegion).toHaveBeenCalledTimes(2);
    expect(onRegion).toHaveBeenNthCalledWith(2, 'europe');
  });

  it('does not open on a touch pointerdown (a toolbar swipe), only on the tap’s click', async () => {
    render(<RegionMenu region="us" onRegion={() => {}} />);
    await act(async () => {
      fireEvent.pointerDown(trigger(), { pointerType: 'touch', button: 0 });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(trigger(), { pointerType: 'touch', button: 0 });
      fireEvent.click(trigger());
    });
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('keeps press-to-open for a mouse', async () => {
    render(<RegionMenu region="us" onRegion={() => {}} />);
    await act(async () => {
      fireEvent.pointerDown(trigger(), { pointerType: 'mouse', button: 0 });
    });
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});
