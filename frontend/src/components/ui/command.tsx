"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("flex h-full w-full flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground", className)}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  container,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  container?: React.ComponentProps<typeof DialogContent>["container"];
}) {
  return (
    <Dialog {...props}>
      {/* pinned near the top, so the palette grows downward as results change instead of bobbing around the center */}
      <DialogContent
        container={container}
        showCloseButton={showCloseButton}
        className={cn(
          "top-[max(14vh,calc(env(safe-area-inset-top)+0.75rem))] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl sm:p-0",
          className,
        )}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command className="rounded-none bg-transparent **:data-[slot=command-input-wrapper]:h-13 **:data-[slot=command-input-wrapper]:px-4 **:data-[slot=command-input]:text-base sm:**:data-[slot=command-input]:text-[15px] **:data-[slot=command-list]:max-h-[min(360px,50dvh)] [&_[cmdk-group]]:px-2 [&_[cmdk-item]]:py-2.5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-11 shrink-0 items-center gap-2.5 border-b px-3.5">
      <SearchIcon className="size-4 shrink-0 text-glyph" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-full w-full min-w-0 bg-transparent text-base outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      // cmdk measures its results into --cmdk-list-height, so filtering eases the height instead of snapping
      className={cn(
        "h-(--cmdk-list-height) max-h-[300px] scroll-py-2 overflow-x-hidden overflow-y-auto overscroll-contain transition-[height] duration-200 ease-ios motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className={cn("px-4 py-10 text-center text-sm text-balance text-muted-foreground", className)} {...props} />;
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator data-slot="command-separator" className={cn("my-1 h-px bg-border", className)} {...props} />;
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm pointer-coarse:min-h-11 outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface dark:data-[selected=true]:bg-surface-hover [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-glyph",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="command-shortcut" className={cn("ml-auto pl-3 text-xs tracking-widest text-glyph tabular-nums", className)} {...props} />;
}

function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-footer"
      className={cn(
        "flex h-10 shrink-0 items-center gap-4 border-t px-4 text-xs text-muted-foreground",
        "[&_kbd]:mr-1 [&_kbd]:inline-grid [&_kbd]:h-5 [&_kbd]:min-w-5 [&_kbd]:place-items-center [&_kbd]:rounded-md [&_kbd]:bg-surface [&_kbd]:px-1 [&_kbd]:font-sans [&_kbd]:text-[11px] [&_kbd]:font-medium [&_kbd]:text-glyph [&_kbd]:shadow-lift",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
  CommandFooter,
};
