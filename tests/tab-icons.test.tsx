// @vitest-environment jsdom
// The tab registry's icons are lucide components rendered aria-hidden beside the label, so a
// tab's accessible name is exactly its label (audit F73).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tabs } from '../src/components/ui/tabs';
import { TabBar } from '../src/app/shell/TabBar';
import { TABS } from '../src/app/tabs';

afterEach(cleanup);

describe('TabBar icons', () => {
  it('every tab shows an aria-hidden SVG icon and is named by its label alone', () => {
    render(
      <Tabs value="live">
        <TabBar />
      </Tabs>,
    );
    for (const tab of TABS) {
      const trigger = screen.getByRole('tab', { name: tab.label });
      const svg = trigger.querySelector('svg');
      expect(svg, `${tab.id} has no icon`).not.toBeNull();
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('marks Starlink with the same ⚡ (Zap) the badges and chips use', () => {
    const starlink = TABS.find((t) => t.id === 'starlink')!;
    render(
      <Tabs value="live">
        <TabBar />
      </Tabs>,
    );
    const svg = screen.getByRole('tab', { name: starlink.label }).querySelector('svg');
    expect(svg!.getAttribute('class')).toMatch(/lucide-zap/);
  });
});
