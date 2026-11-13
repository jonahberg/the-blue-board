/**
 * One hub's weather card.
 *
 * Three tiers, in the order someone actually reads them: SCAN (code, flight category, the
 * de-icing badge, the four metrics), STATUS (the one line that says whether the airport is
 * working), and DETAIL behind "▾ Details" (the plain-English explainers, the FAA advisory
 * links, the NOTAM and the raw observation). Nine cards are a lot of surface, and only the
 * hub someone cares about deserves the paragraph.
 *
 * Every decision shown here was already made by `buildHubCardModel()` — the category, the
 * colours, which status line wins and which card carries each jargon tooltip. This file
 * chooses layout and nothing else.
 *
 * The border colour and the category chip are the two places a raw hex reaches the DOM.
 * They come from `CAT_COLORS`/`OPS_COLORS` in `src/lib`, which are DATA (the shipped
 * palette, pinned by tests) rather than theme decisions — and the category is always spelled
 * out in text beside the colour, never signalled by it.
 *
 * The hub code is the card's identity link: that hub's Schedule board, in place (links
 * everywhere, part 2). Not this card (a `HubStatusLink kind="weather"` here would point at the card
 * it sits on). The airport name, the weather values, the status line and the details stay text.
 * Its 44 px touch box stays inside the card: it reaches about 10 px above and beside the code, and
 * the card's padding is 12 px.
 */

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { HubLink } from '../../features/EntityLinks';
import { JargonTerm } from '../../features/JargonTerm';

export type HubCardStatusPart = {
  text?: string;
  label?: string;
  window?: string;
  extras?: string[];
  jargon?: 'gdp' | 'groundstop' | null;
};

export type HubCardModel = {
  hub: string;
  name: string;
  cat: string;
  catColor: string;
  borderColor: string;
  metrics: { temp: string; wind: string; vis: string; clouds: string };
  runway: string;
  deice: boolean;
  status: { tone: 'delay' | 'caution' | 'normal'; prefix: string; parts: HubCardStatusPart[] };
  explainer: string;
  faaExplainer: string;
  advisoryUrls: string[];
  notam: string;
  raw: string;
  unavailable: boolean;
  hasDetail: boolean;
  markerLabel: string;
  markerDetail: string;
  /** The radar dot's colour: the flight category, never the worst-of ops colour. */
  markerColor: string;
  jargon: { metar: boolean };
};

const STATUS_TONE: Record<HubCardModel['status']['tone'], string> = {
  delay: 'text-destructive',
  caution: 'text-bb-warn',
  normal: 'text-bb-ok',
};

function StatusPart({ part }: { part: HubCardStatusPart }) {
  if (part.text !== undefined) return <>{part.text}</>;
  const label = part.label ?? '';
  return (
    <>
      {part.jargon ? <JargonTerm term={part.jargon}>{label}</JargonTerm> : label}
      {part.window}
      {part.extras?.length ? ` ${part.extras.join(' · ')}` : ''}
    </>
  );
}

export function HubCard({ model, highlighted }: { model: HubCardModel; highlighted: boolean }) {
  const [open, setOpen] = useState(false);
  const metrics = [
    ['Temperature', model.metrics.temp],
    ['Wind', model.metrics.wind],
    ['Visibility', model.metrics.vis],
    ['Ceiling', model.metrics.clouds],
  ] as const;

  return (
    <Card
      id={`hub-card-${model.hub}`}
      data-hub={model.hub}
      style={{ borderTopColor: model.borderColor }}
      className={cn(
        'gap-0 border-t-[3px] p-3 transition-[box-shadow,border-color] duration-300',
        highlighted && 'ring-2 ring-primary',
      )}
    >
      {/* A link row for the runtime guard (scripts/ui-audit.mjs): the card's code is a name. */}
      <div data-link-row="" className="flex items-center gap-2">
        <HubLink code={model.hub} tone="identity" className="font-mono text-base font-semibold" />
        {model.deice ? (
          <Badge
            variant="outline"
            className="border-bb-warn/40 px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-bb-warn"
          >
            De-ice
          </Badge>
        ) : null}
        <span
          style={{ backgroundColor: model.catColor }}
          className="ml-auto rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold text-black"
        >
          {model.cat}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{model.name}</p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="font-mono text-xs tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {model.runway ? (
        <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{model.runway}</p>
      ) : null}

      <p className={cn('mt-1.5 text-[11px]', STATUS_TONE[model.status.tone])}>
        <span aria-hidden="true">{model.status.prefix}</span>{' '}
        {model.status.parts.map((part, i) => (
          <span key={i}>
            {i > 0 ? ', ' : ''}
            <StatusPart part={part} />
          </span>
        ))}
      </p>

      {model.unavailable ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Current METAR observation unavailable. Retry in a moment.
        </p>
      ) : null}

      {model.hasDetail ? (
        <details
          className="mt-2 border-t pt-2"
          onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          {/* `flex` both removes the disclosure marker (the element stops being a
              list-item, so `list-none` is belt and braces) and lets the row carry a 44 px
              tap height below `md:` without the 10 px label growing. */}
          <summary
            aria-expanded={open}
            className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground pointer-fine:md:min-h-0 md:py-1"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-3 transition-transform duration-100 motion-reduce:transition-none', open && 'rotate-180')}
            />
            Details
          </summary>
          <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
            {model.explainer ? <p>{model.explainer}</p> : null}
            {model.faaExplainer ? <p>{model.faaExplainer}</p> : null}
            {model.advisoryUrls.length ? (
              <p className="flex flex-wrap gap-2">
                {model.advisoryUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-bb-warn underline"
                  >
                    Advisory
                  </a>
                ))}
              </p>
            ) : null}
            {model.notam ? <p className="font-mono text-[10px]">{model.notam}</p> : null}
            {model.raw ? (
              <p className="break-words font-mono text-[10px]">
                {model.jargon.metar ? (
                  <>
                    <JargonTerm term="metar">METAR</JargonTerm>{' '}
                  </>
                ) : null}
                {model.raw}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </Card>
  );
}

export default HubCard;
