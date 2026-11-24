import { cn } from "@/lib/utils";
import type { Tone } from "@/components/app/kit";

export const OUTCOME_TONE: Record<string, Tone> = {
  Eligible: "success",
  NeedsReview: "warning",
  Ineligible: "destructive",
};

export const STAGES = [
  { key: "draft", label: "Draft", states: ["Draft"] },
  { key: "submitted", label: "Submitted", states: ["Submitted"] },
  { key: "screened", label: "Locked and screened", states: ["Locked", "Screened"] },
  { key: "evaluation", label: "Panel evaluation", states: ["UnderEvaluation"] },
  { key: "result", label: "Result", states: ["Shortlisted", "NotShortlisted"] },
];

export function stageIndex(state: string) {
  const index = STAGES.findIndex((stage) => stage.states.includes(state));
  return index < 0 ? 0 : index;
}

/** Five segments that fill as the application moves through the process. */
export function ApplicationProgress({ state, className }: { state: string; className?: string }) {
  const current = stageIndex(state);
  const withdrawn = state === "Withdrawn";
  const lost = state === "NotShortlisted";
  const won = state === "Shortlisted";
  return (
    <div className={cn("flex flex-col gap-1.5", className)} aria-label={`Stage ${current + 1} of ${STAGES.length}: ${STAGES[current].label}`}>
      <div className="flex gap-1">
        {STAGES.map((stage, index) => (
          <span
            key={stage.key}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              withdrawn
                ? "bg-recess"
                : index < current
                  ? "bg-foreground/70"
                  : index === current
                    ? won
                      ? "bg-success"
                      : lost
                        ? "bg-destructive/70"
                        : "bg-brand"
                    : "bg-recess",
            )}
          />
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground">{withdrawn ? "Withdrawn" : STAGES[current].label}</span>
    </div>
  );
}
