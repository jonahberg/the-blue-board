import { describe, it, expect } from 'vitest';
import {
  HUB_STATIONS,
  WX_HUBS,
  HUB_NAMES,
  NEUTRAL_MARKER_COLOR,
  UNKNOWN_CAT_COLOR,
  WX_LEGEND,
  routeAirports,
  legacyWatchedRoutes,
  collectMetarStations,
  indexMetarByKey,
  weatherOpsEntry,
  resolveWeather,
  buildHubCardModel,
  assignJargonFirsts,
  faaAlertLines,
  radarTitle,
} from '../src/lib/weather-cards.js';
import { CAT_COLORS } from '../src/lib/metar-explain.js';
import { getMetarStationForIata } from '../src/lib/airport-metadata.js';

const VFR = 'KDEN 121953Z 18008KT 10SM FEW200 24/M01 A2992 RMK AO2';
const IFR_TS = 'KORD 121951Z 09015G32KT 2SM TSRA BKN008 OVC015 18/17 A2975 RMK AO2';

describe('the hub → station map is the shipped one (inventory §23)', () => {
  it('has the nine hubs in card order with their ICAO stations', () => {
    expect(HUB_STATIONS).toEqual({
      EWR: 'KEWR', IAH: 'KIAH', ORD: 'KORD', DEN: 'KDEN', SFO: 'KSFO',
      LAX: 'KLAX', IAD: 'KIAD', NRT: 'RJAA', GUM: 'PGUM',
    });
    expect(WX_HUBS).toEqual(['EWR', 'IAH', 'ORD', 'DEN', 'SFO', 'LAX', 'IAD', 'NRT', 'GUM']);
  });

  it('names every hub', () => {
    for (const hub of WX_HUBS) expect(HUB_NAMES[hub]).toBeTruthy();
  });

  it('the legend is the four AIM categories in the shipped colours', () => {
    expect(WX_LEGEND.map((e) => e.cat)).toEqual(['VFR', 'MVFR', 'IFR', 'LIFR']);
    expect(WX_LEGEND.map((e) => e.color)).toEqual([
      CAT_COLORS.VFR, CAT_COLORS.MVFR, CAT_COLORS.IFR, CAT_COLORS.LIFR,
    ]);
    expect(NEUTRAL_MARKER_COLOR).toBe('#334155');
    expect(UNKNOWN_CAT_COLOR).toBe('#64748b');
  });
});

describe('routeAirports', () => {
  it('splits the stored U+2192 route', () => {
    expect(routeAirports('ORD→DEN')).toEqual(['ORD', 'DEN']);
    expect(routeAirports('ord → den')).toEqual(['ORD', 'DEN']);
  });

  it('ignores anything that is not a 3-letter code', () => {
    expect(routeAirports('')).toEqual([]);
    expect(routeAirports(null)).toEqual([]);
    expect(routeAirports('UA123')).toEqual([]);
  });
});

describe('collectMetarStations', () => {
  const getStation = (iata) => getMetarStationForIata(iata);

  it('puts the nine hub stations first, in hub order', () => {
    const { stations } = collectMetarStations({ getStation });
    expect(stations.slice(0, 9)).toEqual(Object.values(HUB_STATIONS));
  });

  it('maps every hub station back to its hub code', () => {
    const { stationToKey } = collectMetarStations({ getStation });
    expect(stationToKey.KORD).toBe('ORD');
    expect(stationToKey.RJAA).toBe('NRT');
    expect(stationToKey.PGUM).toBe('GUM');
  });

  it('adds non-hub airports from watched routes and board rows, deduped', () => {
    const { stations, stationToKey } = collectMetarStations({
      routes: ['ORD→MSY', 'MSY→AUS'],
      rows: [
        { airport: { origin: { code: { iata: 'AUS' } }, destination: { code: { iata: 'BOS' } } } },
        { airport: { origin: { code: { iata: 'BOS' } }, destination: { code: { iata: 'ORD' } } } },
      ],
      getStation,
    });
    expect(stations.slice(9)).toEqual(['KMSY', 'KAUS', 'KBOS']);
    expect(stationToKey.KMSY).toBe('MSY');
    expect(stationToKey.KBOS).toBe('BOS');
    // A hub named in a route never becomes an "extra".
    expect(stations.filter((s) => s === 'KORD')).toHaveLength(1);
  });

  it('skips codes with no known station rather than guessing one', () => {
    const { stations } = collectMetarStations({ routes: ['ORD→ZZZ'], getStation });
    expect(stations).toHaveLength(9);
  });

  it('tolerates missing routes, rows and malformed entries', () => {
    const { stations } = collectMetarStations({ rows: [null, {}, { airport: {} }], getStation });
    expect(stations).toHaveLength(9);
  });
});

