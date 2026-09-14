/**
 * The latest-news strip above the header (inventory §7).
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
      className="flex shrink-0 items-center gap-2 border-b bg-primary/10 px-3 py-1 text-[11px]"
      onMouseEnter={() => {
        paused.current = true;
      }}
      onMouseLeave={() => {
        paused.current = false;
      }}
    >
      <span aria-hidden="true">📰</span>
      <a
        href={href}
        onClick={() => trackClick(current.slug)}
        className="min-w-0 flex-1 truncate underline-offset-2 transition-opacity hover:underline"
      >
        {current.title}
      </a>
      <a
        href={href}
        onClick={() => trackClick(current.slug)}
        className="hidden shrink-0 font-semibold text-primary underline-offset-2 hover:underline sm:inline"
      >
        Read →
      </a>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss news"
        className="h-auto min-h-11 shrink-0 px-2 py-0 text-[11px] md:min-h-0"
        onClick={dismiss}
      >
        ✕
      </Button>
    </div>
  );
}
