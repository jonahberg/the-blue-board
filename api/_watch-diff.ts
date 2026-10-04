// Pure decision engine for server-side flight-watch alerts (api/cron/watch-alerts.ts). No Supabase,
// no push, no clock reads — unit-testable in isolation.
//
// ONE WATCH = ONE DATED LEG (Oct 4 2026 audit, finding 2). The client subscribes with a bare flight
// number ({flight}), and the old engine compared whatever leg /api/flight-times answered with on
// each run against the stored status — so when a hub's day rolled over, yesterday's landed leg was
// compared with today's scheduled one and could push "→ scheduled" or "aircraft swap". Three of the
// last eight sends before the fix fell exactly on hub midnights. Now:
//
//   - The first time a watch resolves to a leg that has not finished, it is PINNED to that leg
//     (scheduled departure, origin) and its state is recorded SILENTLY — no push for a baseline.
//     That includes every subscription stored before this change (they carry lastStatus but no
//     legDep): their first evaluation is a silent re-baseline. A watch that resolves only to a
//     finished leg (landed / cancelled) stays unpinned and waits for the next one.
//   - A pinned watch is resolved with that leg's departure (`dep`), and an answer about any other
//     leg is ignored. A day rollover therefore cannot produce a push.
//   - The watch ENDS QUIETLY: 3 h after its leg landed / was cancelled / diverted, or 36 h after the
//     leg's scheduled departure whatever happened, it is marked retired and never resolved or
//     pushed again. It does not roll forward to the next day's flight (that would push a stale
//     August watch twice a day, forever). Re-adding the flight in the watch panel starts a new one.
//
// What pushes, at most one per watch per run, in this priority order:
//   1. A forward phase change (src/lib/watch-rules.js): departed, landed, a CONFIRMED cancellation,
//      a diversion. Never into Likely Canceled or unknown, never backwards (finding 4 / v1.12.0).
//   2. A delay band going up: 15, 30, 60 min, then each further hour, from the estimated (or actual)
//      gate departure against scheduled — not the provider's literal "delayed" word, which only 4
//      of 2,651 departure rows carried on Oct 3 while 610 left 15+ min late (finding 3). A band is
//      never announced twice, and an estimate that wobbles back and forth is not news.
//   3. A departure-gate change between two known gates, before departure.
//   4. A tail-number swap between two known registrations, before departure.

import { delayBucket, isForwardTransition, isSilentPhase, isTerminalPhase, laterPhase, phaseOfStatusText } from '../src/lib/watch-rules.js';
import type { WatchPhase } from '../src/lib/watch-rules.js';
import { localDate, resolveLegState } from '../src/lib/watch-leg.js';

export type { WatchPhase };

/** A stored watch, as it lives in watch_subscriptions.watches. Fields after addedAt are server state. */
export interface WatchEntry {
  flight: string;
  date?: string;
  addedAt?: string;
  // Pre-Oct 2026 state, kept current for continuity; no longer drives a decision.
  lastStatus?: string;
  lastGate?: string;
  lastEquip?: string;
  // The pinned leg.
  legDep?: string; // scheduled departure, ISO
  legOrigin?: string;
  legDest?: string;
  legDate?: string; // origin-local date of legDep
  phase?: WatchPhase;
  delayBucket?: number;
  reg?: string;
  terminalAt?: string;
  retired?: boolean;
  retiredAt?: string;
}

export type WatchAlertKind = 'departed' | 'landed' | 'cancelled' | 'diverted' | 'delay' | 'gate' | 'equip';

/** What a push said, for the one structured log line per push. Never an endpoint, never PII. */
export interface WatchPushLog {
  flight: string;
  legDate: string;
  legDep: string;
  route: string;
  kind: WatchAlertKind;
  from: string;
  to: string;
  reason: string;
  delayMin: number | null;
}

export interface WatchEvaluation {
  notify: boolean;
  kind: WatchAlertKind | 'none';
  title: string;
  body: string;
  next: WatchEntry;
  /** A silent pin / re-baseline happened. */
  baseline: boolean;
  log: WatchPushLog | null;
}

/** An answer for a leg within this much of the pinned scheduled departure is the same leg. */
export const LEG_MATCH_TOLERANCE_MS = 2 * 3600e3;
export const RETIRE_AFTER_TERMINAL_MS = 3 * 3600e3;
export const RETIRE_AFTER_DEPARTURE_MS = 36 * 3600e3;

/**
 * A status string that means "we don't actually know" — never a trigger, never stored. AeroDataBox's
 * soft "Likely Canceled" (canceled_uncertain) is one of them (v1.12.0).
 */
export function isUnknownStatus(status: string | undefined | null): boolean {
  return isSilentPhase(phaseOfStatusText(status));
}

/**
 * Is a status-word change worth a push? Only a forward phase change (watch-rules.js
 * isForwardTransition): the same rule the in-tab watch uses (src/lib/watch-utils.js).
 */
export function isSignificantStatusChange(oldStatus: string, newStatus: string): boolean {
  if (!oldStatus || !newStatus || oldStatus === newStatus) return false;
  return isForwardTransition(phaseOfStatusText(oldStatus), phaseOfStatusText(newStatus));
}

