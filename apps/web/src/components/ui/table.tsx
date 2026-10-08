// design-system-kit 0.10.0 · profile shadcn · kit extension (replaces the stock file when chosen)
"use client";

/**
 * Stock base-nova (shadcn 4.21.1, 2026-10-07) + TTT baseline:
 * - Table: `containerClassName` prop styles the scroll container.
 * - TableRow: hover `bg-muted/50` -> `bg-accent` (hover-highlight role).
 * - TableRow: `focus-visible:-outline-offset-2` so the global focus outline sits inside the clipping container.
 *
 * Kit extensions:
 * - Row density (profile capability "Row density"): `density` prop on Table
 *   (`comfortable` = stock spacing, default; `compact` = tighter rows), set once
 *   on the container as `data-density` and read by cells through `group/table`.
 * - Sortable header (profile capability "Sortable header"): `TableSortButton`
 *   companion part. Put it inside a `TableHead` and set `aria-sort` on that
 *   `TableHead`; the button reflects `active` / `direction` as data attributes.
 * - Clickable rows (candidate): `clickable` prop on TableRow sets
 *   `data-clickable` and a pointer cursor. The caller still owns the click
 *   handler and keyboard access (e.g. a link or button in the row).
 */

import * as React from "react";
import { cn } from "cn";
import { ChevronUpIcon } from "lucide-react";

function Table({
  className,
  containerClassName,
  density = "comfortable",
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string;
  density?: "comfortable" | "compact";
}) {
  return (
    <div
      data-slot="table-container"
      data-density={density}
      className={cn(
        "group/table relative w-full overflow-x-auto",
        containerClassName,
      )}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({
  className,
  clickable,
  ...props
}: React.ComponentProps<"tr"> & { clickable?: boolean }) {
  return (
    <tr
      data-slot="table-row"
      data-clickable={clickable || undefined}
      className={cn(
        "border-b transition-colors hover:bg-accent focus-visible:-outline-offset-2 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted data-clickable:cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground group-data-[density=compact]/table:h-8 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap group-data-[density=compact]/table:py-1 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * Sortable column header button. The arrow stays hidden until the column is
 * hovered, focused or active, and flips for descending. Announce the sort on
 * the header cell itself: `<TableHead aria-sort="ascending">`.
 */
function TableSortButton({
  className,
  active,
  direction,
  type = "button",
  children,
  ...props
}: React.ComponentProps<"button"> & {
  active?: boolean;
  direction?: "asc" | "desc" | false;
}) {
  return (
    <button
      type={type}
      data-slot="table-sort-button"
      data-active={active || undefined}
      data-direction={direction || undefined}
      className={cn(
        "group/sort inline-flex cursor-pointer items-center gap-1 rounded-xs text-inherit hover:text-foreground data-active:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronUpIcon
        aria-hidden
        className={cn(
          "size-3.5 opacity-0 group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50 group-data-active/sort:opacity-100 motion-safe:transition-[transform,opacity] motion-safe:duration-normal motion-safe:ease-standard",
          direction === "desc" && "rotate-180",
        )}
      />
    </button>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableSortButton,
};
