// ═══ THE THANKSGIVING TURKEY (Nov 22 2026) ═══
// The owner asked for "a fun little thanksgiving easter egg on the name / logo top left too for the
// day, maybe a turkey peeking out running around and then going to hide behind the logo". So on US
// Thanksgiving, by the visitor's own clock, a small turkey lives behind the wordmark at the top left
// of the dashboard header and of the content pages' header:
//
//   1. about 2 s after the header mounts its head peeks out of the wordmark's right-hand end, looks,
//      and ducks back;
//   2. it pops out and runs right along the header (legs alternating, a waddle),
//   3. stops, turns round (it always faces the way it is going), runs back,
//   4. and ducks behind the wordmark again.
//
// Afterwards it stays hidden, and every 60–90 s its head peeks out for a moment. Hovering the
// wordmark with a mouse, or tapping it, sends it on the full run again. With reduced motion it is a
// still head peeking from behind the wordmark all day. `?gobble=1` on the landing address turns it on
// for that page load, so the owner can see it before the day.
//
// This module is the DOM-free part: the date, the override, the geometry and the choreography as
// data. src/scripts/turkey-egg.ts plays it (one timer at a time, CSS transforms and opacity only);
// src/app/shell/TurkeyEgg.tsx and src/components/site/SiteHeader.astro mount it. The drawing's
// colours are in src/styles/global.css (`.bb-turkey`), so no hex literal is needed here.

import { hashTailParams } from './tab-hash.js';

/** The landing-address parameter that turns the egg on for one page load: `?gobble=1`. */
export const GOBBLE_PARAM = 'gobble';

/**
 * Is `date`, read in the visitor's own time zone, US Thanksgiving: the fourth Thursday of November?
 * The first Thursday falls on the 1st–7th, so the fourth falls on the 22nd–28th (Nov 26 2026,
 * Nov 25 2027, Nov 23 2028; Nov 30 2028 is a fifth Thursday and is not it).
 *
 * @param {Date} date
 * @returns {boolean}
 */
export function isThanksgiving(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const day = date.getDate();
  return date.getMonth() === 10 && date.getDay() === 4 && day >= 22 && day <= 28;
}

/**
 * The local midnight that starts Thanksgiving in `year`.
 * @param {number} year
 * @returns {Date}
 */
export function thanksgivingDay(year) {
  const firstWeekday = new Date(year, 10, 1).getDay();
  const firstThursday = 1 + ((4 - firstWeekday + 7) % 7);
  return new Date(year, 10, firstThursday + 21);
}

/**
 * Does the landing address carry `gobble=1`, in the query or trapped after the '#' (the shapes
 * src/lib/tab-hash.js tolerates: '/#live?gobble=1', '/#schedule&gobble=1')? Read once, at load,
 * by the caller, before anything rewrites the address.
 *
 * @param {{search?: string, hash?: string}} [loc]
 * @returns {boolean}
 */
export function gobblePreview({ search = '', hash = '' } = {}) {
  const on = (params) => String(params.get(GOBBLE_PARAM) ?? '').trim() === '1';
  try {
    return on(new URLSearchParams(String(search ?? ''))) || on(new URLSearchParams(hashTailParams(hash)));
  } catch {
    return false;
  }
}

/**
 * Does the egg show? On Thanksgiving by the visitor's clock, or all day with the preview override.
 * @param {Date} date
 * @param {boolean} [preview]
 * @returns {boolean}
 */
export function holidayEggOn(date, preview = false) {
  return preview === true || isThanksgiving(date);
}

// ── Geometry ────────────────────────────────────────────────────────────────────────────────────

/**
 * The drawing, in CSS px: 22 tall (the header is 44 / 48), 28 wide with its tail fan, facing right.
 * `peek` is how much of its front (head, beak and wattle) shows when it peeks.
 */
export const TURKEY = Object.freeze({ width: 28, height: 22, peek: 9 });

/** Kept clear between the turkey and the next thing in the header (the LIVE chip, a control). */
export const GAP_SPARE_PX = 4;

/**
 * Below this much free gap (before the spare) the turkey only peeks: the whole bird plus the spare
 * does not fit, and a run that cannot leave the wordmark is just a bigger peek.
 */
export const MIN_RUN_GAP_PX = TURKEY.width + GAP_SPARE_PX + 2;

