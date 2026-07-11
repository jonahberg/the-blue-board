// The schedule board's row-filter predicate, pulled out of getFilteredScheduleFlights
// so its time-range buckets, domestic/intl classification, and delay-risk-band gating
// are testable in isolation. Filter strings arrive as a plain object (read off the DOM
// by the caller); the classifiers/lookups it needs arrive via ctx so this stays pure.
export function matchesScheduleFilters(fl, filterValues, ctx) {
  const {
    statusFilter, aircraftFilter, fleetFamilyFilter, routeTypeFilter,
    starlinkFilter, timeRangeFilter, riskFilter, searchFilter,
  } = filterValues;

  // Status filter. canceled_uncertain ("Likely Canceled") groups under the
  // Canceled filter per the dq-jul3 contract — it is a cancellation for
  // filtering purposes, just an unconfirmed one.
  if (statusFilter) {
    const s = ctx.classify(fl);
    const filterKey = s.key === 'canceled_uncertain' ? 'canceled' : s.key;
    if (filterKey !== statusFilter) return false;
  }
  // Aircraft filter
  if (aircraftFilter && fl.aircraft?.model?.code !== aircraftFilter) return false;
  // Fleet family filter
  if (fleetFamilyFilter) {
    const family = ctx.fleetFamily(fl.aircraft?.model?.code, fl.aircraft?.model?.text);
    if (family !== fleetFamilyFilter) return false;
  }
  // Route type filter (domestic / international)
  if (routeTypeFilter) {
    const endpoint = ctx.dir === 'departures'
      ? fl.airport?.destination?.code?.iata
      : fl.airport?.origin?.code?.iata;
    const isIntl = endpoint && ctx.intlAirports.has(endpoint);
    if (routeTypeFilter === 'domestic' && isIntl) return false;
    if (routeTypeFilter === 'international' && !isIntl) return false;
  }
  // Starlink filter (schedRegFor: backfilled tails must match the filter their ⚡ badge implies)
  if (starlinkFilter) {
    const reg = ctx.regFor(fl);
    const hasSL = reg && ctx.starlinkTails.has(reg);
    if (starlinkFilter === 'starlink' && !hasSL) return false;
    if (starlinkFilter === 'no-starlink' && hasSL) return false;
  }
  // Time range filter
  if (timeRangeFilter) {
    const ts = ctx.dir === 'departures'
      ? fl.time?.scheduled?.departure
      : fl.time?.scheduled?.arrival;
    if (ts) {
      const h = parseInt(new Date(ts * 1000).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: ctx.hubTz }));
      if (timeRangeFilter === 'morning' && !(h >= 5 && h < 12)) return false;
      if (timeRangeFilter === 'afternoon' && !(h >= 12 && h < 17)) return false;
      if (timeRangeFilter === 'evening' && !(h >= 17 && h < 22)) return false;
      if (timeRangeFilter === 'redeye' && !(h >= 22 || h < 5)) return false;
    }
  }
  // Delay risk filter
  if (riskFilter) {
    const status = ctx.classify(fl);
    if (['scheduled', 'estimated', 'delayed'].includes(status.key)) {
      const risk = ctx.computeRisk(fl);
      const riskLabel = risk ? risk.label : 'LOW';
      // F004: RISK_BANDS (src/lib/delay-risk.js) has two bands at/above the "high" threshold —
      // HIGH and V.HIGH — so the "High Delay" filter must accept both, not just HIGH.
      if (riskFilter === 'high' && riskLabel !== 'HIGH' && riskLabel !== 'V.HIGH') return false;
      if (riskFilter === 'moderate' && riskLabel === 'LOW') return false;
      if (riskFilter === 'low' && riskLabel !== 'LOW') return false;
    } else if (riskFilter === 'high' || riskFilter === 'moderate') {
      return false;
    }
  }
  // Search filter
  if (searchFilter) {
    const flNum = fl.identification?.number?.default?.toLowerCase() || '';
    const callsign = fl.identification?.callsign?.toLowerCase() || '';
    const reg = ctx.regFor(fl).toLowerCase(); // incl. backfilled tails — searching a visible reg must hit
    const destName = (fl.airport?.destination?.name || '').toLowerCase();
    const destCode = (fl.airport?.destination?.code?.iata || '').toLowerCase();
    const origName = (fl.airport?.origin?.name || '').toLowerCase();
    const origCode = (fl.airport?.origin?.code?.iata || '').toLowerCase();
    const acType = (fl.aircraft?.model?.code || '').toLowerCase();
    const haystack = `${flNum} ${callsign} ${reg} ${destName} ${destCode} ${origName} ${origCode} ${acType}`;
    if (!haystack.includes(searchFilter)) return false;
  }
  return true;
}
