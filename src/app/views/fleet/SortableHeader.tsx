/**
 * A sortable column header (inventory §17).
 *
 * The `<th>` carries `aria-sort` so a screen reader announces the current order; the control
 * inside is a real `<button>`, which is what gets Enter, Space, the focus ring and a 44 px
 * touch target below `md:` without a single key handler of our own. The arrow is decorative
 * — `aria-sort` is the actual signal.
 */

import { TableHead } from '@/components/ui/table';

export type SortState<C extends string> = { col: C; asc: boolean };

export function SortableHeader<C extends string>({
  col,
  label,
  sort,
  onSort,
  className,
}: {
  col: C;
  label: string;
  sort: SortState<C>;
  onSort: (col: C) => void;
  className?: string;
}) {
  const active = sort.col === col;
  return (
    <TableHead
      scope="col"
      aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'}
      className={`p-0 ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className="flex min-h-11 w-full items-center gap-1 px-2 text-left font-medium hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:min-h-8"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-foreground' : 'opacity-30'}>
          {active ? (sort.asc ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </TableHead>
  );
}

export default SortableHeader;
