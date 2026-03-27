#!/usr/bin/env bun
// Rebuild FLEET_DB from Google Sheet CSV tabs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// GID → type mapping
const GID_TYPE_MAP = {
  '0': 'A319',
  '1': 'A320',
  '3': '737-700',
  '4': '737-800',
  '5': '737-900/900ER',
  '6': '737 MAX 8',
  '7': '757-200',
  '8': '757-300',
  '10': '767',           // will split 763ER vs 764ER
  '12': '777-200',       // will split 200 vs 200ER
  '13': '787-8/10',
  '15': '777-300ER',
  '70572532': '737 MAX 9',
  '948315825': 'A321neo',
  '1855629492': '737 MAX 9',
  '2098141434': '787-9',
  // '1151318329': EXCLUDED - future orders/reserved N-numbers
};

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseSeats(configStr) {
  if (!configStr) return { seats: {}, tot: 0 };
  const seats = {};
  let tot = 0;
  const parts = configStr.match(/(\d+)(J|PE|PP|F|E\+|Y)/g);
  if (!parts) return { seats: {}, tot: 0 };
  for (const p of parts) {
    const m = p.match(/(\d+)(J|PE|PP|F|E\+|Y)/);
    if (m) {
      const count = parseInt(m[1]);
      seats[m[2]] = count;
      tot += count;
    }
  }
  return { seats, tot };
}

function isValidReg(reg) {
  return reg && /^N\d/.test(reg) && reg.length >= 4;
}

// 767: model-based split
const MODEL_767 = {
  '763ER': '767-300ER', '76A': '767-300ER', '76Q': '767-300ER',
  '764ER': '767-400ER', '764': '767-400ER',
};

// 777-200: model-based split
const MODEL_777 = {
  '77G': '777-200', '77M': '777-200',
  '772ER': '777-200ER', '77U': '777-200ER', '77N': '777-200ER',
  '77O': '777-200ER', '77E': '777-200ER',
};

// 737-900: ER detection
const MODEL_739 = {
  '739': '737-900', '73C': '737-900',
  '739ER': '737-900ER', '73W': '737-900ER',
};

const fleet = [];
const seenRegs = new Set();

