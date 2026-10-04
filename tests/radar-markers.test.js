// The Weather tab's radar dots (phone QA, Oct 3 2026): "at 00:56Z the yellow (MVFR) dot sat
// on IAH, at 01:05Z on IAD, while both labels said VFR — and the real METARs agreed; only GUM
// was MVFR."
//
// It was not an ordering bug: markers are keyed by hub end to end. Two real causes, both
// reproduced below with the METARs that were current at those two minutes:
//   1. The dot took the worst-of OPS colour, and OPS_COLORS.caution is the same hex as
//      CAT_COLORS.MVFR. KIAD 040052Z reported light rain (-RA) on a VFR field → caution →
//      MVFR yellow under a "VFR" label.
//   2. The ops parser read the REMARKS. KIAH 032353Z was dry VFR with `RMK … SHRA SW-W`
//      (showers in the distance) → "precipitation" → caution → the same yellow on IAH.
import { describe, expect, it } from 'vitest';

import { CAT_COLORS } from '../src/lib/metar-explain.js';
import { computeOpsImpact, metarObservedPart } from '../src/lib/metar-category.js';
import { buildHubCardModel, radarMarkers, WX_HUBS } from '../src/lib/weather-cards.js';

// aviationweather.gov, retrieved 2026-10-04 01:16Z.
const AT_0056Z = {
  EWR: 'METAR KEWR 032351Z 00000KT 10SM FEW130 FEW250 18/12 A3027 RMK AO2 SLP248 T01830117 10228 20183 53008',
  IAH: 'METAR KIAH 032353Z 01007KT 10SM FEW018 SCT032 SCT120 BKN180 BKN250 29/24 A2990 RMK AO2 SLP126 SHRA SW-W T02890244 10333 20289 53008',
  ORD: 'METAR KORD 032351Z 12006KT 10SM FEW120 17/10 A3016 RMK AO2 SLP215 T01720100 10206 20172 55006 $',
  DEN: 'METAR KDEN 032353Z 04015KT 10SM FEW100 FEW220 24/02 A3028 RMK AO2 SLP186 T02390022 10283 20239 53016',
  SFO: 'METAR KSFO 032356Z 30012KT 10SM FEW200 31/12 A2979 RMK AO2 SLP089 T03110117 10322 20206 56017',
  LAX: 'METAR KLAX 032353Z 26013KT 10SM FEW050 33/13 A2975 RMK AO2 SLP071 FU FEW050 FU PLUME DSNT N T03330133 10389 20322 56010 $',
  IAD: 'METAR KIAD 032352Z 00000KT 10SM BKN050 BKN100 16/14 A3025 RMK AO2 SLP241 60000 T01610139 10178 20161 53004 $',
  NRT: 'METAR RJAA 040030Z 05009KT 010V070 9999 FEW030 BKN/// 22/13 Q1021 NOSIG',
  GUM: 'METAR PGUM 032354Z 23014G24KT 8SM FEW021 SCT025 SCT033 29/26 A2979 RMK AO2 PK WND 21036/2330 SLP079 60004 T02940256 10294 20272 50009 $',
};
const AT_0105Z = {
  ...AT_0056Z,
  EWR: 'METAR KEWR 040051Z 00000KT 10SM FEW050 FEW120 FEW250 18/11 A3028 RMK AO2 SLP254 T01830111',
  IAH: 'METAR KIAH 040053Z 01012KT 10SM FEW031 BKN180 BKN250 28/24 A2992 RMK AO2 SLP132 T02780244',
  ORD: 'METAR KORD 040051Z 10005KT 10SM CLR 16/10 A3017 RMK AO2 SLP217 T01610100 $',
  IAD: 'METAR KIAD 040052Z 00000KT 10SM -RA BKN048 BKN085 16/14 A3025 RMK AO2 RAB46 SLP244 P0000 T01610139 $',
  GUM: 'METAR PGUM 040054Z 22019G26KT 10SM SCT021 BKN025 BKN050 29/26 A2977 RMK AO2 PK WND 21032/0021 SLP074 T02940256 $',
};
// The API's own categories at the time (only GUM was MVFR).
const fltCat = (hub) => (hub === 'GUM' ? 'MVFR' : 'VFR');

const markersFor = (snapshot, order = WX_HUBS) =>
  radarMarkers(order.map((hub) => buildHubCardModel({ hub, metar: { fltCat: fltCat(hub), rawOb: snapshot[hub] } })));
const byHub = (markers) => Object.fromEntries(markers.map((m) => [m.hub, m]));

