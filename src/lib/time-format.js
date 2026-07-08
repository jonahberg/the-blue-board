// Unified time-with-timezone formatter (P2-A item 2 / F047 / F054).
//
// Before this module existed, the flight popup used two different helpers for
// departure ("fmtTimeInTz", never labeled) and arrival ("fmtTimeWithTz", always
// labeled with timeZoneName) — so the popup silently rendered the departure time
// in the *viewer's* local timezone right next to a labeled arrival time, with no
// way to tell they were on different clocks. This single formatter always
// resolves and appends a short timezone abbreviation, and falls back to an
// explicit "local" label (never a silent, unlabeled viewer-local render) when
// the tz is genuinely unknown/empty.
export function formatTimeWithTz(iso, tz) {
  if (!iso) return null;
  let d;
  try {
    d = new Date(iso);
  } catch (e) {
    return null;
  }
  if (isNaN(d.getTime())) return null;

  const baseOpts = { hour: 'numeric', minute: '2-digit', hour12: true };

  if (tz) {
    try {
      const timeStr = d.toLocaleTimeString([], { ...baseOpts, timeZone: tz });
      const abbrev = getTzAbbrev(d, tz);
      return abbrev ? `${timeStr} ${abbrev}` : `${timeStr} local`;
    } catch (e) {
      // Unrecognized IANA tz string — fall through to viewer-local, explicitly labeled.
    }
  }

  try {
    const timeStr = d.toLocaleTimeString([], baseOpts);
    return `${timeStr} local`;
  } catch (e) {
    return null;
  }
}

// Resolve a short abbreviation ("CDT", "EST") for a given instant in a given
// IANA timezone. Returns '' if the runtime can't produce one (rare, but some
// environments fall back to a numeric UTC offset instead of a name).
export function getTzAbbrev(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    const part = parts.find((p) => p.type === 'timeZoneName');
    if (!part || !part.value) return '';
    // Reject bare numeric-offset fallbacks like "GMT-5" — not a real abbreviation.
    if (/^GMT[+-]?\d*$/.test(part.value)) return '';
    return part.value;
  } catch (e) {
    return '';
  }
}
