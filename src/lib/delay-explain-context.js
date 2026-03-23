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
    if (!faa || !faa.delays || !faa.delays.length) return;

    faa.delays.forEach((delay) => {
      const dtype = String(delay.type || '').toLowerCase();
      let label = 'Delay';
      let window = '';

      if (dtype.includes('ground stop')) {
        label = 'Ground stop';
      } else if (dtype.includes('ground delay') || dtype.includes('gdp')) {
        label = 'Ground delay program';
        if (faa.avgDelay) window = ` (avg ${faa.avgDelay}m)`;
      } else if (dtype.includes('departure')) {
        label = 'Departure delays';
        if (faa.minDelay || faa.maxDelay) {
          const low = faa.minDelay || '?';
          const high = faa.maxDelay || faa.minDelay || '?';
          window = ` (${low}-${high}m)`;
        }
      } else if (dtype.includes('arrival')) {
        label = 'Arrival delays';
        if (faa.minDelay || faa.maxDelay) {
          const low = faa.minDelay || '?';
          const high = faa.maxDelay || faa.minDelay || '?';
          window = ` (${low}-${high}m)`;
        }
      } else if (dtype.includes('closure')) {
        label = 'Airport closure';
      }

      const reason = String(delay.reason || '').trim();
      const context = reason ? `${airport} ${label}${window}: ${reason}` : `${airport} ${label}${window}`;
      if (!seen.has(context)) {
        seen.add(context);
        contexts.push(context);
      }
    });
  });

  return contexts.join(' · ');
}
