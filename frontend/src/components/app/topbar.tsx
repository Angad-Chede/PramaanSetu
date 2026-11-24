"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CornerDownLeft, LayoutGrid, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NAV_ICONS } from "@/components/app/app-sidebar";
import { ThemeToggle } from "@/components/app/theme";
import type { NavItem } from "@/lib/session";

const SEGMENT_LABELS: Record<string, string> = {
  home: "My tasks",
  challenges: "Challenges",
  "challenges-board": "Challenge board",
  pilots: "Pilots",
  "my-pilots": "My pilots",
  "my-applications": "My applications",
  evaluation: "Panel work",
  validation: "Validation",
  evidence: "Evidence",
  finance: "Payments",
  startup: "Startup profile",
  admin: "Administration",
  users: "Users and roles",
  templates: "Template Kit",
  jobs: "Jobs",
  audit: "Audit chain",
  notifications: "Notifications",
  demand: "Demand",
  transparency: "Transparency",
  new: "New challenge",
  edit: "Builder",
  review: "Approval",
  clarifications: "Clarifications",
  screening: "Screening",
  panel: "Panel",
  ranking: "Ranking",
  design: "Pilot design",
  agreement: "Agreement",
  metrics: "Measurements",
  milestones: "Milestones",
  decision: "Decision",
};

function crumbsFor(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((part, index) => {
    const href = "/" + parts.slice(0, index + 1).join("/");
    const looksLikeId = /^[0-9a-f-]{8,}$/i.test(part) || (/\d/.test(part) && part.length > 10);
    const raw = SEGMENT_LABELS[part] ?? (looksLikeId ? "Record" : part.replace(/-/g, " "));
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    return { href, label, last: index === parts.length - 1 };
  });
}

export function Topbar({ items, unread }: { items: NavItem[]; unread: number }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const crumbs = crumbsFor(pathname);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 rounded-t-[inherit] border-b border-border/60 bg-background/80 px-3 backdrop-blur-xl md:px-5">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4!" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb) => (
            <React.Fragment key={crumb.href}>
              <BreadcrumbItem className={crumb.last ? "min-w-0" : "hidden md:inline-flex"}>
                {crumb.last ? (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!crumb.last && <BreadcrumbSeparator className="hidden md:inline-flex" />}
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="hidden w-56 justify-start gap-2 text-muted-foreground sm:inline-flex"
      >
        <Search />
        <span className="flex-1 text-left">Go to...</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label="Search" onClick={() => setOpen(true)}>
        <Search />
      </Button>
      <Button variant="ghost" size="icon-sm" asChild aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
        <Link href="/notifications" className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-brand-foreground tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
      </Button>
      <ThemeToggle />

      <CommandDialog open={open} onOpenChange={setOpen} title="Go to" description="Jump to any section you can open">
        <CommandInput placeholder="Where to?" />
        <CommandList>
          <CommandEmpty>Nothing matches that.</CommandEmpty>
          <CommandGroup heading="Sections">
            {items.map((item) => {
              const Icon = NAV_ICONS[item.icon] ?? LayoutGrid;
              return (
                <CommandItem
                  key={item.href}
                  value={item.label + " " + item.description}
                  onSelect={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                >
                  <Icon />
                  <span>{item.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.description}</span>
                  <CommandShortcut>
                    <CornerDownLeft className="size-3" />
                  </CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </header>
  );
}