function nonEmpty(v: unknown): string {
  return String(v ?? '').trim();
}

function noChange(entry: WatchEntry): WatchEvaluation {
  return { notify: false, kind: 'none', title: '', body: '', next: entry, baseline: false, log: null };
}

/**
 * Retire a watch whose leg is over: 3 h after it landed / was cancelled / diverted, or 36 h after
 * its scheduled departure. Returns the SAME entry when nothing changes.
 */
export function retireIfDone(entry: WatchEntry, nowMs: number): WatchEntry {
  if (!entry || entry.retired || !entry.legDep) return entry;
  const terminalAt = Date.parse(entry.terminalAt || '');
  const legDep = Date.parse(entry.legDep);
  const done =
    (Number.isFinite(terminalAt) && nowMs - terminalAt >= RETIRE_AFTER_TERMINAL_MS) ||
    (Number.isFinite(legDep) && nowMs - legDep >= RETIRE_AFTER_DEPARTURE_MS);
  return done ? { ...entry, retired: true, retiredAt: new Date(nowMs).toISOString() } : entry;
}

/** The /api/flight-times query for a watch: its pinned leg when it has one, else the flight. */
export function watchQuery(entry: WatchEntry): { flight: string; date?: string; dep?: number; from?: string } {
  const legDep = Date.parse(entry.legDep || '');
  if (Number.isFinite(legDep)) {
    return { flight: entry.flight, dep: Math.floor(legDep / 1000), ...(entry.legOrigin ? { from: entry.legOrigin } : {}) };
  }
  return { flight: entry.flight, ...(entry.date ? { date: entry.date } : {}) };
}

/** Stable key for deduplicating /api/flight-times lookups across subscriptions. */
export function watchQueryKey(entry: WatchEntry): string {
  const q = watchQuery(entry);
  return q.dep ? `${q.flight}|dep:${q.dep}|${q.from || ''}` : `${q.flight}|date:${q.date || ''}`;
}

/**
 * Carry the server state of watches that are still listed across a re-subscribe. The client posts
 * the whole list ({flight} only) on every add/remove; without this, adding a second flight would
 * wipe the first one's pinned leg and baseline (a transition in between would go unannounced) and
 * revive a retired watch onto the next day's flight. Matched on flight + date.
 */
export function carryWatchState<T extends { flight: string; date?: string }>(next: T[], prior: unknown): Array<T & Partial<WatchEntry>> {
  if (!Array.isArray(prior) || prior.length === 0) return next;
  const byKey = new Map<string, WatchEntry>();
  for (const p of prior as WatchEntry[]) {
    if (!p || typeof p !== 'object' || typeof p.flight !== 'string') continue;
    byKey.set(`${p.flight}:${p.date || ''}`, p);
  }
  return next.map((w) => {
    const p = byKey.get(`${w.flight}:${w.date || ''}`);
    return p ? { ...p, ...w, ...(p.addedAt ? { addedAt: p.addedAt } : {}) } : w;
  });
}

function hhmm(msValue: number, tz: string): string {
  if (!Number.isFinite(msValue)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(msValue));
  } catch {
    return new Date(msValue).toISOString().slice(11, 16) + ' UTC';
  }
}

function routeText(origin: string, dest: string): string {
  if (origin && dest) return `${origin}→${dest}`;
  return origin || dest || '';
}

type Leg = NonNullable<ReturnType<typeof resolveLegState>>;

function copyFor(flight: string, kind: WatchAlertKind, leg: Leg, entry: WatchEntry, bucket: number): { title: string; body: string } {
  const route = routeText(leg.origin, leg.dest);
  switch (kind) {
    case 'departed':
      return {
        title: `${flight} departed${leg.origin ? ` ${leg.origin}` : ''}`,
        body: leg.reason === 'airborne-sighting'
          ? `Seen airborne out of ${leg.origin}${leg.dest ? `, bound for ${leg.dest}` : ''}.`
          : `${route ? `${route} ` : ''}is on its way.`,
      };
    case 'landed': {
      const at = leg.reason === 'actual-arrival' ? hhmm(leg.actualArrMs, leg.destTz) : '';
      return {
        title: `${flight} landed${leg.dest ? ` at ${leg.dest}` : ''}`,
        body: leg.reason === 'ground-at-destination'
          ? `Seen on the ground at ${leg.dest}${leg.origin ? ` after the flight from ${leg.origin}` : ''}.`
          : `${route ? `${route} ` : ''}has landed${at ? ` (${at} local)` : ''}.`,
      };
    }
    case 'cancelled':
      return { title: `${flight} canceled`, body: `${route ? `${route} ` : ''}on ${leg.legDate} has been canceled.` };
    case 'diverted':
      return { title: `${flight} diverted`, body: `${route ? `${route} ` : 'The flight '}has diverted.` };
    case 'delay': {
      const now = hhmm(leg.estDepMs, leg.originTz);
      const sched = hhmm(leg.schedDepMs, leg.originTz);
      return {
        title: `${flight} delayed ${leg.delayMin} min`,
        body: now
          ? `Now expected to leave${leg.origin ? ` ${leg.origin}` : ''} at ${now} (scheduled ${sched}).`
          : `Running ${bucket}+ min behind its ${sched} departure.`,
      };
    }
    case 'gate':
      return { title: `${flight}: gate ${leg.gate}`, body: `Departure gate changed from ${entry.lastGate} to ${leg.gate}.` };
    case 'equip':
      return { title: `${flight}: aircraft swap`, body: `Aircraft changed from ${entry.reg} to ${leg.reg}.` };
  }
}

