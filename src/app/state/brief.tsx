/**
 * The ops brief: one `GET /api/brief` poll shared by the header row (`shell/Ticker`), the Live
 * sidebar panel and the brief sheet.
 *
 * Polling policy (rule: never show old text as current):
 *  - on mount, every 2 minutes while the tab is visible, and the moment it becomes visible again;
 *  - a failed fetch makes the brief unavailable until a later one succeeds. The header row then
 *    shows the rotating ticker, the sidebar panel goes away and an open sheet closes;
 *  - staleness is re-checked against the clock on every tick and on return to the tab
 *    (`briefViewState`, src/lib/brief-view.js), BEFORE the refetch answers, so a brief left in a
 *    background tab for hours never flashes back as "right now".
 *
 * Not `useJson`: that hook keeps the last good data through a failure and does not refetch on
 * becoming visible, which are exactly the two things this feed must not do.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { BRIEF_REFRESH_MS, briefViewState } from '@/lib/brief-view.js';
import { fetchBrief } from '../data/api';
import type { BriefFact, BriefResponse } from '../data/api';

export type BriefViewItem = { text: string; factIds: string[] };

export type BriefReady = {
  status: 'ready';
  headline: string;
  tone: 'calm' | 'watch' | 'disrupted';
  source: 'model' | 'template';
  items: BriefViewItem[];
  travelerNote: BriefViewItem | null;
  facts: BriefFact[];
  factsById: Map<string, BriefFact>;
  factCount: number;
  generatedAtMs: number;
  checkedAtMs: number;
  nextUpdateAtMs: number | null;
  hasRadio: boolean;
};

export type BriefView =
  | BriefReady
  | { status: 'unavailable'; reason: 'loading' | 'error' | 'none' | 'stale' | 'invalid' };

type BriefValue = {
  view: BriefView;
  /** The full brief as a sheet (below `lg` on every tab; at `lg`+ on tabs without the panel). */
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  /** Bumped when the header row asks the Live sidebar's panel to show itself (≥ `lg` on Live). */
  revealKey: number;
  revealPanel: () => void;
};

const UNAVAILABLE: BriefView = { status: 'unavailable', reason: 'loading' };

const BriefContext = createContext<BriefValue | null>(null);

/** Outside a provider (isolated component tests) the brief is simply unavailable. */
const FALLBACK: BriefValue = {
  view: UNAVAILABLE,
  sheetOpen: false,
  setSheetOpen: () => {},
  revealKey: 0,
  revealPanel: () => {},
};

export function useBrief(): BriefValue {
  return useContext(BriefContext) ?? FALLBACK;
}

export function BriefProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<{ payload: BriefResponse | null; error: boolean }>({
    payload: null,
    error: false,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sheetOpenRaw, setSheetOpen] = useState(false);
  const [revealKey, setRevealKey] = useState(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    fetchBrief(controller.signal).then(
      (payload) => {
        if (controller.signal.aborted) return;
        setFeed({ payload, error: false });
        setNowMs(Date.now());
      },
      () => {
        if (controller.signal.aborted) return;
        setFeed((current) => ({ payload: current.payload, error: true }));
        setNowMs(Date.now());
      },
    );
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      setNowMs(Date.now());
      if (!document.hidden) load();
    }, BRIEF_REFRESH_MS);
    const onVisibility = () => {
      if (document.hidden) return;
      setNowMs(Date.now());
      load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      inFlight.current?.abort();
    };
  }, [load]);

  const view = useMemo(
    () => briefViewState(feed.payload, { error: feed.error, nowMs }) as BriefView,
    [feed, nowMs],
  );
  // A sheet never stays open over a brief that has stopped being current.
  const sheetOpen = sheetOpenRaw && view.status === 'ready';
  useEffect(() => {
    if (view.status !== 'ready') setSheetOpen(false);
  }, [view.status]);

  const revealPanel = useCallback(() => setRevealKey((k) => k + 1), []);

  const value = useMemo<BriefValue>(
    () => ({ view, sheetOpen, setSheetOpen, revealKey, revealPanel }),
    [view, sheetOpen, revealKey, revealPanel],
  );
  return <BriefContext.Provider value={value}>{children}</BriefContext.Provider>;
}
