/**
 * The Starlink chip on a My Flights equipment grid (inventory §19).
 *
 * Three different claims, and they must never look alike:
 *  - the tail is known AND on the Starlink roster → a CONFIRMATION.
 *  - the tail is known but not on the roster → `/api/check-flight` for this date.
 *  - no tail assigned yet → `/api/predict-flight`, a route BASE RATE. It says "likely",
 *    and a high percentage off a thin sample is demoted in words and shape as well as
 *    colour, because nobody should rebook on a statistic dressed as a fact.
 *
 * The bands and the low-data rule are `src/lib/starlink-prediction.js`.
 */

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { starlinkPredictionBadge, starlinkPredictionDate } from '@/lib/starlink-prediction.js';
import { fetchCheckFlight, fetchPredictFlight } from '../../data/api';
import type { PredictionResponse } from '../../data/api';
import { PREDICTION_TONE } from './tone';

type BadgeModel = {
  hidden: boolean;
  text: string;
  tone: string;
  lowData: boolean;
  title: string;
};

/** Module-level so a tab switch does not re-spend a prediction per card. */
const cache = new Map<string, PredictionResponse>();

export function StarlinkBadge({ flight, forecast }: { flight: string; forecast: boolean }) {
  const [model, setModel] = useState<BadgeModel | null>(null);

  useEffect(() => {
    if (!flight || flight === 'N/A') {
      setModel({ hidden: true, text: '', tone: 'muted', lowData: false, title: '' });
      return undefined;
    }
    // The forecast model is a date-agnostic route base rate, so it caches by flight
    // number alone; the tail-known lookup is about one calendar date.
    const today = starlinkPredictionDate();
    const key = forecast ? `forecast|${flight}` : `${flight}|${today}`;
    const cached = cache.get(key);
    if (cached) {
      setModel(starlinkPredictionBadge(cached, { forecast }) as BadgeModel);
      return undefined;
    }

    let cancelled = false;
    const request = forecast ? fetchPredictFlight(flight) : fetchCheckFlight(flight, today);
    request.then(
      (data) => {
        if (cancelled) return;
        if (data && data.probability !== undefined) cache.set(key, data);
        setModel(starlinkPredictionBadge(data, { forecast }) as BadgeModel);
      },
      () => {
        if (!cancelled) {
          setModel({ hidden: true, text: '', tone: 'muted', lowData: false, title: '' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [flight, forecast]);

  if (model === null) {
    return (
      <Badge variant="outline" className="ml-1 text-[9px] font-normal text-muted-foreground">
        ⚡ Checking…
      </Badge>
    );
  }
  if (model.hidden) return null;

  return (
    <Badge
      variant="outline"
      title={model.title}
      className={`ml-1 text-[9px] font-normal ${PREDICTION_TONE[model.tone] ?? PREDICTION_TONE.muted} ${
        model.lowData ? 'border-b-dashed' : ''
      }`}
    >
      {model.text}
    </Badge>
  );
}
