"use client";

import type { ComponentProps, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const BOUNCE = 0.12;
const LINE = 1.15;

export type Grouping = "western" | "indian";

export type AnimatedCounterProps = Omit<ComponentProps<"span">, "prefix"> & {
  value: number;
  decimals?: number;
  duration?: number;
  padStart?: number;
  separator?: string;
  decimalSeparator?: string;
  grouping?: Grouping;
  prefix?: ReactNode;
  suffix?: ReactNode;
};

function group(integer: string, separator: string, grouping: Grouping) {
  if (integer.length <= 3) return integer;
  if (grouping === "western") return integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  const last = integer.slice(-3);
  const rest = integer.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, separator);
  return rest + separator + last;
}

function format(value: number, decimals: number, padStart: number, separator: string, decimalSeparator: string, grouping: Grouping) {
  const fixed = Math.abs(value).toFixed(decimals);
  const [integer, fraction] = fixed.split(".");
  const padded = integer.padStart(padStart, "0");
  const sign = value < 0 ? "-" : "";
  return sign + group(padded, separator, grouping) + (fraction ? decimalSeparator + fraction : "");
}

function Digit({ digit, duration, reduced }: { digit: number; duration: number; reduced: boolean }) {
  return (
    <span
      data-slot="animated-counter-digit"
      className="relative inline-block overflow-hidden text-center"
      style={{ height: `${LINE}em`, width: "1ch" }}
    >
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        initial={false}
        animate={{ y: `${-digit * LINE}em` }}
        transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: duration, bounce: BOUNCE }}
      >
        {DIGITS.map((face) => (
          <span key={face} className="block" style={{ height: `${LINE}em`, lineHeight: `${LINE}em` }}>
            {face}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

export function AnimatedCounter({
  value,
  decimals = 0,
  duration = 0.6,
  padStart = 1,
  separator = ",",
  decimalSeparator = ".",
  grouping = "western",
  prefix,
  suffix,
  className,
  ...props
}: AnimatedCounterProps) {
  const reduced = useReducedMotion() ?? false;
  const text = format(value, decimals, padStart, separator, decimalSeparator, grouping);
  const chars = text.split("");

  return (
    <span data-slot="animated-counter" className={cn("inline-flex items-baseline tabular-nums", className)} {...props}>
      <span className="sr-only">{text}</span>
      {prefix != null && <span aria-hidden>{prefix}</span>}
      <span aria-hidden className="inline-flex" style={{ lineHeight: `${LINE}em` }}>
        {chars.map((char, index) => {
          const key = chars.length - index;
          return /\d/.test(char) ? (
            <Digit key={key} digit={Number(char)} duration={duration} reduced={reduced} />
          ) : (
            <span key={`${key}-${char}`} className="inline-block">
              {char}
            </span>
          );
        })}
      </span>
      {suffix != null && <span aria-hidden>{suffix}</span>}
    </span>
  );
}

export default AnimatedCounter;
