/**
 * "What it costs to keep this free" — the cost-transparency bars inside the About popover
 * (inventory §13), and since Nov 2026 one line of "cover a day" truth above them.
 *
 * Lazily fetched: `/api/support-stats` (the bars) and `/api/support-status` (the line) are
 * requested the FIRST time the popover opens and never on page load, because nobody has asked
 * what the dashboard costs until they open the menu that has the donate link in it.
 *
 * Defensive by design, and the failure mode is the point — a network error, a non-200, an
 * unexpected shape or a `configured:false` live feed all render NOTHING. This widget may
 * only ever add to the popover; a broken cost meter must never be why the About links
 * stop working. The same goes for the coverage line: it appears only when the support status
 * is configured and for today (src/lib/cover-a-day.js), and otherwise is simply absent. The
 * shaping rules live in `src/lib/support-meter.js` and `src/lib/cover-a-day.js` with tests.
 */

import { useEffect, useState } from 'react';

import { DAILY_COST_USD, todayLine } from '@/lib/cover-a-day.js';
import { supportMeterModel } from '@/lib/support-meter.js';
import { fetchSupportStats } from '../data/api';
import { useSupportStatus } from '../state/support-status';

type Row = { key: string; label: string; valueLabel: string; pct: number; warn: boolean };
type Model = { rows: Row[]; note: string } | null;

export function SupportMeter({ active }: { active: boolean }) {
  const [model, setModel] = useState<Model>(null);
  const [asked, setAsked] = useState(false);
  const status = useSupportStatus(active);
  const coverage = status ? todayLine(status) : null;

  useEffect(() => {
    if (!active || asked) return;
    setAsked(true);
    fetchSupportStats()
      .then((data) => setModel(supportMeterModel(data) as Model))
      .catch(() => {
        /* silent — see the header */
      });
  }, [active, asked]);

  if (!model && !coverage) return null;

  return (
    <div className="mb-2.5 space-y-1.5 border-b pb-2.5">
      {coverage ? (
        <p className="text-[11px]">
          <span className="font-semibold">{coverage}</span>{' '}
          <span className="text-muted-foreground">${DAILY_COST_USD} keeps the site running for a day.</span>
        </p>
      ) : null}
      {model?.rows.map((row) => (
        <div key={row.key}>
          <div className="flex justify-between gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{row.label}</span>
            {/* The figure, not the bar, is the reading — an amber bar past 85 % is a
                second signal on a number that is already on screen. */}
            <span className={row.warn ? 'text-bb-warn' : undefined}>
              {row.valueLabel}
              {row.warn ? ' · tight' : ''}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className={`h-full rounded-full ${row.warn ? 'bg-bb-warn' : 'bg-primary'}`}
              style={{ width: `${row.pct}%` }}
            />
          </div>
        </div>
      ))}
      {model?.note ? <p className="text-[10px] text-muted-foreground">{model.note}</p> : null}
    </div>
  );
}
