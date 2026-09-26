/**
 * Verification Ledger — the community spreadsheet's Starlink claims that official united.com
 * verification OVERRULED (inventory §22, `renderSlVerification()`).
 *
 * The panel exists for one load-bearing reason: upstream already excludes disputed tails from
 * the served fleet, so a disputed tail appearing in the equipped roster is a broken pipeline,
 * not a difference of opinion. `getServedConflictTails()` is the tripwire, and when it fires
 * this section raises a `role="alert"` naming the offending tails. The alert element is
 * rendered only when there is something to say, so its insertion is what announces it —
 * an always-present empty live region announces nothing.
 *
 * The rest is context, not alarm: a three-stat strip, the disputed table, and a paragraph
 * saying plainly that The Blue Board's equipped count is unaffected. `<details open>` because
 * a reader who scrolled this far wants the rows, but the section still collapses.
 */

import { memo } from 'react';

import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatVerifyDate, integrityAlertText } from '@/lib/starlink-roster.js';
import type { DisputedClaim, VerifySummary } from './types';

export const LEDGER_NOTE =
  "These tails were claimed as Starlink in the community spreadsheet, but official united.com verification overruled the claim. Upstream already excludes them from the served fleet, so The Blue Board's equipped count is not affected. Verified equipment may be Viasat or Thales.";

export const VerificationLedger = memo(function VerificationLedger({
  id,
  disputed,
  summary,
  conflicts,
}: {
  id: string;
  disputed: DisputedClaim[];
  summary: VerifySummary | null;
  conflicts: Set<string>;
}) {
  const disputedCount = summary?.disputed != null ? summary.disputed : disputed.length;
  return (
    <section id={id} aria-label="Starlink verification ledger" className="scroll-mt-2">
      <Card className="gap-0 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Verification Ledger
          </p>
          <dl className="flex gap-5">
            <div className="text-center">
              <dd className="font-mono text-lg font-semibold tabular-nums text-emerald-400">
                {summary?.verifiedStarlink ?? '—'}
              </dd>
              <dt className="text-[10px] text-muted-foreground">Verified Starlink</dt>
            </div>
            <div className="text-center">
              <dd className="font-mono text-lg font-semibold tabular-nums text-destructive">
                {disputedCount}
              </dd>
              <dt className="text-[10px] text-muted-foreground">Disputed</dt>
            </div>
            <div className="text-center">
              <dd className="font-mono text-lg font-semibold tabular-nums">
                {summary?.unverified ?? '—'}
              </dd>
              <dt className="text-[10px] text-muted-foreground">Unverified</dt>
            </div>
          </dl>
        </div>

        {conflicts.size > 0 ? (
          <p
            id="sl-verify-alert"
            role="alert"
            className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs"
          >
            <span className="mr-2 font-semibold">⚠ INTEGRITY ALERT</span>
            {integrityAlertText(conflicts) as string}
          </p>
        ) : null}

        <details open className="mt-3">
          {/* Padding and min-height, never `display:flex`: a <summary> is `display:list-item`,
              and changing that is what silently deletes its disclosure triangle. */}
          <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium marker:text-muted-foreground md:min-h-0 md:py-0">
            Disputed claims{' '}
            <span className="font-normal text-muted-foreground">
              — overruled by official verification
            </span>
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground">{LEDGER_NOTE}</p>
          <div
            tabIndex={0}
            aria-label="Starlink verification table, scrollable region"
            className="mt-2 max-h-80 overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead scope="col">Tail</TableHead>
                  <TableHead scope="col">Airframe</TableHead>
                  <TableHead scope="col">Verification</TableHead>
                  <TableHead scope="col">Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disputed.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-4 text-center text-xs text-muted-foreground">
                      No disputed claims on record.
                    </TableCell>
                  </TableRow>
                ) : (
                  disputed.map((claim, index) => (
                    <TableRow key={`${claim.tail ?? ''}-${index}`}>
                      <TableCell className="font-mono">
                        {claim.tail ?? ''}
                        {claim.tail && conflicts.has(claim.tail) ? (
                          <span
                            className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white"
                            title="Still served in the equipped fleet — integrity conflict"
                          >
                            <span aria-hidden="true">!</span>
                            <span className="sr-only">
                              Still served in the equipped fleet: integrity conflict
                            </span>
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">{claim.aircraft || '—'}</TableCell>
                      <TableCell className="text-xs">
                        <span className="mr-1 rounded border border-destructive/50 px-1 py-0.5 text-[9px] font-semibold text-destructive">
                          Disputed
                        </span>
                        Starlink{' '}
                        <span aria-hidden="true" className="text-muted-foreground">
                          →
                        </span>{' '}
                        {claim.verifiedAs || 'Not Starlink'}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {claim.verifiedAt ? (formatVerifyDate(claim.verifiedAt) as string) || '—' : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </details>
      </Card>
    </section>
  );
});

export default VerificationLedger;