/** The farthest it runs, however wide the header: it stays close to its hiding place. */
export const MAX_RUN_PX = 150;

/**
 * The plan for a measured gap: the clipping box's width (`room`, the wordmark's right edge to the
 * next visible element less the spare), the box-relative x of the hidden, peeking and far positions
 * (the box's left edge is the wordmark's right edge, so x < 0 is behind the letters), and whether
 * there is room to run.
 *
 * @param {number} gapPx the free gap to the right of the wordmark
 * @returns {{mode: 'run'|'peek', room: number, hiddenX: number, peekX: number, farX: number}}
 */
export function turkeyPlan(gapPx) {
  const gap = Number.isFinite(gapPx) ? gapPx : 0;
  const room = Math.max(0, Math.floor(gap - GAP_SPARE_PX));
  const hiddenX = -TURKEY.width - 1;
  // A gap narrower than the head still clips it at the box's right edge: never past the room.
  const peekX = -TURKEY.width + Math.min(TURKEY.peek, room);
  if (gap < MIN_RUN_GAP_PX) return { mode: 'peek', room, hiddenX, peekX, farX: peekX };
  const farX = Math.min(room - TURKEY.width, MAX_RUN_PX);
  return { mode: 'run', room, hiddenX, peekX, farX };
}

// ── Choreography ────────────────────────────────────────────────────────────────────────────────

/** Timings, ms. A full run at desktop width is about 6.7 s; a short phone run about 4 s. */
export const EGG_TIMING = Object.freeze({
  /** From the header mounting (or the tab first being visible) to the first peek. */
  introDelayMs: 2000,
  peekOutMs: 450,
  lookMs: 900,
  duckMs: 250,
  pauseMs: 450,
  turnMs: 220,
  turnLookMs: 450,
  /** A periodic peek holds this long. */
  peekHoldMs: 1400,
  /** Running speed and the bounds on one leg of the run. */
  runPxPerSecond: 90,
  minRunMs: 700,
  maxRunMs: 2000,
  /** Between periodic peeks: 60–90 s, at random. */
  idleMinMs: 60_000,
  idleMaxMs: 90_000,
});

/**
 * One step of the show: where the turkey moves to (`x`, box-relative px), which way it faces
 * (1 right, -1 left), how long the move takes (`ms`, also how long the step lasts), its easing, and
 * the pose CSS animates on top: 'run' moves the legs and waddles, 'look' tilts the head, 'hop'
 * gives one small hop, 'still' nothing.
 *
 * @typedef {{name: string, x: number, face: 1|-1, ms: number, ease: string, pose: 'still'|'run'|'look'|'hop'}} EggStep
 */

/** How long one leg of the run takes over `distance` px. */
export function runLegMs(distance) {
  const { runPxPerSecond, minRunMs, maxRunMs } = EGG_TIMING;
  const ms = Math.round((Math.max(0, distance) / runPxPerSecond) * 1000);
  return Math.min(maxRunMs, Math.max(minRunMs, ms));
}

/**
 * The periodic peek: head out, a look, and back.
 * @param {ReturnType<typeof turkeyPlan>} plan
 * @returns {EggStep[]}
 */
export function peekSteps(plan) {
  const t = EGG_TIMING;
  return [
    { name: 'peek', x: plan.peekX, face: 1, ms: t.peekOutMs, ease: 'ease-out', pose: 'still' },
    { name: 'look', x: plan.peekX, face: 1, ms: t.peekHoldMs, ease: 'linear', pose: 'look' },
    { name: 'duck', x: plan.hiddenX, face: 1, ms: t.duckMs, ease: 'ease-in', pose: 'still' },
  ];
}

/**
 * The full show: peek, look, duck, then (with room) out, turn, back and gone. Without room to run
 * it is the peek alone.
 *
 * @param {ReturnType<typeof turkeyPlan>} plan
 * @returns {EggStep[]}
 */
