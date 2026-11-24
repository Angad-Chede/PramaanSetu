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

export type NavItem = { href: string; label: string; description: string };

/** Navigation is built from the roles the user actually holds. */
export function navigationFor(session: Session | null): NavItem[] {
  const items: NavItem[] = [];
  if (!session) {
    return [
      { href: "/challenges-board", label: "Challenge board", description: "Open challenges from every department" },
      { href: "/demand", label: "Demand", description: "Where departmental demand is, by sector" },
      { href: "/evidence", label: "Validated evidence", description: "Pilots that produced measured results" },
      { href: "/transparency", label: "Transparency", description: "Platform-wide figures" },
    ];
  }

  items.push({ href: "/home", label: "My tasks", description: "Everything waiting for you" });

  if (hasRole(session, "DO", "DA")) {
    items.push({
      href: "/challenges",
      label: "Challenges",
      description: "Challenges owned by your department",
    });
  }
  if (hasRole(session, "DO", "DA", "FO")) {
    items.push({ href: "/pilots", label: "Pilots", description: "Pilots your department is running" });
  }
  if (hasRole(session, "FO")) {
    items.push({ href: "/finance", label: "Payments", description: "Approved milestones awaiting release" });
  }
  if (hasRole(session, "SU")) {
    items.push(
      { href: "/challenges-board", label: "Find challenges", description: "Open challenges you can apply to" },
      { href: "/my-applications", label: "My applications", description: "Applications and their results" },
      { href: "/my-pilots", label: "My pilots", description: "Pilots, measurements and payments" },
      { href: "/startup", label: "Startup profile", description: "Your registry profile and passports" },
    );
  }
  if (hasRole(session, "EE", "IV")) {
    items.push({
      href: "/evaluation",
      label: "My panel work",
      description: "Challenges you are assigned to",
    });
  }

  items.push({ href: "/evidence", label: "Validated evidence", description: "Innovation Passports you can reuse" });

  if (hasRole(session, "PA")) {
    items.push({ href: "/admin", label: "Administration", description: "Users, templates, jobs and audit" });
  }

  return items;
}