describe('legacyWatchedRoutes (pre-bb_watched_flights key, inventory §29)', () => {
  it('returns the route string of every entry that has one', () => {
    const raw = JSON.stringify([
      { flight: 'UA1', route: 'ORD\u2192MSY' },
      { flight: 'UA2', route: 'MSY\u2192AUS' },
    ]);
    expect(legacyWatchedRoutes(raw)).toEqual(['ORD\u2192MSY', 'MSY\u2192AUS']);
  });

  it('drops entries with no usable route and keeps the rest', () => {
    const raw = JSON.stringify([
      { flight: 'UA1' },
      null,
      'UA2',
      { flight: 'UA3', route: '' },
      { flight: 'UA4', route: 'DEN\u2192BOS' },
    ]);
    expect(legacyWatchedRoutes(raw)).toEqual(['DEN\u2192BOS']);
  });

  it('yields nothing for an absent, malformed or non-array value', () => {
    expect(legacyWatchedRoutes(null)).toEqual([]);
    expect(legacyWatchedRoutes(undefined)).toEqual([]);
    expect(legacyWatchedRoutes('')).toEqual([]);
    expect(legacyWatchedRoutes('{not json')).toEqual([]);
    expect(legacyWatchedRoutes('{"flight":"UA1"}')).toEqual([]);
    expect(legacyWatchedRoutes('null')).toEqual([]);
  });

  it('feeds collectMetarStations, so a legacy-only route still gets its station', () => {
    const raw = JSON.stringify([{ flight: 'UA1', route: 'ORD\u2192MSY' }]);
    const { stations, stationToKey } = collectMetarStations({
      routes: legacyWatchedRoutes(raw),
      getStation: (iata) => getMetarStationForIata(iata),
    });
    expect(stations.slice(9)).toEqual(['KMSY']);
    expect(stationToKey.KMSY).toBe('MSY');
  });
});

describe('indexMetarByKey', () => {
  const stationToKey = { KORD: 'ORD', KMSY: 'MSY' };

  it('keys records by the hub or non-hub code their station stands for', () => {
    const byKey = indexMetarByKey(
      [{ icaoId: 'KORD', rawOb: IFR_TS }, { stationId: 'KMSY', rawOb: VFR }],
      stationToKey,
    );
    expect(Object.keys(byKey).sort()).toEqual(['MSY', 'ORD']);
  });

  it('drops stations nobody asked for, and survives a null payload', () => {
    expect(indexMetarByKey([{ icaoId: 'KJFK' }], stationToKey)).toEqual({});
    expect(indexMetarByKey(null, stationToKey)).toEqual({});
    expect(indexMetarByKey([null, undefined], stationToKey)).toEqual({});
  });
});

describe('resolveWeather / weatherOpsEntry', () => {
  it('takes the worse of the API category and the locally computed one', () => {
    // API says VFR; the raw observation is 2SM in thunderstorms → IFR wins.
    const { cat } = resolveWeather({ fltCat: 'VFR', rawOb: IFR_TS });
    expect(cat).toBe('IFR');
  });

  it('borders with the ops colour when conditions are worse than normal', () => {
    const bad = resolveWeather({ fltCat: 'IFR', rawOb: IFR_TS });
    expect(bad.ops.level).not.toBe('normal');
    expect(bad.borderColor).toBe(bad.ops.color);

    const good = resolveWeather({ fltCat: 'VFR', rawOb: VFR });
    expect(good.ops.level).toBe('normal');
    expect(good.borderColor).toBe(CAT_COLORS.VFR);
  });

  it('falls back to UNK with no observation at all', () => {
    const none = resolveWeather(null);
    expect(none.cat).toBe('UNK');
    expect(none.catColor).toBe(UNKNOWN_CAT_COLOR);
  });

  it('weatherOpsEntry carries every field src/lib/delay-risk.js reads by name', () => {
    const entry = weatherOpsEntry(resolveWeather({ rawOb: IFR_TS }).ops, 'IFR');
    for (const field of [
      'level', 'reasons', 'fltCat', 'hasThunderstorms', 'hasFreezingPrecip',
      'hasSnow', 'hasFog', 'gustKt', 'tempC',
    ]) {
      expect(entry, field).toHaveProperty(field);
    }
    expect(entry.hasThunderstorms).toBe(true);
    expect(entry.gustKt).toBe(32);
    expect(entry.fltCat).toBe('IFR');
  });

  it('never reports gustKt undefined or tempC undefined', () => {
    const entry = weatherOpsEntry(resolveWeather(null).ops, 'UNK');
    expect(entry.gustKt).toBe(0);
    expect(entry.tempC).toBeNull();
  });
});

