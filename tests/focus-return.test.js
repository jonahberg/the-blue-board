import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { shouldRestoreFocus, wasFocusLost } from '../src/lib/focus-return.js';

// Seven overlays — FlightSheet, AircraftDetailDialog, DelayExplainDialog, Fr24LookupDialog,
// Onboarding, DisclaimerDialog, WaitlistDialog — are opened by flipping state rather than by
// a rendered `DialogTrigger`/`SheetTrigger`. Radix's default `onCloseAutoFocus` calls
// `preventDefault()` and then `context.triggerRef.current?.focus()`; with no Trigger that ref
// is null, so nothing is focused and the browser drops focus to `<body>`. A keyboard user is
// returned to the top of the document every time they close one (WCAG 2.4.3 Focus Order).
//
// The rule is pure and lives here so it can be asserted without a DOM. The wrappers in
// `components/ui/dialog.tsx` and `components/ui/sheet.tsx` supply the two facts it needs.
//
// The interesting case is the one that must NOT restore: the flight panel is a NON-MODAL
// sheet beside a live map, and closing it by clicking the map is the user deliberately moving
// focus somewhere else. Yanking focus back to the marker they came from would fight them.

describe('wasFocusLost', () => {
  it('is lost when nothing is focused at all', () => {
    expect(wasFocusLost({ activeElement: null })).toBe(true);
    expect(wasFocusLost({ activeElement: undefined })).toBe(true);
    expect(wasFocusLost({})).toBe(true);
  });

  it('is lost when focus fell through to the document body', () => {
    expect(wasFocusLost({ activeElement: { tagName: 'BODY' } })).toBe(true);
    // Property access, not a DOM comparison — lower-case tagName must read the same.
    expect(wasFocusLost({ activeElement: { tagName: 'body' } })).toBe(true);
  });

  it('is lost when focus is still inside the overlay that is closing', () => {
    // The close button focuses itself, then unmounts with the rest of the content.
    expect(
      wasFocusLost({ activeElement: { tagName: 'BUTTON' }, insideClosingContent: true })
    ).toBe(true);
  });

  it('is NOT lost when the user moved focus somewhere real', () => {
    // Clicking the Leaflet container (tabindex=0) to dismiss the non-modal flight panel.
    expect(
      wasFocusLost({ activeElement: { tagName: 'DIV' }, insideClosingContent: false })
    ).toBe(false);
    expect(wasFocusLost({ activeElement: { tagName: 'INPUT' } })).toBe(false);
  });
});

describe('shouldRestoreFocus', () => {
  const opener = { tagName: 'BUTTON', isConnected: true };

  it('restores to the opener when focus was lost', () => {
    expect(shouldRestoreFocus({ opener, focusWasLost: true })).toBe(true);
  });

  it('leaves focus alone when the user put it somewhere themselves', () => {
    expect(shouldRestoreFocus({ opener, focusWasLost: false })).toBe(false);
  });

  it('does nothing without an opener', () => {
    expect(shouldRestoreFocus({ opener: null, focusWasLost: true })).toBe(false);
    expect(shouldRestoreFocus({ focusWasLost: true })).toBe(false);
    expect(shouldRestoreFocus({})).toBe(false);
  });

  it('does not chase an opener that has left the document', () => {
    // A row that re-rendered away while the sheet was open: focusing a detached node
    // silently moves focus to <body>, which is the bug this is meant to prevent.
    expect(
      shouldRestoreFocus({ opener: { tagName: 'BUTTON', isConnected: false }, focusWasLost: true })
    ).toBe(false);
  });

  it('never treats the body itself as an opener', () => {
    // Opening an overlay from a deep link means nothing was focused: activeElement was
    // <body>. Restoring to it is the no-op that looks like a fix but is not one.
    expect(
      shouldRestoreFocus({ opener: { tagName: 'BODY', isConnected: true }, focusWasLost: true })
    ).toBe(false);
    expect(
      shouldRestoreFocus({ opener: { tagName: 'body', isConnected: true }, focusWasLost: true })
    ).toBe(false);
  });

  it('composes with wasFocusLost for the two end-to-end shapes', () => {
    // Modal dialog closed by Escape: focus was inside the content -> restore.
    const lostOnEscape = wasFocusLost({
      activeElement: { tagName: 'DIV' },
      insideClosingContent: true,
    });
    expect(shouldRestoreFocus({ opener, focusWasLost: lostOnEscape })).toBe(true);

    // Non-modal sheet dismissed by clicking the map -> leave focus on the map.
    const lostOnMapClick = wasFocusLost({
      activeElement: { tagName: 'DIV' },
      insideClosingContent: false,
    });
    expect(shouldRestoreFocus({ opener, focusWasLost: lostOnMapClick })).toBe(false);
  });
});

describe('both overlay wrappers use the shared rule', () => {
  // A `bunx shadcn add dialog` / `add sheet` regeneration rewrites these files in place and
  // would drop the focus return silently — nothing renders differently and no other test
  // touches it. This is the tripwire for that.
  const UI = resolve(__dirname, '..', 'src', 'components', 'ui');

  for (const file of ['dialog.tsx', 'sheet.tsx']) {
    it(`${file} restores focus through focus-return.js`, () => {
      const source = readFileSync(resolve(UI, file), 'utf8');
      expect(source.length, `${file} is empty — the scan is looking in the wrong place`).toBeGreaterThan(
        500
      );
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

      expect(code, `${file} must import the shared focus rule`).toMatch(
        /from ['"]@\/lib\/focus-return\.js['"]/
      );
      expect(code, `${file} must consult shouldRestoreFocus`).toMatch(/shouldRestoreFocus\(/);
      expect(code, `${file} must derive focusWasLost with wasFocusLost`).toMatch(/wasFocusLost\(/);
      expect(code, `${file} must handle onCloseAutoFocus`).toMatch(/onCloseAutoFocus/);
      // The caller's own handler runs first and can opt out (ScheduleControls does).
      expect(code, `${file} must respect a caller that already prevented default`).toMatch(
        /defaultPrevented/
      );
      // Captured on mount, before Radix's FocusScope moves focus in a passive effect.
      expect(code, `${file} must capture the opener in a layout effect`).toMatch(
        /useLayoutEffect/
      );
    });
  }
});
