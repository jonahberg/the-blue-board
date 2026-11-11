// @vitest-environment jsdom
/**
 * The brief on screen: the header row (shell/Ticker), the sidebar panel and the sheet
 * (features/Brief*.tsx), driven by the real BriefProvider with `fetch` stubbed at the network
 * edge and bodies built by the endpoint's own `briefResponseBody()` from the fixtures.
 *
 * What is pinned:
 *  - the row is a real button with an accessible name, the same h-7 as the ticker it replaces,
 *    and NOT a live region (IropsAnnouncer is the one announcer, DESIGN.md);
 *  - no brief / a failed fetch / a stale brief → the rotating ticker (aria-live="off") instead;
 *  - a chip with a target is a link with a real deep-link href; one without (radio, flow) or one
 *    that would go nowhere (the tab already showing) is plain text, never a dead button;
 *  - text is text: markup in a brief renders as characters;
 *  - the poll: on mount, every 2 minutes while visible, and on becoming visible.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { briefResponseBody } from '../api/brief';
import { buildBriefFacts } from '../src/lib/brief-facts.js';
import { radioFactsFromStatus } from '../src/lib/brief-radio.js';
import { buildTemplateBrief } from '../src/lib/brief-template.js';
import { verifyBrief } from '../src/lib/brief-verify.js';

const ctl = vi.hoisted(() => ({ wide: false, setCurrent: vi.fn(), flights: [] as Array<Record<string, unknown>>, faaUnknownSince: null as number | null }));

vi.mock('../src/app/state/feed', () => ({ useFeed: () => ({ flights: ctl.flights }) }));
vi.mock('../src/app/state/fleet', () => ({ useFleet: () => ({ fleetDb: [], starlink: { tails: new Set() } }) }));
vi.mock('../src/app/state/irops', () => ({ useIrops: () => ({ score: null }) }));
vi.mock('../src/app/state/weather', () => ({ useWeather: () => ({ faaIndex: {}, faaUnknownSince: ctl.faaUnknownSince }) }));
vi.mock('../src/app/state/schedule', () => ({
  HUB_ORDER: ['ORD', 'DEN'],
  useHubHealth: () => ({ hubs: [], byHub: {} }),
  useSchedule: () => ({ setCurrent: ctl.setCurrent }),
}));

const { Ticker } = await import('../src/app/shell/Ticker');
const { BriefSidebarPanel } = await import('../src/app/features/BriefPanel');
const { default: BriefSheet } = await import('../src/app/features/BriefSheet');
const { BriefProvider } = await import('../src/app/state/brief');
const { UiProvider, useUi } = await import('../src/app/state/ui');

const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'brief', `${name}.json`), 'utf8'));

function factsOf(name: string) {
  const fx = fixture(name);
  const nowMs = Date.parse(fx.nowIso);
  const radio = Object.entries(fx.radio || {}).flatMap(([hub, s]) => radioFactsFromStatus(hub, s, { nowMs }));
  return buildBriefFacts({ ...fx.sources, extraFacts: radio }, { nowMs }).facts;
}

/** A GET /api/brief body for a fixture: its template, or a model candidate the verifier keeps. */
function body(name: string, { candidate, agoMs = 2 * 60_000 }: { candidate?: any; agoMs?: number } = {}) {
  const facts = factsOf(name);
  let brief: any = buildTemplateBrief(facts);
  let source = 'template';
  if (candidate) {
    const v = verifyBrief(candidate, facts);
    if (!v.ok) throw new Error(`fixture candidate rejected: ${JSON.stringify(v.report)}`);
    brief = v.brief;
    source = 'model';
  }
  const at = new Date(Date.now() - agoMs).toISOString();
  return briefResponseBody({
    id: 1, generated_at: at, checked_at: at, source, template_reason: null, tone: brief.tone, headline: brief.headline,
    items: brief.items, traveler_note: brief.traveler_note ?? null, headline_fact_ids: [], facts,
    verifier: { itemsIn: brief.items.length },
  } as any, Date.now());
}

