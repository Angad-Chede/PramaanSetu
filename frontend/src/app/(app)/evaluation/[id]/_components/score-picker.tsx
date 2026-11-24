"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

const SCORES = [1, 2, 3, 4, 5];

/**
 * Five anchored buttons feeding one hidden `criterion_score` input. A hidden input keeps
 * the posted values in the same order as the `criterion_id` inputs, which a radio group
 * named the same for every criterion could not.
 */
export function ScorePicker({
  name,
  label,
  defaultValue,
  anchors,
  id,
}: {
  name: string;
  label: string;
  defaultValue: number;
  anchors: Record<string, string>;
  id: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const reduced = useReducedMotion();
  const anchor = anchors?.[String(value)];

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setValue((v) => Math.min(5, v + 1));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setValue((v) => Math.max(1, v - 1));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={value} />
      <div role="radiogroup" aria-label={label} id={id} onKeyDown={onKeyDown} className="relative grid grid-cols-5 gap-1 rounded-2xl bg-recess/70 p-1">
        {SCORES.map((score) => {
          const selected = score === value;
          return (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              title={anchors?.[String(score)]}
              onClick={() => setValue(score)}
              className={cn(
                "relative h-10 rounded-xl text-sm font-semibold tabular-nums outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "text-brand-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {selected && (
                <motion.span
                  layoutId={"score-" + id}
                  transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.3, bounce: 0.18 }}
                  className="absolute inset-0 rounded-xl bg-brand shadow-lift"
                />
              )}
              <span className="relative">{score}</span>
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="min-h-[2.5em] text-[13px] leading-snug text-pretty text-muted-foreground">
        {anchor ? (
          <>
            <span className="font-medium text-foreground">{value} means: </span>
            {anchor}
          </>
        ) : null}
      </p>
    </div>
  );
}
