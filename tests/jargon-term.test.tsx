// @vitest-environment jsdom
/**
 * JargonTerm on each kind of pointer (Nov 2026). With a mouse it is the hover/focus tooltip it
 * always was. On a coarse pointer it is a popover a tap opens and closes, which stays put while the
 * page scrolls and never takes focus from the term. It also carries explanations that were `title=`
 * attributes, which a touch screen never shows (`description`).
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { JargonTerm } from '@/app/features/JargonTerm';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pointer(kind: 'coarse' | 'fine') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: kind === 'coarse' ? /pointer:\s*coarse/.test(query) : /pointer:\s*fine/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function mount(node: React.ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>);
}

describe('JargonTerm', () => {
  it('with a mouse: a button whose tooltip opens on focus', async () => {
    pointer('fine');
    mount(<JargonTerm term="irops">IROPS</JargonTerm>);
    const term = screen.getByRole('button', { name: 'IROPS' });
    expect(term.className).toMatch(/decoration-dotted/);
    await act(async () => {
      fireEvent.focus(term);
    });
    expect(screen.getByRole('tooltip').textContent).toContain('Irregular operations');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('on a touch screen: a tap opens a popover named by the term, a second tap closes it, focus stays on the term', async () => {
    pointer('coarse');
    mount(<JargonTerm term="groundstop">Ground Stop</JargonTerm>);
    const term = screen.getByRole('button', { name: 'Ground Stop' });
    term.focus();
    await act(async () => {
      fireEvent.click(term);
    });
    const bubble = screen.getByRole('dialog', { name: 'Ground Stop' });
    expect(bubble.textContent).toContain('FAA order halting departures');
    expect(term.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(term);
    await act(async () => {
      fireEvent.click(term);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a 44 px target on touch, the text height for a mouse at md+', () => {
    pointer('coarse');
    mount(<JargonTerm term="otp">On-Time</JargonTerm>);
    const classes = screen.getByRole('button', { name: 'On-Time' }).className.split(/\s+/);
    expect(classes).toContain('min-h-11');
    expect(classes).toContain('pointer-fine:md:min-h-0');
  });

  it('carries an explanation that is not a glossary entry, which wins over the term', async () => {
    pointer('coarse');
    mount(
      <JargonTerm term="otp" description="Operated: flights with a recorded departure time.">
        On-Time
      </JargonTerm>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'On-Time' }));
    });
    expect(screen.getByRole('dialog').textContent).toBe('Operated: flights with a recorded departure time.');
  });

  it('an unknown term with no explanation is just its label', () => {
    pointer('coarse');
    const { container } = mount(<JargonTerm term="nope">Plain</JargonTerm>);
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('Plain');
  });
});
