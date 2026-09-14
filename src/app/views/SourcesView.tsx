/**
 * Sources — where every number on this dashboard comes from (inventory §26).
 *
 * Several of these rows are LICENCE obligations rather than presentation, and
 * `tests/compliance.test.js` pins them:
 *  - Schedules are AeroDataBox, never Flightradar24. Crediting FR24 for schedule data is
 *    an FR24 terms violation; FR24 is credited for live aircraft positions only.
 *  - The basemap is CARTO over OpenStreetMap data, which is ODbL — the credit must be
 *    visible wherever tiles render (the Leaflet attribution control carries it on the map,
 *    this panel carries it in prose).
 *
 * The freshness pill is the one fix to the shipped panel: the Starlink tracker card read
 * "LIVE" while carrying the `fresh-daily` class (`legacy/index.html:888`), so the label and
 * the styling disagreed about the same fact. It is a once-a-day community sync — DAILY.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type Freshness = 'LIVE' | 'DAILY' | 'TILES' | 'COMPUTED';

type Source = {
  icon: string;
  name: string;
  freshness?: Freshness;
  desc: string;
  links?: { label: string; href: string }[];
};

/** Freshness is a claim about data age, so it is always a word — never a colour alone. */
const FRESHNESS_TONE: Record<Freshness, string> = {
  LIVE: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
  DAILY: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  TILES: 'border-border bg-muted/60 text-muted-foreground',
  COMPUTED: 'border-border bg-muted/60 text-muted-foreground',
};

const SOURCES: Source[] = [
  {
    icon: '📡',
    name: 'Live Flight Positions — Flightradar24',
    freshness: 'LIVE',
    desc: 'Real-time aircraft positions with registration, origin, destination, aircraft type, and flight number. Updates every 30 seconds. Positions only — never schedules.',
    links: [{ label: 'flightradar24.com →', href: 'https://www.flightradar24.com' }],
  },
  {
    icon: '📅',
    name: 'Flight Schedule — AeroDataBox',
    freshness: 'LIVE',
    desc: 'Schedule data via AeroDataBox: airport departure and arrival boards with status, gate, terminal, and aircraft info.',
    links: [{ label: 'aerodatabox.com →', href: 'https://aerodatabox.com' }],
  },
  {
    icon: '✈️',
    name: 'Fleet Database — United Fleet Site',
    freshness: 'DAILY',
    desc: 'Comprehensive fleet data: mainline aircraft with type, config, WiFi, IFE, seats, delivery year.',
    links: [
      { label: 'United Fleet Site →', href: 'https://unitedfleetsite.com/' },
      {
        label: 'Google Sheet →',
        href: 'https://docs.google.com/spreadsheets/d/1ZlYgN_IZmd6CSx_nXnuP0L0PiodapDRx3RmNkIpxXAo',
      },
    ],
  },
  {
    icon: '⚡',
    name: 'Starlink Tracker — @martinamps',
    freshness: 'DAILY',
    desc: 'Starlink-equipped United aircraft with fleet stats & predictions. Community-maintained tracker, synced once a day.',
    links: [
      {
        label: 'github.com/martinamps/ua-starlink-tracker →',
        href: 'https://github.com/martinamps/ua-starlink-tracker',
      },
      { label: 'unitedstarlinktracker.com →', href: 'https://unitedstarlinktracker.com' },
    ],
  },
  {
    icon: '🌦',
    name: 'Aviation Weather — AWC',
    freshness: 'LIVE',
    desc: 'METAR observations and flight-category readings for hub airports, from the Aviation Weather Center (NOAA).',
    links: [{ label: 'aviationweather.gov →', href: 'https://aviationweather.gov' }],
  },
  {
    icon: '🌧',
    name: 'NEXRAD Radar — Iowa State / NWS',
    freshness: 'LIVE',
    desc: 'Composite NEXRAD radar imagery overlaid on maps.',
    links: [{ label: 'Iowa State Mesonet →', href: 'https://mesonet.agron.iastate.edu' }],
  },
  {
    icon: '🗺',
    name: 'Basemap — CARTO / OpenStreetMap',
    freshness: 'TILES',
    desc: 'Dark basemap tiles by CARTO. Map data © OpenStreetMap contributors, licensed under the Open Database License (ODbL).',
    links: [
      { label: 'carto.com →', href: 'https://carto.com/attributions' },
      { label: 'openstreetmap.org/copyright →', href: 'https://www.openstreetmap.org/copyright' },
    ],
  },
  {
    icon: '🏛',
    name: 'NAS Status — FAA',
    freshness: 'LIVE',
    desc: 'National Airspace System status, ground stops, ground delay programs, departure and arrival delays, runway configuration and closures.',
    links: [{ label: 'nasstatus.faa.gov →', href: 'https://nasstatus.faa.gov' }],
  },
  {
    icon: '🛠',
    name: 'Route Estimation — Algorithmic',
    freshness: 'COMPUTED',
    desc: 'Origin/destination airports estimated using aircraft position, heading, and nearest airport matching. Routes marked as "estimated" — not from flight plans.',
  },
];

const COMMUNITY: Source[] = [
  {
    icon: '💬',
    name: 'r/UnitedAirlines',
    desc: 'The United Airlines community on Reddit — news, trip reports, MileagePlus discussion, and more.',
    links: [{ label: 'reddit.com/r/UnitedAirlines →', href: 'https://www.reddit.com/r/UnitedAirlines/' }],
  },
];

function SourceCard({ source }: { source: Source }) {
  return (
    <Card size="sm" className="min-w-0">
      <CardContent className="flex gap-3">
        <span aria-hidden="true" className="text-xl leading-none">
          {source.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {source.name}
            {source.freshness ? (
              <Badge
                variant="outline"
                className={`font-mono text-[9px] tracking-wide ${FRESHNESS_TONE[source.freshness]}`}
              >
                {source.freshness}
              </Badge>
            ) : null}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{source.desc}</p>
          {source.links?.length ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {source.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center text-xs text-primary underline-offset-2 hover:underline md:min-h-0"
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SourcesView() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 p-3 md:p-6">
      <h2 className="text-base font-semibold text-primary">📋 Data Sources &amp; Credits</h2>

      {SOURCES.map((source) => (
        <SourceCard key={source.name} source={source} />
      ))}

      <h2 className="pt-3 text-sm font-semibold text-primary">🤝 Community</h2>
      {COMMUNITY.map((source) => (
        <SourceCard key={source.name} source={source} />
      ))}

      <div className="rounded-md border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-primary">Disclaimer:</strong> This dashboard is an independent
        project and is not affiliated with, endorsed by, or connected to United Airlines, Inc. All
        trademarks belong to their respective owners. Flight tracking data is sourced from publicly
        available ADS-B receivers. Route estimates are algorithmic approximations and may not
        reflect actual flight plans.{' '}
        <strong className="text-foreground">
          Do not use this dashboard for operational or safety-critical decisions.
        </strong>{' '}
        united.com and the airport display remain the systems of record for a flight you are about
        to board.
      </div>
    </div>
  );
}
