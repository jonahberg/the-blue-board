// ═══ METAR RENDERING AND PLAIN-ENGLISH EXPLANATION ═══
// Turns a raw METAR (or the structured payload /api/metar returns alongside it) into
// the four values a hub card shows, and into the paragraph behind "▾ Details".
//
// Extracted verbatim from src/dashboard/main.js (:3542-3612 quick parse + fallbacks,
// :3875-3880 the worse-of-two category rule, :4331-4444 explainMETAR).
//
// The AIM category itself (computeFlightCategory) and the ops-severity parse
// (computeOpsImpact) already live in ./metar-category.js — this module only decides
// which of the API's category and the locally computed one to trust.

/** Flight-category colours for the legend, hub cards and radar markers. */
/** @type {Record<string, string>} */
export const CAT_COLORS = {VFR:'#22c55e',MVFR:'#eab308',IFR:'#ef4444',LIFR:'#c026d3'};

/**
 * Restrictiveness ranking, lowest = worst. UNK ranks with VFR so an unknown API
 * category never makes conditions look worse than they are.
 * @type {Record<string, number>}
 */
export const CAT_RANK = {LIFR:0,IFR:1,MVFR:2,VFR:3,UNK:3};

/**
 * The worse (more restrictive) of the API's category and the one computed locally
 * from the raw observation. The local parse only wins when it is strictly more
 * restrictive, so a missing/garbled local parse can never soften the API.
 *
 * @param {string} apiCat  `fltCat` from /api/metar (or 'UNK').
 * @param {string|null|undefined} computedCat  computeFlightCategory(raw).
 * @returns {string}
 */
export function worstCategory(apiCat, computedCat) {
  return computedCat && (CAT_RANK[computedCat] ?? 3) < (CAT_RANK[apiCat] ?? 3) ? computedCat : apiCat;
}

export function formatStructuredVisibility(visib) {
  if (visib === null || visib === undefined || visib === '') return '--';
  const value = String(visib).trim();
  if (!value) return '--';
  if (/SM$/i.test(value) || /m$/i.test(value)) return value;
  if (/^\d+(\.\d+)?$/.test(value) && Number(value) > 50) return `${Math.round(Number(value))}m`;
  return `${value} SM`;
}

export function applyStructuredMetarFallback(parsed, metar) {
  if (!metar || typeof metar !== 'object') return parsed;

  if (parsed.temp === '--' && Number.isFinite(metar.temp)) {
    parsed.temp = `${Math.round(metar.temp)}°C / ${Math.round((metar.temp * 9) / 5 + 32)}°F`;
  }

  if (parsed.wind === '--' && Number.isFinite(metar.wspd)) {
    if (metar.wspd === 0) parsed.wind = 'Calm';
    else if (Number.isFinite(metar.wdir)) parsed.wind = `${String(Math.round(metar.wdir)).padStart(3, '0')}° @ ${Math.round(metar.wspd)}kt`;
    else parsed.wind = `${Math.round(metar.wspd)}kt`;
  }

  if (parsed.vis === '--') {
    parsed.vis = formatStructuredVisibility(metar.visib);
  }

  if (parsed.clouds === '--') {
    const cloudLayer = Array.isArray(metar.clouds) && metar.clouds.length ? metar.clouds[0] : null;
    const cloudCover = cloudLayer?.cover || metar.cover || '';
    const cloudBase = Number.isFinite(cloudLayer?.base) ? cloudLayer.base : null;
    const cloudNames = {FEW:'Few',SCT:'Scattered',BKN:'Broken',OVC:'Overcast'};
    if (cloudCover && cloudBase !== null) parsed.clouds = `${cloudNames[cloudCover] || cloudCover} ${cloudBase}ft`;
    else if (cloudCover === 'CLR' || cloudCover === 'SKC') parsed.clouds = 'Clear';
  }

  return parsed;
}