function disruptedWithRadio() {
  const radio = factsOf('ground-stop-with-radio').find((f) => f.kind === 'radio') as unknown as { id: string; quote: string };
  return body('ground-stop-with-radio', {
    candidate: {
      headline: 'A ground stop is holding flights into Newark until 8:00 PM ET.',
      tone: 'disrupted',
      items: [
        { text: 'The FAA has a ground stop in effect for flights into Newark until 8:00 PM ET because of heavy traffic.', fact_ids: ['faa.active.EWR.gs'] },
        { text: `On Newark approach frequencies, controllers were heard reporting "${radio.quote}".`, fact_ids: [radio.id] },
        { text: '39 arrivals are scheduled at Newark in the next hour against a planned rate of 36.', fact_ids: ['flow.EWR.arrivals'] },
      ],
      traveler_note: { text: "If you are flying to Newark, check your flight's status before you leave for the airport.", fact_ids: ['faa.active.EWR.gs'] },
    },
  });
}

let responses: Array<() => Response>;
let fetchMock: ReturnType<typeof vi.fn>;

function serve(...bodies: Array<unknown | 'fail'>) {
  responses = bodies.map((b) => () => (b === 'fail' ? Response.json({ error: 'x' }, { status: 503 }) : Response.json(b)));
}

function TabSwitch({ to }: { to: string }) {
  const { setTab } = useUi();
  return <button type="button" onClick={() => setTab(to as never)}>switch-{to}</button>;
}

function tree(extra: React.ReactNode = null) {
  return (
    <UiProvider>
      <BriefProvider>
        <Ticker />
        <BriefSidebarPanel />
        <BriefSheet />
        {extra}
      </BriefProvider>
    </UiProvider>
  );
}