/** The fields every evaluation writes back for the pinned leg. */
function legFields(entry: WatchEntry, leg: Leg, phase: WatchPhase | undefined, bucket: number, nowMs: number): WatchEntry {
  const next: WatchEntry = {
    ...entry,
    legDep: leg.legDep,
    legOrigin: leg.origin || entry.legOrigin,
    legDest: leg.dest || entry.legDest,
    legDate: leg.legDate || entry.legDate,
    phase,
    delayBucket: bucket,
    reg: leg.reg || entry.reg,
    lastStatus: isSilentPhase(leg.phase) ? entry.lastStatus : leg.statusText || entry.lastStatus,
    lastGate: leg.gate || entry.lastGate,
    lastEquip: leg.reg || leg.type || entry.lastEquip,
  };
  if (phase && isTerminalPhase(phase) && !entry.terminalAt) next.terminalAt = new Date(nowMs).toISOString();
  for (const k of Object.keys(next) as (keyof WatchEntry)[]) if (next[k] === undefined || next[k] === '') delete next[k];
  return next;
}

/**
 * Decide what one watch does with one /api/flight-times answer (null = no answer this run).
 * Pure: the caller injects `nowMs`.
 */
export function evaluateWatch(entry: WatchEntry, payload: unknown, nowMs: number): WatchEvaluation {
  if (!entry || entry.retired) return noChange(entry);
  const leg = resolveLegState(payload, nowMs);
  if (!leg) return noChange(entry);
  const bucketNow = delayBucket(leg.delayMin);

  // ── Unpinned (a new watch, or one stored before legs were pinned): pin + silent baseline ──
  if (!entry.legDep) {
    if (leg.phase === 'unknown' || isTerminalPhase(leg.phase)) return noChange(entry);
    return {
      notify: false, kind: 'none', title: '', body: '', log: null, baseline: true,
      next: legFields(entry, leg, leg.phase, bucketNow, nowMs),
    };
  }

  // ── Pinned: only an answer about THIS leg counts ──
  const pinnedDep = Date.parse(entry.legDep);
  const sameLeg =
    Number.isFinite(pinnedDep) &&
    Math.abs(leg.schedDepMs - pinnedDep) <= LEG_MATCH_TOLERANCE_MS &&
    (!entry.legOrigin || !leg.origin || entry.legOrigin === leg.origin);
  if (!sameLeg) return noChange(entry);

  const prevPhase: WatchPhase = entry.phase || 'unknown';
  const nextPhase = laterPhase(prevPhase, leg.phase) || prevPhase;
  const storedBucket = Number.isFinite(Number(entry.delayBucket)) ? Number(entry.delayBucket) : 0;
  const preDeparture = nextPhase === 'scheduled' || nextPhase === 'likely_canceled';

  let kind: WatchAlertKind | null = null;
  let from = '';
  let to = '';
  if (isForwardTransition(prevPhase, leg.phase)) {
    kind = leg.phase as WatchAlertKind;
    from = prevPhase;
    to = leg.phase;
  } else if (preDeparture && bucketNow > storedBucket) {
    kind = 'delay';
    from = `${storedBucket}m`;
    to = `${bucketNow}m`;
  } else if (preDeparture && entry.lastGate && leg.gate && entry.lastGate !== leg.gate) {
    kind = 'gate';
    from = entry.lastGate;
    to = leg.gate;
  } else if (preDeparture && entry.reg && leg.reg && entry.reg !== leg.reg) {
    kind = 'equip';
    from = entry.reg;
    to = leg.reg;
  }

  // Bands only ratchet up: a later departure is announced once per band, an estimate coming back
  // earlier does not lower the bar for the next push.
  const next = legFields(entry, leg, nextPhase, Math.max(storedBucket, bucketNow), nowMs);
  if (!kind) return { notify: false, kind: 'none', title: '', body: '', next, baseline: false, log: null };

  const { title, body } = copyFor(entry.flight, kind, leg, entry, bucketNow);
  return {
    notify: true,
    kind,
    title,
    body,
    next,
    baseline: false,
    log: {
      flight: entry.flight,
      legDate: leg.legDate || localDate(pinnedDep, leg.originTz),
      legDep: entry.legDep,
      route: [leg.origin, leg.dest].filter(Boolean).join('-'),
      kind,
      from,
      to,
      reason: kind === 'delay' ? 'estimated-departure' : kind === 'gate' || kind === 'equip' ? 'provider-change' : leg.reason,
      delayMin: leg.delayMin,
    },
  };
}
