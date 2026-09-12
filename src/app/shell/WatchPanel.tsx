/**
 * The watch list, as a Sheet from the canopy's 👁️ button.
 *
 * Also owns the push opt-in prompt, which appears 500 ms after the FIRST flight is watched
 * and only when the server has VAPID keys, the browser supports notifications and the
 * viewer has not been asked before. Both "Enable" and "Not now" record that they were
 * asked, so nobody is prompted twice.
 */

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';

export function WatchPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const watch = useWatch();
  const { select, announce } = useUi();
  const [showPushPrompt, setShowPushPrompt] = useState(false);

  // 500 ms after the first add: long enough that it reads as a consequence of the action
  // rather than an interruption of it.
  useEffect(() => {
    if (!watch.justAddedFirst) return undefined;
    if (watch.push.prompted || !watch.push.configured) return undefined;
    if (watch.push.permission !== 'default') return undefined;
    const show = setTimeout(() => setShowPushPrompt(true), 500);
    const hide = setTimeout(() => setShowPushPrompt(false), 15500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [watch.justAddedFirst, watch.push.prompted, watch.push.configured, watch.push.permission]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        id="watch-panel"
        className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-sm"
      >
        <SheetHeader>
          <SheetTitle>Watched flights</SheetTitle>
          <SheetDescription>
            {watch.watched.length === 0
              ? 'Watch a flight from its detail panel to track status changes here.'
              : `${watch.watched.length} of 20 slots used.`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 pb-8">
          {showPushPrompt ? (
            <div className="rounded-md border bg-card p-3 text-sm">
              <p className="mb-2">Get a notification when a watched flight changes?</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void watch.push.enable()}>
                  Enable notifications
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    watch.push.dismissPrompt();
                    setShowPushPrompt(false);
                  }}
                >
                  Not now
                </Button>
              </div>
            </div>
          ) : null}

          {watch.watched.length > 0 ? (
            <>
              <ul className="divide-y rounded-md border">
                {watch.watched.map((entry) => (
                  <li key={entry.flight} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        select({ kind: 'ident', ident: entry.flight });
                        onOpenChange(false);
                      }}
                    >
                      <span className="font-mono font-medium">{entry.flight}</span>
                      {entry.route ? (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {entry.route}
                        </span>
                      ) : null}
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-8"
                      onClick={() => {
                        watch.toggle(entry.flight);
                        announce(`Stopped watching ${entry.flight}`);
                      }}
                      aria-label={`Stop watching ${entry.flight}`}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  watch.clearAll();
                  announce('Watch list cleared');
                }}
              >
                Clear all
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {watch.push.configured && watch.push.permission === 'granted'
                  ? 'Status changes are pushed to this device.'
                  : watch.push.configured
                    ? 'Enable notifications to be told about changes while this tab is closed.'
                    : 'Changes appear here while the dashboard is open.'}
              </p>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
