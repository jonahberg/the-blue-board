// ═══ ROUTE ESTIMATION ═══
// FR24 usually gives us a real origin/destination. When it doesn't, this reconstructs
// the city pair — first from a static table of United's published flight numbers, then
// geometrically from the aircraft's position and heading.
//
// Extracted verbatim from src/dashboard/main.js (:404-462 UA_ROUTES, :928-980
// estimateRoute); the low-altitude nearest-airport scan is now airports.nearestAirport().
//
// Known quirk, preserved: the table lookup strips a leading "UA" only, so a raw
// "UAL123" callsign leaves "L123", parseInt rejects it, and the flight falls through
// to bearing matching. The one caller passes `flightIATA || callsign`, so the common
// path ("UA123") does hit the table.

import { haversineNm, bearing, angleDiff } from './geo.js';
import { AIRPORTS, nearestAirport } from './airports.js';

// ═══ UA ROUTE LOOKUP TABLE ═══
// Static mapping of UA flight numbers to known city pairs (fallback for missing FR24 route data)
/** @type {Record<number, {from: string, to: string}>} */
export const UA_ROUTES = {
  1:{from:'SFO',to:'SIN'},2:{from:'SIN',to:'SFO'},3:{from:'SFO',to:'HKG'},4:{from:'HKG',to:'SFO'},
  5:{from:'SFO',to:'SYD'},6:{from:'SYD',to:'SFO'},7:{from:'SFO',to:'NRT'},8:{from:'NRT',to:'SFO'},
  9:{from:'EWR',to:'CDG'},10:{from:'CDG',to:'EWR'},11:{from:'EWR',to:'BRU'},12:{from:'BRU',to:'EWR'},
  17:{from:'EWR',to:'LHR'},18:{from:'LHR',to:'EWR'},21:{from:'EWR',to:'LIS'},22:{from:'LIS',to:'EWR'},
  23:{from:'SFO',to:'ICN'},24:{from:'ICN',to:'SFO'},25:{from:'EWR',to:'FRA'},26:{from:'FRA',to:'EWR'},
  27:{from:'EWR',to:'ZRH'},28:{from:'ZRH',to:'EWR'},29:{from:'EWR',to:'DUB'},30:{from:'DUB',to:'EWR'},
  31:{from:'EWR',to:'FCO'},32:{from:'FCO',to:'EWR'},33:{from:'EWR',to:'AMS'},34:{from:'AMS',to:'EWR'},
  35:{from:'SFO',to:'TPE'},36:{from:'TPE',to:'SFO'},37:{from:'EWR',to:'IST'},38:{from:'IST',to:'EWR'},
  39:{from:'EWR',to:'MAD'},40:{from:'MAD',to:'EWR'},41:{from:'EWR',to:'BCN'},42:{from:'BCN',to:'EWR'},
  43:{from:'SFO',to:'BKK'},44:{from:'BKK',to:'SFO'},45:{from:'IAH',to:'LHR'},46:{from:'LHR',to:'IAH'},
  50:{from:'EWR',to:'TLV'},51:{from:'TLV',to:'EWR'},52:{from:'IAD',to:'LHR'},53:{from:'LHR',to:'IAD'},
  54:{from:'SFO',to:'DEL'},55:{from:'DEL',to:'SFO'},56:{from:'EWR',to:'DEL'},57:{from:'DEL',to:'EWR'},
  58:{from:'EWR',to:'EDI'},59:{from:'EDI',to:'EWR'},60:{from:'EWR',to:'MUC'},61:{from:'MUC',to:'EWR'},
  62:{from:'EWR',to:'CPH'},63:{from:'CPH',to:'EWR'},64:{from:'EWR',to:'HEL'},65:{from:'HEL',to:'EWR'},
  66:{from:'EWR',to:'ARN'},67:{from:'ARN',to:'EWR'},68:{from:'EWR',to:'OSL'},69:{from:'OSL',to:'EWR'},
  70:{from:'IAD',to:'CDG'},71:{from:'CDG',to:'IAD'},72:{from:'IAD',to:'FRA'},73:{from:'FRA',to:'IAD'},
  78:{from:'ORD',to:'LHR'},79:{from:'LHR',to:'ORD'},80:{from:'ORD',to:'FRA'},81:{from:'FRA',to:'ORD'},
  82:{from:'ORD',to:'CDG'},83:{from:'CDG',to:'ORD'},84:{from:'ORD',to:'MUC'},85:{from:'MUC',to:'ORD'},
  86:{from:'ORD',to:'NRT'},87:{from:'NRT',to:'ORD'},88:{from:'ORD',to:'PEK'},89:{from:'PEK',to:'ORD'},
  90:{from:'ORD',to:'ICN'},91:{from:'ICN',to:'ORD'},92:{from:'ORD',to:'HND'},93:{from:'HND',to:'ORD'},
  94:{from:'ORD',to:'DEL'},95:{from:'DEL',to:'ORD'},96:{from:'SFO',to:'PVG'},97:{from:'PVG',to:'SFO'},
  100:{from:'EWR',to:'PEK'},101:{from:'PEK',to:'EWR'},102:{from:'EWR',to:'PVG'},103:{from:'PVG',to:'EWR'},
  106:{from:'EWR',to:'HND'},107:{from:'HND',to:'EWR'},108:{from:'EWR',to:'NRT'},109:{from:'NRT',to:'EWR'},
  116:{from:'SFO',to:'MNL'},117:{from:'MNL',to:'SFO'},118:{from:'IAH',to:'NRT'},119:{from:'NRT',to:'IAH'},
  120:{from:'LAX',to:'SYD'},121:{from:'SYD',to:'LAX'},122:{from:'LAX',to:'MEL'},123:{from:'MEL',to:'LAX'},
  130:{from:'IAD',to:'TLV'},131:{from:'TLV',to:'IAD'},132:{from:'IAH',to:'EZE'},133:{from:'EZE',to:'IAH'},
  134:{from:'IAH',to:'GRU'},135:{from:'GRU',to:'IAH'},136:{from:'EWR',to:'GRU'},137:{from:'GRU',to:'EWR'},
  138:{from:'IAH',to:'SCL'},139:{from:'SCL',to:'IAH'},142:{from:'IAH',to:'BOG'},143:{from:'BOG',to:'IAH'},
  146:{from:'IAH',to:'LIM'},147:{from:'LIM',to:'IAH'},148:{from:'EWR',to:'BOG'},149:{from:'BOG',to:'EWR'},
  150:{from:'DEN',to:'NRT'},151:{from:'NRT',to:'DEN'},152:{from:'LAX',to:'NRT'},153:{from:'NRT',to:'LAX'},
  154:{from:'LAX',to:'ICN'},155:{from:'ICN',to:'LAX'},156:{from:'LAX',to:'PVG'},157:{from:'PVG',to:'LAX'},
  160:{from:'SFO',to:'LHR'},161:{from:'LHR',to:'SFO'},162:{from:'IAH',to:'FRA'},163:{from:'FRA',to:'IAH'},
  168:{from:'EWR',to:'SIN'},169:{from:'SIN',to:'EWR'},170:{from:'SFO',to:'FRA'},171:{from:'FRA',to:'SFO'},
  174:{from:'EWR',to:'HKG'},175:{from:'HKG',to:'EWR'},176:{from:'EWR',to:'BOM'},177:{from:'BOM',to:'EWR'},
  178:{from:'DEN',to:'LHR'},179:{from:'LHR',to:'DEN'},180:{from:'DEN',to:'FRA'},181:{from:'FRA',to:'DEN'},
  182:{from:'IAH',to:'MEX'},183:{from:'MEX',to:'IAH'},186:{from:'ORD',to:'DUB'},187:{from:'DUB',to:'ORD'},
  194:{from:'LAX',to:'LHR'},195:{from:'LHR',to:'LAX'},198:{from:'IAH',to:'CUN'},199:{from:'CUN',to:'IAH'},
  200:{from:'SFO',to:'GRU'},201:{from:'GRU',to:'SFO'},204:{from:'IAH',to:'PTY'},205:{from:'PTY',to:'IAH'},
  214:{from:'IAD',to:'IST'},215:{from:'IST',to:'IAD'},218:{from:'DEN',to:'NRT'},219:{from:'NRT',to:'DEN'},
  234:{from:'ORD',to:'AMS'},235:{from:'AMS',to:'ORD'},238:{from:'ORD',to:'IST'},239:{from:'IST',to:'ORD'},
  250:{from:'ORD',to:'BCN'},251:{from:'BCN',to:'ORD'},252:{from:'ORD',to:'ZRH'},253:{from:'ZRH',to:'ORD'},
  254:{from:'ORD',to:'FCO'},255:{from:'FCO',to:'ORD'},262:{from:'ORD',to:'EDI'},263:{from:'EDI',to:'ORD'},
  315:{from:'DEN',to:'HND'},316:{from:'HND',to:'DEN'},400:{from:'DEN',to:'SFO'},401:{from:'SFO',to:'DEN'},
  444:{from:'EWR',to:'LAX'},445:{from:'LAX',to:'EWR'},500:{from:'SFO',to:'EWR'},501:{from:'EWR',to:'SFO'},
  507:{from:'LAX',to:'HNL'},508:{from:'HNL',to:'LAX'},509:{from:'SFO',to:'HNL'},510:{from:'HNL',to:'SFO'},
  708:{from:'ORD',to:'DOH'},709:{from:'DOH',to:'ORD'},730:{from:'IAD',to:'ADD'},731:{from:'ADD',to:'IAD'},
  733:{from:'IAD',to:'ACC'},734:{from:'ACC',to:'IAD'},735:{from:'IAD',to:'JNB'},736:{from:'JNB',to:'IAD'},
  737:{from:'EWR',to:'CPT'},738:{from:'CPT',to:'EWR'},780:{from:'EWR',to:'DOH'},781:{from:'DOH',to:'EWR'},
  788:{from:'EWR',to:'DXB'},789:{from:'DXB',to:'EWR'},838:{from:'SFO',to:'ICN'},839:{from:'ICN',to:'SFO'},
  857:{from:'SFO',to:'PEK'},858:{from:'PEK',to:'SFO'},872:{from:'SFO',to:'HND'},873:{from:'HND',to:'SFO'},
  875:{from:'SFO',to:'NRT'},876:{from:'NRT',to:'SFO'},881:{from:'LAX',to:'HND'},882:{from:'HND',to:'LAX'},
  893:{from:'IAH',to:'SYD'},894:{from:'SYD',to:'IAH'},896:{from:'SFO',to:'MEL'},897:{from:'MEL',to:'SFO'},
  1100:{from:'EWR',to:'SFO'},1101:{from:'SFO',to:'EWR'},1200:{from:'SFO',to:'ORD'},1201:{from:'ORD',to:'SFO'},
  1300:{from:'DEN',to:'EWR'},1301:{from:'EWR',to:'DEN'},1400:{from:'IAH',to:'SFO'},1401:{from:'SFO',to:'IAH'},
  1500:{from:'DEN',to:'LAX'},1501:{from:'LAX',to:'DEN'},1600:{from:'ORD',to:'LAX'},1601:{from:'LAX',to:'ORD'},
  1700:{from:'DEN',to:'ORD'},1701:{from:'ORD',to:'DEN'},1800:{from:'IAH',to:'EWR'},1801:{from:'EWR',to:'IAH'},
  1900:{from:'IAD',to:'LAX'},1901:{from:'LAX',to:'IAD'},2000:{from:'IAD',to:'SFO'},2001:{from:'SFO',to:'IAD'}
};

