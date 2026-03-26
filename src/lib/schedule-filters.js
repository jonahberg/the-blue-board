export function getScheduleFleetFamily(modelCode, modelText = '') {
  const code = String(modelCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const text = String(modelText || '').toUpperCase();

  if (/^(B?73|73|7M)/.test(code) || text.includes('737')) return '737';
  if (/^(A?31|31|A?32|32)/.test(code) || /(A319|A320|A321)/.test(text)) return 'A320';
  if (/^(B?75|75)/.test(code) || text.includes('757')) return '757';
  if (/^(B?76|76)/.test(code) || text.includes('767')) return '767';
  if (/^(B?77|77)/.test(code) || text.includes('777')) return '777';
  if (/^(B?78|78)/.test(code) || text.includes('787') || text.includes('DREAMLINER')) return '787';

  return '';
}
