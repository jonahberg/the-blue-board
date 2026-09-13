/**
 * The seven advanced selects plus the shared search (inventory §20 "Controls").
 *
 * One `<FilterSelect>` for all seven because they differ only in their options: a viewer who
 * learns one learns all of them, and there is exactly one place to fix a keyboard or label
 * bug. The values are the SHIPPED value strings — `schedule-board-filters.js` matches on
 * them, so 'redeye' and 'no-starlink' are contracts, not labels.
 *
 * The Aircraft options are built from the board that is actually loaded, so the list never
 * offers a type that would return zero rows.
 *
 * Rendered inline on a wide screen and inside a `Sheet` below `md`, from one definition: a
 * drawer of seven selects in a 400 px toolbar is unusable, and duplicating the markup is how
 * the two copies drift apart.
 */

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BoardFilters } from './useBoardModel';

/** Radix `Select` has no empty-string value, so "all" is the sentinel that maps back to ''. */
const ALL = '__all__';

export type FilterOption = { value: string; label: string };

export const STATUS_OPTIONS: FilterOption[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'estimated', label: 'Estimated' },
  { value: 'departed', label: 'Departed' },
  { value: 'enroute', label: 'En Route' },
  { value: 'landed', label: 'Landed' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'diverted', label: 'Diverted' },
];

export const FLEET_FAMILY_OPTIONS: FilterOption[] = [
  { value: '737', label: '737 Family' },
  { value: 'A320', label: 'A320 Family' },
  { value: '757', label: '757 Family' },
  { value: '767', label: '767 Family' },
  { value: '777', label: '777 Family' },
  { value: '787', label: '787 Family' },
];

export const ROUTE_TYPE_OPTIONS: FilterOption[] = [
  { value: 'domestic', label: 'Domestic Only' },
  { value: 'international', label: 'International Only' },
];

export const STARLINK_OPTIONS: FilterOption[] = [
  { value: 'starlink', label: '⚡ Starlink Only' },
  { value: 'no-starlink', label: 'Non-Starlink' },
];

export const TIME_RANGE_OPTIONS: FilterOption[] = [
  { value: 'morning', label: 'Morning (5a–12p)' },
  { value: 'afternoon', label: 'Afternoon (12p–5p)' },
  { value: 'evening', label: 'Evening (5p–10p)' },
  { value: 'redeye', label: 'Red-eye (10p–5a)' },
];

export const RISK_OPTIONS: FilterOption[] = [
  { value: 'high', label: 'High Delay' },
  { value: 'moderate', label: 'Moderate+' },
  { value: 'low', label: 'Low Only' },
];

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? '' : next)}>
        <SelectTrigger id={id} size="sm" className="min-h-11 w-full font-mono text-[11px] md:min-h-0">
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function AdvancedFilters({
  filters,
  aircraftOptions,
  onChange,
  idPrefix = 'sched',
}: {
  filters: BoardFilters;
  aircraftOptions: FilterOption[];
  onChange: (patch: Partial<BoardFilters>) => void;
  /** Distinguishes the inline copy from the sheet copy so no two labels share an id. */
  idPrefix?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
      <FilterSelect
        id={`${idPrefix}-status`}
        label="Status"
        allLabel="All Status"
        value={filters.status}
        options={STATUS_OPTIONS}
        onChange={(status) => onChange({ status })}
      />
      <FilterSelect
        id={`${idPrefix}-aircraft`}
        label="Aircraft"
        allLabel="All Aircraft"
        value={filters.aircraft}
        options={aircraftOptions}
        onChange={(aircraft) => onChange({ aircraft })}
      />
      <FilterSelect
        id={`${idPrefix}-fleet-family`}
        label="Fleet"
        allLabel="All Fleet Families"
        value={filters.fleetFamily}
        options={FLEET_FAMILY_OPTIONS}
        onChange={(fleetFamily) => onChange({ fleetFamily })}
      />
      <FilterSelect
        id={`${idPrefix}-route-type`}
        label="Route"
        allLabel="All Routes"
        value={filters.routeType}
        options={ROUTE_TYPE_OPTIONS}
        onChange={(routeType) => onChange({ routeType })}
      />
      <FilterSelect
        id={`${idPrefix}-starlink`}
        label="WiFi"
        allLabel="All WiFi"
        value={filters.starlink}
        options={STARLINK_OPTIONS}
        onChange={(starlink) => onChange({ starlink })}
      />
      <FilterSelect
        id={`${idPrefix}-timerange`}
        label="Time"
        allLabel="All Day"
        value={filters.timeRange}
        options={TIME_RANGE_OPTIONS}
        onChange={(timeRange) => onChange({ timeRange })}
      />
      <FilterSelect
        id={`${idPrefix}-risk`}
        label="Delay risk"
        allLabel="All Delay"
        value={filters.risk}
        options={RISK_OPTIONS}
        onChange={(risk) => onChange({ risk })}
      />
      <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
        <Label htmlFor={`${idPrefix}-search`} className="text-[9px] uppercase tracking-wide text-muted-foreground">
          Search
        </Label>
        <Input
          id={`${idPrefix}-search`}
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
          placeholder="Flight, city, reg…"
          className="min-h-11 font-mono text-[11px] md:min-h-0"
        />
      </div>
    </div>
  );
}
