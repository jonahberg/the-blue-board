// Pure meaningful-change engine for server-side flight watch alerts.
//
// This is the diff logic ported out of src/dashboard/main.js's in-tab watch engine
// (isSignificantStatusChange + checkWatchedFlightChanges) so api/cron/watch-alerts.ts can
// decide whether a resolved flight state warrants a push — WITHOUT a Supabase or push
// dependency, so it is unit-testable in isolation.
//
// Ported rules (must stay in lockstep with main.js so in-tab and background alerts agree):
//   1. NEVER notify on Unknown (v1.5.26 / Jul 3 2026 audit): a transition INTO an unknown /
//      empty status is pipeline noise, not a flight event. Don't notify AND don't overwrite the
//      stored status, so the next REAL transition still compares against the last meaningful state.
//   2. Status transitions notify when meaningful: cancelled, diverted, landed, departed, an
//      appearing delay, a gate change, or scheduled→en-route. Identical status never notifies.
//   3. Gate change notifies (departure gate reassignment).
//   4. Equipment / registration change notifies (equipment swap — the alert type this plumbing
//      will also carry per the roadmap).
//   5. No duplicate notify for unchanged state: if nothing meaningful changed, notify:false and
//      the stored state is left as-is.

export interface WatchState {
  lastStatus?: string;
  lastGate?: string;
  lastEquip?: string;
}

export interface ResolvedFlight {
  status?: string;
  gate?: string;
  equip?: string;
}

export interface WatchDiffResult {
  notify: boolean;
  kind: 'status' | 'gate' | 'equip' | 'none';
  title: string;
  body: string;
  // The state to persist back for this watch. Unknown status is intentionally NOT written
  // (rule 1) so the last meaningful status survives.
  nextState: WatchState;
}

// A status string that means "we don't actually know" — never a notify trigger, never stored.
export function isUnknownStatus(status: string | undefined | null): boolean {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return true;
  return s === 'unknown' || s === 'n/a' || s === 'scheduled?' || s === '—' || s === '-';
}

// Ported verbatim (behaviour) from main.js isSignificantStatusChange.
export function isSignificantStatusChange(oldStatus: string, newStatus: string): boolean {
  if (!oldStatus || !newStatus || oldStatus === newStatus) return false;
  const nl = newStatus.toLowerCase();
  const ol = oldStatus.toLowerCase();
  if (nl.includes('cancel') || nl.includes('divert') || nl.includes('landed') || nl.includes('departed')) return true;
  if (nl.includes('delay')) return true;
  if (nl.includes('gate') && nl !== ol) return true;
  const significantKeys = ['cancel', 'divert', 'landed', 'departed', 'en route', 'en-route', 'delay', 'gate'];
  if (significantKeys.some((k) => nl.includes(k) || ol.includes(k))) return true;
  return false;
}

function norm(v: string | undefined | null): string {
  return String(v || '').trim();
}

/**
 * Decide whether a resolved flight state warrants a push, given the last-known state.
 * Pure: no I/O. `flight` is the display flight number (e.g. "UA123") used in copy.
 */
export function diffWatch(flight: string, prev: WatchState, resolved: ResolvedFlight): WatchDiffResult {
  const newStatus = norm(resolved.status);
  const oldStatus = norm(prev.lastStatus);
  const newGate = norm(resolved.gate);
  const oldGate = norm(prev.lastGate);
  const newEquip = norm(resolved.equip);
  const oldEquip = norm(prev.lastEquip);

  // Rule 1: never notify on / store Unknown. Preserve last meaningful status; still allow gate /
  // equipment fields (which carry their own known/unknown handling below) to update.
  const statusIsKnown = !isUnknownStatus(newStatus);
  const nextStatus = statusIsKnown ? newStatus : oldStatus;

  // Gate: only a change between two KNOWN gate values is meaningful (going from unknown→known or
  // known→unknown is noise from partial upstream data).
  const gateChanged = !!newGate && !!oldGate && newGate !== oldGate;
  // Equipment: same — a real swap between two known equipment/registration strings.
  const equipChanged = !!newEquip && !!oldEquip && newEquip !== oldEquip;

  const statusChanged =
    statusIsKnown && !!oldStatus && newStatus !== oldStatus && isSignificantStatusChange(oldStatus, newStatus);

  const nextState: WatchState = {
    lastStatus: nextStatus || undefined,
    // Store the freshest KNOWN gate/equip we've seen (don't clobber a known value with blank).
    lastGate: (newGate || oldGate) || undefined,
    lastEquip: (newEquip || oldEquip) || undefined,
  };

  // Priority: status transition > gate change > equipment swap. One push per flight per run.
  if (statusChanged) {
    return {
      notify: true,
      kind: 'status',
      title: `${flight}: ${newStatus}`,
      body: `Status changed from ${oldStatus} to ${newStatus}.`,
      nextState,
    };
  }
  if (gateChanged) {
    return {
      notify: true,
      kind: 'gate',
      title: `${flight}: gate ${newGate}`,
      body: `Departure gate changed from ${oldGate} to ${newGate}.`,
      nextState,
    };
  }
  if (equipChanged) {
    return {
      notify: true,
      kind: 'equip',
      title: `${flight}: aircraft swap`,
      body: `Aircraft changed from ${oldEquip} to ${newEquip}.`,
      nextState,
    };
  }

  return { notify: false, kind: 'none', title: '', body: '', nextState };
}