export function parseMetarQuick(metar) {
  const raw = typeof metar === 'string' ? metar : (metar?.rawOb || '');
  const r = {temp:'--',wind:'--',vis:'--',clouds:'--'};
  if (!raw) return typeof metar === 'object' ? applyStructuredMetarFallback(r, metar) : r;
  const wm = raw.match(/\b(\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (wm) { r.wind = `${wm[1]}° @ ${wm[2]}kt${wm[4]?' G'+wm[4]:''}`;} else if(raw.includes('00000KT')){r.wind='Calm';}
  const vm = raw.match(/\b(\d+)\s*SM\b/) || raw.match(/\b(\d+\/\d+)SM\b/);
  if (vm) r.vis = vm[0].replace('SM','').trim()+' SM';
  const tm = raw.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  if (tm) { const c=parseInt(tm[1].replace('M','-')); r.temp=`${c}°C / ${Math.round(c*9/5+32)}°F`;}
  const cm = [...raw.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
  const cn = {FEW:'Few',SCT:'Scattered',BKN:'Broken',OVC:'Overcast'};
  if (cm.length) { const l=cm[0]; r.clouds=`${cn[l[1]]||l[1]} ${parseInt(l[2])*100}ft`;} else if(raw.includes('CLR')||raw.includes('SKC')){r.clouds='Clear';}
  return typeof metar === 'object' ? applyStructuredMetarFallback(r, metar) : r;
}

export function hasRenderableMetarData(metar) {
  if (!metar || typeof metar !== 'object') return false;
  return Boolean(
    metar.rawOb ||
    Number.isFinite(metar.temp) ||
    Number.isFinite(metar.wspd) ||
    (typeof metar.visib === 'string' && metar.visib.trim()) ||
    (Array.isArray(metar.clouds) && metar.clouds.length) ||
    metar.cover
  );
}

export function explainMETAR(rawMetar, hub, cat) {
  if (!rawMetar) return '';
  const hubNames = {EWR:"Newark",IAH:"Houston Intercontinental",ORD:"O'Hare",DEN:"Denver International",SFO:"San Francisco",LAX:"Los Angeles",IAD:"Washington Dulles",NRT:"Tokyo Narita",GUM:"Guam"};
  const name = hubNames[hub] || hub;

  // Build context-aware assessment instead of static category blurbs

  let parts = [];

  // Wind
  const windMatch = rawMetar.match(/\b(\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (windMatch) {
    const dir = parseInt(windMatch[1]), spd = parseInt(windMatch[2]), gust = windMatch[4] ? parseInt(windMatch[4]) : null;
    const dirs = ['north','north-northeast','northeast','east-northeast','east','east-southeast','southeast','south-southeast','south','south-southwest','southwest','west-southwest','west','west-northwest','northwest','north-northwest'];
    const dirName = dirs[Math.round(dir / 22.5) % 16];
    parts.push(`Winds from the ${dirName} at ${spd} knots${gust ? ' gusting to ' + gust : ''}`);
  } else if (rawMetar.includes('00000KT')) {
    parts.push('Winds are calm');
  }

  // Visibility
  const visMatch = rawMetar.match(/\b(\d+)\s*SM\b/) || rawMetar.match(/\b(\d+)\/(\d+)SM\b/) || rawMetar.match(/\bM?(\d+\/\d+)SM\b/);
  if (visMatch) {
    const vis = visMatch[0].replace('SM', '').trim();
    parts.push(`Visibility is ${vis} statute miles`);
  }

  // Ceiling / clouds
  const cloudMatches = [...rawMetar.matchAll(/(FEW|SCT|BKN|OVC)(\d{3})/g)];
  const cloudNames = {FEW:'few clouds',SCT:'scattered',BKN:'broken ceiling',OVC:'overcast ceiling'};
  if (cloudMatches.length) {
    const lowest = cloudMatches[0];
    const altHun = parseInt(lowest[2]) * 100;
    parts.push(`${cloudNames[lowest[1]] || lowest[1]} at ${altHun.toLocaleString()} feet`);
  } else if (rawMetar.includes('CLR') || rawMetar.includes('SKC')) {
    parts.push('Clear skies');
  }

  // Weather phenomena
  const wxCodes = {RA:'rain',SN:'snow',DZ:'drizzle',FG:'fog',BR:'mist',HZ:'haze',TS:'thunderstorms',FZ:'freezing',SH:'showers',GR:'hail',PL:'ice pellets'};
  const wxMatch = rawMetar.match(/\s([+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)\s/);
  if (wxMatch) {
    const wx = wxMatch[1];
    let desc = [];
    if (wx.startsWith('-')) desc.push('light');
    else if (wx.startsWith('+')) desc.push('heavy');
    for (const [code, name] of Object.entries(wxCodes)) {
      if (wx.includes(code)) desc.push(name);
    }
    if (desc.length) parts.push(desc.join(' '));
  }

  // Temperature
  const tempMatch = rawMetar.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  if (tempMatch) {
    const t = tempMatch[1].replace('M', '-');
    const tempC = parseInt(t);
    const tempF = Math.round(tempC * 9/5 + 32);
    parts.push(`Temperature is ${tempC}°C (${tempF}°F)`);
  }

  // Altimeter
  const altMatch = rawMetar.match(/A(\d{4})/);
  if (altMatch) {
    const alt = (parseInt(altMatch[1]) / 100).toFixed(2);
    parts.push(`altimeter setting of ${alt} inHg`);
  }

  let text = `${name} is currently reporting ${cat || 'unknown'} conditions`;
  if (parts.length) text += '. ' + parts.join('. ') + '.';

  // Build dynamic operational assessment from actual conditions
  const assessParts = [];
  // Check for active weather phenomena
  const wxMatch2 = rawMetar.match(/\s([+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)\s/);
  if (wxMatch2) {
    const wx = wxMatch2[1];
    if (wx.includes('SN') || wx.includes('FZ')) assessParts.push('winter weather active');
    else if (wx.includes('TS')) assessParts.push('thunderstorm activity');
    else if (wx.includes('RA') || wx.includes('DZ') || wx.includes('SH')) assessParts.push('precipitation');
    else if (wx.includes('FG')) assessParts.push('fog');
    else if (wx.includes('BR') || wx.includes('HZ')) assessParts.push('reduced visibility');
  }
  // Check winds
  const wm2 = rawMetar.match(/\b\d{3}(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (wm2) {
    const gust = wm2[3] ? parseInt(wm2[3]) : parseInt(wm2[1]);
    if (gust >= 30) assessParts.push('strong/gusty winds');
    else if (gust >= 20) assessParts.push('gusty conditions');
  }
  // Check ceiling
  const ceil = [...rawMetar.matchAll(/(BKN|OVC)(\d{3})/g)];
  if (ceil.length) {
    const ceilFt = parseInt(ceil[0][2]) * 100;
    if (ceilFt < 500) assessParts.push('very low ceilings');
    else if (ceilFt < 1000) assessParts.push('low ceilings');
    else if (ceilFt <= 3000) assessParts.push('low overcast');
  }

  if (cat === 'LIFR') {
    text += ` Very low ceilings/visibility — major operational impact, expect ground stops and diversions.`;
  } else if (cat === 'IFR') {
    text += ` Instrument conditions${assessParts.length ? ' with ' + assessParts.join(', ') : ''} — expect significant delays and possible diversions.`;
  } else if (cat === 'MVFR') {
    text += ` Marginal conditions${assessParts.length ? ' with ' + assessParts.join(', ') : ''} — some delays possible.`;
  } else if (assessParts.length) {
    // VFR but with notable conditions
    text += ` ${assessParts.join(', ').replace(/^./, c => c.toUpperCase())} — monitor for changes.`;
  } else {
    text += ` Clear skies, good visibility — no impact on operations.`;
  }

  return text;
}
