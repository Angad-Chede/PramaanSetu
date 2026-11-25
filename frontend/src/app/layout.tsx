import type { Metadata, Viewport } from "next";
import { Tiro_Devanagari_Hindi } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { GeistSerif } from "geist/font/serif";
import { Toaster } from "@/components/ui/sonner";

import { NavProgress } from "@/components/app/nav-progress";
import { ThemeProvider } from "@/components/app/theme";
import { WarmUp } from "@/components/app/warm-up";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

// the name in Devanagari, set once on the landing page; not preloaded elsewhere
const devanagari = Tiro_Devanagari_Hindi({ subsets: ["devanagari"], weight: "400", variable: "--font-tiro", preload: false });

export const metadata: Metadata = {
  title: { default: "PramaanSetu", template: "%s | PramaanSetu" },
  description:
    "Outcome-based challenges, pre-registered pilots and independently validated evidence for government departments buying from startups.",
  openGraph: {
    title: "PramaanSetu",
    description: "Procure startup solutions on measured evidence, not on a vendor's word.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistSerif.variable} ${GeistMono.variable} ${devanagari.variable} min-h-dvh font-sans`}>
        <NavProgress />
        <WarmUp />
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
