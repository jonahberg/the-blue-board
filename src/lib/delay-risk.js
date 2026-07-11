export const HUB_RISK_PROFILES = {
  EWR: { base: 6, name: 'EWR congestion baseline' },
  ORD: { base: 4, name: 'ORD volume baseline' },
  SFO: { base: 4, name: 'SFO fog/runway risk' },
  IAH: { base: 3, name: 'IAH weather exposure' },
  DEN: { base: 3, name: 'DEN altitude/wind risk' },
  LAX: { base: 2, name: 'LAX ATC congestion' },
  IAD: { base: 2, name: 'IAD weather exposure' },
  NRT: { base: 1, name: 'NRT international ops' },
  GUM: { base: 1, name: 'GUM baseline' },
};

export const HUB_COORDINATES = {
  ORD: { lat: 41.974, lon: -87.907 },
  DEN: { lat: 39.856, lon: -104.674 },
  IAH: { lat: 29.99, lon: -95.336 },
  EWR: { lat: 40.693, lon: -74.169 },
  SFO: { lat: 37.621, lon: -122.379 },
  IAD: { lat: 38.953, lon: -77.456 },
  LAX: { lat: 33.942, lon: -118.408 },
  NRT: { lat: 35.764, lon: 140.386 },
  GUM: { lat: 13.484, lon: 144.797 },
};

const RISK_BANDS = [
  { min: 75, label: 'V.HIGH', color: '#dc2626' },
  { min: 50, label: 'HIGH', color: '#ef4444' },
  { min: 25, label: 'MOD', color: '#eab308' },
  { min: 0, label: 'LOW', color: '#22c55e' },
];

