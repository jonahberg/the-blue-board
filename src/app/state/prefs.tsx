/**
 * Viewer preferences. Today that is the home hub, which drives the initial map centre and
 * zoom, the Schedule tab's default hub, the 🏠 marker in the hub-health strip and the
 * tracker briefing (inventory §1).
 *
 * The read/write/cycle rules live in `src/lib/home-airport.js` — including the detail that
 * clearing the hub REMOVES `bb_home_airport` rather than storing an empty string.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  HOME_HUB_CYCLE,
  nextHomeAirport,
  readHomeAirport,
  writeHomeAirport,
} from '@/lib/home-airport.js';
import { safeLocalStorage } from './storage';

export type PrefsValue = {
  /** IATA code, or '' for "no preference". */
  homeAirport: string;
  setHomeAirport: (code: string) => void;
  cycleHomeAirport: () => void;
};

const PrefsContext = createContext<PrefsValue | null>(null);

export function usePrefs(): PrefsValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs() outside <PrefsProvider>');
  return ctx;
}

/** A no-op storage so the lib helpers can run before hydration or in private mode. */
const NULL_STORAGE = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [homeAirport, setHome] = useState('');

  // Read after mount: the island is client:only, but a storage read still belongs in an
  // effect so a private-mode throw can never happen during render.
  useEffect(() => {
    setHome(readHomeAirport(safeLocalStorage() ?? NULL_STORAGE) as string);
  }, []);

  const setHomeAirport = useCallback((code: string) => {
    writeHomeAirport(safeLocalStorage() ?? NULL_STORAGE, code);
    setHome(code || '');
  }, []);

  const cycleHomeAirport = useCallback(() => {
    setHome((current) => {
      const next = nextHomeAirport(current) as string;
      writeHomeAirport(safeLocalStorage() ?? NULL_STORAGE, next);
      return next;
    });
  }, []);

  const value = useMemo<PrefsValue>(
    () => ({ homeAirport, setHomeAirport, cycleHomeAirport }),
    [homeAirport, setHomeAirport, cycleHomeAirport],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export { HOME_HUB_CYCLE };