describe('radar dots take the category colour the label and legend name', () => {
  for (const [time, snapshot] of [
    ['00:56Z', AT_0056Z],
    ['01:05Z', AT_0105Z],
  ]) {
    it(`${time}: every dot is the colour of its own label's category`, () => {
      for (const marker of markersFor(snapshot)) {
        const cat = marker.label.replace(/\s*⚠$/, '');
        expect(marker.color, `${marker.hub} ${marker.label}`).toBe(CAT_COLORS[cat]);
      }
    });

    it(`${time}: the only MVFR-yellow dot is GUM`, () => {
      const yellow = markersFor(snapshot).filter((m) => m.color === CAT_COLORS.MVFR).map((m) => m.hub);
      expect(yellow).toEqual(['GUM']);
    });
  }

  it('00:56Z: IAH is plain VFR — the distant-showers remark is not rain on the field', () => {
    const iah = byHub(markersFor(AT_0056Z)).IAH;
    expect(iah.label).toBe('VFR');
    expect(iah.color).toBe(CAT_COLORS.VFR);
    expect(iah.detail).toBe('');
  });

  it('01:05Z: IAD stays VFR green and says "rain" with a ⚠, not with the MVFR colour', () => {
    const iad = byHub(markersFor(AT_0105Z)).IAD;
    expect(iad.color).toBe(CAT_COLORS.VFR);
    expect(iad.label).toBe('VFR\u00a0⚠');
    expect(iad.detail).toBe('precipitation');
  });

  it('is keyed by hub: shuffling the model order moves no colour between airports', () => {
    const straight = byHub(markersFor(AT_0105Z));
    const reversed = byHub(markersFor(AT_0105Z, [...WX_HUBS].reverse()));
    expect(reversed).toEqual(straight);
  });

  it('a category that already carries its impact gets no extra ⚠ (MVFR, IFR)', () => {
    expect(byHub(markersFor(AT_0105Z)).GUM.label).toBe('MVFR');
    const ifr = buildHubCardModel({ hub: 'ORD', metar: { fltCat: 'IFR', rawOb: 'KORD 041251Z 2SM BR OVC008 12/11 A2990' } });
    expect(ifr.markerLabel).toBe('IFR');
    // …but an IFR field WITH thunderstorms is still IFR — the warning matches the category.
    const vfrTs = buildHubCardModel({ hub: 'DEN', metar: { fltCat: 'VFR', rawOb: 'KDEN 041253Z 10SM TSRA SCT060CB 20/10 A3000' } });
    expect(vfrTs.markerLabel).toBe('VFR\u00a0⚠');
    expect(vfrTs.markerColor).toBe(CAT_COLORS.VFR);
  });

  it('the hub card border keeps the worst-of ops colour its status line explains', () => {
    const iad = buildHubCardModel({ hub: 'IAD', metar: { fltCat: 'VFR', rawOb: AT_0105Z.IAD } });
    expect(iad.status.tone).toBe('caution');
    expect(iad.borderColor).toBe(iad.ops.color);
  });
});

describe('metarObservedPart / computeOpsImpact read only the observation', () => {
  it('cuts the remarks and the trend forecast', () => {
    expect(metarObservedPart(AT_0056Z.IAH)).toBe(
      'METAR KIAH 032353Z 01007KT 10SM FEW018 SCT032 SCT120 BKN180 BKN250 29/24 A2990',
    );
    expect(metarObservedPart('RJAA 040000Z 06008KT 9999 FEW030 22/15 Q1021 BECMG 04012KT')).toBe(
      'RJAA 040000Z 06008KT 9999 FEW030 22/15 Q1021',
    );
    expect(metarObservedPart('RJAA 040000Z 06008KT 9999 FEW030 Q1021 TEMPO -SHRA')).not.toContain('SHRA');
    expect(metarObservedPart('')).toBe('');
  });

  it('a remark or a TEMPO group is not weather on the field; the body still is', () => {
    expect(computeOpsImpact(AT_0056Z.IAH, 'VFR').level).toBe('normal');
    expect(computeOpsImpact('KXXX 041253Z 10SM FEW040 20/10 A3000 RMK TS DSNT NW', 'VFR').level).toBe('normal');
    expect(computeOpsImpact('RJAA 040000Z 06008KT 9999 FEW030 Q1021 TEMPO -SHRA', 'VFR').level).toBe('normal');
    const iad = computeOpsImpact(AT_0105Z.IAD, 'VFR');
    expect(iad.level).toBe('caution');
    expect(iad.reasons).toEqual(['precipitation']);
    // Wind gusts are read from the body as before.
    expect(computeOpsImpact('KXXX 041253Z 27025G35KT 10SM FEW040 20/10 A3000', 'VFR').reasons).toContain('gusts 35kt');
  });
});
