// Live-flight → fleet entry matching. Prefers the registration FR24 gives directly
// (dash-stripped, then raw), then falls back to an approximate ICAO24→N-number
// conversion. The fleet index is injected so this stays pure and importable.

// ═══ ICAO24 to N-number (approximate) ═══
export function icao24ToNNumber(hex) {
  // US registrations: A00001-AFFFFF (hex)
  const h = parseInt(hex, 16);
  if (h < 0xA00001 || h > 0xAFFFFF) return null;
  const offset = h - 0xA00001;
  // Simplified mapping - not perfectly accurate but works for many
  const d1 = Math.floor(offset / 101711);
  const rem1 = offset % 101711;
  const d2 = Math.floor(rem1 / 10111);
  const rem2 = rem1 % 10111;
  const d3 = Math.floor(rem2 / 951);
  const rem3 = rem2 % 951;

  let nnum = 'N' + (d1 + 1);
  if (d2 > 0) {
    nnum += d2 - 1;
    if (d3 > 0) {
      nnum += d3 - 1;
      if (rem3 > 0) {
        if (rem3 <= 25) nnum += String.fromCharCode(64 + rem3);
        else {
          const d4 = Math.floor((rem3 - 1) / 25);
          const r4 = (rem3 - 1) % 25;
          nnum += d4;
          if (r4 > 0) nnum += String.fromCharCode(64 + r4);
        }
      }
    } else if (rem3 > 0) {
      if (rem3 <= 25) nnum += String.fromCharCode(64 + rem3);
      else {
        nnum += Math.floor((rem3 - 1) / 25);
      }
    }
  } else if (rem2 > 0) {
    if (rem2 <= 25) nnum += String.fromCharCode(64 + rem2);
  }
  return nnum;
}

export function matchAircraft(f, fleetByReg) {
  // FR24 gives us registration directly — try that first
  if (f.reg) {
    const reg = f.reg.replace('-', '');
    if (fleetByReg[reg]) return { ...fleetByReg[reg], nnum: reg };
    if (fleetByReg[f.reg]) return { ...fleetByReg[f.reg], nnum: f.reg };
  }
  // Fallback to ICAO24 conversion
  if (f.icao24) {
    const nnum = icao24ToNNumber(f.icao24);
    if (nnum && fleetByReg[nnum]) return { ...fleetByReg[nnum], nnum };
  }
  return null;
}
