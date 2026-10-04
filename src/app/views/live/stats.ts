/** The shape `computeLiveStats()` returns, named so the strip and the view agree on it. */
export type LiveStats = {
  airborne: number;
  /** Every flight in the feed, unfiltered — what the 24-hour airborne graph samples. */
  airborneAll: number;
  ground: number;
  climbing: number;
  cruising: number;
  descending: number;
  starlink: number;
  avgAlt: string;
  avgSpd: string;
  utilization: string;
  note: string;
  phaseGroups: Record<string, number>;
};
