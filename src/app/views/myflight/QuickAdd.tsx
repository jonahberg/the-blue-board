/**
 * The empty state and the quick-add box (inventory §19).
 *
 * The placeholder rotates every four seconds and stops the moment the field has focus —
 * text moving under a cursor is the sort of thing that makes people lose their place.
 *
 * Enter is the only affordance, exactly as the shipped box was. What gets typed is
 * parsed by `parseQuickAdd()`: a flight number starts a watch, and a TAIL number opens
 * the aircraft dialog rather than being mangled into the flight `UAN37502`, which is
 * what the shipped box did to the very input its own placeholder advertises.
 */

import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { MY_FLIGHTS_PLACEHOLDERS, parseQuickAdd } from '@/lib/my-flights.js';

const ROTATE_MS = 4000;
const FADE_MS = 300;

export function QuickAdd({
  onAddFlight,
  onOpenAircraft,
  showEmptyState,
}: {
  onAddFlight: (flight: string) => void;
  onOpenAircraft: (reg: string) => void;
  showEmptyState: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focused) return undefined;
    const timer = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex((i) => (i + 1) % (MY_FLIGHTS_PLACEHOLDERS as string[]).length);
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [focused]);

  function submit() {
    const parsed = parseQuickAdd(value) as
      | { kind: 'flight'; flight: string }
      | { kind: 'tail'; reg: string }
      | null;
    if (!parsed) return;
    if (parsed.kind === 'tail') onOpenAircraft(parsed.reg);
    else onAddFlight(parsed.flight);
    setValue('');
  }

  const field = (
    <Input
      ref={inputRef}
      id="myflight-search"
      value={value}
      aria-label="Add a flight to track"
      placeholder={(MY_FLIGHTS_PLACEHOLDERS as string[])[index]}
      className={`min-h-11 text-center font-mono transition-opacity duration-300 md:min-h-10 ${
        fading ? 'opacity-40' : 'opacity-100'
      }`}
      onChange={(event) => setValue(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      }}
    />
  );

  if (!showEmptyState) {
    return <div className="mx-auto max-w-xs">{field}</div>;
  }

  return (
    // `#myflight-empty` is the shipped id (inventory §19). Nothing in the rebuild
    // addresses it, but it is a published hook — a bookmarklet, a test, or the next port
    // may look for it, and it costs nothing to keep the name.
    <div id="myflight-empty" className="px-4 py-12 text-center md:py-16">
      <div className="mb-4 text-5xl" aria-hidden="true">
        🎫
      </div>
      <h2 className="mb-2 text-sm font-medium">No Flights Tracked Yet</h2>
      <p className="mx-auto mb-4 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
        Search for a flight and tap 👁️ to watch it. You&rsquo;ll see countdown timers, gate
        info, equipment details, delay risk, and inbound aircraft tracking — all in one place.
      </p>
      <div className="mx-auto max-w-xs">{field}</div>
      <div className="mx-auto mt-5 flex max-w-sm items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[9px] tracking-widest text-muted-foreground">OR</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Check a connection below, without watching either flight.
      </p>
    </div>
  );
}
