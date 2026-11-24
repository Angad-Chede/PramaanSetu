"use client";

import * as React from "react";

import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";

export function CodeInput({ defaultValue }: { defaultValue?: string }) {
  const [value, setValue] = React.useState(defaultValue ?? "");
  const formRef = React.useRef<HTMLDivElement>(null);
  return (
    <div ref={formRef}>
      <InputOTP
        name="code"
        maxLength={6}
        value={value}
        onChange={setValue}
        onComplete={() => formRef.current?.closest("form")?.requestSubmit()}
        autoFocus
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="One-time code"
        pattern="^[0-9]+$"
      >
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}
