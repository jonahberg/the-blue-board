function normalizeAirportCode(iata) {
  return String(iata || '').trim().toUpperCase();
}

export function getScheduleRiskContext(flight, hub, direction) {
  const pageHub = normalizeAirportCode(hub);
  const flightDirection = direction === 'arrivals' ? 'arrivals' : 'departures';
  const origCode = normalizeAirportCode(flight?.airport?.origin?.code?.iata) || pageHub;
  const destCode = normalizeAirportCode(flight?.airport?.destination?.code?.iata);
  const depHub = flightDirection === 'departures' ? pageHub : origCode;
  const arrHub = flightDirection === 'departures' ? destCode : pageHub;
  return { origCode, destCode, depHub, arrHub };
}

export function formatDelayExplainFAAStatus(originIata, destIata, faaDelayIndex) {
  const seen = new Set();
  const contexts = [];
  const airports = [normalizeAirportCode(originIata), normalizeAirportCode(destIata)].filter(Boolean);

  airports.forEach((airport) => {
    const faa = faaDelayIndex?.[airport];
    if (!faa) return;

    // Use programs array if available (new JSON path), fall back to legacy delays array
    const programs = faa.programs || [];
    const delays = faa.delays || [];

    if (programs.length) {
      // Rich path: iterate programs for detailed context
      for (const prog of programs) {
        const { label, window, extras } = describeFaaProgram(prog);
        const reason = String(prog.reason || '').trim();
        let context = reason ? `${airport} ${label}${window}: ${reason}` : `${airport} ${label}${window}`;
        if (extras.length) context += ` (${extras.join(', ')})`;
        if (!seen.has(context)) {
          seen.add(context);
          contexts.push(context);
        }
      }
    } else if (delays.length) {
      // Legacy path: use flat delays array (XML fallback)
      for (const delay of delays) {
        const dtype = String(delay.type || '').toLowerCase();
        let label = 'Delay';
        let window = '';

        if (dtype.includes('ground stop') || dtype === 'ground_stop') {
          label = 'Ground stop';
        } else if (dtype.includes('ground delay') || dtype === 'ground_delay') {
          label = 'Ground delay program';
          if (faa.avgDelay) window = ` (avg ${faa.avgDelay}m)`;
        } else if (dtype.includes('departure') || dtype === 'departure_delay') {
          label = 'Departure delays';
          if (faa.minDelay || faa.maxDelay) {
            window = ` (${faa.minDelay || '?'}-${faa.maxDelay || '?'}m)`;
          }
        } else if (dtype.includes('arrival') || dtype === 'arrival_delay') {
          label = 'Arrival delays';
          if (faa.minDelay || faa.maxDelay) {
            window = ` (${faa.minDelay || '?'}-${faa.maxDelay || '?'}m)`;
          }
        } else if (dtype.includes('closure') || dtype === 'closure') {
          label = 'Airport closure';
        }

        const reason = String(delay.reason || '').trim();
        const context = reason ? `${airport} ${label}${window}: ${reason}` : `${airport} ${label}${window}`;
        if (!seen.has(context)) {
          seen.add(context);
          contexts.push(context);
        }
      }
    }

    // Runway config context (new)
    if (faa.runwayConfig && faa.runwayConfig.arrivalRate > 0) {
      const rc = faa.runwayConfig;
      const ctx = `${airport} config: ${rc.arrivalRunways}/${rc.departureRunways}, rate ${rc.arrivalRate}/hr`;
      if (!seen.has(ctx)) { seen.add(ctx); contexts.push(ctx); }
    }

    // De-icing context (new)
    if (faa.deicing) {
      const ctx = `De-icing active at ${airport}`;
      if (!seen.has(ctx)) { seen.add(ctx); contexts.push(ctx); }
    }
  });

  return contexts.join(' · ');
}

/**
 * Format a single FAA program object into its type-specific pieces, shared by the
 * delay-explain context builder AND the Weather-tab hub card (F074: the card previously
 * only special-cased ground_stop/ground_delay, so a concurrent departure_delay program
 * fell through to its bare reason string, dropping the real delay window). Returns the
 * structured parts so each caller can assemble its own presentation.
 *
 * @param {object} prog  an FAA program entry ({ type, endTime, avgDelay, minDelay, maxDelay, probabilityOfExtension, trend, reason }).
 * @returns {{label:string, window:string, extras:string[]}}
 */
export function describeFaaProgram(prog) {
  const dtype = prog?.type || '';
  let label = 'Delay';
  let window = '';
  const extras = [];

  if (dtype === 'ground_stop') {
    label = 'Ground stop';
    if (prog.endTime) extras.push(`until ${prog.endTime}`);
    if (prog.probabilityOfExtension) extras.push(`ext: ${prog.probabilityOfExtension}`);
  } else if (dtype === 'ground_delay') {
    label = 'Ground delay program';
    if (prog.avgDelay) window = ` (avg ${prog.avgDelay}m)`;
    if (prog.trend) extras.push(`${trendArrow(prog.trend)} ${prog.trend.toLowerCase()}`);
  } else if (dtype === 'departure_delay') {
    label = 'Departure delays';
    if (prog.minDelay || prog.maxDelay) {
      window = ` (${prog.minDelay || '?'}-${prog.maxDelay || '?'}m)`;
    }
    if (prog.trend) extras.push(`${trendArrow(prog.trend)} ${prog.trend.toLowerCase()}`);
  } else if (dtype === 'arrival_delay') {
    label = 'Arrival delays';
    if (prog.minDelay || prog.maxDelay) {
      window = ` (${prog.minDelay || '?'}-${prog.maxDelay || '?'}m)`;
    }
    if (prog.trend) extras.push(`${trendArrow(prog.trend)} ${prog.trend.toLowerCase()}`);
  } else if (dtype === 'closure') {
    label = 'Airport closure';
  }

  return { label, window, extras };
}

function trendArrow(trend) {
  if (!trend) return '';
  const t = String(trend).toLowerCase();
  if (t === 'increasing') return '↑';
  if (t === 'decreasing') return '↓';
  return '→';
}
