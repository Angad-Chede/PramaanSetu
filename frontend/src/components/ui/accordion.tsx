"use client";

import * as React from "react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

function Accordion({ ...props }: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn("border-b last:border-b-0", className)} {...props} />;
}

function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header data-slot="accordion-header" className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger flex min-h-11 flex-1 items-start justify-between gap-4 rounded-xl py-4 text-left text-sm font-medium text-pretty outline-none transition-colors duration-200 ease-out-soft focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
        <span
          aria-hidden
          data-slot="accordion-chevron"
          className="-my-0.5 grid size-6 shrink-0 place-items-center rounded-full text-glyph transition-[background-color,color,rotate] duration-300 ease-ios group-hover/accordion-trigger:bg-surface group-hover/accordion-trigger:text-foreground group-data-[state=open]/accordion-trigger:rotate-180 group-data-[state=open]/accordion-trigger:text-foreground motion-reduce:transition-none"
        >
          <ChevronDown className="pointer-events-none size-4" />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="group/accordion-content overflow-hidden text-sm ease-ios data-[state=closed]:animate-accordion-up data-[state=closed]:duration-200 data-[state=open]:animate-accordion-down data-[state=open]:duration-300 motion-reduce:animate-none"
      {...props}
    >
      <div
        className={cn(
          "pt-0 pb-4 transition-[opacity,translate] duration-300 ease-out-soft group-data-[state=closed]/accordion-content:-translate-y-1 group-data-[state=closed]/accordion-content:opacity-0 group-data-[state=closed]/accordion-content:duration-150 starting:-translate-y-1 starting:opacity-0 motion-reduce:transition-none",
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
