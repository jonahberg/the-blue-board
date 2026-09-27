// Pure raw-METAR parsers: flight category (VFR/MVFR/IFR/LIFR) and operational
// impact (level/color/gust/temp/phenomena). No DOM — string in, values/object out.
// These are the sole producers of the weatherOpsByHub fields that feed the
// delay-risk engine, so a silent regex break here degrades the risk score.

/**
 * Prevailing visibility from a raw METAR, in statute miles — the one visibility parser the
 * category, the hub card and the explainer share.
 *
 * The group must start at a token boundary (string start or whitespace): an unanchored
 * `\b(\d+)SM` matched the "2SM" inside "1/2SM" (the slash is a word boundary), so half-mile
 * fog read as 2 SM and "M1/4SM" as 4 SM.
 *
 * @param {string|null|undefined} rawMetar
 * @returns {{miles: number, text: string, qualifier: ''|'M'|'P'}|null} `text` is the figure
 *   as reported ("1 1/2", "3/4", "10"); `qualifier` is M (less than) or P (more than).
 *   null when there is no statute-mile group (a metric station, or no observation).
 */
export function parseVisibilitySM(rawMetar) {
  const m = String(rawMetar || '').match(
    /(?:^|\s)([MP])?(?:(\d{1,2}) (\d)\/(\d{1,2})|(\d{1,2})\/(\d{1,2})|(\d{1,3}))SM(?=\s|$)/,
  );
  if (!m) return null;
  const qualifier = /** @type {''|'M'|'P'} */ (m[1] || '');
  if (m[2]) {
    return { miles: Number(m[2]) + Number(m[3]) / Number(m[4]), text: `${m[2]} ${m[3]}/${m[4]}`, qualifier };
  }
  if (m[5]) return { miles: Number(m[5]) / Number(m[6]), text: `${m[5]}/${m[6]}`, qualifier };
  return { miles: Number(m[7]), text: m[7], qualifier };
}

/** Sky-cover codes that constitute a ceiling (AIM): broken, overcast, vertical visibility. */
export const CEILING_COVERS = new Set(['BKN', 'OVC', 'VV', 'OVX']);

/**
 * The ceiling layer of a raw METAR: the lowest BKN/OVC/VV group. FEW and SCT are never a
 * ceiling, however low.
 * @param {string|null|undefined} rawMetar
 * @returns {{cover: string, feet: number}|null}
 */
export function parseCeiling(rawMetar) {
  const m = String(rawMetar || '').match(/\b(BKN|OVC|VV)(\d{3})/);
  return m ? { cover: m[1], feet: parseInt(m[2], 10) * 100 } : null;
}

// Compute flight category from raw METAR — strict AIM standard (ceiling + vis only)
export function computeFlightCategory(rawMetar) {
  if (!rawMetar) return null;
  const vis = parseVisibilitySM(rawMetar);
  const visSM = vis ? vis.miles : 99;
  const ceil = parseCeiling(rawMetar);
  const ceiling = ceil ? ceil.feet : 99999;
  // Standard AIM flight category rules
  if (visSM < 1 || ceiling < 500) return 'LIFR';
  if (visSM < 3 || ceiling < 1000) return 'IFR';
  if (visSM <= 5 || ceiling <= 3000) return 'MVFR';
  return 'VFR';
}

// Compute operational impact — considers wind, precip, phenomena beyond just ceiling/vis
// Returns: {level: 'normal'|'caution'|'warning'|'severe', reasons: string[], color: string}
export const OPS_COLORS = {normal:'#22c55e',caution:'#eab308',warning:'#ef4444',severe:'#c026d3'};
export function computeOpsImpact(rawMetar, fltCat) {
  const reasons = [];
  let level = 'normal';
  const bump = (to) => {
    const rank = {normal:0,caution:1,warning:2,severe:3};
    if (rank[to] > rank[level]) level = to;
  };

  if (!rawMetar) return {level, reasons, color: OPS_COLORS[level]};

  // Flight category impact
  if (fltCat === 'LIFR') { bump('severe'); reasons.push('very low ceilings/visibility'); }
  else if (fltCat === 'IFR') { bump('warning'); reasons.push('instrument conditions'); }
  else if (fltCat === 'MVFR') { bump('caution'); reasons.push('marginal ceilings/visibility'); }

  // Wind/gusts
  const wm = rawMetar.match(/\b\d{3}(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (wm) {
    const spd = parseInt(wm[1]), gust = wm[3] ? parseInt(wm[3]) : spd;
    if (gust >= 40) { bump('warning'); reasons.push(`gusts ${gust}kt`); }
    else if (gust >= 30) { bump('caution'); reasons.push(`gusts ${gust}kt`); }
  }

  // Weather phenomena — parse ALL groups, not just first
  const wxAll = [...rawMetar.matchAll(/\s([+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)(?=\s)/g)];
  const wxCombined = wxAll.map(m => m[1]).join(' ');
  if (wxCombined.includes('TS')) { bump('warning'); reasons.push('thunderstorms'); }
  if (wxCombined.includes('FZ')) { bump('warning'); reasons.push('freezing precipitation'); }
  if (wxCombined.includes('SN')) { bump('caution'); reasons.push('snow'); }
  if (wxCombined.match(/\+/) && (wxCombined.includes('RA') || wxCombined.includes('SN'))) { bump('warning'); reasons.push('heavy precipitation'); }
  else if (wxCombined.includes('RA') || wxCombined.includes('DZ') || wxCombined.includes('SH')) { bump('caution'); reasons.push('precipitation'); }
  if (wxCombined.includes('FG')) { bump('caution'); reasons.push('fog'); }

  // Low clouds + active precip (even if not technically ceiling)
  const allClouds = [...rawMetar.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
  const lowestAlt = allClouds.length ? parseInt(allClouds[0][2]) * 100 : 99999;
  if (lowestAlt <= 1500 && wxAll.length > 0 && level === 'normal') {
    bump('caution'); reasons.push('low clouds with active weather');
  }

  // Extract gust speed for delay risk engine
  const gustMatch = rawMetar.match(/\b\d{3}\d{2,3}G(\d{2,3})KT\b/);
  const gustKt = gustMatch ? parseInt(gustMatch[1]) : 0;

  // Extract temperature for de-icing awareness
  const tempMatch = rawMetar.match(/\b(M?\d{2})\/M?\d{2}\b/);
  const tempC = tempMatch ? parseInt(tempMatch[1].replace('M', '-')) : null;

  // Deduplicate reasons
  const unique = [...new Set(reasons)];
  return {level, reasons: unique, color: OPS_COLORS[level], gustKt, tempC,
    hasThunderstorms: unique.includes('thunderstorms'),
    hasFreezingPrecip: unique.includes('freezing precipitation'),
    hasSnow: unique.includes('snow'),
    hasFog: unique.includes('fog'),
  };
}
