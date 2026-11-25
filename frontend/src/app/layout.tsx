import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Reddit_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";

import { NavProgress } from "@/components/app/nav-progress";
import { ThemeProvider } from "@/components/app/theme";
import { WarmUp } from "@/components/app/warm-up";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const display = Reddit_Sans({ subsets: ["latin"], variable: "--font-display-face" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

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
      <body className={`${inter.variable} ${display.variable} ${mono.variable} min-h-dvh font-sans`}>
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
