/**
 * "Ask the board" on the schedule board.
 *
 *   hub, direction        → the board selection (`setCurrent`), as the hub select and the
 *                           Departures/Arrivals toggle do
 *   canceled, Starlink, the six board families → the board's own filters (`setFilters`)
 *   late, on time, 737 MAX / E175 / CRJ, a type, the other end of the route
 *                         → one predicate the board model applies with its own filters
 *                           (src/lib/ask-apply.js makeScheduleAskPredicate)
 *
 * Two steps, because changing the board resets its contextual filters (Starlink among them) in
 * an effect on [hub, dir, day]: the selection is set first, and the filters only once the board on
 * screen is the one the answer named. This hook must be called AFTER that reset effect.
 *
 * Every other board filter is cleared: the board filters itself to the question. If the visitor
 * then changes a control the answer set, that chip goes; if they switch hub or direction, the
 * answer (which was about that board) is cleared.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { makeScheduleAskPredicate, scheduleAskPatch, scheduleControlledFilters } from '@/lib/ask-apply.js';
import { defaultSchedDayOffset } from '@/lib/hubTz.js';
import { clearAsk, removeAskFilter, useAskFor } from '../../state/ask';
import type { AskFilters } from '../../state/ask';
import type { BoardDirection } from '../../state/schedule';
import type { BoardFilters, ScheduleRow } from './useBoardModel';

type Deps = {
  hub: string;
  dir: BoardDirection;
  day: number;
  setCurrent: (next: { hub?: string; dir?: BoardDirection; day?: number }) => void;
  filters: BoardFilters;
  setFilters: (update: (prev: BoardFilters) => BoardFilters) => void;
};

export type AskBoardFilter = (row: ScheduleRow, ctx: { classify: (row: ScheduleRow) => { key?: string; cls?: string } }) => boolean;

export function useAskSchedule({ hub, dir, day, setCurrent, filters, setFilters }: Deps) {
  const ask = useAskFor('schedule');
  const f = ask?.filters;
  const wantHub = f?.hub ?? hub;
  const wantDir = (f?.direction ?? dir) as BoardDirection;
  // The hub's useful board right now: today's, or yesterday's before its local rollover hour.
  const wantDay = useMemo(() => (ask && wantHub ? (defaultSchedDayOffset(wantHub) as number) : day), [ask, wantHub, day]);

  // Step 1: pick the board (named in full, so the day cannot change a render later and reset the
  // filters step 2 sets).
  const selected = useRef(0);
  useEffect(() => {
    if (!ask || selected.current === ask.key) return;
    selected.current = ask.key;
    setCurrent({ hub: wantHub, dir: wantDir, day: wantDay });
  }, [ask, wantHub, wantDir, wantDay, setCurrent]);

  // Step 2: once that board is the one on screen, set its filters.
  const applied = useRef(0);
  const onBoard = Boolean(ask) && hub === wantHub && dir === wantDir && day === wantDay;
  useEffect(() => {
    if (!ask || !onBoard || applied.current === ask.key || selected.current !== ask.key) return;
    applied.current = ask.key;
    const patch = scheduleAskPatch(ask.filters) as BoardFilters;
    setFilters(() => patch);
  }, [ask, onBoard, setFilters]);

  // The visitor moved to another board: the answer was about the old one.
  useEffect(() => {
    if (!ask || applied.current !== ask.key) return;
    if (!onBoard) clearAsk();
  }, [ask, onBoard]);

  // A control the answer set was changed by hand: that chip goes.
  const controlled = useMemo(
    () => (f ? (scheduleControlledFilters(f) as Record<string, { field: keyof BoardFilters; value: string }>) : {}),
    [f],
  );
  const settled = useRef(0);
  useEffect(() => {
    if (!ask || applied.current !== ask.key) return;
    const entries = Object.entries(controlled);
    const allHold = entries.every(([, c]) => filters[c.field] === c.value);
    if (allHold) {
      settled.current = ask.key;
      return;
    }
    if (settled.current !== ask.key) return;
    for (const [name, c] of entries) {
      if (filters[c.field] !== c.value) removeAskFilter(name as keyof AskFilters);
    }
  }, [ask, controlled, filters]);

  const predicate = useMemo(
    () => (f && onBoard ? (makeScheduleAskPredicate(f, dir) as AskBoardFilter | null) : null),
    [f, onBoard, dir],
  );

  const onRemove = useCallback(
    (name: keyof AskFilters) => {
      const c = controlled[name];
      if (c) setFilters((prev) => ({ ...prev, [c.field]: '' }));
    },
    [controlled, setFilters],
  );

  const onClear = useCallback(() => {
    const fields = Object.values(controlled).map((c) => c.field);
    if (fields.length) {
      setFilters((prev) => {
        const next = { ...prev };
        for (const field of fields) next[field] = '';
        return next;
      });
    }
  }, [controlled, setFilters]);

  const active = Boolean(ask);
  return useMemo(
    () => ({ active, applied: active && applied.current === ask?.key, predicate, onRemove, onClear, clear: clearAsk }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `applied` is read at render
    [active, ask?.key, predicate, onRemove, onClear, filters],
  );
}
