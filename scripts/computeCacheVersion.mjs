// Compute the service-worker CACHE_VERSION string from a git commit SHA.
//
// Why: previously CACHE_VERSION was a manually-bumped constant ('v8'). When
// v1.5.6 changed CSP to forbid inline scripts and moved handlers to external
// files, returning users with cached pre-1.5.6 index.html silently broke
// because the cache was never invalidated. Wiring CACHE_VERSION to the commit
// SHA means every deploy gets a fresh cache key automatically.
//
// Format: 'v9-{first8charsOfSha}', or 'v9-dev' for local builds without a SHA.

export const CACHE_VERSION_PLACEHOLDER = '__BUILD_SHA__';

const VERSION_PREFIX = 'v9';
const SHA_LENGTH = 8;

export function computeCacheVersion(sha) {
  if (!sha) return `${VERSION_PREFIX}-dev`;
  return `${VERSION_PREFIX}-${sha.slice(0, SHA_LENGTH)}`;
}
