"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { Check, RotateCcw, Trophy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const POP: Transition = { type: "spring", stiffness: 520, damping: 22, mass: 0.5 };
const FADE: Transition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] };
const INSTANT: Transition = { duration: 0 };
const NOTCH = 10;
const INK = {
  brand: "text-brand-ink",
  success: "text-success-ink",
  destructive: "text-destructive-ink",
};

export type PipelineStage = {
  id: string;
  label: string;
  hint?: string;
};

export type PipelineOutcome = "won" | "lost" | null;

export type PipelineStagesProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  stages: PipelineStage[];
  value: string;
  onValueChange?: (id: string) => void;
  outcome?: PipelineOutcome;
  onOutcomeChange?: (outcome: PipelineOutcome) => void;
  disabled?: boolean;
  size?: "sm" | "default";
};

function chevron(first: boolean, last: boolean) {
  const tip = last ? "100% 0, 100% 100%" : `calc(100% - ${NOTCH}px) 0, 100% 50%, calc(100% - ${NOTCH}px) 100%`;
  const tail = first ? "0 100%" : `0 100%, ${NOTCH}px 50%`;
  return `polygon(0 0, ${tip}, ${tail})`;
}

function stageTone({ outcome, done, active, lostHere }: { outcome: PipelineOutcome; done: boolean; active: boolean; lostHere: boolean }) {
  if (lostHere) return cn("bg-destructive/12", INK.destructive);
  if (outcome === "won") return cn("bg-success/14", INK.success);
  if (outcome === "lost" && done) return "bg-surface text-foreground";
  if (active) return "bg-brand text-brand-foreground";
  if (done) return cn("bg-brand/12 enabled:hover:bg-brand/18", INK.brand);
  return "bg-surface text-muted-foreground enabled:hover:bg-surface-hover enabled:hover:text-foreground";
}

