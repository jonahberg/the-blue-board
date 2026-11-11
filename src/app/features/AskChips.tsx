/**
 * "Ask the board" — the row a view shows while an answer is applied: the real count after
 * filtering, then one removable chip per filter the answer chose, so a misread question is visible
 * and fixable. Removing the last chip (or the row's ✕) clears the answer.
 *
 * Every word here comes from `src/lib/ask-vocabulary.js` (`askChips`, `askSummaryLine`) or from the
 * view's own fixed phrases — never from the visitor's text or a model.
 *
 * No live region of its own (DESIGN.md: the page has one polite writer). The sentence is spoken
 * once per answer through `useUi().announce()`.
 */

import { TriangleAlert, X, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { askSummaryLine } from '@/lib/ask-vocabulary.js';
import { cn } from '@/lib/utils';
import { chipsFor, clearAsk, removeAskFilter, useAskFor } from '../state/ask';
import type { AskFilters, AskView } from '../state/ask';
import { useUi } from '../state/ui';

export type AskChipsProps = {
  view: AskView;
  /** What the view really shows after every filter; null while it is still loading. */
  count: number | null;
  singular: string;
  pluralNoun?: string;
  /** A fixed phrase for where the count is ("on the map", "at DEN"). */
  where?: string;
  /** Undo what a chip set through the view's own controls, before the chip goes. */
  onRemove?: (name: keyof AskFilters) => void;
  /** Undo everything the answer set, before the answer is cleared. */
  onClear?: () => void;
  className?: string;
};

export function AskChips({ view, count, singular, pluralNoun, where, onRemove, onClear, className }: AskChipsProps) {
  const ask = useAskFor(view);
  const { announce, tab } = useUi();
  const chips = useMemo(() => chipsFor(ask?.result ?? null), [ask?.result]);
  const line = askSummaryLine({ count, singular, pluralNoun, where }) as {
    text: string;
    hint?: string;
    empty: boolean;
    loading: boolean;
  };

  // Spoken once per answer, when its count is known and the view is the one on screen.
  const spokenKey = useRef(0);
  useEffect(() => {
    if (!ask || line.loading || tab !== view) return;
    if (spokenKey.current === ask.key) return;
    spokenKey.current = ask.key;
    const labels = chips.map((chip) => chip.label).join(', ');
    const sentence = line.hint ? `${line.text}. ${line.hint}` : `${line.text}.`;
    announce(labels ? `${sentence} Filters: ${labels}.` : sentence);
  }, [ask, line.loading, line.text, chips, announce, tab, view]);

  if (!ask) return null;

  return (
    // One scrollable row below `md` (a wrapped second row of 44 px chips costs a phone that much
    // map or board), wrapping from `md` up. The clear button stays pinned at the row's end.
    <div
      role="group"
      aria-label="Filters from your question"
      data-testid={`ask-chips-${view}`}
      className={cn(
        'flex items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none] md:flex-wrap md:overflow-visible',
        className,
      )}
    >
      <span className={cn('mr-1 shrink-0 whitespace-nowrap', line.empty ? 'text-bb-warn' : 'text-muted-foreground')}>
        {line.empty ? <TriangleAlert aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" /> : null}
        {line.text}
        {line.hint ? <span className="hidden text-muted-foreground md:inline">. {line.hint}</span> : null}
      </span>
      {chips.map((chip) => (
        <button
          key={chip.name}
          type="button"
          onClick={() => {
            onRemove?.(chip.name);
            removeAskFilter(chip.name);
          }}
          aria-label={`Remove filter: ${chip.label}`}
          className={cn(
            'inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-secondary px-2.5 font-medium transition-colors duration-100 hover:bg-muted pointer-fine:md:min-h-7',
            chip.kind === 'starlink' ? 'text-bb-starlink' : 'text-foreground',
          )}
        >
          {chip.kind === 'starlink' ? <Zap aria-hidden="true" className="size-3" /> : null}
          <span>{chip.label}</span>
          <X aria-hidden="true" className="size-3 text-muted-foreground" />
        </button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="sticky right-0 ml-auto size-11 shrink-0 bg-background text-muted-foreground md:static md:ml-0 pointer-fine:md:size-7"
        aria-label="Clear the filters from your question"
        onClick={() => {
          onClear?.();
          clearAsk();
        }}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
