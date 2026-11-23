/**
 * The Thanksgiving turkey's DOM-free part (Nov 22 2026, src/lib/holiday-egg.js): the day is the
 * fourth Thursday of November by the visitor's own clock; `?gobble=1` previews it for one page load;
 * the clipping box never reaches past the free gap; and the choreography faces the way it travels,
 * ends hidden and lasts about 6–7 s at desktop width.
 *
 * Every date here is built from local parts (`new Date(y, m, d, h, …)`), never an ISO string, so the
 * midnight edges hold in whatever time zone the suite runs in.
 */

import { describe, expect, it } from 'vitest';

import {
  EGG_TIMING,
  GAP_SPARE_PX,
  GOBBLE_PARAM,
  MAX_RUN_PX,
  MIN_RUN_GAP_PX,
  TURKEY,
  TURKEY_MARKUP,
  gobblePreview,
  holidayEggOn,
  isThanksgiving,
  nextPeekDelayMs,
  peekSteps,
  runLegMs,
  runSteps,
  stepsMs,
  thanksgivingDay,
  turkeyPlan,
} from '../src/lib/holiday-egg.js';

const NOV = 10;

describe('isThanksgiving — the fourth Thursday of November, local time', () => {
  it('is the day in 2026, 2027 and 2028, from local midnight to the last millisecond', () => {
    for (const [y, d] of [
      [2026, 26],
      [2027, 25],
      [2028, 23],
    ]) {
      expect(isThanksgiving(new Date(y, NOV, d, 0, 0, 0, 0)), `${y}-11-${d} 00:00`).toBe(true);
      expect(isThanksgiving(new Date(y, NOV, d, 12, 30)), `${y}-11-${d} noon`).toBe(true);
      expect(isThanksgiving(new Date(y, NOV, d, 23, 59, 59, 999)), `${y}-11-${d} 23:59:59.999`).toBe(true);
    }
  });

  it('is not the day before or the day after, right up to the midnight edges', () => {
    expect(isThanksgiving(new Date(2026, NOV, 25, 23, 59, 59, 999))).toBe(false);
    expect(isThanksgiving(new Date(2026, NOV, 25, 12, 0))).toBe(false);
    expect(isThanksgiving(new Date(2026, NOV, 27, 0, 0, 0, 0))).toBe(false);
    expect(isThanksgiving(new Date(2026, NOV, 27, 12, 0))).toBe(false);
    expect(isThanksgiving(new Date(2027, NOV, 24, 23, 59, 59, 999))).toBe(false);
    expect(isThanksgiving(new Date(2027, NOV, 26, 0, 0))).toBe(false);
  });

  it('is not a fifth Thursday (Nov 30 2028), nor the third, nor today (Nov 22 2026, a Sunday)', () => {
    expect(new Date(2028, NOV, 30).getDay()).toBe(4);
    expect(isThanksgiving(new Date(2028, NOV, 30, 12))).toBe(false);
    expect(isThanksgiving(new Date(2028, NOV, 16, 12))).toBe(false);
    expect(isThanksgiving(new Date(2026, NOV, 19, 12))).toBe(false);
    expect(isThanksgiving(new Date(2026, NOV, 22, 12))).toBe(false);
  });

  it('is not a Thursday on the 22nd–28th of another month', () => {
    expect(new Date(2026, 9, 22).getDay()).toBe(4);
    expect(isThanksgiving(new Date(2026, 9, 22, 12))).toBe(false);
    expect(new Date(2026, 11, 24).getDay()).toBe(4);
    expect(isThanksgiving(new Date(2026, 11, 24, 12))).toBe(false);
  });

  it('agrees with thanksgivingDay on exactly one day of every November, 2020–2050', () => {
    for (let y = 2020; y <= 2050; y += 1) {
      const days = [];
      for (let d = 1; d <= 30; d += 1) if (isThanksgiving(new Date(y, NOV, d, 9))) days.push(d);
      expect(days, String(y)).toEqual([thanksgivingDay(y).getDate()]);
      expect(thanksgivingDay(y).getDay()).toBe(4);
    }
  });

  it('thanksgivingDay is local midnight on the known dates', () => {
    expect(thanksgivingDay(2026)).toEqual(new Date(2026, NOV, 26));
    expect(thanksgivingDay(2027)).toEqual(new Date(2027, NOV, 25));
    expect(thanksgivingDay(2028)).toEqual(new Date(2028, NOV, 23));
    expect(thanksgivingDay(2029)).toEqual(new Date(2029, NOV, 22));
    expect(thanksgivingDay(2030)).toEqual(new Date(2030, NOV, 28));
  });

  it('is false for anything that is not a valid Date', () => {
    expect(isThanksgiving(new Date(Number.NaN))).toBe(false);
    expect(isThanksgiving(/** @type {any} */ ('2026-11-26'))).toBe(false);
    expect(isThanksgiving(/** @type {any} */ (undefined))).toBe(false);
  });
});

