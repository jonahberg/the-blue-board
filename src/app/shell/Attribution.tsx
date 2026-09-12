/**
 * The data-credit micro-text.
 *
 * Two of these lines are licence obligations rather than politeness: schedules are credited
 * to AeroDataBox (crediting Flightradar24 for schedule data would violate FR24's terms —
 * FR24 is credited for live positions only), and the basemap credit names CARTO and
 * OpenStreetMap, whose data is ODbL. `tests/compliance.test.js` pins both.
 */

export function Attribution() {
  return (
    <footer
      role="contentinfo"
      className="hidden shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-1 text-[10px] text-muted-foreground md:flex"
    >
      <span>
        Schedule data via{' '}
        <a
          className="underline-offset-2 hover:underline"
          href="https://aerodatabox.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          AeroDataBox
        </a>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Positions via{' '}
        <a
          className="underline-offset-2 hover:underline"
          href="https://www.flightradar24.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          FR24
        </a>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Weather{' '}
        <a
          className="underline-offset-2 hover:underline"
          href="https://aviationweather.gov"
          target="_blank"
          rel="noopener noreferrer"
        >
          AWC
        </a>{' '}
        ·{' '}
        <a
          className="underline-offset-2 hover:underline"
          href="https://nasstatus.faa.gov"
          target="_blank"
          rel="noopener noreferrer"
        >
          FAA
        </a>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Basemap ©{' '}
        <a
          className="underline-offset-2 hover:underline"
          href="https://carto.com/attributions"
          target="_blank"
          rel="noopener noreferrer"
        >
          CARTO
        </a>
        , ©{' '}
        <a
          className="underline-offset-2 hover:underline"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenStreetMap
        </a>{' '}
        contributors
      </span>
      <span aria-hidden="true">·</span>
      <span>Not affiliated with United Airlines, Inc.</span>
    </footer>
  );
}