export function runSteps(plan) {
  if (plan.mode !== 'run') return peekSteps(plan);
  const t = EGG_TIMING;
  const legMs = runLegMs(plan.farX - plan.hiddenX);
  return [
    { name: 'peek', x: plan.peekX, face: 1, ms: t.peekOutMs, ease: 'ease-out', pose: 'still' },
    { name: 'look', x: plan.peekX, face: 1, ms: t.lookMs, ease: 'linear', pose: 'look' },
    { name: 'duck', x: plan.hiddenX, face: 1, ms: t.duckMs, ease: 'ease-in', pose: 'still' },
    { name: 'pause', x: plan.hiddenX, face: 1, ms: t.pauseMs, ease: 'linear', pose: 'still' },
    { name: 'out', x: plan.farX, face: 1, ms: legMs, ease: 'cubic-bezier(0.3, 0, 0.6, 1)', pose: 'run' },
    { name: 'turn', x: plan.farX, face: -1, ms: t.turnMs, ease: 'ease-in-out', pose: 'still' },
    { name: 'hop', x: plan.farX, face: -1, ms: t.turnLookMs, ease: 'linear', pose: 'hop' },
    { name: 'back', x: plan.hiddenX, face: -1, ms: legMs, ease: 'cubic-bezier(0.4, 0, 0.7, 1)', pose: 'run' },
  ];
}

/** Total length of a list of steps, ms. */
export function stepsMs(steps) {
  return steps.reduce((sum, s) => sum + s.ms, 0);
}

/**
 * How long until the next periodic peek: 60–90 s.
 * @param {() => number} [random]
 * @returns {number}
 */
export function nextPeekDelayMs(random = Math.random) {
  const r = Math.min(1, Math.max(0, Number(random()) || 0));
  return Math.round(EGG_TIMING.idleMinMs + r * (EGG_TIMING.idleMaxMs - EGG_TIMING.idleMinMs));
}

// ── The drawing ─────────────────────────────────────────────────────────────────────────────────

/**
 * The turkey, facing right, as markup for the egg's clipping box: a mover (travel and facing), a
 * bob (waddle, look, hop) and the SVG. Classes only; the fills are `.bb-turkey .tk-*` in
 * global.css. No text, no title, nothing focusable: the box is `aria-hidden`.
 */
export const TURKEY_MARKUP = [
  '<span class="bb-turkey-mover"><span class="bb-turkey-bob">',
  `<svg class="bb-turkey-svg" viewBox="-2 0 ${TURKEY.width} ${TURKEY.height}" width="${TURKEY.width}" height="${TURKEY.height}" focusable="false">`,
  // Tail fan, behind the body: five feathers radiating from the back, with lighter tips.
  '<g class="tk-tail">',
  ...[-70, -46, -22, 2, 26].map((deg, i) => {
    const tone = ['tk-f1', 'tk-f2', 'tk-f3', 'tk-f2', 'tk-f1'][i];
    return `<g transform="rotate(${deg} 9.5 13.5)"><ellipse class="${tone}" cx="9.5" cy="6.8" rx="2.5" ry="5.2"/><ellipse class="tk-tip" cx="9.5" cy="2.9" rx="1.6" ry="1.4"/></g>`;
  }),
  '</g>',
  // Legs, under the body: each a thin shank and a forward toe, hinged at the hip.
  '<g class="tk-leg tk-leg-a"><path d="M11 17.2 L10.6 21.2 L12.6 21.2"/></g>',
  '<g class="tk-leg tk-leg-b"><path d="M14 17.2 L14.4 21.2 L16.4 21.2"/></g>',
  // Body and wing.
  '<ellipse class="tk-body" cx="12.6" cy="13.2" rx="6.4" ry="5.2"/>',
  '<path class="tk-wing" d="M8.6 12.4 C10.4 10.2 14.4 10.6 15.6 13.2 C14.4 15.8 11 16.4 8.6 12.4 Z"/>',
  // Neck, head, eye, beak and the red wattle.
  '<path class="tk-neck" d="M16 10.6 C16.6 8.6 18 7 19.6 6.6 L21 8.4 C19.6 9.2 18.8 10.8 18.6 12.4 Z"/>',
  '<circle class="tk-head" cx="20.6" cy="5.4" r="2.7"/>',
  '<circle class="tk-eye" cx="21.4" cy="4.7" r="0.75"/>',
  '<path class="tk-beak" d="M22.9 4.6 L25.8 5.6 L22.9 6.6 Z"/>',
  '<path class="tk-wattle" d="M22.4 6.4 C23.6 7 23.6 8.6 23 9.8 C22.4 10.8 21.4 10.4 21.4 9.4 C21.4 8.4 22 7.6 22.4 6.4 Z"/>',
  '</svg></span></span>',
].join('');
