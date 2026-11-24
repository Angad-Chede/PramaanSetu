import type { Metadata, Viewport } from "next";
import Link from "next/link";

import "./globals.css";

import { SignOutButton } from "@/components/actions";
import { BrandMark, NavLinks } from "@/components/nav";
import { THEME_BOOTSTRAP_SCRIPT, ThemeToggle } from "@/components/theme";
import { apiGet } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import { getSession, navigationFor } from "@/lib/session";

export const metadata: Metadata = {
  title: {
    default: "PramaanSetu",
    template: "%s | PramaanSetu",
  },
  description:
    "From a plain-language operational problem to an evidence-backed procurement decision on a startup solution, in one auditable workflow.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#181e26" },
  ],
};

export const dynamic = "force-dynamic";

async function unreadCount(signedIn: boolean): Promise<number> {
  if (!signedIn) return 0;
  try {
    const body = await apiGet<{ unread_count: number }>("/me/notifications?unread_only=true&limit=1");
    return body.unread_count;
  } catch {
    return 0;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const navigation = navigationFor(session);
  const unread = await unreadCount(Boolean(session));

  return (
    <html lang="en" data-theme="light" data-theme-preference="system" suppressHydrationWarning>
      <head>
        {/* Resolves the theme before the first paint, so a dark user never sees white. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to the main content
        </a>

        <header className="app-header no-print">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-2.5">
            <Link
              href={session ? "/home" : "/"}
              className="flex items-center gap-2.5 no-underline"
              aria-label="PramaanSetu home"
            >
              <BrandMark />
              <span className="leading-tight">
                <span className="block text-[0.95rem] font-semibold tracking-tight text-ink">
                  PramaanSetu
                </span>
                <span className="hidden text-2xs uppercase tracking-wide text-ink-muted sm:block">
                  Bridge of Proof
                </span>
              </span>
            </Link>

            <NavLinks items={navigation} />

            <div className="ml-auto flex items-center gap-3">
              <ThemeToggle />
              {session ? (
                <>
                  <Link
                    href="/notifications"
                    className="nav-link inline-flex items-center gap-1.5"
                    title="Notifications addressed to you"
                  >
                    Notifications
                    {unread > 0 ? (
                      <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full border border-bad/35 bg-bad-light px-1.5 py-0.5 text-2xs font-semibold text-bad">
                        {unread}
                      </span>
                    ) : null}
                  </Link>
                  <div className="hidden border-l border-line pl-3 text-right sm:block">
                    <p className="text-sm font-medium leading-tight text-ink">{session.name}</p>
                    <p className="text-2xs uppercase tracking-wide text-ink-muted">
                      {session.roles.map((role) => ROLE_LABELS[role] ?? role).join(", ")}
                    </p>
                  </div>
                  <SignOutButton />
                </>
              ) : (
                <Link href="/signin" className="btn btn-primary">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-7xl px-4 py-7">
          {children}
        </main>

        <footer className="mt-12 border-t border-line bg-paper py-8 no-print">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <BrandMark className="h-8 w-8 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-ink">PramaanSetu</p>
                <p className="text-2xs uppercase tracking-wide text-ink-muted">Bridge of Proof</p>
              </div>
            </div>
            <div className="max-w-prose space-y-2 text-sm text-ink-muted">
              <p>
                PramaanSetu records the evidence behind a procurement decision. Templates and
                recommendations on this platform support, and do not replace, the judgement of the
                competent authority and the department legal and finance cells.
              </p>
              <p>
                Built for Smart India Hackathon 2026, problem statement SIH26136, by team
                CODE REAPERS.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
