// ═══ AIRPORT TABLE (IATA → coordinates and city names) ═══
// The static airport reference the live map runs on: coordinates for route
// estimation, the hub-radius filter and the long-haul test, plus the city names the
// flight popup and My Flights cards read out.
//
// Extracted verbatim from src/dashboard/main.js (:218-293 AIRPORTS, :465-498
// IATA_CITIES, nearestAirport factored out of estimateRoute :961-971). The table is
// 142 rows — main.js's own "(150 airports)" comment was never trued up.
//
// The nine `hub: true` rows are United's hubs, in the order the dashboard derives
// HUBS/HUB_CODES from: EWR IAH ORD DEN SFO LAX IAD GUM NRT.

import { haversineNm } from './geo.js';

/** @typedef {{iata: string, lat: number, lon: number, hub?: boolean}} Airport */

/** @type {Airport[]} */
export const AIRPORTS = [
  // United Hubs
  {iata:"EWR",lat:40.6925,lon:-74.1687,hub:true},{iata:"IAH",lat:29.9844,lon:-95.3414,hub:true},
  {iata:"ORD",lat:41.9742,lon:-87.9073,hub:true},{iata:"DEN",lat:39.8561,lon:-104.6737,hub:true},
  {iata:"SFO",lat:37.6213,lon:-122.3790,hub:true},{iata:"LAX",lat:33.9425,lon:-118.4081,hub:true},
  {iata:"IAD",lat:38.9531,lon:-77.4565,hub:true},
  // Major US
  {iata:"ATL",lat:33.6407,lon:-84.4277},{iata:"DFW",lat:32.8998,lon:-97.0403},
  {iata:"JFK",lat:40.6413,lon:-73.7781},{iata:"LGA",lat:40.7769,lon:-73.8740},
  {iata:"SEA",lat:47.4502,lon:-122.3088},{iata:"BOS",lat:42.3656,lon:-71.0096},
  {iata:"PHX",lat:33.4373,lon:-112.0078},{iata:"MCO",lat:28.4312,lon:-81.3081},
  {iata:"CLT",lat:35.2140,lon:-80.9431},{iata:"MIA",lat:25.7959,lon:-80.2870},
  {iata:"FLL",lat:26.0742,lon:-80.1506},{iata:"MSP",lat:44.8848,lon:-93.2223},
  {iata:"DTW",lat:42.2162,lon:-83.3554},{iata:"PHL",lat:39.8744,lon:-75.2424},
  {iata:"SLC",lat:40.7899,lon:-111.9791},{iata:"SAN",lat:32.7338,lon:-117.1933},
  {iata:"TPA",lat:27.9755,lon:-82.5332},{iata:"PDX",lat:45.5898,lon:-122.5951},
  {iata:"BNA",lat:36.1263,lon:-86.6774},{iata:"STL",lat:38.7487,lon:-90.3700},
  {iata:"AUS",lat:30.1975,lon:-97.6664},{iata:"RDU",lat:35.8801,lon:-78.7880},
  {iata:"MCI",lat:39.2976,lon:-94.7139},{iata:"SMF",lat:38.6954,lon:-121.5908},
  {iata:"SJC",lat:37.3626,lon:-121.9290},{iata:"OAK",lat:37.7213,lon:-122.2208},
  {iata:"CLE",lat:41.4117,lon:-81.8498},{iata:"CMH",lat:39.9980,lon:-82.8919},
  {iata:"PIT",lat:40.4915,lon:-80.2329},{iata:"IND",lat:39.7173,lon:-86.2944},
  {iata:"MKE",lat:42.9472,lon:-87.8966},{iata:"RSW",lat:26.5362,lon:-81.7552},
  {iata:"JAX",lat:30.4941,lon:-81.6879},{iata:"BDL",lat:41.9389,lon:-72.6832},
  {iata:"ABQ",lat:35.0402,lon:-106.6090},{iata:"ONT",lat:34.0560,lon:-117.6012},
  {iata:"BUR",lat:34.2005,lon:-118.3585},{iata:"HNL",lat:21.3187,lon:-157.9225},
  {iata:"OGG",lat:20.8986,lon:-156.4305},{iata:"KOA",lat:19.7388,lon:-156.0456},
  {iata:"LIH",lat:21.9760,lon:-159.3390},{iata:"ANC",lat:61.1743,lon:-149.9962},
  {iata:"SNA",lat:33.6757,lon:-117.8682},{iata:"DAL",lat:32.8471,lon:-96.8518},
  {iata:"HOU",lat:29.6454,lon:-95.2789},{iata:"MDW",lat:41.7868,lon:-87.7522},
  {iata:"BWI",lat:39.1754,lon:-76.6683},{iata:"DCA",lat:38.8512,lon:-77.0402},
  {iata:"MSY",lat:29.9934,lon:-90.2580},{iata:"RNO",lat:39.4991,lon:-119.7681},
  {iata:"LAS",lat:36.0840,lon:-115.1537},{iata:"PBI",lat:26.6832,lon:-80.0956},
  {iata:"SAT",lat:29.5337,lon:-98.4698},{iata:"CHS",lat:32.8986,lon:-80.0405},
  {iata:"BOI",lat:43.5644,lon:-116.2228},{iata:"TUS",lat:32.1161,lon:-110.9410},
  {iata:"OMA",lat:41.3032,lon:-95.8941},{iata:"DSM",lat:41.5340,lon:-93.6631},
  {iata:"BUF",lat:42.9405,lon:-78.7322},{iata:"ROC",lat:43.1189,lon:-77.6724},
  {iata:"SYR",lat:43.1112,lon:-76.1063},{iata:"ALB",lat:42.7483,lon:-73.8017},
  {iata:"RIC",lat:37.5052,lon:-77.3197},{iata:"ORF",lat:36.8946,lon:-76.2012},
  {iata:"GSO",lat:36.0978,lon:-79.9373},{iata:"CVG",lat:39.0488,lon:-84.6678},
  {iata:"MEM",lat:35.0424,lon:-89.9767},{iata:"OKC",lat:35.3931,lon:-97.6007},
  {iata:"TUL",lat:36.1984,lon:-95.8881},{iata:"ELP",lat:31.8073,lon:-106.3778},
  {iata:"GEG",lat:47.6199,lon:-117.5338},{iata:"PSP",lat:33.8297,lon:-116.5067},
  {iata:"SBN",lat:41.7087,lon:-86.3173},{iata:"GRR",lat:42.8808,lon:-85.5228},
  {iata:"MSN",lat:43.1399,lon:-89.3375},{iata:"XNA",lat:36.2819,lon:-94.3068},
  {iata:"ICT",lat:37.6499,lon:-97.4331},{iata:"LIT",lat:34.7294,lon:-92.2243},
  // International
  {iata:"LHR",lat:51.4700,lon:-0.4543},{iata:"FRA",lat:50.0379,lon:8.5622},
  {iata:"CDG",lat:49.0097,lon:2.5479},{iata:"AMS",lat:52.3105,lon:4.7683},
  {iata:"MUC",lat:48.3538,lon:11.7861},{iata:"ZRH",lat:47.4647,lon:8.5492},
  {iata:"FCO",lat:41.8003,lon:12.2389},{iata:"MAD",lat:40.4983,lon:-3.5676},
  {iata:"BCN",lat:41.2974,lon:2.0833},{iata:"LIS",lat:38.7813,lon:-9.1359},
  {iata:"DUB",lat:53.4213,lon:-6.2701},{iata:"EDI",lat:55.9508,lon:-3.3615},
  {iata:"GUM",lat:13.4834,lon:144.7960,hub:true},{iata:"NRT",lat:35.7720,lon:140.3929,hub:true},{iata:"HND",lat:35.5494,lon:139.7798},
  {iata:"ICN",lat:37.4602,lon:126.4407},{iata:"PEK",lat:40.0799,lon:116.6031},
  {iata:"PVG",lat:31.1443,lon:121.8083},{iata:"HKG",lat:22.3080,lon:113.9185},
  {iata:"SIN",lat:1.3644,lon:103.9915},{iata:"BKK",lat:13.6900,lon:100.7501},
  {iata:"DEL",lat:28.5562,lon:77.1000},{iata:"BOM",lat:19.0896,lon:72.8656},
  {iata:"SYD",lat:-33.9399,lon:151.1753},{iata:"MEL",lat:-37.6690,lon:144.8410},
  {iata:"GRU",lat:-23.4356,lon:-46.4731},{iata:"EZE",lat:-34.8222,lon:-58.5358},
  {iata:"SCL",lat:-33.3930,lon:-70.7858},{iata:"BOG",lat:4.7016,lon:-74.1469},
  {iata:"MEX",lat:19.4363,lon:-99.0721},{iata:"CUN",lat:21.0365,lon:-86.8771},
  {iata:"GDL",lat:20.5218,lon:-103.3113},{iata:"SJD",lat:23.1518,lon:-109.7215},
  {iata:"PVR",lat:20.6801,lon:-105.2544},{iata:"LIM",lat:-12.0219,lon:-77.1143},
  {iata:"PTY",lat:9.0714,lon:-79.3835},{iata:"SJO",lat:9.9939,lon:-84.2088},
  {iata:"YYZ",lat:43.6777,lon:-79.6248},{iata:"YVR",lat:49.1967,lon:-123.1815},
  {iata:"YUL",lat:45.4706,lon:-73.7408},{iata:"YYC",lat:51.1315,lon:-114.0106},
  {iata:"TLV",lat:32.0114,lon:34.8867},{iata:"DOH",lat:25.2731,lon:51.6082},
  {iata:"DXB",lat:25.2532,lon:55.3657},{iata:"ADD",lat:8.9779,lon:38.7993},
  {iata:"ACC",lat:5.6052,lon:-0.1668},{iata:"CPT",lat:-33.9649,lon:18.6017},
  {iata:"JNB",lat:-26.1392,lon:28.2460},{iata:"CAI",lat:30.1219,lon:31.4056},
  {iata:"IST",lat:41.2753,lon:28.7519},{iata:"MNL",lat:14.5086,lon:121.0198},
  {iata:"TPE",lat:25.0777,lon:121.2327},{iata:"BRU",lat:50.9014,lon:4.4844},
  {iata:"OSL",lat:60.1976,lon:11.1004},{iata:"CPH",lat:55.6180,lon:12.6560},
  {iata:"ARN",lat:59.6519,lon:17.9186},{iata:"HEL",lat:60.3172,lon:24.9633}
];

