/**
 * "Ask the board" — the one answer currently applied to a view.
 *
 * A tiny external store rather than a context provider, on purpose: the views that apply an answer
 * (Live, Schedule, Fleet, Starlink) keep their filters in local state and mount lazily on first
 * visit, so the palette cannot call their setters. It publishes the answer here; each view PULLS
 * the answer meant for it (`useAskFor(view)`) and applies it through its own setters once per
 * answer (`key`). No provider means nothing to mount in `Dashboard.tsx`.
 *
 * Only validated results ever enter (src/lib/ask-vocabulary.js validateAskResult); chip labels are
 * derived from them by `askChips()`, never from text.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { askChips, validateAskResult, withoutAskFilter } from '@/lib/ask-vocabulary.js';

export type AskView = 'live' | 'schedule' | 'fleet' | 'starlink' | 'weather' | 'flight';

export type AskFilters = {
  flight?: string;
  tail?: string;
  hub?: string;
  direction?: 'departures' | 'arrivals';
  origin?: string;
  destination?: string;
  family?: string;
  type?: string;
  starlink?: boolean;
  region?: string;
  airborne?: boolean;
  status?: 'delayed' | 'canceled' | 'on-time';
};

export type AskResult = { view: AskView; filters: AskFilters };

export type AskSource = 'rules' | 'model';

export type AskChip = { name: keyof AskFilters; label: string; kind: 'starlink' | 'plain' };

export type AskState = {
  /** Bumps on every new answer, so a view applies each answer exactly once. */
  key: number;
  result: AskResult | null;
  source: AskSource | null;
};

let state: AskState = { key: 0, result: null, source: null };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AskState {
  return state;
}

/** Publish a new answer. It is validated again here: nothing unvalidated reaches a view. */
export function setAskResult(result: unknown, source: AskSource): AskResult | null {
  const checked = validateAskResult(result) as
    | { ok: true; result: AskResult }
    | { ok: false; reason: string };
  if (!checked.ok) return null;
  state = { key: state.key + 1, result: checked.result, source };
  emit();
  return checked.result;
}

/** Remove one chip's filter. Removing the last chip clears the answer. */
export function removeAskFilter(name: keyof AskFilters) {
  if (!state.result || state.result.filters[name] === undefined) return;
  const next = withoutAskFilter(state.result, name) as AskResult | null;
  state = next ? { ...state, result: next } : { key: state.key, result: null, source: null };
  emit();
}

/** Clear the answer (the row's dismiss button, or a view's own "clear filters"). */
export function clearAsk() {
  if (!state.result) return;
  state = { key: state.key, result: null, source: null };
  emit();
}

export function useAsk(): AskState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The answer meant for one view, or null. */
export function useAskFor(view: AskView): { key: number; filters: AskFilters; result: AskResult } | null {
  const current = useAsk();
  if (!current.result || current.result.view !== view) return null;
  return { key: current.key, filters: current.result.filters, result: current.result };
}

/**
 * Run `apply` once per answer meant for `view` (views stay mounted, so a ref is enough).
 * Returns whether the current answer has been applied.
 */
export function useApplyAsk(view: AskView, apply: (filters: AskFilters) => void): boolean {
  const ask = useAskFor(view);
  const applied = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!ask || applied.current === ask.key) return;
    applied.current = ask.key;
    applyRef.current(ask.filters);
  }, [ask]);
  return Boolean(ask) && applied.current === ask?.key;
}

/**
 * Drop one chip once the control it set has been changed by hand: `holds` must have been true at
 * least once for this answer (the control took the value), and then turn false.
 */
export function useAskDrift(active: boolean, key: number, holds: boolean, name: keyof AskFilters) {
  const seen = useRef(-1);
  useEffect(() => {
    if (!active) return;
    if (holds) {
      seen.current = key;
      return;
    }
    if (seen.current === key) removeAskFilter(name);
  }, [active, key, holds, name]);
}

export function chipsFor(result: AskResult | null): AskChip[] {
  return askChips(result) as AskChip[];
}

export function __peekAskStateForTests(): AskState {
  return state;
}

export function __resetAskStateForTests() {
  state = { key: 0, result: null, source: null };
  emit();
}
