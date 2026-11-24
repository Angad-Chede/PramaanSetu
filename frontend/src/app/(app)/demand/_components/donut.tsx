"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { DonutChartProps } from "@/components/ui/donut-chart";

// recharts numbers its clip paths with a module counter, so server and client ids
// disagree; drawing it only in the browser avoids the hydration mismatch
const DonutChart = dynamic(() => import("@/components/ui/donut-chart").then((mod) => mod.DonutChart), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center gap-4">
      <Skeleton className="size-44 rounded-full" />
      <Skeleton className="h-16 w-full rounded-2xl" />
    </div>
  ),
});

export function ClientDonut(props: DonutChartProps) {
  return <DonutChart {...props} />;
}
