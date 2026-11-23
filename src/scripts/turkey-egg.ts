/**
 * Plays the Thanksgiving turkey (src/lib/holiday-egg.js) behind a header wordmark. Framework-free,
 * so the dashboard (src/app/shell/TurkeyEgg.tsx) and the content pages (SiteHeader.astro, through
 * its processed `<script>`, bundled to `_astro/`, never inline) run the same code.
 *
 * `root` is the egg's clipping box (`.bb-turkey`, styled in global.css), placed inside the wordmark
 * element (`position: relative`): its left edge is the wordmark's right edge. The box's width is the
 * free gap from there to the next visible element after the wordmark's link (the LIVE chip, the
 * content pages' nav or menu button) less a few px, measured on mount, on every size change of the
 * header (ResizeObserver) and before every peek and run. The bird slides out of the box's left edge
 * as if from behind a wall, and the box's right edge is a hard stop short of the next control.
 *
 * One step at a time, one timer at a time: each step sets the mover's transform (a CSS transition)
 * and a `data-pose` the CSS animates (legs and waddle, a look, a hop), then waits for the step to
 * end. No per-frame JavaScript. Timers stop when the tab is hidden and on cleanup. With reduced
 * motion there are no timers at all: the head peeks, still.
 */

import {
  EGG_TIMING,
  gobblePreview,
  holidayEggOn,
  nextPeekDelayMs,
  peekSteps,
  runSteps,
  TURKEY_MARKUP,
  turkeyPlan,
} from '../lib/holiday-egg.js';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

type Plan = ReturnType<typeof turkeyPlan>;
type Step = ReturnType<typeof runSteps>[number];

/**
 * The free gap to the right of `wordmark`: to the first visible element after `link` (skipping
 * anything not displayed), else to the end of `link`'s parent's content box.
 */
export function measureGap(wordmark: Element, link: Element): number {
  const right = wordmark.getBoundingClientRect().right;
  for (let next = link.nextElementSibling; next; next = next.nextElementSibling) {
    const r = next.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r.left - right;
  }
  const parent = link.parentElement;
  if (!parent) return 0;
  const pad = Number.parseFloat(getComputedStyle(parent).paddingRight) || 0;
  return parent.getBoundingClientRect().right - pad - right;
}

/**
 * Mount the turkey into `root` (an empty, `aria-hidden` element inside the wordmark). Returns the
 * cleanup, which stops every timer and listener and empties `root`.
 */
export function mountTurkey(root: HTMLElement, { random = Math.random }: { random?: () => number } = {}): () => void {
  const wordmark = root.parentElement;
  const link = root.closest('a') ?? wordmark;
  if (!wordmark || !link) return () => {};

  root.setAttribute('aria-hidden', 'true');
  // A constant from the lib, never anything the visitor or a feed supplied.
  root.innerHTML = TURKEY_MARKUP;
  const mover = root.firstElementChild as HTMLElement;

  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null;
  let reduced = mq?.matches === true;
  let plan: Plan = turkeyPlan(0);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let introPlayed = false;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  /** The one timer: setting it clears whatever was pending. */
  const after = (ms: number, fn: () => void) => {
    stop();
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };

  const place = (x: number, face: number, ms: number, ease: string) => {
    mover.style.transitionDuration = `${ms}ms`;
    mover.style.transitionTimingFunction = ease;
    mover.style.transform = `translateX(${x}px) scaleX(${face})`;
  };

  const measure = () => {
    plan = turkeyPlan(measureGap(wordmark, link));
    root.style.width = `${plan.room}px`;
  };

  /** Behind the wordmark, facing right, at once (no transition: it cannot be seen there). */
  const hide = () => {
    root.dataset.pose = 'still';
    root.dataset.step = 'hidden';
    place(plan.hiddenX, 1, 0, 'linear');
  };

  /** Reduced motion: the head peeking out, still, all day. */
  const stillPeek = () => {
    root.dataset.pose = 'still';
    root.dataset.step = 'still-peek';
    place(plan.peekX, 1, 0, 'linear');
  };

  const play = (steps: Step[]) => {
    busy = true;
    let i = 0;
    const next = () => {
      if (i >= steps.length) {
        busy = false;
        hide();
        idle();
        return;
      }
      const step = steps[i];
      i += 1;
      root.dataset.pose = step.pose;
      root.dataset.step = step.name;
      place(step.x, step.face, step.ms, step.ease);
      after(step.ms, next);
    };
    next();
  };

  const fullRun = () => {
    introPlayed = true;
    measure();
    play(runSteps(plan));
  };

  /** The next periodic peek, 60–90 s from now, while the tab is visible and motion is fine. */
  const idle = () => {
    if (reduced || document.hidden) return;
    after(nextPeekDelayMs(random), () => {
      measure();
      play(peekSteps(plan));
    });
  };

  /** (Re)start from rest: the intro 2 s on if it has not played, else the periodic peeks. */
  const resume = () => {
    stop();
    busy = false;
    measure();
    if (reduced) {
      stillPeek();
      return;
    }
    hide();
    if (document.hidden) return;
    if (introPlayed) idle();
    else after(EGG_TIMING.introDelayMs, fullRun);
  };

  // A hover with a mouse, or a tap (a touch fires pointerenter too), sends it on the full run. The
  // link's own behaviour is untouched: nothing here prevents or stops the event.
  const onPointerEnter = () => {
    if (busy || reduced || document.hidden) return;
    fullRun();
  };

  const onVisibility = () => {
    if (document.hidden) {
      stop();
      busy = false;
      if (!reduced) hide();
    } else if (!busy) {
      resume();
    }
  };

  const onMotionChange = () => {
    reduced = mq?.matches === true;
    resume();
  };

  // The gap moves: the LIVE chip grows when the feed lands, the watch count and refresh text
  // change, the viewport resizes. Re-measure on any size change in the header row.
  const ro =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          measure();
          if (reduced) stillPeek();
        })
      : null;
  if (ro) {
    ro.observe(wordmark);
    if (link.parentElement) ro.observe(link.parentElement);
    for (let el = link.nextElementSibling; el; el = el.nextElementSibling) ro.observe(el);
  }

  link.addEventListener('pointerenter', onPointerEnter);
  document.addEventListener('visibilitychange', onVisibility);
  mq?.addEventListener?.('change', onMotionChange);

  resume();

  return () => {
    stop();
    ro?.disconnect();
    link.removeEventListener('pointerenter', onPointerEnter);
    document.removeEventListener('visibilitychange', onVisibility);
    mq?.removeEventListener?.('change', onMotionChange);
    root.innerHTML = '';
    root.style.width = '';
    delete root.dataset.pose;
    delete root.dataset.step;
  };
}

/**
 * The content pages: on Thanksgiving (or with `?gobble=1` on this address) put a turkey behind every
 * `[data-turkey-wordmark]` on the page. Nothing is added, and no timer runs, on any other day.
 */
export function mountTurkeysOnPage(doc: Document = document, now: Date = new Date()): Array<() => void> {
  const preview = gobblePreview({ search: doc.location?.search ?? '', hash: doc.location?.hash ?? '' });
  if (!holidayEggOn(now, preview)) return [];
  return [...doc.querySelectorAll<HTMLElement>('[data-turkey-wordmark]')].map((wordmark) => {
    const root = doc.createElement('span');
    root.className = 'bb-turkey';
    root.setAttribute('aria-hidden', 'true');
    wordmark.append(root);
    const cleanup = mountTurkey(root);
    return () => {
      cleanup();
      root.remove();
    };
  });
}
