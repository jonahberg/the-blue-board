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
});
