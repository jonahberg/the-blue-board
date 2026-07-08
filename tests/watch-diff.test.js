import { describe, it, expect } from 'vitest';
import { diffWatch, isSignificantStatusChange, isUnknownStatus } from '../api/_watch-diff.js';

describe('_watch-diff meaningful-change engine', () => {
  describe('isUnknownStatus', () => {
    it('treats empty / unknown / placeholders as unknown', () => {
      for (const v of ['', '  ', 'Unknown', 'unknown', 'N/A', '—', '-', null, undefined]) {
        expect(isUnknownStatus(v)).toBe(true);
      }
    });
    it('treats real statuses as known', () => {
      for (const v of ['Scheduled', 'Departed', 'En Route', 'Landed', 'Cancelled']) {
        expect(isUnknownStatus(v)).toBe(false);
      }
    });
  });

  describe('isSignificantStatusChange (ported from main.js)', () => {
    it('notifies Scheduled → Departed', () => {
      expect(isSignificantStatusChange('Scheduled', 'Departed')).toBe(true);
    });
    it('notifies Scheduled → En Route', () => {
      expect(isSignificantStatusChange('Scheduled', 'En Route')).toBe(true);
    });
    it('notifies on cancellation / diversion / landing', () => {
      expect(isSignificantStatusChange('En Route', 'Cancelled')).toBe(true);
      expect(isSignificantStatusChange('En Route', 'Diverted')).toBe(true);
      expect(isSignificantStatusChange('En Route', 'Landed')).toBe(true);
    });
    it('does not notify on identical status', () => {
      expect(isSignificantStatusChange('Scheduled', 'Scheduled')).toBe(false);
    });
    it('does not notify with empty operands', () => {
      expect(isSignificantStatusChange('', 'Departed')).toBe(false);
      expect(isSignificantStatusChange('Scheduled', '')).toBe(false);
    });
  });

  describe('diffWatch', () => {
    const empty = {};

    it('rule 1: never notifies on transition INTO unknown, and preserves the last status', () => {
      const r = diffWatch('UA123', { lastStatus: 'Departed' }, { status: 'Unknown' });
      expect(r.notify).toBe(false);
      expect(r.nextState.lastStatus).toBe('Departed'); // preserved, not overwritten
    });

    it('does not notify on the first observation (no prior status)', () => {
      const r = diffWatch('UA123', empty, { status: 'Scheduled' });
      expect(r.notify).toBe(false);
      expect(r.nextState.lastStatus).toBe('Scheduled'); // stored for next comparison
    });

    it('notifies on Scheduled → Departed', () => {
      const r = diffWatch('UA123', { lastStatus: 'Scheduled' }, { status: 'Departed' });
      expect(r.notify).toBe(true);
      expect(r.kind).toBe('status');
      expect(r.title).toContain('UA123');
      expect(r.title).toContain('Departed');
      expect(r.nextState.lastStatus).toBe('Departed');
    });

    it('does NOT duplicate-notify when nothing changed', () => {
      const r = diffWatch('UA123', { lastStatus: 'Departed', lastGate: 'C12', lastEquip: 'N12345' },
        { status: 'Departed', gate: 'C12', equip: 'N12345' });
      expect(r.notify).toBe(false);
      expect(r.kind).toBe('none');
    });

    it('notifies on a gate change between two known gates', () => {
      const r = diffWatch('UA123', { lastStatus: 'Scheduled', lastGate: 'C12' },
        { status: 'Scheduled', gate: 'C15' });
      expect(r.notify).toBe(true);
      expect(r.kind).toBe('gate');
      expect(r.body).toContain('C12');
      expect(r.body).toContain('C15');
      expect(r.nextState.lastGate).toBe('C15');
    });

    it('does NOT treat unknown→known gate as a change', () => {
      const r = diffWatch('UA123', { lastStatus: 'Scheduled' }, { status: 'Scheduled', gate: 'C15' });
      expect(r.notify).toBe(false);
      expect(r.nextState.lastGate).toBe('C15'); // still stored
    });

    it('notifies on an equipment / registration swap', () => {
      const r = diffWatch('UA123', { lastStatus: 'Scheduled', lastEquip: 'N12345' },
        { status: 'Scheduled', equip: 'N67890' });
      expect(r.notify).toBe(true);
      expect(r.kind).toBe('equip');
      expect(r.nextState.lastEquip).toBe('N67890');
    });

    it('prioritizes a status transition over a simultaneous gate change', () => {
      const r = diffWatch('UA123', { lastStatus: 'Scheduled', lastGate: 'C12' },
        { status: 'Departed', gate: 'C15' });
      expect(r.kind).toBe('status');
      // both new states are still persisted
      expect(r.nextState.lastStatus).toBe('Departed');
      expect(r.nextState.lastGate).toBe('C15');
    });
  });
});
