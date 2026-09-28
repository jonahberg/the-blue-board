/**
 * The latest-news strip (inventory §7), in the engagement slot BELOW the tab panel.
 *
 * It used to sit above the header, and because it can only appear once `news-latest.json`
 * arrives, it pushed the header, ticker, hub strip and the whole map 53 px down a few hundred
 * milliseconds into the load (CLS ≈ 0.06 on a phone). Below the panel it inserts under the
 * content instead of above it — nothing the visitor is looking at moves — and at a single
 * 32 px line it costs a phone far less of its first screen (the dismiss button keeps a 44 px
 * hit area through its `after:` box rather than by making the row 44 px tall).
 *
 * Loaded off the critical path — `requestIdleCallback` with a 4-second timeout, falling
 * back to a 1.5-second timer — because a headline must never be why the map paints late.
 *
 * Dismissal is keyed to the NEWEST slug, not to a boolean: saying "not interested" to
 * today's story must not silence tomorrow's. When a newer post arrives, `d[0].slug`
 * changes and the banner comes back on its own.
 *
 * Rotation pauses on hover, because a headline that swaps out while you are reading it —
 * or moving towards it — is worse than no rotation at all.
 */

import { Newspaper, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { fetchNewsLatest } from '../data/api';
import { STORAGE_KEYS, readString, writeString } from '../state/storage';

type NewsItem = { title: string; slug: string };

/** Inventory §30. */
const ROTATE_MS = 6000;
const IDLE_TIMEOUT_MS = 4000;
const FALLBACK_DELAY_MS = 1500;

/** Vercel Analytics, if the script loaded. Never a hard dependency. */
function trackClick(slug: string) {
  try {
    const va = (window as unknown as { va?: { track?: (name: string, data: unknown) => void } }).va;
    va?.track?.('news_banner_click', { slug });
  } catch {
    /* analytics is never allowed to break a link */
  }
}

export default function NewsBanner() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const paused = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchNewsLatest()
        .then((data) => {
          if (cancelled || !Array.isArray(data) || !data.length) return;
          if (readString(STORAGE_KEYS.newsDismissedSlug) === data[0].slug) return;
          setItems(data);
        })
        .catch(() => {
          /* no news is not an error state — the strip simply does not appear */
        });
    };

    const idle = (window as unknown as { requestIdleCallback?: typeof requestIdleCallback })
      .requestIdleCallback;
    if (typeof idle === 'function') {
      const handle = idle(load, { timeout: IDLE_TIMEOUT_MS });
      return () => {
        cancelled = true;
        (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(
          handle as unknown as number,
        );
      };
    }
    const timer = setTimeout(load, FALLBACK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (items.length < 2) return undefined;
    const timer = setInterval(() => {
      if (paused.current) return;
      setIndex((current) => (current + 1) % items.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [items.length]);

  const dismiss = useCallback(() => {
    if (items[0]) writeString(STORAGE_KEYS.newsDismissedSlug, items[0].slug);
    setDismissed(true);
  }, [items]);

  if (dismissed || !items.length) return null;

  const current = items[index] ?? items[0];
  const href = `/news/${current.slug}`;

  return (
    <div
      role="status"
      // Rotates every 6 s: announcing each headline would interrupt a screen reader, so the
      // region is present for structure but silent (same rule as the Ticker — DESIGN.md).
      aria-live="off"
      className="flex h-8 shrink-0 items-center gap-2 border-t bg-primary/10 px-3 text-[11px]"
      onMouseEnter={() => {
        paused.current = true;
      }}
      onMouseLeave={() => {
        paused.current = false;
      }}
    >
      <Newspaper aria-hidden="true" className="size-3.5 shrink-0" />
      <a
        href={href}
        onClick={() => trackClick(current.slug)}
        // A full-height flex box so the whole 32 px row is the target, not the 11 px line box
        // (measured 17 px tall); `truncate` stays on the inner span, where the text is.
        className="flex h-full min-w-0 flex-1 items-center underline-offset-2 transition-opacity hover:underline"
      >
        <span className="truncate">{current.title}</span>
      </a>
      <a
        href={href}
        onClick={() => trackClick(current.slug)}
        className="hidden h-full shrink-0 items-center font-semibold text-primary underline-offset-2 hover:underline sm:flex"
      >
        Read →
      </a>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss news"
        className="relative h-8 min-w-11 shrink-0 px-2 py-0 text-[11px] after:absolute after:inset-x-0 after:-inset-y-1.5"
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
