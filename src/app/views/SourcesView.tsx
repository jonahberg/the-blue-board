/**
 * Sources — where every number on this dashboard comes from.
 *
 * Task 8 fills in the full ten-card panel. This file already carries the attribution rows
 * because they are a LICENCE obligation rather than presentation, and `tests/compliance.js`
 * pins them:
 *  - Schedules are AeroDataBox, never Flightradar24. Crediting FR24 for schedule data is an
 *    FR24 terms violation; FR24 is credited for live aircraft positions only.
 *  - The basemap is CARTO over OpenStreetMap data, which is ODbL — the credit must be
 *    visible wherever tiles render (the Leaflet attribution control carries it on the map,
 *    this panel carries it in prose).
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Source = {
  name: string;
  href: string;
  used: string;
};

const SOURCES: Source[] = [
  {
    name: 'AeroDataBox',
    href: 'https://aerodatabox.com',
    used: 'Schedule data via AeroDataBox — departure and arrival boards, scheduled and actual times, aircraft assignment.',
  },
  {
    name: 'Flightradar24',
    href: 'https://www.flightradar24.com',
    used: 'Live aircraft positions, altitude, speed, heading and squawk on the Live Ops map. Positions only — never schedules.',
  },
  {
    name: 'CARTO',
    href: 'https://carto.com/attributions',
    used: 'Dark basemap tiles for the Live Ops and radar maps.',
  },
  {
    name: 'OpenStreetMap',
    href: 'https://www.openstreetmap.org/copyright',
    used: 'The map data behind those tiles, © OpenStreetMap contributors, licensed under the Open Database License (ODbL).',
  },
  {
    name: 'Aviation Weather Center (NOAA)',
    href: 'https://aviationweather.gov',
    used: 'METAR observations and flight-category readings at every tracked airport.',
  },
  {
    name: 'FAA NAS Status',
    href: 'https://nasstatus.faa.gov',
    used: 'Ground stops, ground delay programs, departure and arrival delays, runway configuration and airport closures.',
  },
  {
    name: 'Iowa Environmental Mesonet',
    href: 'https://mesonet.agron.iastate.edu',
    used: 'NEXRAD composite radar imagery overlaid on the maps.',
  },
];

export default function SourcesView() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Where this data comes from</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4 text-sm">
            {SOURCES.map((source) => (
              <div key={source.name}>
                <dt className="font-medium text-foreground">
                  <a
                    className="underline-offset-2 hover:underline"
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.name}
                  </a>
                </dt>
                <dd className="text-muted-foreground">{source.used}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Independence and limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The Blue Board is not affiliated with, endorsed by, or operated by United Airlines,
            Inc. It is built by Jonah Berg, a United flyer, for the United community.
          </p>
          <p className="font-medium text-foreground">
            Do not use this dashboard for operational or safety-critical decisions. united.com and
            the airport display remain the systems of record for a flight you are about to board.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
