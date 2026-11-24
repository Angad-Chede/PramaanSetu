"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BadgeCheck,
  Bell,
  BookOpenCheck,
  Building2,
  ChevronsUpDown,
  ClipboardCheck,
  FileStack,
  FlaskConical,
  Gauge,
  Inbox,
  IndianRupee,
  Landmark,
  LayoutGrid,
  LogOut,
  Map,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { BrandMark } from "@/components/app/brand";
import { initials } from "@/lib/format";
import type { NavGroup, NavItem } from "@/lib/session";

export const NAV_ICONS: Record<string, LucideIcon> = {
  tasks: Inbox,
  bell: Bell,
  challenges: FileStack,
  pilots: FlaskConical,
  payments: IndianRupee,
  board: LayoutGrid,
  applications: ClipboardCheck,
  profile: Building2,
  panel: Gauge,
  validation: BadgeCheck,
  admin: Activity,
  users: Users,
  templates: BookOpenCheck,
  jobs: Waypoints,
  audit: ScrollText,
  demand: Map,
  evidence: ShieldCheck,
  transparency: Landmark,
};

const GROUP_ORDER: NavGroup[] = ["Workspace", "Department", "Startup", "Panel", "Platform", "Explore"];

export function isActivePath(pathname: string, href: string, all: string[]) {
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;
  // a more specific sibling owns the path (/admin/users beats /admin)
  return !all.some((other) => other !== href && other.startsWith(href + "/") && (pathname === other || pathname.startsWith(other + "/")));
}

export function AppSidebar({
  items,
  user,
  unread,
  signOut,
}: {
  items: NavItem[];
  user: { name: string; email: string; roleLabel: string; org: string };
  unread: number;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname() ?? "";
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  const hrefs = items.map((item) => item.href);
  const groups = GROUP_ORDER.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter(
    (entry) => entry.items.length > 0,
  );

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="PramaanSetu">
              <Link href="/home">
                <BrandMark className="size-8" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="font-display text-[15px] font-semibold tracking-tight">PramaanSetu</span>
                  <span className="truncate text-xs text-muted-foreground">{user.org}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map(({ group, items: entries }) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{group}</SidebarGroupLabel>
            <SidebarMenu>
              {entries.map((item) => {
                const Icon = NAV_ICONS[item.icon] ?? LayoutGrid;
                const active = isActivePath(pathname, item.href, hrefs);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href} title={item.description}>
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.icon === "bell" && unread > 0 && <SidebarMenuBadge className="bg-brand/12 text-brand-ink">{unread}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-8 rounded-full">
                    <AvatarFallback className="bg-foreground text-[11px] font-semibold text-background">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.roleLabel}</span>
                  </span>
                  <ChevronsUpDown className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium text-foreground">{user.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
                  {isDark ? <Sun /> : <Moon />}
                  {isDark ? "Light theme" : "Dark theme"}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/signin">
                    <Users />
                    Switch account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
