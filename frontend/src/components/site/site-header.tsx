"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/app/brand";
import { ThemeToggle } from "@/components/app/theme";

type Item = { href: string; label: string };

export function SiteHeader({ items, overlay = false, className }: { items: Item[]; overlay?: boolean; className?: string }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const reduced = useReducedMotion();

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={cn(
        "nav top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-300 ease-ios",
        overlay ? "fixed inset-x-0" : "sticky",
        className,
        scrolled || open || !overlay ? "bg-background/80 shadow-[0_1px_0_var(--border)] backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2 focus:shadow-float">
        Skip to content
      </a>
      <div className={cn("mx-auto flex h-16 items-center gap-6", overlay ? "wrap w-full max-w-[1280px] px-6 md:px-12 xl:px-0" : "max-w-6xl px-4 md:px-8")}>
        <Wordmark />
        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 lg:flex">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-full px-3 py-1.5 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="site-nav-pill"
                    transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.35, bounce: 0.15 }}
                    className="absolute inset-0 -z-10 rounded-full bg-surface shadow-lift"
                  />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <ThemeToggle />
          <Button asChild variant="default" size="sm" className="hidden sm:inline-flex">
            <Link href="/signin">Sign in</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Main"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden border-t lg:hidden"
          >
            <div className={cn("mx-auto flex flex-col gap-1 py-3", overlay ? "max-w-[1280px] px-6 md:px-12 xl:px-0" : "px-4")}>
              {items.map((item) => (
                <Link key={item.href} href={item.href} className="flex min-h-11 items-center rounded-xl px-3 text-[15px] text-foreground hover:bg-surface">
                  {item.label}
                </Link>
              ))}
              <Button asChild className="mt-2 h-11 w-full">
                <Link href="/signin">Sign in</Link>
              </Button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
