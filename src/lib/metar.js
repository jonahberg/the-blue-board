function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function normalizeStationId(station) {
  return firstNonEmptyString(station).toUpperCase();
}

function normalizeCloudLayer(layer) {
  if (!layer || typeof layer !== 'object') return null;
  const cover = firstNonEmptyString(layer.cover, layer.skyCover, layer.sky_cover).toUpperCase();
  const base = firstFiniteNumber(layer.base, layer.altitudeFt, layer.altitude_ft_agl, layer.altitude);
  if (!cover && base === null) return null;
  return {
    ...layer,
    cover: cover || undefined,
    base: base === null ? undefined : base,
  };
}

export function normalizeMetarRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const stationId = firstNonEmptyString(
    record.icaoId,
    record.stationId,
    record.station_id,
    record.station,
    record.id
  ).toUpperCase();

  const rawOb = firstNonEmptyString(
    record.rawOb,
    record.raw_text,
    record.rawText,
    record.raw,
    record.metar
  );

  const fltCat = firstNonEmptyString(
    record.fltCat,
    record.fltcat,
    record.flightCategory,
    record.flight_category,
    record.category
  ).toUpperCase();

  const visib = firstNonEmptyString(
    record.visib,
    record.visibility,
    record.visibility_sm,
    record.vis
  );

  const wdir = firstFiniteNumber(
    record.wdir,
    record.windDir,
    record.wind_dir_degrees,
    record.wind_direction
  );

  const wspd = firstFiniteNumber(
    record.wspd,
    record.windSpeed,
    record.wind_speed_kt,
    record.wind_speed,
    record.wind_kt
  );

  const temp = firstFiniteNumber(
    record.temp,
    record.tempC,
    record.temperature_c,
    record.temperature
  );

  const clouds = (
    Array.isArray(record.clouds) ? record.clouds :
    Array.isArray(record.sky_condition) ? record.sky_condition :
    Array.isArray(record.skyConditions) ? record.skyConditions :
    []
  )
    .map(normalizeCloudLayer)
    .filter(Boolean);

  const cover = firstNonEmptyString(record.cover, record.skyCover, record.sky_cover).toUpperCase();

  return {
    ...record,
    id: stationId || record.id,
    icaoId: stationId || record.icaoId,
    stationId: stationId || record.stationId,
    rawOb,
    fltCat,
    visib: visib || record.visib || '',
    wdir,
    wspd,
    temp,
    cover: cover || record.cover,
    clouds,
  };
}

export function normalizeMetarPayload(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.metars)
        ? payload.metars
        : Array.isArray(payload?.observations)
          ? payload.observations
          : [];

  return rows
    .map(normalizeMetarRecord)
    .filter(Boolean);
}

export function chunkMetarStationIds(stations, maxQueryLength = 180) {
  const stationList = Array.isArray(stations)
    ? stations
    : String(stations || '').split(',');

  const chunks = [];
  let current = [];
  let currentLength = 0;

  stationList.forEach((station) => {
    const id = normalizeStationId(station);
    if (!id) return;

    const nextLength = currentLength ? currentLength + 1 + id.length : id.length;
    if (nextLength > maxQueryLength && current.length) {
      chunks.push(current.join(','));
      current = [id];
      currentLength = id.length;
      return;
    }

    current.push(id);
    currentLength = nextLength;
  });

  if (current.length) chunks.push(current.join(','));
  return chunks;
}
