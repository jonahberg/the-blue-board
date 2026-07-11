// Maps provider status text + live-feed onGround into the flight state shown on
// My Flights cards. Delay is measured at the GATE (scheduled vs estimated), never
// the runway/takeoff times — the field choice that drove the delay-at-runway incident.
export function resolveFlightStatus(td, liveFlight) {
  if (!td || td.success === false) return '';
  if (td.cancelled) return 'cancelled';
  if (td.diverted) return 'diverted';
  const st = (td.status || '').toLowerCase();
  if (st.includes('land') || st.includes('arrived')) return 'landed';
  if (st.includes('en-route') || st.includes('en route') || st.includes('airborne') ||
      st.includes('in air') || st.includes('active') || st.includes('in flight')) return 'en-route';
  if (st.includes('depart') || st.includes('taxiing')) return 'departed';
  if (st.includes('delay')) return 'delayed';
  // Cross-reference with live FR24 feed data
  if (liveFlight && !liveFlight.onGround) return 'en-route';
  if (liveFlight && liveFlight.onGround) {
    const hasActualDep = td.departure?.takeoff?.actual || td.departure?.gate?.actual;
    if (hasActualDep) return 'landed';
  }
  // Detect delay from time comparison (estimated vs scheduled gate departure)
  const schedDep = td.departure?.gate?.scheduled;
  const estDep = td.departure?.gate?.estimated;
  if (schedDep && estDep) {
    const diffMin = (new Date(estDep) - new Date(schedDep)) / 60000;
    if (diffMin >= 15) return 'delayed';
  }
  return 'scheduled';
}
