// Client-fallback IROPS severity engine: the F017 weighted score, the
// score→label/class thresholds, and the small-sample rate floor. Both updateIrops
// (client fallback) and renderIropsFromAPI (server path) import these so the
// <5/<15 thresholds live in exactly one place and cannot silently drift apart.

// F007/F015: a cancellation RATE from a tiny sample is a lie — one cancelled GUM
// flight on a 4-flight board is not a "25% cancellation rate". Only publish a rate
// when total >= 10 OR cancellations >= 3; below the floor, expose raw counts only.
export function iropsRateFloor(total, cancellations) {
  return total >= 10 || cancellations >= 3;
}

// F017: weight each flight once — 60m+ delays are ×2, the exclusive 30–60m bucket is
// ×1 (a 61-min delay must not score 1+2=3, i.e. as much as a cancellation). delayed30
// stays cumulative so the caller's ">30m" card remains truthful.
export function iropsScore({ cancellations = 0, delayed60 = 0, delayed30 = 0, diversions = 0, total = 0 } = {}) {
  if (!(total > 0)) return 0;
  const delayed30to60 = Math.max(0, delayed30 - delayed60);
  return ((cancellations * 3 + delayed60 * 2 + delayed30to60 + diversions * 2) / total * 100).toFixed(1);
}

export function iropsScoreCls(score) {
  return score < 5 ? 'low' : score < 15 ? 'med' : 'high';
}

export function iropsScoreLabel(score) {
  return score < 5 ? 'NORMAL OPERATIONS' : score < 15 ? 'MINOR DISRUPTION' : 'SIGNIFICANT DISRUPTION';
}
