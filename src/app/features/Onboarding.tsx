/**
 * "What is this dashboard?" — a short orientation and the home-hub picker (inventory §10).
 *
 * OPENED ON REQUEST ONLY (Nov 2026). This was the first-visit welcome: a modal over the live
 * map for every new visitor, six emoji feature rows and a hub picker. The map is the first
 * impression now, so the dialog opens only from the header's "?" (`md` and up) and the phone
 * "More" sheet's "What is this dashboard?" row — both call `setOnboardingOpen(true)`. On a
 * phone this is the ONLY home-hub picker (the header's hub button is `hidden md:inline-flex`),
 * so the picker stays here.
 *
 * Every route out (the button, Escape, the backdrop) goes through the SAME dismiss — the
 * shipped version had three code paths and only one of them saved the hub the visitor had
 * just chosen. That dismiss still writes `bb-onboarded` and `bb_onboarding_dismissed`, so a
 * returning visitor's storage reads exactly as it always did; nothing gates on them now.
 *
 * Radix's Dialog supplies what `main.js:7906-7947` hand-rolled with an AbortController: a
 * real focus trap, Escape, focus on the first control, and focus returned to where it came
 * from on close.
 */

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { onboardingHubSeed } from '@/lib/engagement.js';
import { STORAGE_KEYS, writeString } from '../state/storage';
import { usePrefs } from '../state/prefs';
import { useUi } from '../state/ui';

/**
 * Where to look, one line per place. An orientation, not a feature list: each line says what
 * the place answers, in the words a traveller would ask it.
 */
const ORIENTATION: { place: string; line: string }[] = [
  { place: 'Live', line: 'every United flight in the air. Select a plane for its flight, aircraft and Wi-Fi.' },
  { place: 'Schedule', line: 'any hub’s departures and arrivals, with a delay-risk read on flights still to go.' },
  // The tab reads "Delays · Weather · Hubs" on a desktop and "Weather" in the phone bar.
  { place: 'Delays · Weather', line: 'what is disrupting the network today, and the weather at every hub.' },
];

/** The picker's options — `legacy/index.html:113-125`. */
const HUBS: { code: string; name: string }[] = [
  { code: 'ORD', name: "Chicago O'Hare" },
  { code: 'DEN', name: 'Denver' },
  { code: 'IAH', name: 'Houston' },
  { code: 'EWR', name: 'Newark' },
  { code: 'SFO', name: 'San Francisco' },
  { code: 'IAD', name: 'Washington Dulles' },
  { code: 'LAX', name: 'Los Angeles' },
  { code: 'NRT', name: 'Tokyo Narita' },
  { code: 'GUM', name: 'Guam' },
];

/** Radix `Select` cannot hold "" as a value, so the no-preference slot needs a sentinel. */
const NO_PREFERENCE = '__none__';

export default function Onboarding() {
  const { onboardingOpen, setOnboardingOpen } = useUi();
  const { homeAirport, setHomeAirport } = usePrefs();
  const [hub, setHub] = useState<string>(() => onboardingHubSeed(homeAirport, NO_PREFERENCE));

  // The dialog is mounted for the life of the page and only toggles `open`, so the picker
  // has to be re-seeded every time it opens. Without this it keeps the hub as it was at
  // MOUNT: reopening it after setting a different hub from the header shows the old one, and
  // `dismiss()` writes that stale value straight back over the visitor's choice.
  useEffect(() => {
    if (onboardingOpen) setHub(onboardingHubSeed(homeAirport, NO_PREFERENCE));
  }, [onboardingOpen, homeAirport]);

  /**
   * One dismiss for every route out.
   *
   * The hub is saved only when one was actually picked: "No preference" is the default
   * state of the control, not an instruction to forget a hub the visitor set earlier from
   * the header (`main.js:7932` — `if (hubSel.value)`).
   */
  const dismiss = useCallback(() => {
    if (hub && hub !== NO_PREFERENCE) setHomeAirport(hub);
    // Both wrapped: a quota error on a preference must not take the dashboard down, and by
    // this point the dialog is closing either way.
    writeString(STORAGE_KEYS.onboarded, '1');
    writeString(STORAGE_KEYS.onboardingDismissed, String(Date.now()));
    setOnboardingOpen(false);
  }, [hub, setHomeAirport, setOnboardingOpen]);

  return (
    <Dialog
      open={onboardingOpen}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      {/* A column whose MIDDLE scrolls: header on top, the button pinned at the bottom, so the
          way out is always on screen on a short phone (phone QA, Oct 3 2026). */}
      <DialogContent className="flex max-h-[90svh] flex-col gap-3 overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>The Blue Board</DialogTitle>
          <DialogDescription>
            United’s operation as it happens, from public flight-tracking, schedule and weather
            data. Built by a United flyer; not affiliated with United Airlines.
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="onboarding-scroll"
          className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4"
        >
          <dl className="space-y-1.5 text-sm">
            {ORIENTATION.map(({ place, line }) => (
              <div key={place}>
                <dt className="inline font-semibold">{place}</dt>
                <dd className="inline text-muted-foreground">
                  {' — '}
                  {line}
                </dd>
              </div>
            ))}
          </dl>

          <div className="space-y-1.5">
            <Label htmlFor="onboarding-home-hub" className="text-xs">
              Home hub
            </Label>
            <Select value={hub} onValueChange={setHub}>
              <SelectTrigger id="onboarding-home-hub" aria-describedby="onboarding-home-hub-hint" className="w-full">
                <SelectValue placeholder="No preference" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PREFERENCE}>No preference</SelectItem>
                {HUBS.map((option) => (
                  <SelectItem key={option.code} value={option.code}>
                    {option.code} — {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="onboarding-home-hub-hint" className="text-[11px] text-muted-foreground">
              Centers the map on it and opens its schedule first.
            </p>
          </div>
        </div>

        <Button className="min-h-11 w-full shrink-0" onClick={dismiss}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}