function toMillis(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value > 1e12 ? value : value * 1000;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parseDelayNumber(value) {
  if (!value) return 0;
  const matches = String(value).match(/\d+/g);
  if (!matches || !matches.length) return 0;
  return Math.max(...matches.map(Number));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180)
    * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getLocalHour(timeZone, baseTime, nowMs) {
  const sourceMs = toMillis(baseTime) ?? nowMs;
  try {
    const hourStr = new Date(sourceMs).toLocaleTimeString('en-US', {
      timeZone: timeZone || 'America/Chicago',
      hour12: false,
      hour: 'numeric',
    });
    const hour = parseInt(hourStr, 10);
    // Some Node/ICU builds emit hour="24" for local midnight in en-US + hour12:false;
    // left unguarded it crosses the >=19 late-evening threshold. Normalize to 0, matching hubTz.js.
    return hour === 24 ? 0 : hour;
  } catch {
    return new Date(nowMs).getHours();
  }
}

function createState() {
  return {
    score: 0,
    components: [],
    factors: new Map(),
  };
}

function addPoints(state, id, points, factor) {
  if (!points) return;
  state.score += points;
  state.components.push({ id, points, factor: factor || '' });
  if (factor) {
    const current = state.factors.get(factor) || 0;
    state.factors.set(factor, Math.max(current, points));
  }
}

function collectWeatherSignals(state, airportCode, weather, role) {
  if (!airportCode || !weather) return;

  const isOrigin = role === 'origin';
  const levelFactor = weather.level === 'severe'
    ? (isOrigin ? 8 : 5)
    : weather.level === 'warning'
      ? (isOrigin ? 5 : 3)
      : weather.level === 'caution'
        ? (isOrigin ? 2 : 1)
        : 0;

  if (levelFactor && !weather.hasThunderstorms && !weather.hasFreezingPrecip && !weather.hasSnow) {
    addPoints(
      state,
      `${role}-weather-level`,
      levelFactor,
      `${airportCode} weather: ${(weather.reasons || []).join(', ') || weather.level}`
    );
  } else {
    addPoints(state, `${role}-weather-level`, levelFactor);
  }

  if (weather.hasThunderstorms) {
    addPoints(state, `${role}-weather-ts`, isOrigin ? 8 : 5, `${airportCode} thunderstorms${isOrigin ? '' : ' (arrival)'}`);
  }
  if (weather.hasFreezingPrecip) {
    addPoints(state, `${role}-weather-fz`, isOrigin ? 6 : 3, `${airportCode} freezing precipitation`);
  }
  if (weather.hasSnow) {
    addPoints(state, `${role}-weather-snow`, isOrigin ? 4 : 2, `${airportCode} snow`);
  }
  if (weather.gustKt >= 40) {
    addPoints(state, `${role}-weather-gust`, isOrigin ? 5 : 3, `${airportCode} gusts ${weather.gustKt}kt`);
  } else if (weather.gustKt >= 30) {
    addPoints(state, `${role}-weather-gust`, isOrigin ? 3 : 2, `${airportCode} gusts ${weather.gustKt}kt`);
  }

  if (weather.fltCat === 'LIFR') {
    let points = isOrigin ? 10 : 5;
    let factor = `${airportCode} LIFR${isOrigin ? ' conditions' : ' (arrival impact)'}`;
    if (airportCode === 'SFO') {
      points = isOrigin ? 14 : 8;
      factor = `${airportCode} LIFR - single-stream runway ops`;
    } else if (airportCode === 'EWR') {
      points = isOrigin ? 12 : 7;
      factor = `${airportCode} LIFR - runway restrictions`;
    }
    addPoints(state, `${role}-weather-lifr`, points, factor);
  } else if (weather.fltCat === 'IFR') {
    let points = isOrigin ? 5 : 3;
    let factor = `${airportCode} IFR${isOrigin ? ' conditions' : ' (arrival impact)'}`;
    if (airportCode === 'SFO') {
      points = isOrigin ? 8 : 5;
      factor = `${airportCode} IFR - reduced runway capacity`;
    } else if (airportCode === 'EWR') {
      points = isOrigin ? 7 : 4;
      factor = `${airportCode} IFR - runway config restrictions`;
    }
    addPoints(state, `${role}-weather-ifr`, points, factor);
  }

  if ((weather.hasFreezingPrecip || weather.hasSnow) && weather.tempC !== null && weather.tempC <= 2) {
    let points = 6;
    let factor = `De-icing required (${weather.tempC}C)`;
    if (weather.tempC <= -5) {
      points = 10;
      factor = `Extended de-icing queue (${weather.tempC}C)`;
    }
    addPoints(state, `${role}-weather-deice`, points, factor);
  }
}

function collectFaaSignals(state, airportCode, faa, role) {
  if (!airportCode || !faa) return;

  const roleLabel = role === 'origin' ? 'at' : 'at';
  // parseDelayNumber handles both numeric (from JSON) and string (from XML fallback) inputs
  const severityWindow = Math.max(
    parseDelayNumber(faa.avgDelay),
    parseDelayNumber(faa.minDelay),
    parseDelayNumber(faa.maxDelay)
  );

  if (faa.closure) {
    addPoints(state, `${role}-faa-closure`, role === 'origin' ? 35 : 25, `Airport closed ${roleLabel} ${airportCode}`);
    return;
  }
  if (faa.groundStop) {
    addPoints(state, `${role}-faa-gs`, role === 'origin' ? 30 : 20, `Ground stop ${roleLabel} ${airportCode}`);
    // Probability of extension signal (ground stops only)
    const ext = faa.probabilityOfExtension || (faa.programs && faa.programs.find(p => p.type === 'ground_stop')?.probabilityOfExtension);
    if (ext === 'HIGH') addPoints(state, `${role}-faa-gs-ext`, 5, `GS extension likely at ${airportCode}`);
    else if (ext === 'MEDIUM') addPoints(state, `${role}-faa-gs-ext`, 3, `GS extension possible at ${airportCode}`);
    return;
  }
  if (faa.groundDelay) {
    let points = role === 'origin' ? 16 : 12;
    if (severityWindow >= 90) points += 8;
    else if (severityWindow >= 45) points += 4;
    const detail = severityWindow ? ` (up to ${severityWindow}m)` : '';
    addPoints(state, `${role}-faa-gdp`, points, `Ground delay program ${roleLabel} ${airportCode}${detail}`);
    return;
  }
  if (faa.departureDelay) {
    let points = role === 'origin' ? 10 : 6;
    if (severityWindow >= 90) points += 5;
    else if (severityWindow >= 45) points += 3;
    const detail = severityWindow ? ` (up to ${severityWindow}m)` : '';
    addPoints(state, `${role}-faa-dep`, points, `Departure delays ${roleLabel} ${airportCode}${detail}`);
    return;
  }
  if (faa.arrivalDelay) {
    let points = role === 'origin' ? 6 : 8;
    if (severityWindow >= 90) points += 3;
    const detail = severityWindow ? ` (up to ${severityWindow}m)` : '';
    addPoints(state, `${role}-faa-arr`, points, `Arrival delays ${roleLabel} ${airportCode}${detail}`);
  }

  // Arrival rate signal — reduced capacity means higher delay risk
  const arrivalRate = faa.runwayConfig?.arrivalRate;
  if (typeof arrivalRate === 'number' && arrivalRate > 0 && arrivalRate < 25) {
    addPoints(state, `${role}-faa-rate`, role === 'origin' ? 4 : 2, `Reduced arrival rate at ${airportCode} (${arrivalRate}/hr)`);
  }
}

function collectPlannedTmiSignals(state, airportCode, plannedTmis, role) {
  if (!airportCode || !Array.isArray(plannedTmis) || !plannedTmis.length) return;
  for (const tmi of plannedTmis) {
    if (tmi.type !== 'terminal') continue;
    if (!tmi.affectedAirports || !tmi.affectedAirports.includes(airportCode)) continue;
    const event = (tmi.event || '').toUpperCase();
    if (event.includes('GS') || event.includes('GROUND STOP')) {
      addPoints(state, `${role}-planned-gs`, 3, `Planned ground stop at ${airportCode} (${tmi.time || 'later'})`);
    } else if (event.includes('GDP') || event.includes('GROUND DELAY')) {
      addPoints(state, `${role}-planned-gdp`, 2, `Planned ground delay at ${airportCode} (${tmi.time || 'later'})`);
    }
  }
}

function collectOtpSignal(state, airportCode, otp) {
  if (otp === undefined || otp === null) return;
  if (otp < 40) addPoints(state, 'origin-otp', 12, `${airportCode} OTP ${otp}% - severe disruptions`);
  else if (otp < 55) addPoints(state, 'origin-otp', 8, `${airportCode} OTP ${otp}%`);
  else if (otp < 70) addPoints(state, 'origin-otp', 4, `${airportCode} OTP ${otp}%`);
  else if (otp < 80) addPoints(state, 'origin-otp', 2);
}

function collectTimeOfDaySignal(state, timeZone, scheduledTime, nowMs) {
  const hour = getLocalHour(timeZone, scheduledTime, nowMs);
  if (hour >= 19) addPoints(state, 'time-of-day', 8, 'Late evening - high cascade risk');
  else if (hour >= 16) addPoints(state, 'time-of-day', 5, 'Evening - cascade risk');
  else if (hour >= 13) addPoints(state, 'time-of-day', 2, 'Afternoon - moderate cascade');
}

function collectInboundSignals(state, input) {
  const {
    originHub,
    scheduledDepartureTime,
    nowMs,
    inboundFlight,
    originCoordinates,
    aircraftJourney,
    currentFlightNumber,
  } = input;

  const scheduledMs = toMillis(scheduledDepartureTime);
  if (!originHub || !scheduledMs) return;

  if (inboundFlight) {
    const depTime = scheduledMs;
    const hubCoords = originCoordinates || HUB_COORDINATES[originHub];
    const hasPosition = hubCoords
      && inboundFlight.lat
      && inboundFlight.lon
      && inboundFlight.spd > 0;

    if (hasPosition) {
      const distKm = haversineKm(inboundFlight.lat, inboundFlight.lon, hubCoords.lat, hubCoords.lon);
      const speedKmH = inboundFlight.spd * 3.6;
      const etaMin = speedKmH > 0 ? (distKm / speedKmH) * 60 + 15 : null;
      if (etaMin !== null) {
        const estArrivalMs = nowMs + etaMin * 60000;
        const isWidebody = /^(B77|B78|A35|A33|A38)/.test(inboundFlight.acType || '');
        const minTurnaround = isWidebody ? 75 : 45;
        const turnaroundBuffer = (depTime - estArrivalMs) / 60000 - minTurnaround;
        if (turnaroundBuffer < 0) {
          addPoints(
            state,
            'inbound-turn',
            28,
            `Inbound aircraft cannot make turnaround (${Math.round(etaMin)}m to arrival, needs ${minTurnaround}m turn)`
          );
        } else if (turnaroundBuffer < 15) {
          addPoints(state, 'inbound-turn', 20, `Inbound aircraft - very tight turnaround (${Math.round(turnaroundBuffer)}m buffer)`);
        } else if (turnaroundBuffer < 30) {
          addPoints(state, 'inbound-turn', 12, `Inbound aircraft - tight turnaround (${Math.round(turnaroundBuffer)}m buffer)`);
        } else if (turnaroundBuffer < 60) {
          addPoints(state, 'inbound-turn', 4, 'Inbound aircraft en route');
        }
      }
    } else {
      const minutesToDeparture = (depTime - nowMs) / 60000;
      if (minutesToDeparture < 45) addPoints(state, 'inbound-turn', 22, 'Inbound aircraft still airborne - very tight turnaround');
      else if (minutesToDeparture < 75) addPoints(state, 'inbound-turn', 12, 'Inbound aircraft still en route');
      else if (minutesToDeparture < 120) addPoints(state, 'inbound-turn', 6, 'Inbound aircraft in flight');
    }

    if (inboundFlight.originWeatherLevel === 'severe' || inboundFlight.originWeatherLevel === 'warning') {
      addPoints(state, 'inbound-origin-weather', 4, `Inbound from ${inboundFlight.origin} (${inboundFlight.originWeatherLevel} weather)`);
    }
    if (inboundFlight.originFaaGroundStop || inboundFlight.originFaaGroundDelay) {
      addPoints(
        state,
        'inbound-origin-faa',
        4,
        `Inbound from ${inboundFlight.origin} (${inboundFlight.originFaaGroundStop ? 'ground stop' : 'GDP'})`
      );
    }

    if (inboundFlight.alt > 8000 && inboundFlight.vr >= -0.5) {
      const minutesToDeparture = (depTime - nowMs) / 60000;
      if (minutesToDeparture < 90) {
        addPoints(state, 'inbound-cruise', 3, 'Inbound still at cruise altitude');
      }
    }
  }

  if (aircraftJourney && Array.isArray(aircraftJourney.segments)) {
    const priorSegments = aircraftJourney.segments.filter((segment) => segment.flightNumber !== currentFlightNumber);
    const lateSegments = priorSegments.filter((segment) => segment.delayMin !== null && segment.delayMin > 15);
    if (lateSegments.length >= 2) {
      const avgDelay = Math.round(lateSegments.reduce((sum, segment) => sum + segment.delayMin, 0) / lateSegments.length);
      const points = avgDelay >= 45 ? 8 : avgDelay >= 30 ? 6 : 4;
      addPoints(state, 'journey-propagation', points, `Aircraft running late all day (avg +${avgDelay}m across ${lateSegments.length} segments)`);
    }
  }
}

function collectIropsSignals(state, airportCode, irops, role) {
  if (!airportCode || !irops) return;
  if (irops.cancellationRate >= 15) {
    addPoints(
      state,
      `${role}-irops-cancel`,
      role === 'origin' ? 12 : 7,
      `${airportCode} ${irops.cancellationRate}% cancellation rate${role === 'destination' ? ' (arrival disruptions)' : ''}`
    );
  } else if (irops.cancellationRate >= 8) {
    addPoints(
      state,
      `${role}-irops-cancel`,
      role === 'origin' ? 7 : 4,
      `${airportCode} elevated cancellations (${irops.cancellationRate}%)${role === 'destination' ? ' (arrival)' : ''}`
    );
  } else if (role === 'origin' && irops.cancellationRate >= 3) {
    addPoints(state, `${role}-irops-cancel`, 3, `${airportCode} some cancellations`);
  }

  if (irops.delayed60Rate >= 20) {
    addPoints(
      state,
      `${role}-irops-delay`,
      role === 'origin' ? 4 : 2,
      `${airportCode} high 60min+ delay rate${role === 'destination' ? ' (arrival holds likely)' : ''}`
    );
  }
}

function collectCompoundSignal(state, input) {
  let severeSignals = 0;
  if (input.originFaa && (input.originFaa.groundStop || input.originFaa.closure)) severeSignals++;
  if (input.destinationFaa && (input.destinationFaa.groundStop || input.destinationFaa.closure)) severeSignals++;
  if (input.originWeather && input.originWeather.level === 'severe') severeSignals++;
  if (input.destinationWeather && input.destinationWeather.level === 'severe') severeSignals++;
  if (input.originIrops && input.originIrops.cancellationRate >= 15) severeSignals++;

  if (severeSignals >= 3) {
    addPoints(state, 'compound-severe', Math.min(severeSignals * 4, 12), 'Multiple severe disruptions compounding');
  }
}

function finalize(state) {
  const score = Math.min(Math.round(state.score), 100);
  const band = RISK_BANDS.find((entry) => score >= entry.min) || RISK_BANDS[RISK_BANDS.length - 1];
  const factors = Array.from(state.factors.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([factor]) => factor);

  return {
    score,
    label: band.label,
    color: band.color,
    factors,
    components: state.components.sort((a, b) => b.points - a.points),
  };
}

export function computeDelayRiskModel(input) {
  const state = createState();
  const nowMs = input.nowMs || Date.now();
  const scheduledMs = toMillis(input.scheduledTime);
  const comparisonMs = toMillis(input.comparisonTime);

  if (scheduledMs && comparisonMs && comparisonMs > scheduledMs) {
    const delayMin = Math.max(0, Math.round((comparisonMs - scheduledMs) / 60000));
    if (delayMin >= 120) addPoints(state, 'actual-delay', 50, `Already ${delayMin}min delayed`);
    else if (delayMin >= 60) addPoints(state, 'actual-delay', 40, `Already ${delayMin}min delayed`);
    else if (delayMin >= 30) addPoints(state, 'actual-delay', 30, `${delayMin}min delay`);
    else if (delayMin >= 15) addPoints(state, 'actual-delay', 15, `${delayMin}min delay`);
  }

  collectFaaSignals(state, input.originHub, input.originFaa, 'origin');
  collectFaaSignals(state, input.destinationHub, input.destinationFaa, 'destination');
  collectWeatherSignals(state, input.originHub, input.originWeather, 'origin');
  collectWeatherSignals(state, input.destinationHub, input.destinationWeather, 'destination');
  collectOtpSignal(state, input.originHub, input.originOtp);
  collectTimeOfDaySignal(state, input.timeZone, input.scheduledTime, nowMs);
  collectInboundSignals(state, {
    originHub: input.originHub,
    scheduledDepartureTime: input.scheduledTime,
    nowMs,
    inboundFlight: input.inboundFlight,
    originCoordinates: input.originCoordinates,
    aircraftJourney: input.aircraftJourney,
    currentFlightNumber: input.currentFlightNumber,
  });

  const hubProfile = input.hubProfile || HUB_RISK_PROFILES[input.originHub];
  if (hubProfile && hubProfile.base > 0) {
    addPoints(state, 'hub-profile', hubProfile.base, hubProfile.base >= 4 ? hubProfile.name : '');
  }

  collectIropsSignals(state, input.originHub, input.originIrops, 'origin');
  collectIropsSignals(state, input.destinationHub, input.destinationIrops, 'destination');

  // Planned TMI signals (forward-looking NAS operations plan)
  if (input.plannedTmis) {
    collectPlannedTmiSignals(state, input.originHub, input.plannedTmis, 'origin');
    collectPlannedTmiSignals(state, input.destinationHub, input.plannedTmis, 'destination');
  }

  collectCompoundSignal(state, input);

  return finalize(state);
}
