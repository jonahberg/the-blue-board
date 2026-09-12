/**
 * The headline strip under the canopy.
 *
 * One render mode: a 5-second fade rotation. The old marquee is gone — it only ever ran
 * above 768 px AND when the ticker sat outside the header, which stopped being true once the
 * strip moved into the canopy, so every real visitor has been seeing the fade for a long time.
 *
 * `aria-live="off"` is deliberate and load-bearing (inventory §2, §17). A strip that rotates
 * every five seconds would interrupt a screen-reader user continuously; the ONE polite
 * announcer on the page is `IropsAnnouncer`, which speaks only when the network state
 * actually changes. Item priority — advisory, counts, emergency squawks, the green line only
 * when nothing above it is an advisory — lives in `src/lib/ticker.js`.
 */

import { useEffect, useMemo, useState } from 'react';

import { decodeSquawk } from '@/lib/flight-phase.js';
import { deriveOpsHealth } from '@/lib/ops-health.js';
import { buildTickerItems } from '@/lib/ticker.js';
import { cn } from '@/lib/utils';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useIrops } from '../state/irops';
import { HUB_ORDER, useHubHealth } from '../state/schedule';
import { useWeather } from '../state/weather';

const ROTATE_MS = 5000;
const FADE_MS = 400;

type TickerItem = { text: string; cls: string };

export function Ticker() {
  const feed = useFeed();
  const { fleetDb, starlink } = useFleet();
  const irops = useIrops();
  const weather = useWeather();
  const { byHub } = useHubHealth();

  const items = useMemo<TickerItem[]>(() => {
    const squawks = feed.flights
      .map((flight) => {
        const decoded = decodeSquawk(flight.squawk) as { text: string; cls: string } | null;
        if (!decoded || decoded.cls !== 'squawk-alert') return null;
        return {
          text: decoded.text,
          callsign: flight.callsign || flight.flightIATA || '',
          squawk: String(flight.squawk ?? ''),
        };
      })
      .filter((entry): entry is { text: string; callsign: string; squawk: string } =>
        Boolean(entry),
      );

    const opsHealth = deriveOpsHealth({
      hubOtps: byHub,
      faaIndex: weather.faaIndex,
      hubCodes: HUB_ORDER as string[],
      iropsScore: irops.data?.score ?? null,
    }) as { level: string; text: string };

    return buildTickerItems({
      opsHealth,
      airborne: feed.flights.filter((f) => !f.onGround).length,
      total: feed.flights.length,
      fleetCount: fleetDb.length,
      starlinkCount: starlink.tails.size,
      squawks,
    }) as TickerItem[];
  }, [feed.flights, fleetDb.length, starlink.tails, byHub, weather.faaIndex, irops.data]);

  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    setIndex(0);
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1) return undefined;
    const timer = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex((current) => (current + 1) % items.length);
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;
  const item = items[Math.min(index, items.length - 1)];

  return (
    <div
      // Never "polite": see the file header.
      aria-live="off"
      className="flex h-7 shrink-0 items-center overflow-hidden border-b bg-card/40 px-3 md:px-4"
    >
      <p
        className={cn(
          'truncate text-[11px] transition-opacity duration-300 motion-reduce:transition-none',
          fading ? 'opacity-0' : 'opacity-100',
          item.cls === 'advisory' && 'text-amber-400',
          item.cls === 'critical' && 'font-medium text-red-400',
          item.cls === 'disclaimer' && 'text-muted-foreground',
        )}
      >
        {item.text}
      </p>
    </div>
  );
}
