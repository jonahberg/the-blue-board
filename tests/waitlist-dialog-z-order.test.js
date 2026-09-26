import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Legacy stacked these two overlays deliberately: the welcome overlay sat at z 10000 and the
// waitlist modal at 10001, so `?waitlist=1` — a visitor who followed that link ON PURPOSE —
// was never buried under the first-visit welcome. The rebuild's shadcn `DialogContent` gives
// BOTH dialogs the same `z-50`, so whichever portal mounts second wins and the waitlist loses
// on a fresh visit.
//
// The fix lives in two halves and needs both: `z-[60]` on the content, and `overlayClassName`
// -> `z-[60]` on the overlay `DialogContent` renders for itself. Lifting only the content
// leaves the waitlist card above onboarding's backdrop but underneath its own.
//
// This is a source scan rather than a render test because the failure mode it guards is a
// regeneration: `bunx shadcn add dialog` rewrites `src/components/ui/dialog.tsx` in place and
// would silently drop the `overlayClassName` pass-through, leaving the prop on the call site
// doing nothing at all. No assertion on a rendered tree would catch that — the markup still
// renders, just one z-index short.

const SRC = resolve(__dirname, '..', 'src');

/** JSX/TS source with comments removed, so prose about `z-[60]` cannot satisfy a scan. */
function sourceWithoutComments(path) {
  const raw = readFileSync(path, 'utf8');
  expect(raw.length, `${path} is empty — the scan is looking in the wrong place`).toBeGreaterThan(
    500
  );
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the waitlist dialog outranks the onboarding overlay', () => {
  const waitlist = sourceWithoutComments(
    resolve(SRC, 'app', 'features', 'WaitlistDialog.tsx')
  );

  /** The single `<DialogContent …>` opening tag, attributes only. */
  const contentTag = (waitlist.match(/<DialogContent\b([^>]*)>/) || [])[1];

  it('opens a DialogContent this scan can actually read', () => {
    expect(contentTag, 'no <DialogContent …> tag found in WaitlistDialog.tsx').toBeDefined();
  });

  it('lifts the dialog content above the shared z-50', () => {
    expect(
      contentTag,
      "WaitlistDialog's DialogContent must carry z-[60] — at z-50 it ties with onboarding"
    ).toMatch(/className="[^"]*\bz-\[60\]/);
  });

  it('lifts the overlay it renders for itself as well', () => {
    expect(
      contentTag,
      'without overlayClassName="z-[60]" the waitlist card floats above onboarding but below its own backdrop'
    ).toMatch(/overlayClassName="[^"]*\bz-\[60\]/);
  });

  it('keeps the 480px width the modal was designed at', () => {
    expect(contentTag).toMatch(/sm:max-w-\[480px\]/);
  });
});

describe('DialogContent still forwards overlayClassName to its overlay', () => {
  const dialog = sourceWithoutComments(resolve(SRC, 'components', 'ui', 'dialog.tsx'));

  it('declares the prop', () => {
    expect(dialog, 'dialog.tsx must declare an overlayClassName prop').toMatch(
      /overlayClassName\?:\s*string/
    );
  });

  it('destructures it out of the props spread', () => {
    // Left in `...props` it would land on DialogPrimitive.Content as a stray DOM attribute.
    const signature = (dialog.match(/function DialogContent\(\{([\s\S]*?)\}:/) || [])[1];
    expect(signature, 'no DialogContent signature found').toBeDefined();
    expect(signature).toMatch(/\boverlayClassName\b/);
  });

  it('actually passes it through to DialogOverlay', () => {
    // The half a shadcn regeneration would drop: the prop can survive on the signature while
    // `<DialogOverlay />` goes back to taking no className, and nothing else would notice.
    expect(
      dialog,
      'a regenerated dialog.tsx dropped the pass-through — every overlayClassName is now a no-op'
    ).toMatch(/<DialogOverlay\s+className=\{overlayClassName\}\s*\/>/);
  });
});
