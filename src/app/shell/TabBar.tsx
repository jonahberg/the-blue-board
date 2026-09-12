/**
 * The desktop tab bar.
 *
 * Wrapped in `<nav aria-label="Dashboard navigation">` on purpose: `role="tablist"` on the
 * inner element overrides the implicit nav landmark, so without the wrapper the tabs sit in
 * no landmark at all (axe "region"). Radix's Tabs primitive supplies the roving tabindex,
 * arrow-key wrapping and Home/End that the old hand-rolled bar had to implement itself.
 */

import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TABS } from '../tabs';

export function TabBar() {
  return (
    <nav aria-label="Dashboard navigation" className="shrink-0 border-b px-1 md:px-3">
      <TabsList
        variant="line"
        className="h-10 w-full justify-start gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {TABS.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 px-2.5 text-xs">
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </nav>
  );
}
