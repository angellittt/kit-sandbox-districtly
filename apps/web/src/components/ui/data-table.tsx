// design-system-kit 0.10.0 · profile shadcn · kit extension (replaces the stock file when chosen)
"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  Column,
  ColumnDef,
  RowData,
  Table as TanStackTable,
  TableOptions,
} from "@tanstack/react-table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Columns3Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortButton,
} from "@/components/ui/table";
import { cn } from "cn";

/**
 * Data Table — rows from `@tanstack/react-table` v8, drawn with Table.
 *
 * Kit file, whole (no registry item exists): shadcn's documented data-table
 * guide as parts, from STOCK Button, Button Group, Checkbox, Dropdown Menu,
 * Empty and Select, and the kit's Table:
 * - `useDataTable`: `useReactTable` with the guide's row models (core,
 *   sorted, filtered, paginated) and its sorting, filter, visibility and
 *   selection state held for you. Server-side data: call `useReactTable`
 *   yourself with `manualSorting` / `manualPagination`; every part below
 *   takes any TanStack table.
 * - `DataTable`: header and body from the table, `aria-sort` on the sorted
 *   column only (as in the APG sortable table), selected rows
 *   `data-state="selected"`, Empty when no rows.
 * - `DataTableColumnHeader`: the guide's sortable header, as the kit's
 *   `TableSortButton` (so DataTable takes Table's kit file with it).
 * - `DataTablePagination`: selected count, rows per page, page N of M,
 *   first / previous / next / last.
 * - `DataTableViewOptions`: the guide's column toggle menu.
 * - `dataTableSelectColumn`: the guide's checkbox column (page-wide select
 *   all, indeterminate when some are selected).
 * Visible text is overridable through `strings`, as in DatePicker; a
 * column's name in the menu is `meta.label`, else its id.
 */

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** The column's name where its header can't be used (the columns menu). */
    label?: string;
  }
}

type DataTableStrings = {
  empty: string;
  selectAll: string;
  selectRow: string;
  selected: (selected: number, total: number) => string;
  rowsPerPage: string;
  page: (page: number, pages: number) => string;
  firstPage: string;
  previousPage: string;
  nextPage: string;
  lastPage: string;
  columns: string;
  toggleColumns: string;
};

const defaultStrings: DataTableStrings = {
  empty: "No results",
  selectAll: "Select all",
  selectRow: "Select row",
  selected: (selected, total) => `${selected} of ${total} row(s) selected`,
  rowsPerPage: "Rows per page",
  page: (page, pages) => `Page ${page} of ${pages}`,
  firstPage: "First page",
  previousPage: "Previous page",
  nextPage: "Next page",
  lastPage: "Last page",
  columns: "Columns",
  toggleColumns: "Toggle columns",
};

type UseDataTableOptions<TData> = Omit<TableOptions<TData>, "getCoreRowModel"> &
  Partial<Pick<TableOptions<TData>, "getCoreRowModel">> & {
    /** Rows per page on first render. */
    pageSize?: number;
  };

function useDataTable<TData>({
  pageSize = 10,
  initialState,
  ...options
}: UseDataTableOptions<TData>) {
  return useReactTable<TData>({
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    ...options,
    initialState: {
      ...initialState,
      pagination: { pageIndex: 0, pageSize, ...initialState?.pagination },
    },
  });
}

