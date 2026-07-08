/**
 * Hub data for the 9 airport pages The Blue Board tracks: United's 8 official
 * hubs (ORD, DEN, IAH, EWR, SFO, IAD, LAX, GUM) plus the Tokyo-Narita (NRT)
 * gateway. See src/data/facts.js for the canonical hub-count constants.
 * Split into per-hub files for maintainability.
 */

import { ord } from './ord.js';
import { den } from './den.js';
import { iah } from './iah.js';
import { ewr } from './ewr.js';
import { sfo } from './sfo.js';
import { iad } from './iad.js';
import { lax } from './lax.js';
import { nrt } from './nrt.js';
import { gum } from './gum.js';

export const hubOrder = ['ord', 'den', 'iah', 'ewr', 'sfo', 'iad', 'lax', 'nrt', 'gum'];

export const hubNavLabels = {
  ord: 'ORD · Chicago',
  den: 'DEN · Denver',
  iah: 'IAH · Houston',
  ewr: 'EWR · Newark',
  sfo: 'SFO · San Francisco',
  iad: 'IAD · Washington',
  lax: 'LAX · Los Angeles',
  nrt: 'NRT · Tokyo',
  gum: 'GUM · Guam',
};

export const hubs = { ord, den, iah, ewr, sfo, iad, lax, nrt, gum };
