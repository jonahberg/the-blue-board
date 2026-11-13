// @vitest-environment jsdom
/**
 * A tab panel that receives focus shows the site's focus ring, for keyboard focus only
 * (src/components/ui/tabs.tsx).
 *
 * Radix gives each panel tabIndex 0, and since Nov 12 2026 a followed link and Back move focus to
 * the panel they show (state/follow-link.tsx). shadcn's `outline-none` hid that focus entirely.
 * The ring is global.css's `:focus-visible` rule, which a mouse click does not match, so a click
 * inside a panel (it focuses the panel too) draws no ring around the dashboard.
 *
 * jsdom applies no stylesheet and has no `:focus-visible` heuristics, so what is pinned here is
 * the mechanism: the panel carries no outline utility that would beat the base rule, and the base
 * rule is still there for both cases. The rendered behaviour was checked once in a real browser
 * (the foundation report).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

afterEach(cleanup);

function mount() {
  render(
    <Tabs defaultValue="one">
      <TabsList>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
      <TabsContent value="one">first panel</TabsContent>
      <TabsContent value="two">second panel</TabsContent>
    </Tabs>,
  );
  return screen.getByRole('tabpanel');
}

describe('a focused tab panel shows the focus ring for the keyboard', () => {
  it('is focusable and carries nothing that removes the outline', () => {
    const panel = mount();
    expect(panel.tabIndex).toBe(0);
    const classes = panel.className.split(/\s+/);
    for (const cls of classes) {
      // `outline-none`, `outline-hidden`, `outline-0` or a focus variant of them would beat the
      // base `:focus-visible` rule (utilities outrank base styles).
      expect(cls, cls).not.toMatch(/(?:^|:)outline-(?:none|hidden|0)$/);
    }
  });

  it('draws the ring inside its edge, where a full-width panel can show it', () => {
    const panel = mount();
    expect(panel.className.split(/\s+/)).toContain('focus-visible:-outline-offset-2');
  });

  it("the ring is global.css's: on :focus-visible, and none for a mouse focus", () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/global.css'), 'utf8').replace(/\s+/g, ' ');
    expect(css).toMatch(/:focus-visible \{ outline: 2px solid var\(--ring\);/);
    expect(css).toMatch(/:focus:not\(:focus-visible\) \{ outline: none; \}/);
  });
});