/**
 * IATA code → airport row, for O(1) coordinate lookups.
 * @type {Record<string, Airport>}
 */
export const AIRPORT_COORDS = {};
AIRPORTS.forEach(a => { AIRPORT_COORDS[a.iata] = a; });

/** @type {Record<string, string>} */
export const IATA_CITIES = {
  // United Hubs
  EWR:'Newark',IAH:'Houston',ORD:'Chicago O\'Hare',DEN:'Denver',SFO:'San Francisco',LAX:'Los Angeles',IAD:'Washington Dulles',
  // Major US
  ATL:'Atlanta',DFW:'Dallas/Fort Worth',JFK:'New York JFK',LGA:'New York LaGuardia',SEA:'Seattle',BOS:'Boston',
  PHX:'Phoenix',MCO:'Orlando',CLT:'Charlotte',MIA:'Miami',FLL:'Fort Lauderdale',MSP:'Minneapolis',
  DTW:'Detroit',PHL:'Philadelphia',SLC:'Salt Lake City',SAN:'San Diego',TPA:'Tampa',PDX:'Portland',
  BNA:'Nashville',STL:'St. Louis',AUS:'Austin',RDU:'Raleigh-Durham',MCI:'Kansas City',SMF:'Sacramento',
  SJC:'San José',OAK:'Oakland',CLE:'Cleveland',CMH:'Columbus',PIT:'Pittsburgh',IND:'Indianapolis',
  MKE:'Milwaukee',RSW:'Fort Myers',JAX:'Jacksonville',BDL:'Hartford',ABQ:'Albuquerque',ONT:'Ontario',
  BUR:'Burbank',HNL:'Honolulu',OGG:'Maui Kahului',KOA:'Kona',LIH:'Kauai Lihue',ANC:'Anchorage',
  SNA:'Orange County',DAL:'Dallas Love',HOU:'Houston Hobby',MDW:'Chicago Midway',BWI:'Baltimore',
  DCA:'Washington Reagan',MSY:'New Orleans',RNO:'Reno',LAS:'Las Vegas',PBI:'West Palm Beach',
  SAT:'San Antonio',CHS:'Charleston',BOI:'Boise',TUS:'Tucson',OMA:'Omaha',DSM:'Des Moines',
  BUF:'Buffalo',ROC:'Rochester',SYR:'Syracuse',ALB:'Albany',RIC:'Richmond',ORF:'Norfolk',
  GSO:'Greensboro',CVG:'Cincinnati',MEM:'Memphis',OKC:'Oklahoma City',TUL:'Tulsa',ELP:'El Paso',
  GEG:'Spokane',PSP:'Palm Springs',SBN:'South Bend',GRR:'Grand Rapids',MSN:'Madison',XNA:'Fayetteville',
  ICT:'Wichita',LIT:'Little Rock',
  // Europe
  LHR:'London Heathrow',FRA:'Frankfurt',CDG:'Paris CDG',AMS:'Amsterdam',MUC:'Munich',ZRH:'Zurich',
  FCO:'Rome Fiumicino',MAD:'Madrid',BCN:'Barcelona',LIS:'Lisbon',DUB:'Dublin',EDI:'Edinburgh',
  BRU:'Brussels',OSL:'Oslo',CPH:'Copenhagen',ARN:'Stockholm',HEL:'Helsinki',IST:'Istanbul',
  // Asia-Pacific
  GUM:'Guam',NRT:'Tokyo Narita',HND:'Tokyo Haneda',ICN:'Seoul Incheon',PEK:'Beijing',PVG:'Shanghai Pudong',
  HKG:'Hong Kong',SIN:'Singapore',BKK:'Bangkok',DEL:'Delhi',BOM:'Mumbai',MNL:'Manila',TPE:'Taipei',
  SYD:'Sydney',MEL:'Melbourne',
  // Americas (International)
  GRU:'São Paulo',EZE:'Buenos Aires',SCL:'Santiago',BOG:'Bogotá',MEX:'Mexico City',CUN:'Cancún',
  GDL:'Guadalajara',SJD:'Los Cabos',PVR:'Puerto Vallarta',LIM:'Lima',PTY:'Panama City',SJO:'San José CR',
  YYZ:'Toronto',YVR:'Vancouver',YUL:'Montreal',YYC:'Calgary',
  // Middle East & Africa
  TLV:'Tel Aviv',DOH:'Doha',DXB:'Dubai',ADD:'Addis Ababa',ACC:'Accra',CPT:'Cape Town',
  JNB:'Johannesburg',CAI:'Cairo'
};

/**
 * Human city name for an IATA code.
 * @param {string|null|undefined} iata
 * @returns {string} the city name, or '' when unknown (callers branch on falsiness).
 */
export function cityFor(iata) {
  return IATA_CITIES[iata] || '';
}

/**
 * Nearest airport to a position, if it is within `maxNm` nautical miles.
 *
 * Used by route estimation: an aircraft below 5000 ft is almost certainly departing
 * from or arriving at whatever field it is sitting over.
 *
 * @param {number} lat @param {number} lon
 * @param {number} maxNm  radius in nautical miles (route estimation uses 50).
 * @returns {Airport|null} the closest airport inside the radius, else null.
 */
export function nearestAirport(lat, lon, maxNm) {
  let nearest = null, nearDist = Infinity;
  for (const apt of AIRPORTS) {
    const d = haversineNm(lat, lon, apt.lat, apt.lon);
    if (d < nearDist) { nearDist = d; nearest = apt; }
  }
  return nearest && nearDist < maxNm ? nearest : null;
}
