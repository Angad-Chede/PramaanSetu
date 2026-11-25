"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2 } from "lucide-react";

/** A persona's sign-in button, which answers the click at once while the session is set up. */
export function PersonaButton({ icon, role, note }: { icon: React.ReactNode; role: string; note: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="group flex w-full items-center gap-3 rounded-2xl bg-white/[0.05] p-3 text-left ring-1 ring-white/[0.08] transition-[background-color,translate,box-shadow] duration-200 ease-ios outline-none hover:-translate-y-0.5 hover:bg-white/[0.09] hover:ring-white/15 focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98] disabled:translate-y-0 disabled:bg-white/[0.09] disabled:ring-brand/60"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-white/80 transition-colors group-hover:bg-brand group-hover:text-white group-disabled:bg-brand group-disabled:text-white">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{role}</span>
        <span className="truncate text-[12px] text-white/50">{pending ? "Signing in…" : note}</span>
      </span>
      {pending ? (
        <Loader2 aria-hidden className="ml-auto size-4 shrink-0 animate-spin text-white" />
      ) : (
        <ArrowRight className="ml-auto size-4 shrink-0 text-white/30 transition-[translate,color] duration-200 ease-ios group-hover:translate-x-0.5 group-hover:text-white" />
      )}
    </button>
  );
}
