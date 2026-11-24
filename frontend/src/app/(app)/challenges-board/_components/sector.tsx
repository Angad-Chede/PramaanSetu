import { Bus, Droplets, GraduationCap, HeartPulse, Layers, Recycle, Siren, Sprout, Zap, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const SECTORS = [
  "Water",
  "Urban solid waste",
  "Urban mobility",
  "Public health",
  "Agriculture",
  "Energy",
  "Education",
  "Disaster management",
];

const SECTOR_STYLE: Record<string, { icon: LucideIcon; tint: string }> = {
  Water: { icon: Droplets, tint: "bg-info/12 text-info-ink" },
  "Urban solid waste": { icon: Recycle, tint: "bg-success/12 text-success-ink" },
  "Urban mobility": { icon: Bus, tint: "bg-chart-4/12 text-chart-4-ink" },
  "Public health": { icon: HeartPulse, tint: "bg-destructive/10 text-destructive-ink" },
  Agriculture: { icon: Sprout, tint: "bg-success/12 text-success-ink" },
  Energy: { icon: Zap, tint: "bg-warning/14 text-warning-ink" },
  Education: { icon: GraduationCap, tint: "bg-info/12 text-info-ink" },
  "Disaster management": { icon: Siren, tint: "bg-brand/12 text-brand-ink" },
};

export function sectorStyle(sector: string | null | undefined) {
  return (sector && SECTOR_STYLE[sector]) || { icon: Layers, tint: "bg-surface text-glyph" };
}

export function SectorIcon({ sector, className, size = "md" }: { sector: string | null | undefined; className?: string; size?: "sm" | "md" | "lg" }) {
  const { icon: Icon, tint } = sectorStyle(sector);
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center",
        size === "sm" && "size-7 rounded-lg [&_svg]:size-3.5",
        size === "md" && "size-10 rounded-xl [&_svg]:size-[18px]",
        size === "lg" && "size-14 rounded-2xl [&_svg]:size-6",
        tint,
        className,
      )}
    >
      <Icon />
    </span>
  );
}
