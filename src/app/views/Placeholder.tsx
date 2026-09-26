/**
 * The stand-in a not-yet-ported tab renders.
 *
 * Every tab is registered and routable from the first day of the rebuild — the tab bar, the
 * mobile nav, the `#hash` deep links and the `?tab=` aliases all work — so the work package
 * that ports a view replaces exactly one file and touches nothing else.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function Placeholder({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{summary}</p>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
