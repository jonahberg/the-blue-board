// Pro feature kill-switches.
//
// Master: PRO_ENABLED=false → all Pro features disabled
// Per-feature: PRO_FEATURE_{NAME}_ENABLED=false → that feature disabled
//
// Default is enabled for both — only the literal string 'false' disables.
// This is intentional: forgetting to set the env var should NOT break Pro.
// Closes TODOs.md item: "Feature kill-switches for non-core via env flags."

export type ProFeature = 'checkout' | 'push' | 'risk_monitor';

const FEATURE_FLAG: Record<ProFeature, string> = {
  checkout: 'PRO_FEATURE_CHECKOUT_ENABLED',
  push: 'PRO_FEATURE_PUSH_ENABLED',
  risk_monitor: 'PRO_FEATURE_RISK_MONITOR_ENABLED',
};

export function isProEnabled(feature?: ProFeature): boolean {
  if (process.env.PRO_ENABLED === 'false') return false;
  if (!feature) return true;
  return process.env[FEATURE_FLAG[feature]] !== 'false';
}