describe('gobblePreview — `?gobble=1` on the landing address', () => {
  it('is the parameter named gobble', () => {
    expect(GOBBLE_PARAM).toBe('gobble');
  });

  it('is true for gobble=1 in the query, alone or among others', () => {
    expect(gobblePreview({ search: '?gobble=1' })).toBe(true);
    expect(gobblePreview({ search: '?utm_source=x&gobble=1' })).toBe(true);
    expect(gobblePreview({ search: '?gobble=1', hash: '#fleet' })).toBe(true);
  });

  it('is true when it is trapped after the "#", the shapes tab-hash.js tolerates', () => {
    expect(gobblePreview({ hash: '#live?gobble=1' })).toBe(true);
    expect(gobblePreview({ hash: '#schedule&gobble=1' })).toBe(true);
  });

  it('is false for any other value and for no parameter', () => {
    for (const search of ['?gobble=0', '?gobble=true', '?gobble=', '?gobble', '?gobbles=1', '?xgobble=1', '']) {
      expect(gobblePreview({ search }), search).toBe(false);
    }
    expect(gobblePreview({ hash: '#gobble=1' })).toBe(false);
    expect(gobblePreview({})).toBe(false);
    expect(gobblePreview()).toBe(false);
  });
});

describe('holidayEggOn', () => {
  it('is on on the day, or on any day with the preview', () => {
    expect(holidayEggOn(new Date(2026, NOV, 26, 8))).toBe(true);
    expect(holidayEggOn(new Date(2026, NOV, 22, 8))).toBe(false);
    expect(holidayEggOn(new Date(2026, NOV, 22, 8), true)).toBe(true);
    expect(holidayEggOn(new Date(2026, NOV, 22, 8), /** @type {any} */ ('1'))).toBe(false);
  });
});

describe('turkeyPlan — the clipping box and the positions in it', () => {
  it('runs only when the whole bird and the spare fit; under that it only peeks', () => {
    expect(MIN_RUN_GAP_PX).toBe(TURKEY.width + GAP_SPARE_PX + 2);
    expect(turkeyPlan(MIN_RUN_GAP_PX - 1).mode).toBe('peek');
    expect(turkeyPlan(MIN_RUN_GAP_PX).mode).toBe('run');
    expect(turkeyPlan(20).mode).toBe('peek');
    expect(turkeyPlan(0).mode).toBe('peek');
    expect(turkeyPlan(Number.NaN)).toEqual(turkeyPlan(0));
  });

  it('keeps the spare: the box is the gap less a few px, and never negative', () => {
    expect(GAP_SPARE_PX).toBeGreaterThanOrEqual(3);
    expect(turkeyPlan(100).room).toBe(100 - GAP_SPARE_PX);
    expect(turkeyPlan(100.9).room).toBe(Math.floor(100.9 - GAP_SPARE_PX));
    expect(turkeyPlan(2).room).toBe(0);
    expect(turkeyPlan(-40).room).toBe(0);
  });

  it('hidden is wholly behind the wordmark (left of the box), and the peek shows the head only', () => {
    for (const gap of [0, 10, 24, 40, 200, 900]) {
      const plan = turkeyPlan(gap);
      expect(plan.hiddenX + TURKEY.width).toBeLessThanOrEqual(0);
      const shown = plan.peekX + TURKEY.width;
      expect(shown).toBeLessThanOrEqual(TURKEY.peek);
      expect(shown).toBeLessThanOrEqual(plan.room);
    }
    expect(turkeyPlan(200).peekX + TURKEY.width).toBe(TURKEY.peek);
  });

  it('runs to the end of the room (its right edge on the box edge), never past it, at most MAX_RUN_PX out', () => {
    const mid = turkeyPlan(80);
    expect(mid.farX + TURKEY.width).toBe(mid.room);
    const wide = turkeyPlan(900);
    expect(wide.farX).toBe(MAX_RUN_PX);
    expect(wide.farX + TURKEY.width).toBeLessThanOrEqual(wide.room);
  });
});

