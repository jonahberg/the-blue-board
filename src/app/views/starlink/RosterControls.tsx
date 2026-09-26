/**
 * The roster's filter bar (inventory §22): tail search, fleet, type, operator, the
 * "★ New this week" quick toggle, and the "N of M" count.
 *
 * Type and operator are populated FROM THE DATA rather than from a fixed list — upstream adds
 * regional operators without telling anyone, and a hardcoded dropdown would quietly make
 * their aircraft unfilterable.
 *
 * The count only appears once a filter has actually narrowed the roster: "397 of 397" is
 * noise, and printing it permanently trains the eye to ignore the one place that says how
 * much of the fleet you are currently looking at.
 */

import { memo } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Radix Select has no empty-string value, so "all" is a sentinel mapped back to ''. */
const ALL = '__all__';

export const RosterControls = memo(function RosterControls({
  search,
  onSearch,
  fleet,
  onFleet,
  type,
  onType,
  typeOptions,
  operator,
  onOperator,
  operatorOptions,
  newOnly,
  onNewOnly,
  shown,
  total,
}: {
  search: string;
  onSearch: (value: string) => void;
  fleet: string;
  onFleet: (value: string) => void;
  type: string;
  onType: (value: string) => void;
  typeOptions: string[];
  operator: string;
  onOperator: (value: string) => void;
  operatorOptions: string[];
  newOnly: boolean;
  onNewOnly: (value: boolean) => void;
  shown: number;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id="sl-search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        aria-label="Search Starlink aircraft"
        placeholder="Search tail..."
        className="h-11 w-full max-w-56 md:h-9"
      />

      <Select
        value={fleet || ALL}
        onValueChange={(value) => onFleet(value === ALL ? '' : value)}
      >
        <SelectTrigger
          id="sl-filter-fleet"
          aria-label="Starlink fleet filter"
          className="h-11! w-36 md:h-9!"
        >
          <SelectValue placeholder="All Fleets" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Fleets</SelectItem>
          <SelectItem value="Mainline">Mainline</SelectItem>
          <SelectItem value="Express">Express</SelectItem>
        </SelectContent>
      </Select>

      <Select value={type || ALL} onValueChange={(value) => onType(value === ALL ? '' : value)}>
        <SelectTrigger
          id="sl-filter-type"
          aria-label="Starlink type filter"
          className="h-11! w-36 md:h-9!"
        >
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Types</SelectItem>
          {typeOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={operator || ALL}
        onValueChange={(value) => onOperator(value === ALL ? '' : value)}
      >
        <SelectTrigger
          id="sl-filter-operator"
          aria-label="Starlink operator filter"
          className="h-11! w-48 md:h-9!"
        >
          <SelectValue placeholder="All Operators" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Operators</SelectItem>
          {operatorOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        id="sl-filter-new"
        aria-pressed={newOnly}
        onClick={() => onNewOnly(!newOnly)}
        className="min-h-11 rounded-md border px-3 text-xs font-medium aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-9"
      >
        ★ New this week
      </button>

      <span id="sl-filtered-count" className="text-[11px] text-muted-foreground">
        {shown < total ? `${shown} of ${total}` : ''}
      </span>
    </div>
  );
});

export default RosterControls;
