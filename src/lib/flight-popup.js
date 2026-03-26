export function getFlightPopupMetrics(flight) {
  const altFt = flight.alt ? Math.round(flight.alt * 3.28084) : null;
  const spdKts = flight.spd ? Math.round(flight.spd * 1.944) : null;
  const altPct = altFt ? Math.min(100, (altFt / 41000) * 100) : 0;

  return {
    altFt,
    altPct,
    // FR24 feed speed is groundspeed; do not infer Mach from it.
    speedText: spdKts ? `${spdKts} kts` : 'N/A',
  };
}