function DataTable<TData>({
  table,
  className,
  containerClassName,
  density,
  empty,
  strings: overrides,
  ...props
}: Omit<React.ComponentProps<typeof Table>, "children"> & {
  table: TanStackTable<TData>;
  /** Shown in the one full-width cell when there are no rows. */
  empty?: React.ReactNode;
  strings?: Partial<Pick<DataTableStrings, "empty">>;
}) {
  const strings = { ...defaultStrings, ...overrides };
  const rows = table.getRowModel().rows;
  return (
    <Table
      data-slot="data-table"
      className={className}
      containerClassName={containerClassName}
      density={density}
      {...props}
    >
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              return (
                <TableHead
                  key={header.id}
                  colSpan={header.colSpan}
                  aria-sort={
                    sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                        ? "descending"
                        : undefined
                  }
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length ? (
          rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() ? "selected" : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={table.getVisibleLeafColumns().length}>
              {empty ?? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{strings.empty}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function DataTableColumnHeader<TData, TValue>({
  column,
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof TableSortButton>,
  "active" | "direction"
> & {
  column: Column<TData, TValue>;
}) {
  if (!column.getCanSort()) {
    return <span className={className}>{children}</span>;
  }
  const sorted = column.getIsSorted();
  return (
    <TableSortButton
      active={!!sorted}
      direction={sorted}
      onClick={column.getToggleSortingHandler()}
      className={className}
      {...props}
    >
      {children}
    </TableSortButton>
  );
}

function DataTablePagination<TData>({
  table,
  pageSizes = [10, 20, 50],
  className,
  strings: overrides,
  ...props
}: React.ComponentProps<"div"> & {
  table: TanStackTable<TData>;
  /** Choices for rows per page; an empty list hides the control. */
  pageSizes?: number[];
  strings?: Partial<DataTableStrings>;
}) {
  const strings = { ...defaultStrings, ...overrides };
  const id = React.useId();
  const { pageIndex, pageSize } = table.getState().pagination;
  const selectable = table.options.enableRowSelection !== false;
  return (
    <div
      data-slot="data-table-pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm",
        className,
      )}
      {...props}
    >
      <p className="text-muted-foreground" aria-live="polite">
        {selectable
          ? strings.selected(
              table.getFilteredSelectedRowModel().rows.length,
              table.getFilteredRowModel().rows.length,
            )
          : null}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {pageSizes.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor={id} className="font-medium">
              {strings.rowsPerPage}
            </label>
            <Select
              value={pageSize}
              items={pageSizes.map((n) => ({ value: n, label: String(n) }))}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger id={id} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {pageSizes.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
        <span className="font-medium">
          {strings.page(pageIndex + 1, Math.max(table.getPageCount(), 1))}
        </span>
        <ButtonGroup>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={strings.firstPage}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.firstPage()}
          >
            <ChevronsLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={strings.previousPage}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={strings.nextPage}
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={strings.lastPage}
            disabled={!table.getCanNextPage()}
            onClick={() => table.lastPage()}
          >
            <ChevronsRightIcon />
          </Button>
        </ButtonGroup>
      </div>
    </div>
  );
}

function DataTableViewOptions<TData>({
  table,
  strings: overrides,
}: {
  table: TanStackTable<TData>;
  strings?: Partial<DataTableStrings>;
}) {
  const strings = { ...defaultStrings, ...overrides };
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && column.accessorFn !== undefined);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-slot="data-table-view-options"
          />
        }
      >
        <Columns3Icon data-icon="inline-start" />
        {strings.columns}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{strings.toggleColumns}</DropdownMenuLabel>
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(checked) => column.toggleVisibility(!!checked)}
            >
              {column.columnDef.meta?.label ?? column.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function dataTableSelectColumn<TData>(
  overrides?: Partial<Pick<DataTableStrings, "selectAll" | "selectRow">>,
): ColumnDef<TData> {
  const strings = { ...defaultStrings, ...overrides };
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label={strings.selectAll}
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={
          table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
        }
        onCheckedChange={(checked) =>
          table.toggleAllPageRowsSelected(!!checked)
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={strings.selectRow}
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={(checked) => row.toggleSelected(!!checked)}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  };
}

export {
  DataTable,
  DataTableColumnHeader,
  DataTablePagination,
  DataTableViewOptions,
  dataTableSelectColumn,
  useDataTable,
};
export type { DataTableStrings, UseDataTableOptions };