function mount(extra: React.ReactNode = null) {
  return render(tree(extra));
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  window.history.replaceState(null, '', '/');
  ctl.wide = false;
  ctl.setCurrent.mockReset();
  ctl.flights = [];
  ctl.faaUnknownSince = null;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width: 1024px') ? ctl.wide : false,
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  }));
  responses = [];
  fetchMock = vi.fn(async (url: string) => {
    if (!String(url).startsWith('/api/brief')) return Response.json({}, { status: 404 });
    const next = responses.length > 1 ? responses.shift()! : responses[0];
    return next ? next() : Response.json({}, { status: 503 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the header row', () => {
  it('is a 28px button named by tone and headline, inside no live region', async () => {
    serve(body('storm-day'));
    mount();
    await settle();
    const row = screen.getByRole('button', { name: 'Disrupted: A ground stop is holding flights into Newark. Open the full brief.' });
    expect(row.closest('[aria-live]')).toBeNull();
    expect(row.getAttribute('aria-live')).toBeNull();
    expect(row.parentElement?.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-7', 'shrink-0']));
    expect(row.querySelector('.truncate')?.textContent).toBe('A ground stop is holding flights into Newark.');
    expect(row.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('calm is plain: a word, no icon, no status colour', async () => {
    serve(body('calm-afternoon'));
    mount();
    await settle();
    const row = screen.getByRole('button', { name: /^Calm: United is running smoothly right now\./ });
    expect(row.querySelector('svg.lucide-octagon-alert, svg.lucide-triangle-alert')).toBeNull();
    expect(row.innerHTML).not.toMatch(/text-bb-warn|text-destructive/);
  });

  it('watch carries an icon and a word as well as the colour', async () => {
    serve(body('planned-only-watch'));
    mount();
    await settle();
    const row = screen.getByRole('button', { name: /^Watch: / });
    const mark = within(row).getByText('Watch');
    expect(mark.className).toContain('text-bb-warn');
    expect(mark.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    ['no brief yet', () => briefResponseBody(null, Date.now())],
    ['a stale brief', () => body('calm-afternoon', { agoMs: 45 * 60_000 })],
    ['a failed fetch', () => 'fail' as const],
  ])('falls back to the rotating ticker for %s', async (_label, make) => {
    serve(make());
    const { container } = mount();
    await settle();
    expect(screen.queryByRole('button', { name: /full brief/i })).toBeNull();
    expect(container.querySelector('[aria-live="off"]')).not.toBeNull();
    expect(container.querySelector('#brief-panel')).toBeNull();
  });

  it('with no brief and a stale FAA answer, the ticker says "FAA status unknown since", neutral with an icon, never "All systems normal"', async () => {
    ctl.faaUnknownSince = Date.now() - 40 * 60_000;
    serve(briefResponseBody(null, Date.now()));
    const { container } = mount();
    await settle();
    const ticker = container.querySelector('[aria-live="off"]')!;
    expect(ticker.textContent).toMatch(/^FAA status unknown since \d\d:\d\d$/);
    expect(ticker.textContent).not.toMatch(/All systems normal/);
    const line = ticker.querySelector('p')!;
    expect(line.className).toContain('text-muted-foreground');
    expect(line.className).not.toMatch(/bb-ok|bb-warn|destructive/);
    expect(line.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('a failed refresh keeps a brief that is still current, until it ages out', async () => {
    // Checked 2 minutes ago, then every poll fails.
    serve(body('calm-afternoon', { agoMs: 2 * 60_000 }), 'fail');
    mount();
    await settle();
    expect(screen.getByRole('button', { name: /full brief/i })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 10);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /full brief/i })).toBeTruthy();
    // 26 minutes after the first load the brief is 28 minutes old: still current.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60_000);
    });
    expect(screen.getByRole('button', { name: /full brief/i })).toBeTruthy();
    // Past 30 minutes since checkedAt, with no good answer since: the ticker returns.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(screen.queryByRole('button', { name: /full brief/i })).toBeNull();
  });

  it('a successful answer of no-brief or stale takes a shown brief down at once', async () => {
    serve(body('calm-afternoon'), briefResponseBody(null, Date.now()));
    mount();
    await settle();
    expect(screen.getByRole('button', { name: /full brief/i })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 10);
    });
    expect(screen.queryByRole('button', { name: /full brief/i })).toBeNull();
  });
});

describe('an emergency squawk', () => {
  const squawking = { fr24id: 'x1', squawk: '7700', callsign: 'UAL123', flightIATA: 'UA123', onGround: false, alt: 35000, vr: 0, spd: 450 };

  it('takes the row\'s text while it lasts, keeps the tone word and the button, and the name says both', async () => {
    ctl.flights = [squawking];
    serve(body('calm-afternoon'));
    const view = mount();
    await settle();
    const row = screen.getByRole('button', {
      name: 'Calm. EMERGENCY: UAL123 (7700). Brief: United is running smoothly right now. Open the full brief.',
    });
    const text = row.querySelector('.truncate')!;
    expect(text.textContent).toBe('⚠️ EMERGENCY: UAL123 (7700)');
    expect(text.className).toContain('text-destructive');
    expect(within(row).getByText('Calm')).toBeTruthy();
    expect(row.closest('[aria-live]')).toBeNull();
    // Still the button that opens the brief.
    fireEvent.click(row);
    await settle();
    expect(screen.getByRole('dialog', { name: 'United is running smoothly right now.' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await settle();

    // The squawk clears: the headline returns.
    ctl.flights = [{ ...squawking, squawk: '2341' }];
    view.rerender(tree());
    await settle();
    const back = screen.getByRole('button', { name: 'Calm: United is running smoothly right now. Open the full brief.' });
    expect(back.querySelector('.truncate')?.textContent).toBe('United is running smoothly right now.');
  });
});

describe('the sheet and the sidebar panel', () => {
  it('below lg the row opens the full brief as a sheet titled by the headline', async () => {
    serve(disruptedWithRadio());
    mount();
    await settle();
    // Below lg there is no sidebar panel: the sheet is the full brief.
    fireEvent.click(screen.getByRole('button', { name: /full brief/i }));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'A ground stop is holding flights into Newark until 8:00 PM ET.' });
    expect(within(dialog).getByText(/Written from 25 live facts and checked against them\./)).toBeTruthy();
    expect(within(dialog).getByText(/model-written summaries/)).toBeTruthy();
    expect(within(dialog).getByText(/If you are flying to Newark/)).toBeTruthy();
    expect(within(dialog).getByText('How this was written')).toBeTruthy();
  });

  it('chips: a target is a deep link, radio and flow are plain text, never a button', async () => {
    serve(disruptedWithRadio());
    mount();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /full brief/i }));
    await settle();
    const dialog = screen.getByRole('dialog');
    const gs = within(dialog).getAllByRole('link', { name: 'FAA ground stop · EWR' });
    expect(gs[0].getAttribute('href')).toBe('/?tab=weather&hub=EWR');
    const radio = within(dialog).getByText(/^ATC radio · \d{1,2}:\d{2} [AP]M ET$/);
    expect(radio.closest('a, button')).toBeNull();
    expect(radio.className).toContain('text-bb-info');
    expect(radio.querySelector('svg.lucide-radio-tower')).not.toBeNull();
    expect(within(dialog).getByText('EWR arrivals').closest('a, button')).toBeNull();
    // Every chip carries the fact it stands for.
    expect(gs[0].getAttribute('title')).toMatch(/^The FAA has a ground stop in effect for flights heading to Newark/);
  });

  it('following a chip closes the sheet and lands on the hub card', async () => {
    serve(disruptedWithRadio());
    function TabProbe() {
      const { tab, pendingScroll } = useUi();
      return <output data-testid="probe">{`${tab}|${pendingScroll ?? ''}`}</output>;
    }
    mount(<TabProbe />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /full brief/i }));
    await settle();
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('link', { name: 'FAA ground stop · EWR' })[0]);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('probe').textContent).toBe('weather|hub-card-EWR');
  });

  it('a schedule chip picks that hub\'s board', async () => {
    serve(body('storm-day'));
    mount();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /full brief/i }));
    await settle();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'EWR 41%' }));
    await settle();
    expect(ctl.setCurrent).toHaveBeenCalledWith({ hub: 'EWR' });
  });

  it('a chip to the tab already showing is text, not a dead link', async () => {
    serve(body('live-2026-11-10-evening'));
    mount(<TabSwitch to="schedule" />);
    await settle();
    // On Live (the default tab), "647 airborne" would go nowhere.
    fireEvent.click(screen.getByRole('button', { name: /full brief/i }));
    await settle();
    expect(within(screen.getByRole('dialog')).getByText('647 airborne').closest('a')).toBeNull();
  });

  it('at lg on Live the panel is open in the sidebar and the row reveals it instead of opening a sheet', async () => {
    ctl.wide = true;
    serve(body('calm-afternoon'));
    mount();
    await settle();
    const panel = document.getElementById('brief-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('aria-live')).toBeNull();
    expect(within(panel).getByRole('heading', { level: 2, name: 'United is running smoothly right now.' })).toBeTruthy();
    expect(within(panel).getByText('This brief was listed straight from the data, with no AI text.')).toBeTruthy();
    const row = screen.getByRole('button', { name: /Go to the full brief/ });
    expect(row.getAttribute('aria-controls')).toBe('brief-panel');
    panel.scrollIntoView = vi.fn();
    fireEvent.click(row);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(panel);
  });

  it('renders brief text as text, never as markup', async () => {
    const b = body('calm-afternoon');
    b.brief!.headline = 'Evil <img src=x onerror="alert(1)"> <b>bold</b>';
    b.brief!.items[0].text = '<script>alert(2)</script> item';
    ctl.wide = true;
    serve(b);
    mount();
    await settle();
    const panel = document.getElementById('brief-panel')!;
    expect(panel.querySelector('img, b, script')).toBeNull();
    expect(panel.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(panel.textContent).toContain('<script>alert(2)</script> item');
  });
});

describe('the poll', () => {
  it('fetches on mount, every 2 minutes while visible, never while hidden, and on becoming visible', async () => {
    serve(body('calm-afternoon'));
    mount();
    await settle();
    const calls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/brief')).length;
    expect(calls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    expect(calls()).toBe(2);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60_000);
    });
    expect(calls()).toBe(2);

    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(calls()).toBe(3);
    hidden.mockRestore();
  });

  it('a brief left in a background tab past its freshness is gone the moment the tab returns, before the refetch answers', async () => {
    serve(body('calm-afternoon', { agoMs: 20 * 60_000 }));
    mount();
    await settle();
    expect(screen.getByRole('button', { name: /full brief/i })).toBeTruthy();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    // The refetch on return never answers: the stale check alone must take the brief down.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryByRole('button', { name: /full brief/i })).toBeNull();
    hidden.mockRestore();
  });
});
