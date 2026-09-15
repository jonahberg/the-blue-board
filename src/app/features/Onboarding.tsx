/**
 * The first-visit welcome overlay (inventory §10).
 *
 * Six feature rows, a home-hub picker and one button. It is shown once, it is dismissed by
 * anything a visitor might reasonably do to get rid of it (the button, Escape, a click on
 * the backdrop), and every one of those routes through the SAME dismiss — the shipped
 * version had three code paths and only one of them saved the hub the visitor had just
 * chosen.
 *
 * Radix's Dialog supplies what `main.js:7906-7947` hand-rolled with an AbortController: a
 * real focus trap, Escape, focus on the first control, and focus returned to where it came
 * from on close. The show/hide rules stay in `src/lib/engagement.js`; the ordering rule
 * that must not be broken is documented in `state/engagement.tsx`.
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
import { initEngagement, useEngagement } from '../state/engagement';
import { usePrefs } from '../state/prefs';
import { useUi } from '../state/ui';

const FEATURES = [
  {
    icon: '📡',
    title: 'Live Map',
    desc: 'See where every United flight is right now — updated every 30 seconds',
  },
  {
    icon: '⚠️',
    title: 'AI Delay Prediction',
    desc: '8-signal risk scoring with AI-powered explanations — plus hub delays, cancellations, and ground stops',
  },
  {
    icon: '📅',
    title: 'Schedules',
    desc: 'Departures & arrivals at all 8 United hubs plus the Tokyo-Narita gateway, with on-time stats and equipment swap alerts',
  },
  {
    icon: '🌦',
    title: 'Weather & Hub Status',
    desc: "Conditions at every hub airport — radar, visibility, wind, and how it's affecting flights",
  },
  {
    icon: '✈️',
    title: 'Fleet & WiFi',
    desc: 'Check if your plane has Starlink WiFi, seat config, and aircraft details',
  },
  {
    icon: '📊',
    title: 'Stats',
    desc: 'Fleet utilization, route patterns, and network health — the truly nerdy stuff',
  },
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
  const engagement = useEngagement();
  const [hub, setHub] = useState<string>(() => onboardingHubSeed(homeAirport, NO_PREFERENCE));

  // The overlay is mounted for the life of the page and only toggles `open`, so the picker
  // has to be re-seeded every time it opens. Without this it keeps the hub as it was at
  // MOUNT: reopening via the header's "?" after setting a different hub there shows the old
  // one, and `dismiss()` writes that stale value straight back over the visitor's choice.
  //
  // Re-seeding is safe precisely because it writes the CURRENT preference — legacy never
  // pre-populated this select at all, so nothing here is a behaviour the port has to match.
  useEffect(() => {
    if (onboardingOpen) setHub(onboardingHubSeed(homeAirport, NO_PREFERENCE));
  }, [onboardingOpen, homeAirport]);

  useEffect(() => {
    initEngagement();
  }, []);

  // Opening is driven through `useUi` rather than local state so that Task 5's `?aircraft=`
  // deep link can see the overlay is up and hold its own dialog back (inventory §10).
  const opened = engagement.ready && engagement.showOnboardingInitially;
  useEffect(() => {
    if (opened) setOnboardingOpen(true);
  }, [opened, setOnboardingOpen]);

  /**
   * One dismiss for every route out.
   *
   * The hub is saved only when one was actually picked: "No preference" is the default
   * state of the control, not an instruction to forget a hub the visitor set earlier from
   * the header (`main.js:7932` — `if (hubSel.value)`).
   */
  const dismiss = useCallback(() => {
    if (hub && hub !== NO_PREFERENCE) setHomeAirport(hub);
    // main.js wrote `bb-onboarded` unguarded and only wrapped the timestamp. Both are
    // wrapped here: a quota error on a preference must not take the dashboard down, and by
    // this point the overlay is closing either way.
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
      <DialogContent className="max-h-[90svh] gap-4 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Welcome to The Blue Board ✈️</DialogTitle>
          <DialogDescription>
            Your real-time command center for United flights
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="flex gap-3">
              <span aria-hidden="true" className="text-lg leading-none">
                {feature.icon}
              </span>
              <div className="min-w-0">
                <strong className="text-sm">{feature.title}</strong>
                <p className="text-xs leading-relaxed text-muted-foreground">{feature.desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5 text-center">
          <Label htmlFor="onboarding-home-hub" className="justify-center text-xs text-muted-foreground">
            Set your home hub for a personalized experience
          </Label>
          <Select value={hub} onValueChange={setHub}>
            <SelectTrigger id="onboarding-home-hub" className="mx-auto w-[260px]">
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
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Built by a United flyer, for United flyers. Not affiliated with United Airlines.
        </p>

        <Button className="min-h-11 w-full" onClick={dismiss}>
          Let&rsquo;s Fly the Friendly Skies ✈️
        </Button>
      </DialogContent>
    </Dialog>
  );
}
