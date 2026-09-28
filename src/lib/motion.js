// Reduced-motion helpers for motion the global CSS rule cannot reach: Leaflet's JS `flyTo`
// and `scrollIntoView({ behavior: 'smooth' })`, both animated by script (audit F52).

/**
 * Does the visitor ask for reduced motion? False wherever matchMedia is unavailable.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * The `behavior` for a scripted scroll: 'smooth', or 'auto' (a jump) under reduced motion.
 * @param {boolean} [reduce]
 * @returns {'smooth'|'auto'}
 */
export function scrollBehavior(reduce = prefersReducedMotion()) {
  return reduce ? 'auto' : 'smooth';
}
