/**
 * The brief's tone, as the status rule requires (DESIGN.md): watch and disrupted carry an icon
 * and a word as well as their colour; calm is plain and renders nothing here. Its own file so
 * the header row (in the first-paint chunk) does not pull in the whole brief panel.
 */

import { OctagonAlert, TriangleAlert } from 'lucide-react';

import { BRIEF_TONE_WORD } from '@/lib/brief-view.js';
import { cn } from '@/lib/utils';

export function ToneMark({ tone, className }: { tone: 'calm' | 'watch' | 'disrupted'; className?: string }) {
  if (tone === 'calm') return null;
  const Icon = tone === 'disrupted' ? OctagonAlert : TriangleAlert;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1',
        tone === 'disrupted' ? 'text-destructive' : 'text-bb-warn',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {BRIEF_TONE_WORD[tone]}
    </span>
  );
}