/**
 * Estimate a flight's origin and destination.
 *
 * Strategy, in order:
 *  1. Static UA_ROUTES lookup on the flight number.
 *  2. Bearing matching — the nearest airport behind the aircraft is the origin, the
 *     nearest one ahead is the destination, inside a 60° cone (90° below 5000 ft,
 *     where headings swing on departure/approach) and 2000 nm.
 *  3. Below 5000 ft, whatever field the aircraft is within 50 nm of becomes the
 *     origin when climbing and the destination when descending.
 *
 * @param {number|null|undefined} lat  latitude (a falsy value is treated as missing).
 * @param {number|null|undefined} lon  longitude (likewise).
 * @param {number|null|undefined} hdg  track in compass degrees.
 * @param {number|null|undefined} altFt  altitude in FEET (the caller converts).
 * @param {number|null|undefined} vr  vertical rate; only its sign is used.
 * @param {string|number|null|undefined} flightNum  e.g. "UA123".
 * @returns {{origin: import('./airports.js').Airport|null, dest: import('./airports.js').Airport|null}}
 */
export function estimateRoute(lat, lon, hdg, altFt, vr, flightNum) {
  // Try static UA route lookup first
  if (flightNum) {
    const num = parseInt(String(flightNum).replace(/^UA/i, '').replace(/^UAL/i, ''), 10);
    if (num && UA_ROUTES[num]) {
      const r = UA_ROUTES[num];
      const oApt = AIRPORTS.find(a => a.iata === r.from);
      const dApt = AIRPORTS.find(a => a.iata === r.to);
      if (oApt && dApt) return { origin: oApt, dest: dApt };
    }
  }
  if (!lat || !lon || hdg === null || hdg === undefined) return { origin: null, dest: null };
  const reverseHdg = (hdg + 180) % 360;
  let bestOrigin = null, bestDest = null;
  let bestOrigDist = Infinity, bestDestDist = Infinity;
  const lowAlt = altFt !== null && altFt < 5000;
  const tolerance = lowAlt ? 90 : 60;

  for (const apt of AIRPORTS) {
    const dist = haversineNm(lat, lon, apt.lat, apt.lon);
    const brng = bearing(lat, lon, apt.lat, apt.lon);

    // Behind aircraft = origin
    if (angleDiff(brng, reverseHdg) < tolerance && dist < bestOrigDist && dist < 2000) {
      bestOrigDist = dist; bestOrigin = apt;
    }
    // Ahead = destination
    if (angleDiff(brng, hdg) < tolerance && dist < bestDestDist && dist < 2000) {
      bestDestDist = dist; bestDest = apt;
    }
  }

  // For low altitude, nearest airport is likely origin or dest
  if (lowAlt) {
    const nearest = nearestAirport(lat, lon, 50);
    if (nearest) {
      if (vr > 0) bestOrigin = nearest;
      else bestDest = nearest;
    }
  }

  // Don't let origin = dest
  if (bestOrigin && bestDest && bestOrigin.iata === bestDest.iata) {
    if (bestOrigDist < bestDestDist) bestDest = null;
    else bestOrigin = null;
  }

  return { origin: bestOrigin, dest: bestDest };
}
