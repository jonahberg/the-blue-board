// ═══ CONNECTION RISK — pure, DOM-free logic (shared by dashboard + tests) ═══
//
// F003/F055 (2026-07-08 persona review): the previous inline implementation fell
// through to a green "SAFE — Comfortable connection" verdict on two failure modes
// that are the single worst wrong answers the site could give:
//   1. A cancelled or diverted leg was never checked — a dead flight could read SAFE.
//   2. Missing gate times produced NaN math that skipped every risk branch and
//      landed on the SAFE else-clause.
// This module gates the verdict on cancellation status + data presence FIRST, and
// only scores a buffer when both legs have real times. It also labels the MCT
// figure honestly: MIN_CONNECTION_TIMES is OUR padded comfort guidance, not
// United's published minima (which are lower, ~40-45 dom-dom at ORD).

// Comfortable-connection guidance in minutes, keyed hub → mctKey where
// mctKey = (domestic-in ? 'd' : 'i') + (domestic-out ? 'd' : 'i'). These are
// intentionally padded above United's published domestic MCTs — conservative
// guidance, not the airline's official minimum. The rendering layer must label
// them as such (see renderConnectionRiskCard).
export const MIN_CONNECTION_TIMES = {
  ORD:{dd:75,di:120,id:120,ii:120},DEN:{dd:60,di:90,id:90,ii:90},IAH:{dd:60,di:90,id:90,ii:120},
  EWR:{dd:60,di:90,id:90,ii:90},SFO:{dd:60,di:90,id:90,ii:120},IAD:{dd:60,di:90,id:90,ii:90},
  LAX:{dd:75,di:120,id:120,ii:120},NRT:{dd:60,di:90,id:90,ii:90},GUM:{dd:45,di:60,id:60,ii:60}
};

export const TERMINAL_WALK_TIMES = {
  ORD:{'1-2':8,'1-3':15,'2-3':10,'1-5':20,'2-5':18,'3-5':12,default:12},
  DEN:{default:10},EWR:{'A-B':10,'A-C':15,'B-C':8,default:10},
  IAH:{'A-B':8,'A-C':12,'A-D':15,'A-E':20,'B-C':8,'B-D':12,'B-E':15,'C-D':8,'C-E':12,'D-E':8,default:12},
  SFO:{default:12},IAD:{default:10},LAX:{'7-8':5,'7-B':15,'8-B':12,default:10},NRT:{default:15},GUM:{default:5}
};

export const CONN_COLORS = {
  risk: '#ef4444',      // red — MISSED / HIGH / cancelled / diverted
  moderate: '#eab308',  // yellow
  safe: '#22c55e',      // green
  neutral: '#94a3b8',   // --ua-muted — insufficient data (deliberately NOT green)
};

// Classify a connection from primitive inputs. `arrMs`/`depMs` are epoch
// milliseconds; pass NaN (or any non-finite value) when a required gate time is
// absent. Returns a result whose `.state` is one of:
//   'disrupted'    — a leg is cancelled/diverted (red, never SAFE)
//   'insufficient' — a required time is missing/NaN (neutral, never SAFE)
//   'scored'       — both legs have real times; buffer math applied
export function classifyConnection(input) {
  const {
    arrMs, depMs, mct, walkTime,
    inboundCancelled = false, outboundCancelled = false,
    inboundDiverted = false, outboundDiverted = false,
    inboundFlight = 'the inbound flight', outboundFlight = 'the outbound flight',
  } = input || {};

  const wt = Number.isFinite(walkTime) ? walkTime : 10;
  const m = Number.isFinite(mct) ? mct : 60;

  // (a) Cancelled / diverted — AT RISK regardless of the clock. Never SAFE.
  if (inboundCancelled || outboundCancelled || inboundDiverted || outboundDiverted) {
    let which, verb;
    if (inboundCancelled) { which = inboundFlight; verb = 'is cancelled'; }
    else if (outboundCancelled) { which = outboundFlight; verb = 'is cancelled'; }
    else if (inboundDiverted) { which = inboundFlight; verb = 'is diverted'; }
    else { which = outboundFlight; verb = 'is diverted'; }
    return {
      state: 'disrupted', hasData: false,
      risk: 'AT RISK', color: CONN_COLORS.risk,
      label: `CONNECTION AT RISK — ${which} ${verb}`,
      connectionMin: null, buffer: null, mct: m, walkTime: wt,
    };
  }

  // (b) Missing / NaN required times — insufficient to assess. Never SAFE.
  if (!Number.isFinite(arrMs) || !Number.isFinite(depMs)) {
    return {
      state: 'insufficient', hasData: false,
      risk: 'NO DATA', color: CONN_COLORS.neutral,
      label: 'Insufficient data to assess this connection',
      connectionMin: null, buffer: null, mct: m, walkTime: wt,
    };
  }

  // (c) Both legs have real times — score the buffer.
  const connectionMin = Math.round((depMs - arrMs) / 60000);
  const buffer = connectionMin - wt;

  let risk, color, label;
  if (connectionMin <= 0) { risk = 'MISSED'; color = CONN_COLORS.risk; label = 'Inbound arrives after outbound departs'; }
  else if (buffer < m * 0.5) { risk = 'HIGH'; color = CONN_COLORS.risk; label = 'Very tight — high risk of misconnect'; }
  else if (buffer < m) { risk = 'MODERATE'; color = CONN_COLORS.moderate; label = 'Tight but possible if no further delays'; }
  else { risk = 'SAFE'; color = CONN_COLORS.safe; label = 'Comfortable connection'; }

  return { state: 'scored', hasData: true, risk, color, label, connectionMin, buffer, mct: m, walkTime: wt };
}
