// @vitest-environment jsdom
// DESIGN.md touch floor on the Weather tab's inline controls (audit F70): the IROPS jargon
// trigger and the briefing links measured 16px tall on a phone.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/app/state/prefs', () => ({ usePrefs: () => ({ homeAirport: '' }) }));

import { TooltipProvider } from '../src/components/ui/tooltip';
import { JargonTerm } from '../src/app/features/JargonTerm';
import { TrackerBriefing } from '../src/app/views/weather/TrackerBriefing';

afterEach(cleanup);

const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);

function expectTouchFloor(el: Element) {
  const cls = classesOf(el);
  expect(cls).toContain('min-h-11');
  expect(cls).toContain('pointer-fine:md:min-h-0');
}

describe('weather touch targets', () => {
  it('the jargon trigger is 44px tall until a fine pointer at md', () => {
    render(
      <TooltipProvider>
        <JargonTerm term="irops">IROPS</JargonTerm>
      </TooltipProvider>,
    );
    expectTouchFloor(screen.getByRole('button', { name: 'IROPS' }));
  });

  it('the infrastructure-watch links are 44px tall until a fine pointer at md', () => {
    render(<TrackerBriefing />);
    const links = screen.getAllByRole('link');
    expect(links.length).toBe(2);
    for (const link of links) expectTouchFloor(link);
  });
});
