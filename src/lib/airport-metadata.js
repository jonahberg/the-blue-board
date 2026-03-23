export const INTL_AIRPORTS = new Set([
  'NRT','GUM','HND','LHR','FRA','CDG','AMS','ZRH','FCO','MAD','BCN','DUB','IST','TLV','MUC','EDI','BRU','LIS','CPH',
  'ARN','HEL','OSL','SIN','HKG','SYD','PEK','ICN','TPE','BKK','DEL','MEL','AKL','PVG','CAN','BOM','NAN','PPT',
  'KIX','CTU','XIY','CKG','SNN','MAN','GLA'
]);

export const US_AIRPORTS = new Set([
  'ORD','DEN','EWR','IAH','SFO','LAX','IAD','GUM',
  'ATL','JFK','LGA','DFW','CLT','MIA','FLL','TPA','MCO','SEA','MSP','DTW','PHL','BOS',
  'DCA','BWI','SAN','PHX','SLC','AUS','SAT','HOU','DAL','MDW','OAK','SJC','SMF','PDX',
  'MCI','MSY','STL','IND','CLE','CVG','CMH','PIT','RDU','BNA','MKE','OMA','RSW',
  'HNL','OGG','LIH','KOA'
]);

export const ICAO_TO_IATA_OVERRIDES = Object.freeze({
  RJAA: 'NRT',
  RJTT: 'HND',
  PGUM: 'GUM',
  EGLL: 'LHR',
  LFPG: 'CDG',
  EDDF: 'FRA',
  RCKH: 'KHH',
  VHHH: 'HKG',
  WSSS: 'SIN',
  NZAA: 'AKL',
  YSSY: 'SYD',
  LEMD: 'MAD',
  EHAM: 'AMS',
  OMDB: 'DXB',
  ZBAA: 'PEK',
  RCTP: 'TPE',
  RJBB: 'KIX',
  RKSI: 'ICN',
  VTBS: 'BKK',
  WMKK: 'KUL',
  CYYZ: 'YYZ',
  CYUL: 'YUL',
  CYVR: 'YVR',
  MMMX: 'MEX',
  MMUN: 'CUN',
  TNCM: 'SXM',
  TXKF: 'BDA',
  MUHA: 'HAV',
  LIRF: 'FCO',
  EGKK: 'LGW',
  EIDW: 'DUB',
  LSZH: 'ZRH',
  LOWW: 'VIE',
  EKCH: 'CPH',
  ENGM: 'OSL',
  ESSA: 'ARN',
  EFHK: 'HEL',
  LPPT: 'LIS',
  LEBL: 'BCN',
  LGAV: 'ATH',
  LTFM: 'IST',
  VIDP: 'DEL',
  VABB: 'BOM',
  RPLL: 'MNL',
  ZUUU: 'CTU',
  ZSPD: 'PVG',
  ZSSS: 'SHA',
  VVNB: 'HAN',
  VVTS: 'SGN',
});

export const IATA_TO_ICAO_OVERRIDES = Object.freeze(
  Object.fromEntries(Object.entries(ICAO_TO_IATA_OVERRIDES).map(([icao, iata]) => [iata, icao]))
);

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function icaoToIata(icao) {
  const code = normalizeCode(icao);
  if (!code) return '';
  if (code.length === 4 && code.startsWith('K')) return code.slice(1);
  return ICAO_TO_IATA_OVERRIDES[code] || code;
}

export function isInternationalRoute(origIata, destIata) {
  const orig = normalizeCode(origIata);
  const dest = normalizeCode(destIata);
  if (!orig || !dest) return false;
  return !(US_AIRPORTS.has(orig) && US_AIRPORTS.has(dest));
}

export function getMetarStationForIata(iata) {
  const code = normalizeCode(iata);
  if (!code || code.length !== 3) return '';
  if (IATA_TO_ICAO_OVERRIDES[code]) return IATA_TO_ICAO_OVERRIDES[code];
  if (US_AIRPORTS.has(code)) return `K${code}`;
  return '';
}