describe('buildHubCardModel status precedence (inventory §23)', () => {
  it('FAA programs outrank every weather level', () => {
    const model = buildHubCardModel({
      hub: 'ORD',
      metar: { fltCat: 'LIFR', rawOb: IFR_TS },
      faa: {
        delays: [{ type: 'ground_stop' }],
        programs: [{ type: 'ground_stop', endTime: '23:00Z', probabilityOfExtension: '40%' }],
      },
    });
    expect(model.status.tone).toBe('delay');
    expect(model.status.parts[0].label).toBe('Ground stop');
    expect(model.status.parts[0].extras).toEqual(['until 23:00Z', 'ext: 40%']);
  });

  it('falls back to the raw delays[] when the airport reports no programs', () => {
    const model = buildHubCardModel({
      hub: 'EWR',
      metar: { fltCat: 'VFR', rawOb: VFR },
      faa: { delays: [{ reason: 'VOLUME' }, { type: 'DEPARTURE' }] },
    });
    expect(model.status.parts.map((p) => p.text)).toEqual(['VOLUME', 'DEPARTURE']);
  });

  it('severe / warning / caution / normal, in that order, when the FAA is quiet', () => {
    const severe = buildHubCardModel({ hub: 'SFO', metar: { fltCat: 'LIFR', rawOb: 'KSFO 1SM FG OVC002 10/10' } });
    expect(severe.status.parts[0].text).toMatch(/^Severe Weather Impact — /);

    const warning = buildHubCardModel({ hub: 'ORD', metar: { fltCat: 'IFR', rawOb: IFR_TS } });
    expect(warning.status.parts[0].text).toMatch(/^Weather Advisory — /);

    const caution = buildHubCardModel({ hub: 'DEN', metar: { fltCat: 'MVFR', rawOb: 'KDEN 121953Z 18008KT 4SM BR BKN020 10/08 A2992' } });
    expect(caution.status.tone).toBe('caution');
    expect(caution.status.parts[0].text).toMatch(/^Weather Caution — /);

    const normal = buildHubCardModel({ hub: 'IAD', metar: { fltCat: 'VFR', rawOb: VFR } });
    expect(normal.status.tone).toBe('normal');
    expect(normal.status.prefix).toBe('✓');
    expect(normal.status.parts[0].text).toBe('Normal Operations');
  });
});

