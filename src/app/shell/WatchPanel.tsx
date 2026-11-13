/**
 * The watch list, as a Sheet from the canopy's 👁️ button (inventory §6).
 *
 * Also owns the push opt-in prompt, which appears 500 ms after the FIRST flight is
 * watched and only when the browser can notify at all and the viewer has not been asked
 * before. Both "Enable" and "Not now" record that they were asked, so nobody is
 * prompted twice — and so does dismissing the browser's own dialog.
 *
 * The prompt is rendered OUTSIDE the Sheet on purpose. A flight is watched from the map
 * popup, a schedule row, a My Flights card — almost never from inside this panel — so a
 * prompt nested in `SheetContent` would be invisible at exactly the moment it fires.
 *
 * It is also NOT gated on the server having VAPID keys. The prompt buys two different
 * things: server-side push while the tab is closed, and the browser `Notification` the
 * in-tab watch fires while the tab is merely in the background (§6). The second needs
 * nothing from the server, and a deployment without keys still benefits from it.
 *
 * The panel itself carries the standing control (phone QA Oct 4 2026: it said "Enable
 * notifications for background alerts" with nothing to press). One honest line per state —
 * on, available (with the button), blocked (and how to undo it), iPhone/iPad Safari (needs the
 * Home Screen), unsupported — from `notificationControlState()` in watch-utils.js. The button
 * runs the same `push.enable()` the prompt does: permission, then the push subscription.
 *
 * Links (links everywhere, part 2). A watched flight's number is its flight page link, split out
 * of the row's button (DESIGN.md 2026-11-11: a number inside a control that does something else
 * is split out of it); the button, stretched under it, still opens the flight sheet. The panel
 * prints the raw watched ident, so a number `flightLink` refuses (a provider suffix, "UA526H")
 * stays inside the button, as before. "N of 20 slots used" links to My Flights: this panel is a
 * modal sheet whose open state Dashboard.tsx holds, which the follow's `fromOverlay` does not
 * close, so the link closes it in the same click (contract sheet §2) or the sheet would stay open
 * over My Flights with focus trapped in it.
 */

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { flightLink } from '@/lib/flight-link.js';
import { MY_FLIGHTS_HREF } from '@/lib/tab-links.js';
import { cn } from '@/lib/utils';
import { notificationControlState } from '@/lib/watch-utils.js';
import { dashLinkClick } from '../features/DashLink';
import { FlightLink } from '../features/FlightLink';
import { LINK_HIT, LINK_TONE } from '../features/link-style';
import { useFollowDeepLink } from '../state/follow-link';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';

const PROMPT_DELAY_MS = 500;
const PROMPT_VISIBLE_MS = 15000;

/** What this browser can do about notifications. Read once per panel mount; never during SSR. */
function notificationEnv() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { hasNotification: false, hasPush: false, isIos: false, isStandalone: false };
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIos = /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  let isStandalone = nav.standalone === true;
  try {
    isStandalone = isStandalone || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    /* no matchMedia */
  }
  return {
    hasNotification: typeof Notification !== 'undefined',
    hasPush: 'serviceWorker' in nav && 'PushManager' in window,
    isIos,
    isStandalone,
  };
}

