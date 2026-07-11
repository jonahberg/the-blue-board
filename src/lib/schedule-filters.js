export function getScheduleFleetFamily(modelCode, modelText = '') {
  const code = String(modelCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const text = String(modelText || '').toUpperCase();

  // ICAO codes for MAX (B37M/B38M/B39M/B3XM) and neo (A19N/A20N/A21N) don't
  // share the classic-family prefixes, and FR24 normalizers ship them with
  // empty model.text — match them explicitly or the family filter drops them.
  if (/^(B?73|73|7M)/.test(code) || /^B3[0-9X]M/.test(code) || text.includes('737')) return '737';
  if (/^(A?31|31|A?32|32)/.test(code) || /^A(19|20|21)N/.test(code) || /(A319|A320|A321)/.test(text)) return 'A320';
  if (/^(B?75|75)/.test(code) || text.includes('757')) return '757';
  if (/^(B?76|76)/.test(code) || text.includes('767')) return '767';
  if (/^(B?77|77)/.test(code) || text.includes('777')) return '777';
  if (/^(B?78|78)/.test(code) || text.includes('787') || text.includes('DREAMLINER')) return '787';
  if (/^E(17[05]|7[05][LS])/.test(code) || text.includes('E175') || text.includes('EMBRAER 175')) return 'E175';

  return '';
}