function PipelineStages({
  stages,
  value,
  onValueChange,
  outcome = null,
  onOutcomeChange,
  disabled = false,
  size = "default",
  className,
  ...props
}: PipelineStagesProps) {
  const reduced = useReducedMotion() ?? false;
  const current = Math.max(
    0,
    stages.findIndex((stage) => stage.id === value),
  );
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const closed = outcome !== null;
  const announce = outcome ? `Deal ${outcome}` : `Stage ${current + 1} of ${stages.length}: ${stages[current]?.label ?? ""}`;

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const jump = event.key === "Home" ? 0 : event.key === "End" ? stages.length - 1 : null;
    const next = jump ?? (step ? index + step : null);
    if (next === null || next < 0 || next >= stages.length) return;
    event.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <div
      data-slot="pipeline-stages"
      data-outcome={outcome ?? undefined}
      className={cn("flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2", className)}
      {...props}
    >
      <div data-slot="pipeline-stages-track" className="@container/pipeline flex min-w-0 grow basis-80 flex-col">
        <div role="radiogroup" aria-label="Pipeline stage" className="flex min-w-0">
          {stages.map((stage, index) => {
            const first = index === 0;
            const last = index === stages.length - 1;
            const done = outcome === "won" || index < current;
            const active = index === current && outcome !== "won";
            const lostHere = outcome === "lost" && index === current;
            const tone = stageTone({ outcome, done, active, lostHere });

            const segment = (
              <button
                ref={(node) => {
                  refs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={index === current}
                tabIndex={index === current ? 0 : -1}
                disabled={disabled || closed}
                data-slot="pipeline-stages-step"
                data-state={lostHere ? "lost" : active ? "current" : done ? "complete" : "upcoming"}
                onClick={() => index !== current && onValueChange?.(stage.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                aria-label={stage.label}
                style={
                  {
                    clipPath: chevron(first, last),
                    marginLeft: first ? 0 : -(NOTCH - 3),
                    "--pl": `${first ? 14 : NOTCH + 8}px`,
                    "--pr": `${last ? 14 : NOTCH + 6}px`,
                  } as React.CSSProperties
                }
                className={cn(
                  "group/step relative flex min-w-0 flex-1 items-center justify-center gap-1.5 pr-(--pr) pl-(--pl) text-[13px] font-medium whitespace-nowrap outline-none select-none",
                  "transition-[background-color,color,box-shadow] duration-300 ease-out-soft focus-visible:z-10 focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]",
                  "disabled:cursor-default",
                  size === "sm" ? "h-7 text-xs" : "h-9 pointer-coarse:h-11",
                  (active || lostHere) && "grow-[1.8]",
                  !active && !lostHere && outcome !== "won" && "@max-[30rem]/pipeline:w-12 @max-[30rem]/pipeline:flex-none",
                  first && "rounded-l-xl",
                  last && "rounded-r-xl",
                  tone,
                )}
              >
                <AnimatePresence initial={false}>
                  {(done || lostHere) && (
                    <motion.span
                      key={lostHere ? "x" : "check"}
                      className="-ml-0.5 grid shrink-0 place-items-center"
                      initial={{ scale: 0, width: 0, opacity: 0 }}
                      animate={{ scale: 1, width: "auto", opacity: 1 }}
                      exit={{ scale: 0, width: 0, opacity: 0 }}
                      transition={reduced ? INSTANT : POP}
                    >
                      {lostHere ? <X className="size-3.5" strokeWidth={2.5} /> : <Check className="size-3.5" strokeWidth={2.5} />}
                    </motion.span>
                  )}
                </AnimatePresence>
                {!done && !active && !lostHere && (
                  <span aria-hidden className="hidden tabular-nums @max-[30rem]/pipeline:inline">
                    {index + 1}
                  </span>
                )}
                <span aria-hidden className={cn("truncate", !active && !lostHere && "@max-[30rem]/pipeline:hidden")}>
                  {stage.label}
                </span>
              </button>
            );

            return stage.hint ? (
              <Tooltip key={stage.id}>
                <TooltipTrigger asChild>{segment}</TooltipTrigger>
                <TooltipContent>{stage.hint}</TooltipContent>
              </Tooltip>
            ) : (
              <React.Fragment key={stage.id}>{segment}</React.Fragment>
            );
          })}
        </div>
        <p
          aria-hidden
          data-slot="pipeline-stages-caption"
          className={cn(
            "mt-1.5 hidden items-baseline justify-between gap-3 px-1 text-muted-foreground tabular-nums @max-[30rem]/pipeline:flex",
            size === "sm" ? "text-[11px]" : "text-xs",
          )}
        >
          <span className="truncate">
            {outcome === "won" ? "Closed won" : outcome === "lost" ? `Lost at ${stages[current]?.label ?? ""}` : `Stage ${current + 1} of ${stages.length}`}
          </span>
          {!closed && stages[current + 1] && (
            <span className="truncate">
              Next <span className="font-medium text-foreground">{stages[current + 1].label}</span>
            </span>
          )}
        </p>
      </div>

      {onOutcomeChange && (
        <div data-slot="pipeline-stages-outcome" className="ml-auto flex shrink-0 items-center gap-1.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {outcome ? (
              <motion.div
                key="closed"
                className="flex items-center gap-1.5"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={reduced ? INSTANT : FADE}
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
                    size === "sm" ? "h-7" : "h-9",
                    outcome === "won" ? cn("bg-success/14", INK.success) : cn("bg-destructive/12", INK.destructive),
                  )}
                >
                  {outcome === "won" ? <Trophy className="size-3.5" /> : <X className="size-3.5" strokeWidth={2.5} />}
                  {outcome === "won" ? "Won" : "Lost"}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size={size === "sm" ? "icon-sm" : "icon"}
                      aria-label="Reopen deal"
                      disabled={disabled}
                      onClick={() => onOutcomeChange(null)}
                    >
                      <RotateCcw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reopen</TooltipContent>
                </Tooltip>
              </motion.div>
            ) : (
              <motion.div
                key="open"
                className="flex items-center gap-1.5"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={reduced ? INSTANT : FADE}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onOutcomeChange("won")}
                  className={cn(INK.success, size === "default" && "h-9")}
                >
                  <Trophy /> Won
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onOutcomeChange("lost")}
                  className={cn(INK.destructive, size === "default" && "h-9")}
                >
                  <X /> Lost
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

export { PipelineStages };
