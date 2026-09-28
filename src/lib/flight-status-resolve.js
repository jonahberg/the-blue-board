// Maps provider status text + live-feed onGround into the flight state shown on
// My Flights cards. Delay is measured at the GATE (scheduled vs estimated), never
// the runway/takeoff times — the field choice that drove the delay-at-runway incident.
//
// Actual times outrank the status TEXT (live audit Sep 28 2026, D1): AeroDataBox kept
// UA1215 at 'expected' — real.departure null — for a leg FR24 had seen take off at
// 14:17:40Z. A recorded takeoff or arrival is a fact; a status word is a label that can lag.
export function resolveFlightStatus(td, liveFlight) {
  if (!td || td.success === false) return '';
  if (td.cancelled) return 'cancelled';
  if (td.diverted) return 'diverted';
  const st = (td.status || '').toLowerCase();
  const arrActual = td.arrival?.gate?.actual || td.arrival?.landing?.actual;
  if (arrActual || st.includes('land') || st.includes('arrived')) return 'landed';
  if (st.includes('en-route') || st.includes('en route') || st.includes('airborne') ||
      st.includes('in air') || st.includes('active') || st.includes('in flight')) return 'en-route';
  if (st.includes('depart') || st.includes('taxiing')) return 'departed';
  // Cross-reference with live FR24 feed data
  if (liveFlight && !liveFlight.onGround) return 'en-route';
  const takeoffActual = td.departure?.takeoff?.actual;
  const hasActualDep = takeoffActual || td.departure?.gate?.actual;
  if (liveFlight && liveFlight.onGround && hasActualDep) return 'landed';
  // Off the runway and not yet down: airborne, whatever the status text still says.
  if (takeoffActual) return 'en-route';
  if (td.departure?.gate?.actual) return 'departed';
  if (st.includes('delay')) return 'delayed';
  // Detect delay from time comparison (estimated vs scheduled gate departure)
  const schedDep = td.departure?.gate?.scheduled;
  const estDep = td.departure?.gate?.estimated;
  if (schedDep && estDep) {
    const diffMin = (new Date(estDep) - new Date(schedDep)) / 60000;
    if (diffMin >= 15) return 'delayed';
  }
  return 'scheduled';
}
