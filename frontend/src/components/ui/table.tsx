import * as React from "react";

import { cn } from "@/lib/utils";

function Table({
  className,
  containerClassName,
  stickyHeader = false,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string; stickyHeader?: boolean }) {
  return (
    <div
      data-slot="table-container"
      data-sticky-header={stickyHeader || undefined}
      className={cn("relative w-full overflow-x-auto overscroll-x-contain rounded-[inherit]", containerClassName)}
    >
      <table data-slot="table" className={cn("w-full caption-bottom text-[13px]", stickyHeader ? "border-separate border-spacing-0" : "border-collapse", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_tr]:hover:bg-transparent [[data-sticky-header]_&_th]:sticky [[data-sticky-header]_&_th]:top-0 [[data-sticky-header]_&_th]:z-10 [[data-sticky-header]_&_th]:bg-card",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child>td]:border-b-0", className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "font-medium [&_td]:border-t [&_td]:border-b-0 [&_tr]:hover:bg-transparent [[data-sticky-header]_&_td]:sticky [[data-sticky-header]_&_td]:bottom-0 [[data-sticky-header]_&_td]:z-10 [[data-sticky-header]_&_td]:bg-card",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "transition-colors duration-150 hover:bg-surface/70 data-[state=selected]:bg-surface",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      data-numeric={numeric || undefined}
      className={cn(
        "h-9 border-b px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-numeric={numeric || undefined}
      className={cn(
        "h-10 border-b px-3 align-middle whitespace-nowrap first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("mt-4 text-[13px] text-muted-foreground", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
