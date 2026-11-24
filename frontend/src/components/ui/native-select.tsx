import * as React from "react";
import { ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" }) {
  return (
    <div
      data-slot="native-select-wrapper"
      className="group/native-select relative w-full has-[select:disabled]:opacity-50"
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          // 16px on phones so ios safari does not zoom the page on focus
          "h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-xl border border-input bg-surface py-1 pr-9 pl-3 text-base text-foreground outline-none md:text-sm",
          "transition-[background-color,border-color,box-shadow] duration-200 ease-ios hover:bg-surface-hover",
          "data-[size=sm]:h-8 data-[size=sm]:rounded-[10px] data-[size=sm]:pr-8 data-[size=sm]:pl-2.5 md:data-[size=sm]:text-[13px]",
          "focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/20 dark:focus-visible:bg-surface",
          "aria-invalid:border-destructive/70 aria-invalid:ring-[3px] aria-invalid:ring-destructive/15",
          "disabled:cursor-not-allowed disabled:hover:bg-surface",
          "[&>option]:bg-popover [&>option]:text-popover-foreground [&>optgroup]:bg-popover [&>optgroup]:text-glyph",
          className,
        )}
        {...props}
      />
      <ChevronsUpDown
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-glyph transition-colors select-none group-hover/native-select:text-foreground group-has-[select:disabled]/native-select:text-glyph group-has-[select:focus-visible]/native-select:text-foreground group-has-[[aria-invalid=true]]/native-select:text-destructive group-has-[[data-size=sm]]/native-select:right-2.5"
      />
    </div>
  );
}

function NativeSelectOption({ ...props }: React.ComponentProps<"option">) {
  return <option data-slot="native-select-option" {...props} />;
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<"optgroup">) {
  return <optgroup data-slot="native-select-optgroup" className={cn(className)} {...props} />;
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
