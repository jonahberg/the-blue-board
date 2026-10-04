// ═══ COUNTED NOUNS ═══
// "1 TRACKED PROJECTS" shipped on the GUM tracker page (phone QA, Oct 3 2026) because each
// page hand-rolled its own `count === 1 ? … : …`, and most of them did not bother. Every
// place a tracker counts things goes through these three instead.

/**
 * The noun for a count: `plural(1, 'project')` → "project", `plural(2, 'project')` →
 * "projects". Irregular plurals pass their own form.
 *
 * @param {number} count
 * @param {string} singular
 * @param {string} [pluralForm]  defaults to `${singular}s`.
 * @returns {string}
 */
export function plural(count, singular, pluralForm) {
  return Number(count) === 1 ? singular : pluralForm || `${singular}s`;
}

/**
 * The count and its noun: "1 project", "0 projects", "12 airports".
 *
 * @param {number} count
 * @param {string} singular
 * @param {string} [pluralForm]
 * @returns {string}
 */
export function countLabel(count, singular, pluralForm) {
  return `${count} ${plural(count, singular, pluralForm)}`;
}

/**
 * A counted subject with its verb: "1 project is", "3 projects are". For sentences whose
 * subject is the count — "4 projects are tracked at ORD" read "1 projects are tracked at GUM".
 *
 * @param {number} count
 * @param {string} singular
 * @param {string} [pluralForm]
 * @returns {string}
 */
export function countIs(count, singular, pluralForm) {
  return `${countLabel(count, singular, pluralForm)} ${Number(count) === 1 ? 'is' : 'are'}`;
}
