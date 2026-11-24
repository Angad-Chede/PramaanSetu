"use client";

import * as React from "react";
import { OTPInput, OTPInputContext } from "input-otp";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";

import { cn } from "@/lib/utils";

const ROLL: Transition = { type: "spring", stiffness: 520, damping: 34 };
const INSTANT: Transition = { duration: 0 };
const BLINK: Transition = { duration: 1.1, times: [0, 0.5, 0.5, 1], repeat: Infinity, ease: "linear" };

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string;
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn("flex items-center gap-2 has-disabled:opacity-50", containerClassName)}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-otp-group" className={cn("flex items-center", className)} {...props} />;
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  index: number;
}) {
  const inputOTPContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {};
  const reduceMotion = useReducedMotion();

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      data-filled={char ? true : undefined}
      className={cn(
        "relative flex size-10 items-center pointer-coarse:size-11 justify-center overflow-hidden border-y border-r border-input bg-surface text-base font-medium text-foreground tabular-nums outline-none",
        "transition-[background-color,border-color,box-shadow] duration-200 ease-ios first:rounded-l-xl first:border-l last:rounded-r-xl",
        "data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:bg-card data-[active=true]:ring-[3px] data-[active=true]:ring-ring/20 dark:data-[active=true]:bg-surface",
        "aria-invalid:border-destructive/70 data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/15",
        className,
      )}
      {...props}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {char && (
          <motion.span
            key={char}
            initial={{ y: "70%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-70%", opacity: 0 }}
            transition={reduceMotion ? INSTANT : ROLL}
          >
            {char}
          </motion.span>
        )}
      </AnimatePresence>
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <motion.div
            className="h-5 w-px rounded-full bg-foreground"
            animate={reduceMotion ? undefined : { opacity: [1, 1, 0, 0] }}
            transition={BLINK}
          />
        </div>
      )}
    </div>
  );
}

function InputOTPSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-separator"
      role="separator"
      className={cn("flex items-center px-0.5 text-glyph", className)}
      {...props}
    >
      <span className="h-0.5 w-2.5 rounded-full bg-current" />
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
