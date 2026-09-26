/**
 * The tab registry: one row per view, consumed by the desktop tab bar, the mobile bottom
 * nav, the deep-link handler and `Dashboard.tsx`.
 *
 * Every view is a `React.lazy` chunk so the first paint ships the Live tab and nothing
 * else. Later work packages replace ONLY their own view file — nothing in this table, in
 * `Dashboard.tsx` or in the state providers has to change for a view to come to life.
 *
 * Hashes are the ones the shipped site published (inventory §16). They are additive: a
 * visitor arriving at `/` with no hash still lands on Live, and nothing requires a hash.
 * The old internal id `tab-analytics` published `#stats`, which is the id used here.
 */

import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

export type TabId =
  | 'live'
  | 'myflight'
  | 'schedule'
  | 'fleet'
  | 'starlink'
  | 'weather'
  | 'stats'
  | 'sources';

export type TabDef = {
  id: TabId;
  /** Location hash, including the leading '#'. */
  hash: string;
  label: string;
  /** Short label for the mobile bottom nav. */
  shortLabel: string;
  /** Decorative glyph — always paired with the text label, never the only signal. */
  icon: string;
  /** In the mobile bottom bar rather than behind "More". */
  mobilePrimary: boolean;
  View: LazyExoticComponent<ComponentType>;
};

export const TABS: TabDef[] = [
  {
    id: 'myflight',
    hash: '#myflight',
    label: 'My Flights',
    shortLabel: 'My Flights',
    icon: '🎫',
    mobilePrimary: true,
    View: lazy(() => import('./views/MyFlightsView')),
  },
  {
    id: 'live',
    hash: '#live',
    label: 'Live Ops',
    shortLabel: 'Live',
    icon: '📡',
    mobilePrimary: true,
    View: lazy(() => import('./views/LiveView')),
  },
  {
    id: 'schedule',
    hash: '#schedule',
    label: 'Schedule',
    shortLabel: 'Schedule',
    icon: '📅',
    mobilePrimary: true,
    View: lazy(() => import('./views/ScheduleView')),
  },
  {
    id: 'fleet',
    hash: '#fleet',
    label: 'Fleet',
    shortLabel: 'Fleet',
    icon: '✈️',
    mobilePrimary: false,
    View: lazy(() => import('./views/FleetView')),
  },
  {
    id: 'starlink',
    hash: '#starlink',
    label: 'Starlink',
    shortLabel: 'Starlink',
    icon: '🛰️',
    mobilePrimary: false,
    View: lazy(() => import('./views/StarlinkView')),
  },
  {
    id: 'weather',
    hash: '#weather',
    label: 'Delays · Weather · Hubs',
    shortLabel: 'Weather',
    icon: '🌦',
    mobilePrimary: true,
    View: lazy(() => import('./views/WeatherView')),
  },
  {
    id: 'stats',
    hash: '#stats',
    label: 'Stats',
    shortLabel: 'Stats',
    icon: '📊',
    mobilePrimary: false,
    View: lazy(() => import('./views/StatsView')),
  },
  {
    id: 'sources',
    hash: '#sources',
    label: 'Sources',
    shortLabel: 'Sources',
    icon: 'ℹ️',
    mobilePrimary: false,
    View: lazy(() => import('./views/SourcesView')),
  },
];

export const DEFAULT_TAB: TabId = 'live';

/** `{ live: '#live', … }` — the published hash for each tab. */
export const TAB_HASHES: Record<TabId, string> = TABS.reduce(
  (map, tab) => ({ ...map, [tab.id]: tab.hash }),
  {} as Record<TabId, string>,
);

export function tabById(id: string): TabDef | undefined {
  return TABS.find((tab) => tab.id === id);
}

/**
 * Resolve a `#hash` or a `?tab=` value to a tab id.
 *
 * `?tab=irops` is an alias the hub pages and old links still use: it means "the Weather tab,
 * scrolled to the IROPS section", so it resolves to `weather` and the caller handles the
 * scroll (inventory §16).
 */
export function resolveTabParam(value: string | null | undefined): TabId | null {
  if (!value) return null;
  const key = value.replace(/^#/, '').replace(/^tab-/, '').toLowerCase();
  if (key === 'irops') return 'weather';
  if (key === 'analytics') return 'stats';
  return TABS.some((tab) => tab.id === key) ? (key as TabId) : null;
}