describe('buildHubCardModel presentation data', () => {
  it('renders the runway line only when there is an arrival rate', () => {
    const withRate = buildHubCardModel({
      hub: 'ORD',
      faa: { runwayConfig: { arrivalRunways: '10C/10L', departureRunways: '22L', arrivalRate: 96 } },
    });
    expect(withRate.runway).toBe('RWY: 10C/10L/22L · 96/hr');

    const noRate = buildHubCardModel({ hub: 'ORD', faa: { runwayConfig: { arrivalRate: 0 } } });
    expect(noRate.runway).toBe('');
    expect(buildHubCardModel({ hub: 'ORD' }).runway).toBe('');
  });

  it('flags de-icing, collects advisory URLs and keeps the NOTAM', () => {
    const model = buildHubCardModel({
      hub: 'DEN',
      faa: {
        deicing: true,
        notam: 'RWY 16R/34L CLSD',
        programs: [{ type: 'ground_delay', advisoryUrl: 'https://example.test/a' }, { type: 'closure' }],
      },
    });
    expect(model.deice).toBe(true);
    expect(model.advisoryUrls).toEqual(['https://example.test/a']);
    expect(model.notam).toBe('RWY 16R/34L CLSD');
  });

  it('marks a hub with no renderable observation unavailable', () => {
    expect(buildHubCardModel({ hub: 'GUM' }).unavailable).toBe(true);
    expect(buildHubCardModel({ hub: 'GUM', metar: { rawOb: VFR } }).unavailable).toBe(false);
  });

  it('has no detail section when there is nothing to put in it', () => {
    expect(buildHubCardModel({ hub: 'GUM' }).hasDetail).toBe(false);
    expect(buildHubCardModel({ hub: 'GUM', metar: { rawOb: VFR } }).hasDetail).toBe(true);
  });

  it('the marker label carries the category and the leading ops reason', () => {
    expect(buildHubCardModel({ hub: 'ORD', metar: { fltCat: 'IFR', rawOb: IFR_TS } }).markerLabel)
      .toMatch(/^IFR \(/);
    expect(buildHubCardModel({ hub: 'IAD', metar: { fltCat: 'VFR', rawOb: VFR } }).markerLabel)
      .toBe('VFR');
  });

  it('fills the four metrics from the raw observation', () => {
    const { metrics } = buildHubCardModel({ hub: 'DEN', metar: { fltCat: 'VFR', rawOb: VFR } });
    expect(metrics.wind).toBe('180° @ 08kt');
    expect(metrics.vis).toBe('10 SM');
    expect(metrics.clouds).toBe('Few 20000ft');
    expect(metrics.temp).toContain('24°C');
  });
});

describe('assignJargonFirsts gates each tooltip to one card (inventory §17)', () => {
  it('only the first card with an observation carries the METAR tooltip', () => {
    const models = assignJargonFirsts([
      buildHubCardModel({ hub: 'EWR' }),
      buildHubCardModel({ hub: 'IAH', metar: { rawOb: VFR } }),
      buildHubCardModel({ hub: 'ORD', metar: { rawOb: IFR_TS } }),
    ]);
    expect(models.map((m) => m.jargon.metar)).toEqual([false, true, false]);
  });

  it('GDP and Ground Stop each fire once across the whole panel', () => {
    const gdp = { delays: [{ type: 'ground_delay' }], programs: [{ type: 'ground_delay', avgDelay: 30 }] };
    const gs = { delays: [{ type: 'ground_stop' }], programs: [{ type: 'ground_stop' }] };
    const models = assignJargonFirsts([
      buildHubCardModel({ hub: 'EWR', faa: gdp }),
      buildHubCardModel({ hub: 'IAH', faa: gdp }),
      buildHubCardModel({ hub: 'ORD', faa: gs }),
      buildHubCardModel({ hub: 'DEN', faa: gs }),
    ]);
    expect(models.map((m) => m.status.parts[0].jargon)).toEqual(['gdp', null, 'groundstop', null]);
  });

  it('is pure — the same input always produces the same gating', () => {
    const build = () => [
      buildHubCardModel({ hub: 'EWR', metar: { rawOb: VFR } }),
      buildHubCardModel({ hub: 'IAH', metar: { rawOb: VFR } }),
    ];
    expect(assignJargonFirsts(build()).map((m) => m.jargon.metar))
      .toEqual(assignJargonFirsts(build()).map((m) => m.jargon.metar));
  });

  it('survives an empty panel', () => {
    expect(assignJargonFirsts([])).toEqual([]);
    expect(assignJargonFirsts(null)).toEqual([]);
  });
});

describe('faaAlertLines', () => {
  it('lists one line per delay, preferring the type over the reason', () => {
    expect(
      faaAlertLines({
        ORD: { delays: [{ type: 'Ground Stop' }, { reason: 'VOLUME' }] },
        DEN: { delays: [] },
        SFO: {},
      }),
    ).toEqual(['ORD: Ground Stop', 'ORD: VOLUME']);
  });

  it('returns nothing for an empty or missing index', () => {
    expect(faaAlertLines({})).toEqual([]);
    expect(faaAlertLines(null)).toEqual([]);
  });
});

describe('radarTitle', () => {
  it('stamps the frame in UTC, zero-padded, and says so with a trailing Z', () => {
    expect(radarTitle(Date.UTC(2026, 8, 13, 4, 7, 9))).toBe('🌧 NEXRAD Radar — 04:07:09Z');
    expect(radarTitle(new Date(Date.UTC(2026, 8, 13, 23, 59, 59)))).toBe('🌧 NEXRAD Radar — 23:59:59Z');
  });

  it('renders the bare title before the first cycle lands (edge case)', () => {
    expect(radarTitle(null)).toBe('🌧 NEXRAD Radar');
    expect(radarTitle(undefined)).toBe('🌧 NEXRAD Radar');
    expect(radarTitle(NaN)).toBe('🌧 NEXRAD Radar');
    expect(radarTitle(new Date('nope'))).toBe('🌧 NEXRAD Radar');
  });

  it('treats epoch 0 as a real timestamp rather than as "no data" (edge case)', () => {
    expect(radarTitle(0)).toBe('🌧 NEXRAD Radar — 00:00:00Z');
  });
});