describe('the choreography', () => {
  /** Every step stays inside the box: hidden at its left, never past its right edge. */
  const insideBox = (plan, steps) => steps.every((s) => s.x >= plan.hiddenX && s.x + TURKEY.width <= Math.max(plan.room, plan.peekX + TURKEY.width));

  it('the full run: peek, look, duck, out, turn, back, and it ends hidden', () => {
    const plan = turkeyPlan(600);
    const steps = runSteps(plan);
    expect(steps.map((s) => s.name)).toEqual(['peek', 'look', 'duck', 'pause', 'out', 'turn', 'hop', 'back']);
    expect(steps[0].x).toBe(plan.peekX);
    expect(steps.find((s) => s.name === 'out').x).toBe(plan.farX);
    expect(steps.at(-1).x).toBe(plan.hiddenX);
    expect(insideBox(plan, steps)).toBe(true);
  });

  it('runs facing the way it is travelling, turns round standing still, and only ducks back from a peek', () => {
    for (const gap of [MIN_RUN_GAP_PX, 60, 200, 900]) {
      const plan = turkeyPlan(gap);
      const steps = runSteps(plan);
      let x = plan.hiddenX;
      let face = 1;
      for (const s of steps) {
        if (s.pose === 'run') expect(Math.sign(s.x - x), `${gap}px ${s.name}`).toBe(s.face);
        // The one move it makes backwards: pulling its head back in after a peek.
        else if (s.x < x && s.face === 1) expect(s.name, `${gap}px ${s.name}`).toBe('duck');
        if (s.face !== face) expect(s.x, `${gap}px turn`).toBe(x);
        x = s.x;
        face = s.face;
      }
      expect(face).toBe(-1);
    }
  });

  it('runs its legs only while it moves along the header', () => {
    const steps = runSteps(turkeyPlan(600));
    expect(steps.filter((s) => s.pose === 'run').map((s) => s.name)).toEqual(['out', 'back']);
  });

  it('a full run at desktop width lasts about 6–7 s; a short phone run is shorter', () => {
    const desktop = stepsMs(runSteps(turkeyPlan(900)));
    expect(desktop).toBeGreaterThanOrEqual(6000);
    expect(desktop).toBeLessThanOrEqual(7000);
    const phone = stepsMs(runSteps(turkeyPlan(50)));
    expect(phone).toBeLessThan(desktop);
    expect(phone).toBeGreaterThan(3000);
  });

  it('each leg of the run takes 0.7–2 s, at about 90 px/s between', () => {
    expect(runLegMs(0)).toBe(EGG_TIMING.minRunMs);
    expect(runLegMs(90)).toBe(1000);
    expect(runLegMs(10_000)).toBe(EGG_TIMING.maxRunMs);
  });

  it('without room to run it only peeks: head out, a look, and back, never further', () => {
    const plan = turkeyPlan(20);
    const steps = runSteps(plan);
    expect(steps).toEqual(peekSteps(plan));
    expect(steps.map((s) => s.name)).toEqual(['peek', 'look', 'duck']);
    expect(steps.every((s) => s.face === 1 && s.pose !== 'run')).toBe(true);
    expect(steps.at(-1).x).toBe(plan.hiddenX);
    expect(Math.max(...steps.map((s) => s.x))).toBe(plan.peekX);
  });

  it('the periodic peek holds for a second or two', () => {
    const steps = peekSteps(turkeyPlan(600));
    const out = stepsMs(steps.slice(0, 2));
    expect(out).toBeGreaterThanOrEqual(1000);
    expect(out).toBeLessThanOrEqual(2000);
  });

  it('starts about 2 s after the header mounts', () => {
    expect(EGG_TIMING.introDelayMs).toBe(2000);
  });
});

describe('nextPeekDelayMs — 60 to 90 s, at random', () => {
  it('spans the range', () => {
    expect(nextPeekDelayMs(() => 0)).toBe(60_000);
    expect(nextPeekDelayMs(() => 0.5)).toBe(75_000);
    expect(nextPeekDelayMs(() => 0.999_999)).toBeLessThanOrEqual(90_000);
    expect(nextPeekDelayMs(() => 1)).toBe(90_000);
  });

  it('clamps a broken random source into the range', () => {
    expect(nextPeekDelayMs(() => Number.NaN)).toBe(60_000);
    expect(nextPeekDelayMs(() => 7)).toBe(90_000);
    expect(nextPeekDelayMs(() => -1)).toBe(60_000);
    const d = nextPeekDelayMs();
    expect(d).toBeGreaterThanOrEqual(60_000);
    expect(d).toBeLessThanOrEqual(90_000);
  });
});

describe('TURKEY_MARKUP — the drawing', () => {
  it('is an SVG with two legs that can alternate, a head, a beak and a wattle', () => {
    for (const part of ['<svg', 'tk-leg-a', 'tk-leg-b', 'tk-head', 'tk-beak', 'tk-wattle', 'tk-body', 'tk-tail']) {
      expect(TURKEY_MARKUP).toContain(part);
    }
    expect(TURKEY_MARKUP).toContain(`width="${TURKEY.width}" height="${TURKEY.height}"`);
  });

  it('says nothing and takes nothing: no text, no title, no link, no handler, no inline style', () => {
    // No text between or around the tags (asserted directly: stripping tags with a replace reads to
    // CodeQL as a sanitizer, js/incomplete-multi-character-sanitization).
    expect(TURKEY_MARKUP.trim()).toMatch(/^<[^]*>$/);
    expect(TURKEY_MARKUP).not.toMatch(/>\s*[^<\s][^<]*</);
    expect(TURKEY_MARKUP).not.toMatch(/<title|<text|<a\b|<button|tabindex|\son\w+=|style=/i);
  });

  it('carries no colour of its own: the fills are classes styled in global.css', () => {
    expect(TURKEY_MARKUP).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(|fill="|stroke="/i);
  });

  it('is no pictographic emoji', () => {
    expect(TURKEY_MARKUP).not.toMatch(/[\u{1F000}-\u{1FAFF}]/u);
  });
});
