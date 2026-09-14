/**
 * "Why might this flight be late?" — the AI delay explanation (inventory §27).
 *
 * Opened from `useUi().openDelayExplain(context)` by the risk badge on a My Flights card
 * and by the Schedule board's delay cell. Those two hand over DIFFERENT shapes (the card
 * mirrors the shipped `data-*` strings, the board passes live objects); reconciling them
 * is `buildDelayExplainBody()`'s job, not this component's.
 *
 * The score, the label and the contributing factors are painted IMMEDIATELY and stay
 * painted while the model is thinking — and if the request fails, they are still there.
 * The deterministic risk model is the thing the visitor came for; the prose is a bonus,
 * and a failed bonus must not blank out the numbers behind it. That is also why the
 * error is a line inside the body rather than a replacement for the dialog.
 *
 * `ctx.hubTime` is computed when the dialog OPENS, not when the badge rendered: "is this
 * a late-evening departure out of a hub that is already backed up?" is a question about
 * now, and a card can sit on screen for an hour.
 *
 * The explanation is written through `textContent` semantics — React text children — so
 * a model that returns markup renders as the characters it sent, never as HTML.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  asFactors,
  buildDelayExplainBody,
  hubLocalTime,
  riskLabelColor,
} from '@/lib/delay-explain-request.js';
import { HUB_TZ } from '@/lib/hubTz.js';
import { postDelayExplain } from '../data/api';
import { useUi } from '../state/ui';

type ExplainState =
  | { phase: 'loading' }
  | { phase: 'done'; explanation: string }
  | { phase: 'error'; message: string };

export default function DelayExplainDialog() {
  const { delayExplain, openDelayExplain } = useUi();
  const [state, setState] = useState<ExplainState>({ phase: 'loading' });
  // Bumped on every open, so a slow answer for the flight you closed cannot overwrite
  // the one you opened next.
  const generation = useRef(0);

  const context = delayExplain;
  const open = context !== null;

  const flight = String(context?.flight ?? '');
  const riskLabel = String(context?.riskLabel ?? 'LOW');
  const route = String(context?.route ?? '');
  const riskScore = Number(context?.riskScore);
  const factors = useMemo(
    () => asFactors((context?.factors ?? context?.riskFactors) as string[] | string | null) as string[],
    [context],
  );
  const riskColor = riskLabelColor(riskLabel);

  useEffect(() => {
    if (!context?.flight) return undefined;
    const run = generation.current + 1;
    generation.current = run;
    setState({ phase: 'loading' });

    const hub = typeof context.hub === 'string' ? context.hub : '';
    const body = buildDelayExplainBody({
      ...context,
      hubTime: hubLocalTime((HUB_TZ as Record<string, string>)[hub]),
    });

    let cancelled = false;
    postDelayExplain(body).then(
      (data) => {
        if (cancelled || generation.current !== run) return;
        if (data.error) {
          setState({ phase: 'error', message: data.error });
          return;
        }
        setState({ phase: 'done', explanation: data.explanation || 'No analysis available.' });
      },
      () => {
        if (cancelled || generation.current !== run) return;
        setState({ phase: 'error', message: 'Unable to reach analysis service' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [context]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : openDelayExplain(null))}>
      <DialogContent
        aria-label="AI delay risk explanation"
        className="max-w-[min(420px,calc(100vw-2rem))]"
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold text-primary">{flight}</span>
            {/* The colour comes from `RISK_BANDS` so it agrees with the badge that was
                clicked; the LABEL is always spelled out beside it. */}
            <Badge
              variant="outline"
              className="text-[10px] font-bold"
              style={{ backgroundColor: `${riskColor}20`, color: riskColor, borderColor: `${riskColor}66` }}
            >
              {riskLabel} RISK
            </Badge>
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            {route} · Score {Number.isFinite(riskScore) ? riskScore : 0}/100
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {state.phase === 'loading' ? (
            <div aria-busy="true">
              <p className="mb-2.5 text-xs text-muted-foreground">Analyzing delay risk…</p>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-[90%]" />
              </div>
            </div>
          ) : null}

          {state.phase === 'done' ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{state.explanation}</p>
          ) : null}

          {state.phase === 'error' ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-400">
              <span aria-hidden="true">⚠️ </span>
              {state.message}
            </p>
          ) : null}

          {factors.length > 0 ? (
            <div>
              <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Contributing Factors
              </h3>
              <ul className="space-y-1">
                {factors.map((factor) => (
                  <li key={factor} className="flex gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true">•</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <p className="border-t pt-2.5 text-[10px] text-muted-foreground">Powered by Claude AI</p>
      </DialogContent>
    </Dialog>
  );
}