export function WatchPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const watch = useWatch();
  const { select, announce } = useUi();
  const follow = useFollowDeepLink();
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const env = useMemo(notificationEnv, []);
  const control = notificationControlState(watch.push, env) as { state: string; text: string; canEnable: boolean };

  // 500 ms after the first add: long enough that it reads as a consequence of the action
  // rather than an interruption of it, and gone again after fifteen seconds whether or
  // not it was answered — an opt-in that will not leave is not an opt-in.
  useEffect(() => {
    if (!watch.justAddedFirst) return undefined;
    if (watch.push.prompted) return undefined;
    if (watch.push.permission !== 'default') return undefined;
    const show = setTimeout(() => setShowPushPrompt(true), PROMPT_DELAY_MS);
    const hide = setTimeout(() => setShowPushPrompt(false), PROMPT_DELAY_MS + PROMPT_VISIBLE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [watch.justAddedFirst, watch.push.prompted, watch.push.permission]);

  async function onEnablePush() {
    setShowPushPrompt(false);
    setEnabling(true);
    try {
      const result = await watch.push.enable();
      announce(
        result === 'granted'
          ? '🔔 Notifications on for watched flights'
          : result === 'denied'
            ? 'Notifications are blocked. You can allow them in your browser’s site settings.'
            : 'Notifications stay in this tab. You can enable them later in your browser settings.',
      );
    } finally {
      setEnabling(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          id="watch-panel"
          className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-sm"
        >
          <SheetHeader>
            <SheetTitle>Watched flights</SheetTitle>
            <SheetDescription>
              {watch.watched.length === 0 ? (
                'Watch a flight from its detail panel to track status changes here.'
              ) : (
                <>
                  {/* Followed in place as from an overlay (focus goes to My Flights), and the
                      panel closes in the same click; a modified click is left to the browser. */}
                  <a
                    href={MY_FLIGHTS_HREF}
                    className={cn(LINK_TONE.quiet, LINK_HIT.box)}
                    onClick={(event) => {
                      if (dashLinkClick(follow, MY_FLIGHTS_HREF, { fromOverlay: true })(event)) onOpenChange(false);
                    }}
                  >
                    {watch.watched.length} of 20 slots used
                  </a>
                  .
                </>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3 px-4 pb-8">
            {watch.watched.length > 0 ? (
              <>
                <ul className="divide-y rounded-md border">
                  {watch.watched.map((entry) => {
                    const linked = flightLink(entry.flight) !== null;
                    return (
                      <li key={entry.flight} className="relative flex items-center gap-2 px-3 py-2 text-sm">
                        {/* The number links to its flight page, above the row's button. */}
                        {linked ? (
                          <FlightLink ident={entry.flight} className="font-mono font-medium" linkClassName="z-10" />
                        ) : null}
                        {/* The flight sheet: stretched over the row (its ring drawn on that box), so
                            the row stays one target around the number, with Remove above it. */}
                        <button
                          type="button"
                          className="flex min-h-11 items-center text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring pointer-fine:md:min-h-0"
                          onClick={() => {
                            select({ kind: 'ident', ident: entry.flight });
                            onOpenChange(false);
                          }}
                        >
                          {linked ? (
                            <span className="sr-only">{entry.flight} flight details</span>
                          ) : (
                            <span className="font-mono font-medium">{entry.flight}</span>
                          )}
                          {entry.route ? (
                            <span className={cn('font-mono text-xs text-muted-foreground', !linked && 'ml-2')}>
                              {entry.route}
                            </span>
                          ) : null}
                        </button>
                        {entry.status ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {entry.status}
                          </span>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`relative z-10 min-h-11 pointer-fine:md:h-8 pointer-fine:md:min-h-0 ${entry.status ? '' : 'ml-auto'}`}
                          onClick={() => {
                            watch.toggle(entry.flight);
                            announce(`Stopped watching ${entry.flight}`);
                          }}
                          aria-label={`Stop watching ${entry.flight}`}
                        >
                          Remove
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 pointer-fine:md:min-h-0"
                  onClick={() => {
                    watch.clearAll();
                    announce('Watch list cleared');
                  }}
                >
                  Clear all
                </Button>
              </>
            ) : null}

            <section aria-labelledby="watch-notifications-heading" className="space-y-2 border-t pt-3">
              <h3 id="watch-notifications-heading" className="text-xs font-medium">
                Notifications
              </h3>
              <p
                className="text-[11px] leading-relaxed text-muted-foreground"
                data-state={control.state}
                aria-live="polite"
              >
                {control.text}
              </p>
              {control.canEnable ? (
                <Button
                  size="sm"
                  className="min-h-11 pointer-fine:md:min-h-0"
                  disabled={enabling}
                  onClick={() => void onEnablePush()}
                >
                  {enabling ? 'Asking your browser…' : 'Turn on notifications'}
                </Button>
              ) : null}
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* Outside the Sheet: the flight was almost certainly watched from somewhere else.
          The full-width positioning wrapper lets taps through (`pointer-events-none`); only
          the card itself blocks them, so the My Flights card actions either side of it stay
          reachable while the prompt is up. */}
      {showPushPrompt ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4">
          <div className="pointer-events-auto max-w-md rounded-md border bg-card p-3 text-sm shadow-lg">
            <p className="mb-2">Get a notification when a watched flight changes?</p>
            <div className="flex gap-2">
              <Button size="sm" className="min-h-11 pointer-fine:md:min-h-0" onClick={() => void onEnablePush()}>
                Enable notifications
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 pointer-fine:md:min-h-0"
                onClick={() => {
                  watch.push.dismissPrompt();
                  setShowPushPrompt(false);
                }}
              >
                Not now
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
