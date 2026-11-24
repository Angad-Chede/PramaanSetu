"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const OPEN_DELAY = 200;
// once one tooltip has shown, neighbors open instantly for this long
const SKIP_DELAY = 400;
// touch has no hover, so pressing and holding shows the label, which lingers a moment after release
const HOLD_DELAY = 450;
const TOUCH_LINGER = 1500;

const GroupContext = React.createContext(false);

type TouchContextValue = { setOpen: (open: boolean) => void; held: boolean; setHeld: (held: boolean) => void };
const TouchContext = React.createContext<TouchContextValue | null>(null);

function TooltipProvider({
  delayDuration = OPEN_DELAY,
  skipDelayDuration = SKIP_DELAY,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <GroupContext.Provider value={true}>
      <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
    </GroupContext.Provider>
  );
}

function Tooltip({ open: openProp, defaultOpen = false, onOpenChange, ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const grouped = React.useContext(GroupContext);
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const [held, setHeld] = React.useState(false);
  const open = openProp ?? uncontrolledOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(next);
      if (!next) setHeld(false);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const touch = React.useMemo(() => ({ setOpen, held, setHeld }), [setOpen, held]);

  const root = (
    <TouchContext.Provider value={touch}>
      <TooltipPrimitive.Root data-slot="tooltip" open={open} onOpenChange={setOpen} {...props} />
    </TouchContext.Provider>
  );
  // inside a provider the tooltip joins its group, so moving between triggers skips the delay
  return grouped ? root : <TooltipProvider>{root}</TooltipProvider>;
}

function TooltipTrigger({
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
  onClickCapture,
  style,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const touch = React.useContext(TouchContext);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressing = React.useRef(false);
  const held = React.useRef(false);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  const release = () => {
    pressing.current = false;
    clearTimeout(timer.current);
    if (held.current && touch) timer.current = setTimeout(() => touch.setOpen(false), TOUCH_LINGER);
  };

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      style={{ WebkitTouchCallout: "none", ...style }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!touch || event.pointerType !== "touch") return;
        pressing.current = true;
        held.current = false;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          held.current = true;
          touch.setHeld(true);
          touch.setOpen(true);
        }, HOLD_DELAY);
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        if (event.pointerType === "touch") release();
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        if (event.pointerType === "touch") release();
      }}
      onContextMenu={(event) => {
        onContextMenu?.(event);
        if (pressing.current || held.current) event.preventDefault();
      }}
      // a hold only reveals the label, so the release must not also run the action
      onClickCapture={(event) => {
        onClickCapture?.(event);
        if (!held.current) return;
        held.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  container,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  container?: React.ComponentProps<typeof TooltipPrimitive.Portal>["container"];
}) {
  const touch = React.useContext(TouchContext);

  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        data-touch={touch?.held || undefined}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 flex w-fit max-w-[min(16rem,var(--radix-tooltip-content-available-width))] origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-xl bg-primary px-2.5 py-1 text-xs leading-[18px] font-medium text-balance text-primary-foreground shadow-float select-none dark:bg-surface-hover dark:text-foreground",
          // keycaps take the pill's own colors, whichever kbd component renders them
          "[&_kbd]:-mr-1 [&_kbd]:h-4.5 [&_kbd]:rounded-md [&_kbd]:px-1.5 [&_kbd]:font-sans [&_kbd]:text-[11px] [&_kbd]:tabular-nums [&_kbd]:bg-primary-foreground/15! [&_kbd]:text-current! [&_kbd]:shadow-none! dark:[&_kbd]:bg-foreground/10!",
          // a handoff from a neighbor appears in place; only a first open, or a touch hold, animates
          "ease-ios data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-96 data-[state=delayed-open]:duration-150",
          "data-touch:data-[state=instant-open]:animate-in data-touch:data-[state=instant-open]:fade-in-0 data-touch:data-[state=instant-open]:zoom-in-96 data-touch:data-[state=instant-open]:duration-150",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 data-[state=closed]:duration-100",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
