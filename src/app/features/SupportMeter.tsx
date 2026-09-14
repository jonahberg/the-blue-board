/**
 * "What it costs to keep this free" — the cost-transparency bars inside the About popover
 * (inventory §13).
 *
 * Lazily fetched: `/api/support-stats` is requested the FIRST time the popover opens and
 * never on page load, because nobody has asked what the dashboard costs until they open
 * the menu that has the donate link in it.
 *
 * Defensive by design, and the failure mode is the point — a network error, a non-200, an
 * unexpected shape or a `configured:false` live feed all render NOTHING. This widget may
 * only ever add to the popover; a broken cost meter must never be why the About links
 * stop working. The shaping rule lives in `src/lib/support-meter.js` with a test.
 */

import { useEffect, useState } from 'react';

import { supportMeterModel } from '@/lib/support-meter.js';
import { fetchSupportStats } from '../data/api';

type Row = { key: string; label: string; valueLabel: string; pct: number; warn: boolean };
type Model = { rows: Row[]; note: string } | null;

export function SupportMeter({ active }: { active: boolean }) {
  const [model, setModel] = useState<Model>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (!active || asked) return;
    setAsked(true);
    fetchSupportStats()
      .then((data) => setModel(supportMeterModel(data) as Model))
      .catch(() => {
        /* silent — see the header */
      });
  }, [active, asked]);

  if (!model) return null;

  return (
    <div className="mb-2.5 space-y-1.5 border-b pb-2.5">
      {model.rows.map((row) => (
        <div key={row.key}>
          <div className="flex justify-between gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{row.label}</span>
            {/* The figure, not the bar, is the reading — an amber bar past 85 % is a
                second signal on a number that is already on screen. */}
            <span className={row.warn ? 'text-amber-400' : undefined}>
              {row.valueLabel}
              {row.warn ? ' · tight' : ''}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className={`h-full rounded-full ${row.warn ? 'bg-amber-400' : 'bg-primary'}`}
              style={{ width: `${row.pct}%` }}
            />
          </div>
        </div>
      ))}
      {model.note ? <p className="text-[10px] text-muted-foreground">{model.note}</p> : null}
    </div>
  );
}
