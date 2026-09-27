// @vitest-environment jsdom
/** F42 — the Stats headline cards are a valid description list: dt before dd, nothing else. */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MetricCards } from '../src/app/views/stats/MetricCards';

afterEach(cleanup);

describe('MetricCards', () => {
  it('renders each card as a dl group holding only dt then dd children', () => {
    render(
      <MetricCards
        metrics={[
          { label: 'Flights Airborne', value: '241' },
          { label: 'Starlink Coverage', value: '24%', sub: '58 of 241 airborne' },
        ]}
      />,
    );
    const dl = document.querySelector('dl') as HTMLElement;
    const groups = [...dl.children];
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      const tags = [...group.children].map((c) => c.tagName);
      expect(tags[0]).toBe('DT');
      expect(tags.slice(1).every((t) => t === 'DD')).toBe(true);
    }
    expect(groups[1].querySelectorAll('dd')[1].textContent).toBe('58 of 241 airborne');
  });
});
