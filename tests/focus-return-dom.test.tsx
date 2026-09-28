// @vitest-environment jsdom
/**
 * The overlay wrappers' focus return, rendered (audit F117). tests/focus-return.test.js
 * covers the pure rule and keeps a source tripwire; this checks the behaviour a keyboard
 * user sees. Most of the app's overlays are opened by flipping state — no `DialogTrigger`,
 * so Radix has nothing to hand focus back to — and closing one must still put focus back on
 * the button that opened it rather than on <body>.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '../src/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '../src/components/ui/sheet';

afterEach(cleanup);

function StateOpenedDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Details</DialogTitle>
          <button type="button">Inside</button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StateOpenedSheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>Filters</SheetTitle>
          <button type="button">Inside</button>
        </SheetContent>
      </Sheet>
    </>
  );
}

async function openThenEscape() {
  const opener = screen.getByRole('button', { name: 'Open' });
  opener.focus();
  await act(async () => fireEvent.click(opener));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(document.activeElement).not.toBe(opener);
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  });
  // Radix's FocusScope dispatches its unmount auto-focus on a zero timeout.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  return opener;
}

describe('closing a state-opened overlay returns focus to its opener', () => {
  it('Dialog', async () => {
    render(<StateOpenedDialog />);
    const opener = await openThenEscape();
    expect(document.activeElement).toBe(opener);
  });

  it('Sheet', async () => {
    render(<StateOpenedSheet />);
    const opener = await openThenEscape();
    expect(document.activeElement).toBe(opener);
  });
});
