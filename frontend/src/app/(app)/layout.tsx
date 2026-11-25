import { cookies } from "next/headers";

import { signOut } from "@/app/actions";
import { AppSidebar } from "@/components/app/app-sidebar";
import { Topbar } from "@/components/app/topbar";
import { SiteHeader } from "@/components/site/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { apiGet } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import { getSession, navigationFor } from "@/lib/session";

async function unreadCount(): Promise<number> {
  try {
    const body = await apiGet<{ unread_count: number }>("/me/notifications?unread_only=true&limit=1");
    return body.unread_count ?? 0;
  } catch {
    return 0;
  }
}

function orgLabel(roles: string[]): string {
  if (roles.includes("PA")) return "Platform administration";
  if (roles.includes("SU")) return "Startup workspace";
  if (roles.includes("EE") || roles.includes("IV")) return "Independent panel";
  return "Department workspace";
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const hasSessionCookie = jar.has("ps_access") || jar.has("ps_refresh");
  // asked together; a signed-out visitor's count is never used
  const [session, unread] = await Promise.all([getSession(), hasSessionCookie ? unreadCount() : 0]);
  const items = navigationFor(session);

  if (!session) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteHeader items={items} />
        <main id="main" className="flex-1">
          {children}
        </main>
      </div>
    );
  }

  const sidebarOpen = jar.get("sidebar_state")?.value !== "false";
  const user = {
    name: session.name,
    email: session.email,
    roleLabel: session.roles.map((role) => ROLE_LABELS[role] ?? role).join(", "),
    org: orgLabel(session.roles),
  };

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar items={items} user={user} unread={unread} signOut={signOut} />
      <SidebarInset className="min-w-0">
        <Topbar items={items} unread={unread} />
        <div id="main" className="min-w-0 flex-1">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
