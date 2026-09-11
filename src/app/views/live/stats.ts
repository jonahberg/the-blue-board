/** The shape `computeLiveStats()` returns, named so the strip and the view agree on it. */
export type LiveStats = {
  airborne: number;
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
