"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavItem } from "@/lib/session";

/**
 * The top navigation, with the section the user is in marked.
 *
 * Knowing where you are is the cheapest orientation an interface can give, and it is
 * the reason this is a client component: the active section depends on the current
 * path, which a server component rendered once per request cannot track.
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "";

  function isActive(href: string): boolean {
    if (href === "/home" || href === "/") return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <nav aria-label="Main" className="order-3 w-full sm:order-none sm:w-auto">
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={item.description}
                aria-current={active ? "page" : undefined}
                className={"nav-link" + (active ? " nav-link-active" : "")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The platform mark: two piers and a span, for a bridge between demand and proof. */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="7" fill="rgb(var(--brand))" />
      <path
        d="M7 21.5V13M25 21.5V13"
        stroke="rgb(var(--brand-contrast))"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M7 13c4.6-4.4 13.4-4.4 18 0"
        fill="none"
        stroke="rgb(var(--brand-contrast))"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M5.5 21.5h21"
        stroke="rgb(var(--brand-contrast))"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
