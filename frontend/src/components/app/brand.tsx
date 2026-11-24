import Link from "next/link";

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-brand" />
      <path d="M6.5 21.5c3.2-7.4 15.8-7.4 19 0" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M11 17.6v3.9M16 15.9v5.6M21 17.6v3.9" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <path d="M5 21.5h22" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      <BrandMark className="transition-transform duration-300 ease-ios group-hover:-rotate-6" />
      <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">PramaanSetu</span>
    </Link>
  );
}