for (const [gid, baseType] of Object.entries(GID_TYPE_MAP)) {
  const csvFile = join(import.meta.dirname, `csv_gid_${gid}.csv`);
  if (!existsSync(csvFile)) {
    console.error(`Missing CSV: ${csvFile}`);
    continue;
  }

  const lines = readFileSync(csvFile, 'utf8').split('\n');

  // Find header row
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cols = parseCSVLine(lines[i]);
    const regCol = cols.findIndex(c => /Reg\s*#/i.test(c));
    if (regCol >= 0) {
      headerIdx = i;
      headers = cols;
      break;
    }
  }

  if (headerIdx < 0) {
    console.error(`No header found for GID ${gid} (${baseType})`);
    continue;
  }

  // Map column indices
  const colMap = {};
  headers.forEach((h, i) => {
    if (/reg\s*#/i.test(h)) colMap.reg = i;
    if (/ac\s*#/i.test(h)) colMap.ac = i;
    if (/deliver|delvr/i.test(h)) colMap.delivery = i;
    if (/wifi/i.test(h)) colMap.wifi = i;
    if (/config/i.test(h)) colMap.config = i;
    if (/status/i.test(h)) colMap.status = i;
    if (/ife/i.test(h)) colMap.ife = i;
    if (/power/i.test(h)) colMap.power = i;
  });

  let count = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    const reg = (cols[colMap.reg] || '').replace(/\s/g, '');

    if (!isValidReg(reg)) continue;

    // For GID 1855629492 (newer MAX 9 deliveries), prefer newer data over GID 70572532
    if (seenRegs.has(reg)) {
      if (gid === '1855629492') {
        const oldIdx = fleet.findIndex(e => e.r === reg);
        if (oldIdx >= 0) fleet.splice(oldIdx, 1);
        seenRegs.delete(reg);
      } else {
        continue;
      }
    }

    const ac = (cols[colMap.ac] || '').replace(/\s/g, '');
    const delivery = (cols[colMap.delivery] || '').replace(/\s/g, '');
    const wifi = cols[colMap.wifi] || '';
    const config = cols[colMap.config] || '';
    const status = cols[colMap.status] || '';
    const ife = cols[colMap.ife] || '';
    const power = cols[colMap.power] || '';
    const model = (cols[0] || '').trim();

    // Determine type
    let type = baseType;
    if (baseType === '767') {
      type = MODEL_767[model] || (model.includes('764') ? '767-400ER' : '767-300ER');
    } else if (baseType === '777-200') {
      type = MODEL_777[model] || (model.includes('ER') ? '777-200ER' : '777-200');
    } else if (baseType === '787-8/10') {
      type = (model === '787-10' || model === '78J') ? '787-10' : '787-8';
    } else if (baseType === '737-900/900ER') {
      type = MODEL_739[model];
      if (!type) {
        // Fallback: check delivery year
        const yr = parseInt(delivery);
        type = (yr && yr >= 2008) ? '737-900ER' : '737-900';
      }
    }

    let year = '';
    const yrMatch = delivery.match(/(\d{4})/);
    if (yrMatch) year = yrMatch[1];

    const { seats, tot } = parseSeats(config);

    const entry = { r: reg, t: type, a: ac, w: wifi, c: config, s: status, d: year, i: ife, p: power };
    if (Object.keys(seats).length > 0) {
      entry.seats = seats;
      entry.tot = tot;
    }

    fleet.push(entry);
    seenRegs.add(reg);
    count++;
  }

  console.log(`GID ${gid} (${baseType}): ${count} aircraft`);
}

// Sort by type order then registration
const typeOrder = [
  'A319', 'A320', 'A321neo',
  '737-700', '737-800', '737-900', '737-900ER', '737 MAX 8', '737 MAX 9',
  '757-200', '757-300',
  '767-300ER', '767-400ER',
  '777-200', '777-200ER', '777-300ER',
  '787-8', '787-9', '787-10'
];

fleet.sort((a, b) => {
  const ta = typeOrder.indexOf(a.t);
  const tb = typeOrder.indexOf(b.t);
  if (ta !== tb) return (ta === -1 ? 999 : ta) - (tb === -1 ? 999 : tb);
  return a.r.localeCompare(b.r);
});

// Summary
console.log(`\nTotal fleet: ${fleet.length}`);
const typeCounts = {};
fleet.forEach(e => { typeCounts[e.t] = (typeCounts[e.t] || 0) + 1; });
for (const t of typeOrder) {
  if (typeCounts[t]) console.log(`  ${t}: ${typeCounts[t]}`);
}

// Write the fleet JSON
const json = JSON.stringify(fleet);

// Now update index.html
const htmlPath = join(import.meta.dirname, 'public', 'index.html');
let html = readFileSync(htmlPath, 'utf8');

// Replace FLEET_DB
const fleetMatch = html.match(/const FLEET_DB = \[.*?\];/s);
if (!fleetMatch) {
  console.error('Could not find FLEET_DB in index.html');
  process.exit(1);
}

html = html.replace(fleetMatch[0], `const FLEET_DB = ${json};`);

// Update fleet count references
const total = fleet.length;
// Replace any existing count patterns
html = html.replace(/\b\d{3,4}\s*aircraft/g, (match) => {
  const num = parseInt(match);
  if (num >= 800 && num <= 1300) return `${total} aircraft`;
  return match;
});

// Update typeOrder arrays
const typeOrderStr = JSON.stringify(typeOrder);
html = html.replace(/const typeOrder = \[.*?\]/gs, `const typeOrder = ${typeOrderStr}`);

// Update GID map in the fleet refresh function
const newGidMap = `const gidMap = {
            0: 'A319',
            1: 'A320',
            3: '737-700',
            4: '737-800',
            5: '737-900/900ER',
            6: '737 MAX 8',
            7: '757-200',
            8: '757-300',
            10: '767',
            12: '777-200',
            13: '787-8',
            15: '777-300ER',
            70572532: '737 MAX 9',
            948315825: 'A321neo',
            1855629492: '737 MAX 9',
            2098141434: '787-9'
          }`;

html = html.replace(/const gidMap = \{[^}]+\}/s, newGidMap);

writeFileSync(htmlPath, html);
console.log(`\nUpdated index.html with ${total} aircraft`);

// Validate
try {
  const check = JSON.parse(json);
  console.log(`JSON validation: OK (${check.length} entries)`);
} catch (e) {
  console.error('JSON INVALID:', e.message);
}
