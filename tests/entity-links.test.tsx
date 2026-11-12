// @vitest-environment jsdom
/**
 * The per-kind links (src/app/features/EntityLinks.tsx) and FlightLink's tone.
 *
 * A name with a home on the dashboard is a link there; a name without one is plain text with no
 * link colour and no underline (the plan's Global Constraints). Link colour belongs to the thing
 * the row is about (a tail, a flight number by default); a hub or a type is a quiet link, body
 * colour and underlined at rest, so it reads as a link without colour.
 *
 * Mounted in the real UiProvider and ScheduleProvider, which every in-place link needs; the
 * Schedule store's watch-list collaborators are stubbed as in tests/dash-link.test.tsx.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HubLink, TailLink, TypeLink } from '../src/app/features/EntityLinks';
import { FlightLink } from '../src/app/features/FlightLink';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

function mount(node: ReactNode) {
  return render(
    <UiProvider>
      <ScheduleProvider>
        {node}
        <Probe />
      </ScheduleProvider>
    </UiProvider>,
  );
}

/** A bare `underline` class (the quiet tone's at-rest mark), not `hover:underline`. */
const AT_REST_UNDERLINE = /(?:^|\s)underline(?:\s|$)/;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  ui = null;
});

describe('TailLink', () => {
  it('links a US registration to its aircraft dialog, in link colour', () => {
    mount(<TailLink reg="N78501" />);
    const link = screen.getByRole('link', { name: 'N78501' });
    expect(link.getAttribute('href')).toBe('/?aircraft=N78501');
    expect(link.className).toMatch(/\btext-primary\b/);
  });

  it('prints any other registration as plain text: no link colour, no underline', () => {
    mount(<TailLink reg="JA873A" className="font-mono" />);
    expect(screen.queryByRole('link')).toBeNull();
    const plain = screen.getByText('JA873A');
    expect(plain.tagName).toBe('SPAN');
    expect(plain.className).toBe('font-mono');
    expect(plain.className).not.toMatch(/text-primary/);
    expect(plain.className).not.toMatch(/underline/);
  });

  it('opens the aircraft dialog in place when clicked', () => {
    mount(<TailLink reg="N78501" />);
    // fireEvent.click returns false when the default (a page load) was prevented.
    expect(fireEvent.click(screen.getByRole('link', { name: 'N78501' }))).toBe(false);
    expect(ui!.aircraftReg).toBe('N78501');
  });
});

describe('HubLink', () => {
  it('links one of the nine hubs to its Schedule board, quiet: body colour, underlined at rest', () => {
    mount(<HubLink code="ORD" />);
    const link = screen.getByRole('link', { name: 'ORD' });
    expect(link.getAttribute('href')).toBe('/?tab=schedule&hub=ORD');
    expect(link.className).not.toMatch(/text-primary/);
    expect(link.className).toMatch(AT_REST_UNDERLINE);
  });

  it('prints any other airport as plain text', () => {
    mount(<HubLink code="LHR" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('LHR').tagName).toBe('SPAN');
  });

  it('finePointerOnly: inert and unstyled on a coarse pointer, still in the tab order', () => {
    mount(<HubLink code="ORD" finePointerOnly />);
    const link = screen.getByRole('link', { name: 'ORD' });
    for (const cls of ['pointer-coarse:pointer-events-none', 'pointer-coarse:no-underline', 'pointer-coarse:text-inherit']) {
      expect(link.className.split(/\s+/)).toContain(cls);
    }
    expect(link.hasAttribute('tabindex')).toBe(false);
  });
});

describe('TypeLink', () => {
  it('links by the type code and prints the row\'s own text', () => {
    mount(<TypeLink typeCode="737-900ER">737-900</TypeLink>);
    const link = screen.getByRole('link', { name: '737-900' });
    expect(link.getAttribute('href')).toBe('/?tab=fleet&type=737-900ER');
    expect(link.textContent).toBe('737-900');
    expect(link.className).not.toMatch(/text-primary/);
    expect(link.className).toMatch(AT_REST_UNDERLINE);
  });

  it('prints plain text when there is no type code to link', () => {
    mount(<TypeLink typeCode={null}>ERJ-175</TypeLink>);
    expect(screen.queryByRole('link')).toBeNull();
    const plain = screen.getByText('ERJ-175');
    expect(plain.tagName).toBe('SPAN');
    expect(plain.textContent).toBe('ERJ-175');
  });
});

describe('FlightLink tone', () => {
  it('quiet: a link without link colour, underlined at rest', () => {
    mount(<FlightLink ident="UA576" tone="quiet" />);
    const link = screen.getByRole('link', { name: 'UA576' });
    expect(link.getAttribute('href')).toBe('/flight/UA576');
    expect(link.className).not.toMatch(/text-primary/);
    expect(link.className).toMatch(AT_REST_UNDERLINE);
  });

  it('identity by default: link colour, underline on hover, as every existing caller has it', () => {
    mount(<FlightLink ident="UA576" />);
    const link = screen.getByRole('link', { name: 'UA576' });
    expect(link.className).toMatch(/\btext-primary\b/);
    expect(link.className).toMatch(/\bhover:underline\b/);
    expect(link.className).not.toMatch(AT_REST_UNDERLINE);
  });
});
