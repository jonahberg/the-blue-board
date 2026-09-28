/**
 * Fleet data for all 19 United Airlines aircraft type pages.
 * Split into per-type files for maintainability.
 */

import { _737_max_9 } from './737-max-9.js';
import { _737_max_8 } from './737-max-8.js';
import { _737_800 } from './737-800.js';
import { _737_900er } from './737-900er.js';
import { _737_900 } from './737-900.js';
import { _737_700 } from './737-700.js';
import { _757_200 } from './757-200.js';
import { _757_300 } from './757-300.js';
import { _767_300er } from './767-300er.js';
import { _767_400er } from './767-400er.js';
import { _777_200 } from './777-200.js';
import { _777_200er } from './777-200er.js';
import { _777_300er } from './777-300er.js';
import { _787_8_dreamliner } from './787-8-dreamliner.js';
import { _787_9_dreamliner } from './787-9-dreamliner.js';
import { _787_10_dreamliner } from './787-10-dreamliner.js';
import { a319 } from './a319.js';
import { a320 } from './a320.js';
import { a321neo } from './a321neo.js';

/** Display order: grouped by family, largest count first within family */
export const fleetOrder = [
  '737-800',
  '737-900er',
  '737-max-9',
  '737-max-8',
  '737-700',
  '737-900',
  'a319',
  'a320',
  'a321neo',
  '777-200er',
  '777-300er',
  '777-200',
  '787-9-dreamliner',
  '787-10-dreamliner',
  '787-8-dreamliner',
  '757-200',
  '757-300',
  '767-300er',
  '767-400er',
];

export const fleetNavLabels = {
  '737-800': '737-800 (141)',
  '737-900er': '737-900ER (136)',
  '737-max-9': 'MAX 9 (178)',
  '737-max-8': 'MAX 8 (123)',
  '737-700': '737-700 (40)',
  '737-900': '737-900 (12)',
  'a319': 'A319 (76)',
  'a320': 'A320 (68)',
  'a321neo': 'A321neo (76)',
  '777-200er': '777-200ER (55)',
  '777-300er': '777-300ER (22)',
  '777-200': '777-200 (19)',
  '787-9-dreamliner': '787-9 (59)',
  '787-10-dreamliner': '787-10 (21)',
  '787-8-dreamliner': '787-8 (12)',
  '757-200': '757-200 (40)',
  '757-300': '757-300 (21)',
  '767-300er': '767-300ER (37)',
  '767-400er': '767-400ER (16)',
};

export const fleetTypes = {
  '737-800': _737_800,
  '737-900er': _737_900er,
  '737-max-9': _737_max_9,
  '737-max-8': _737_max_8,
  '737-700': _737_700,
  '737-900': _737_900,
  'a319': a319,
  'a320': a320,
  'a321neo': a321neo,
  '777-200er': _777_200er,
  '777-300er': _777_300er,
  '777-200': _777_200,
  '787-9-dreamliner': _787_9_dreamliner,
  '787-10-dreamliner': _787_10_dreamliner,
  '787-8-dreamliner': _787_8_dreamliner,
  '757-200': _757_200,
  '757-300': _757_300,
  '767-300er': _767_300er,
  '767-400er': _767_400er,
};
