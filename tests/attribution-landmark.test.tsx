// @vitest-environment jsdom
/**
 * The dashboard island mounts inside BaseLayout's <main>, so a `role="contentinfo"` on its
 * attribution strip was a contentinfo landmark nested in main — axe
 * landmark-contentinfo-is-top-level on every tab (audit F41).
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { Attribution } from '../src/app/shell/Attribution';
import { UiProvider } from '../src/app/state/ui';

afterEach(cleanup);

describe('Attribution', () => {
  it('renders no contentinfo landmark when mounted inside <main>', () => {
    render(
      <TooltipProvider>
        <UiProvider>
          <main>
            <Attribution />
          </main>
        </UiProvider>
      </TooltipProvider>,
    );
    // An explicit role is what axe flagged. (Testing Library's implicit-role table maps every
    // <footer> to contentinfo regardless of its ancestors, so the attribute is the honest check.)
    expect(document.querySelector('[role="contentinfo"]')).toBeNull();
    // Still a named footer carrying the licence credits.
    const footer = document.querySelector('footer[aria-label="Data attribution"]');
    expect(footer?.textContent).toContain('AeroDataBox');
  });

  // The hydrated homepage's only always-mounted author credit. The ⓘ menu repeats it, but
  // Radix mounts popover content only while it is open, so that copy never reaches the DOM
  // a crawler renders. The shadcn rebuild (v1.8.0) dropped the old in-DOM credit this way.
  it('carries the "Built by Jonah Berg" credit, linked to jonahberg.com', () => {
    render(
      <TooltipProvider>
        <UiProvider>
          <main>
            <Attribution />
          </main>
        </UiProvider>
      </TooltipProvider>,
    );
    const footer = document.querySelector('footer[aria-label="Data attribution"]');
    const credit = footer?.querySelector('a[href="https://jonahberg.com"]');
    expect(credit?.textContent).toBe('Jonah Berg');
    expect(credit?.parentElement?.textContent).toMatch(/^Built by\s+Jonah Berg$/);
    expect(credit?.getAttribute('rel')).toBe('noopener noreferrer');
    // The GitHub profile is not the credit target (it stays in the JSON-LD Person sameAs).
    expect(footer?.querySelector('a[href="https://github.com/jonahberg"]')).toBeNull();
  });
});
