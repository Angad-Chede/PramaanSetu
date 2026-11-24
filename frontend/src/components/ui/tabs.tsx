"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

const SLIDE = { type: "spring", visualDuration: 0.4, bounce: 0.18 } as const;
const INSTANT = { duration: 0 } as const;

type TabsContextValue = { value: string | undefined; id: string };
const TabsContext = React.createContext<TabsContextValue | null>(null);

type TabsListVariant = "default" | "line";
const TabsListContext = React.createContext<TabsListVariant>("default");

function Tabs({
  className,
  value: valueProp,
  defaultValue,
  onValueChange,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const value = valueProp ?? uncontrolled;
  const id = React.useId();

  const handleValueChange = React.useCallback(
    (next: string) => {
      if (valueProp === undefined) setUncontrolled(next);
      onValueChange?.(next);
    },
    [valueProp, onValueChange],
  );

  const context = React.useMemo(() => ({ value, id }), [value, id]);

  return (
    <TabsContext.Provider value={context}>
      <TabsPrimitive.Root
        data-slot="tabs"
        value={value}
        onValueChange={handleValueChange}
        orientation={orientation}
        className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
        {...props}
      />
    </TabsContext.Provider>
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center text-glyph group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "h-9 rounded-full bg-surface p-[3px] group-data-[orientation=vertical]/tabs:rounded-2xl",
        line: "h-10 gap-1 rounded-none bg-transparent p-0 shadow-[inset_0_-1px_0_var(--border)] group-data-[orientation=vertical]/tabs:shadow-[inset_1px_0_0_var(--border)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  const resolved = variant ?? "default";
  return (
    <TabsListContext.Provider value={resolved}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={resolved}
        className={cn(tabsListVariants({ variant: resolved }), className)}
        {...props}
      />
    </TabsListContext.Provider>
  );
}

function TabsTrigger({ className, children, value, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const tabs = React.useContext(TabsContext);
  const variant = React.useContext(TabsListContext);
  const reduced = useReducedMotion();
  const active = tabs?.value === value;

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "relative inline-flex h-full flex-1 items-center justify-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap outline-none select-none transition-[color,box-shadow,transform] duration-200 ease-out-soft hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[7px] data-[state=active]:text-foreground group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variant === "default" && "rounded-full active:scale-[0.97] group-data-[orientation=vertical]/tabs:h-8 group-data-[orientation=vertical]/tabs:rounded-xl",
        variant === "line" &&
          "rounded-lg active:opacity-70 group-data-[orientation=vertical]/tabs:h-9 group-data-[orientation=vertical]/tabs:pl-4 pointer-coarse:after:-inset-y-0.5",
        className,
      )}
      {...props}
    >
      {active && tabs && (
        <motion.span
          aria-hidden
          data-slot="tabs-indicator"
          layoutId={`tabs-indicator-${tabs.id}`}
          transition={reduced ? INSTANT : SLIDE}
          className={cn(
            "pointer-events-none absolute",
            variant === "default" && "inset-0 rounded-[inherit] bg-card shadow-lift dark:bg-foreground/12",
            variant === "line" &&
              "inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground group-data-[orientation=vertical]/tabs:inset-x-auto group-data-[orientation=vertical]/tabs:inset-y-1.5 group-data-[orientation=vertical]/tabs:left-0 group-data-[orientation=vertical]/tabs:h-auto group-data-[orientation=vertical]/tabs:w-0.5",
          )}
        />
      )}
      <span className="relative inline-flex items-center gap-[inherit]">{children}</span>
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "flex-1 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-300 data-[state=active]:ease-out-soft motion-reduce:data-[state=active]:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
