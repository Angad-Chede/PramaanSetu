import { redirect } from "next/navigation";

import { ApiError, apiGet } from "@/lib/api";
import type { Session } from "@/lib/types";

/** Who is signed in, and what they are allowed to see in the navigation. */

export async function getSession(): Promise<Session | null> {
  try {
    return await apiGet<Session>("/auth/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function requireSession(returnTo?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/signin" + (returnTo ? "?next=" + encodeURIComponent(returnTo) : ""));
  }
  return session;
}

export function hasRole(session: Session | null, ...roles: string[]): boolean {
  if (!session) return false;
  return roles.some((role) => session.roles.includes(role));
}

export function isDepartmentUser(session: Session | null): boolean {
  return hasRole(session, "DO", "DA", "FO");
}

export type NavGroup = "Workspace" | "Department" | "Startup" | "Panel" | "Platform" | "Explore";

export type NavItem = {
  href: string;
  label: string;
  description: string;
  group: NavGroup;
  /** a key the client maps to an icon; components cannot cross the server boundary */
  icon: string;
};

const PUBLIC_ITEMS: NavItem[] = [
  { href: "/challenges-board", label: "Challenge board", description: "Open challenges from every department", group: "Explore", icon: "board" },
  { href: "/demand", label: "Demand", description: "Where departmental demand is, by sector", group: "Explore", icon: "demand" },
  { href: "/evidence", label: "Validated evidence", description: "Pilots that produced measured results", group: "Explore", icon: "evidence" },
  { href: "/transparency", label: "Transparency", description: "Platform-wide figures", group: "Explore", icon: "transparency" },
];

/** Navigation is built from the roles the user actually holds. */
export function navigationFor(session: Session | null): NavItem[] {
  if (!session) return PUBLIC_ITEMS;

  const items: NavItem[] = [
    { href: "/home", label: "My tasks", description: "Everything waiting for you", group: "Workspace", icon: "tasks" },
    { href: "/notifications", label: "Notifications", description: "Reminders, escalations and decisions", group: "Workspace", icon: "bell" },
  ];

  if (hasRole(session, "DO", "DA")) {
    items.push({ href: "/challenges", label: "Challenges", description: "Challenges owned by your department", group: "Department", icon: "challenges" });
  }
  if (hasRole(session, "DO", "DA", "FO")) {
    items.push({ href: "/pilots", label: "Pilots", description: "Pilots your department is running", group: "Department", icon: "pilots" });
  }
  if (hasRole(session, "FO")) {
    items.push({ href: "/finance", label: "Payments", description: "Approved milestones awaiting release", group: "Department", icon: "payments" });
  }
  if (hasRole(session, "SU")) {
    items.push(
      { href: "/challenges-board", label: "Find challenges", description: "Open challenges you can apply to", group: "Startup", icon: "board" },
      { href: "/my-applications", label: "My applications", description: "Applications and their results", group: "Startup", icon: "applications" },
      { href: "/my-pilots", label: "My pilots", description: "Pilots, measurements and payments", group: "Startup", icon: "pilots" },
      { href: "/startup", label: "Startup profile", description: "Your registry profile and passports", group: "Startup", icon: "profile" },
    );
  }
  if (hasRole(session, "EE", "IV")) {
    items.push({ href: "/evaluation", label: "Panel work", description: "Challenges you are assigned to", group: "Panel", icon: "panel" });
  }
  if (hasRole(session, "IV")) {
    items.push({ href: "/validation", label: "Validation", description: "Evidence reports awaiting your sign-off", group: "Panel", icon: "validation" });
  }
  if (hasRole(session, "PA")) {
    items.push(
      { href: "/admin", label: "Overview", description: "Platform health and controls", group: "Platform", icon: "admin" },
      { href: "/admin/users", label: "Users and roles", description: "Accounts and scoped roles", group: "Platform", icon: "users" },
      { href: "/admin/templates", label: "Template Kit", description: "Versioned challenge templates", group: "Platform", icon: "templates" },
      { href: "/admin/jobs", label: "Jobs", description: "Queues and dead letters", group: "Platform", icon: "jobs" },
      { href: "/admin/audit", label: "Audit chain", description: "The hash-chained audit log", group: "Platform", icon: "audit" },
    );
  }

  const taken = new Set(items.map((item) => item.href));
  for (const item of PUBLIC_ITEMS) {
    if (!taken.has(item.href)) items.push(item);
  }
  return items;
}
