// ═══ FLIGHT PAGE — THE SHARE CARD (1200 × 630) ═══
// What a link preview of /flight/UA929 shows: the flight number large, the route, ONE status line
// and the site's name. The words come from the same verdict the page leads with
// (flight-verdict.js `status` + `line`), so the card and the page cannot disagree. Status colour is
// only ever on status words that say the same thing alone.
//
// The element tree is plain `{type, props}` objects, which satori (inside @vercel/og) renders with
// no React in the function. Colours are the dark theme's tokens (src/styles/global.css), converted
// from OKLCH because the renderer reads only sRGB; they are the card's only colour literals.
//
// Pure: no I/O, no clock.

import { flightPageView } from './flight-page-view.js';
import { formatLocalTime } from './flight-verdict.js';
import { airportTz } from './time-format.js';

/** The dark tokens in sRGB: --background, --card, --border, --foreground, --muted-foreground, --primary, bb-ok, bb-warn, --destructive, bb-info. */
export const CARD_COLORS = Object.freeze({
  background: '#0a0a0a',
  card: '#171717',
  border: '#2e2e2e',
  foreground: '#fafafa',
  muted: '#a1a1a1',
  primary: '#3f93f7',
  ok: '#51c672',
  warn: '#d4ab4f',
  bad: '#ff6467',
  info: '#3fbcf0',
});

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * The card's words for one payload.
 *
 * @param {any} payload  /api/flight.
 * @param {number} nowSec
 * @returns {{ident: string, route: string, place: string, status: {text: string, tone?: string|null}[], line: string, asOf: string}}
 */
export function flightCardModel(payload, nowSec) {
  const ident = String(payload?.ident || '');
  const view = flightPageView(payload, nowSec, { stableDays: true });
  if (view.status !== 'ok') {
    return {
      ident,
      route: view.routeLine || '',
      place: '',
      status: [{ text: view.status === 'unavailable' ? 'Live status on The Blue Board' : 'Not on the boards right now' }],
      line: 'Live status, delays and on-time history',
      asOf: '',
    };
  }
  // A preview is a snapshot that a message thread keeps: it says when it was taken.
  const tz = airportTz(view.trip.origin.code);
  const date = new Date(nowSec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz || 'UTC' });
  return {
    ident,
    route: `${view.trip.origin.code} → ${view.trip.dest.code}`,
    place: view.routeLine,
    status: view.verdict.status,
    line: view.verdict.line,
    asOf: `Status as of ${formatLocalTime(nowSec, tz)}, ${date}`,
  };
}

const div = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });
const text = (style, value) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: value } });

/**
 * The element tree for satori.
 *
 * @param {ReturnType<typeof flightCardModel>} model
 */
export function flightCardTree(model) {
  const c = CARD_COLORS;
  const toneColor = (tone) => (tone ? c[tone] || c.foreground : c.foreground);
  return div(
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      flexDirection: 'column',
      justifyContent: 'space-between',
      backgroundColor: c.background,
      borderTop: `8px solid ${c.primary}`,
      padding: '64px 72px 56px',
      fontFamily: 'Geist',
      color: c.foreground,
    },
    [
      div({ justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }, [
        div({ flexDirection: 'column' }, [
          text({ fontFamily: 'Geist Mono', fontSize: 132, fontWeight: 600, letterSpacing: -4, lineHeight: 1 }, model.ident),
          text({ fontFamily: 'Geist Mono', fontSize: 48, fontWeight: 600, color: c.muted, marginTop: 20 }, model.route || ' '),
          text({ fontSize: 28, color: c.muted, marginTop: 10 }, model.place || ' '),
        ]),
        div({ flexDirection: 'column', alignItems: 'flex-end', paddingTop: 8 }, [
          text({ fontSize: 24, fontWeight: 500, letterSpacing: 3, color: c.foreground }, 'THE BLUE BOARD'),
          text({ fontFamily: 'Geist Mono', fontSize: 22, color: c.muted, marginTop: 6 }, 'theblueboard.co'),
        ]),
      ]),
      div({ flexDirection: 'column', width: '100%' }, [
        div(
          { fontSize: 52, fontWeight: 500, lineHeight: 1.15 },
          model.status.map((part) => ({ type: 'span', props: { style: { color: toneColor(part.tone), whiteSpace: 'pre' }, children: part.text } })),
        ),
        text({ fontSize: 32, color: c.muted, marginTop: 12 }, model.line || ' '),
        text({ fontFamily: 'Geist Mono', fontSize: 22, color: c.muted, marginTop: 18 }, model.asOf || ' '),
      ]),
    ],
  );
}
