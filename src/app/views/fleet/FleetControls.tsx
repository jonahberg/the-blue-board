/**
 * Zone 3's four controls plus Refresh (inventory §21).
 *
 * The search box is uncontrolled-feeling on purpose: it holds its own text and reports it
 * upward on a 120 ms debounce, because re-filtering 1,078 rows on every keystroke makes a
 * phone keyboard stutter. The three dropdowns report immediately — a select changes once.
 *
 * Radix `Select` cannot carry an empty-string item value, so "All …" rides a sentinel and is
 * translated back at this boundary. Nothing downstream sees the sentinel.
 *
 * Refresh reloads the page, which is not laziness: `/data/fleet.json` is a build artefact
 * fetched once on load, so a reload is genuinely the only way to pull a newer deployment's
 * fleet database.
 */

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Radix refuses `value=""`; this stands in for "no filter" inside the dropdowns only. */
const ALL = '__all__';

export const SEARCH_DEBOUNCE_MS = 120;

export const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'stored', label: 'Stored/Maint' },
  { value: 'starlink', label: 'Starlink' },
  { value: 'special', label: 'Special/Named' },
];

export function FleetControls({
  search,
  onSearchChange,
  type,
  onTypeChange,
  typeOptions,
  wifi,
  onWifiChange,
  wifiOptions,
  status,
  onStatusChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  type: string;
  onTypeChange: (value: string) => void;
  typeOptions: { value: string; count: number }[];
  wifi: string;
  onWifiChange: (value: string) => void;
  wifiOptions: string[];
  status: string;
  onStatusChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(search);
  const timer = useRef<number | undefined>(undefined);

  // A deep link or "Clear Filters" changes `search` from outside; adopt it without firing
  // the debounce back at the parent.
  useEffect(() => {
    setDraft((current) => (current === search ? current : search));
  }, [search]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function onInput(value: string) {
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onSearchChange(value), SEARCH_DEBOUNCE_MS);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id="fleet-search"
        type="search"
        aria-label="Fleet search"
        placeholder="Search reg, config…"
        value={draft}
        onChange={(event) => onInput(event.target.value)}
        className="h-11 w-full min-w-0 sm:h-8 sm:w-48"
      />

      <Select value={type || ALL} onValueChange={(value) => onTypeChange(value === ALL ? '' : value)}>
        <SelectTrigger aria-label="Fleet type filter" className="h-11 min-w-36 sm:h-8">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Types</SelectItem>
          {typeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.value} ({option.count})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={wifi || ALL} onValueChange={(value) => onWifiChange(value === ALL ? '' : value)}>
        <SelectTrigger aria-label="Fleet WiFi filter" className="h-11 min-w-32 sm:h-8">
          <SelectValue placeholder="All WiFi" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All WiFi</SelectItem>
          {wifiOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={status || ALL}
        onValueChange={(value) => onStatusChange(value === ALL ? '' : value)}
      >
        <SelectTrigger aria-label="Fleet status filter" className="h-11 min-w-32 sm:h-8">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Status</SelectItem>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="lg"
        className="h-11 sm:h-8"
        onClick={() => window.location.reload()}
      >
        Refresh
      </Button>
    </div>
  );
}

export default FleetControls;
