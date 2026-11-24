"use client";

import { PipelineStages, type PipelineStage } from "@/components/ui/pipeline-stages";

export const LIFECYCLE: (PipelineStage & { states: string[] })[] = [
  { id: "define", label: "Define", hint: "Drafted and approved", states: ["Draft", "InReview"] },
  { id: "discover", label: "Discover", hint: "Open for applications", states: ["Published"] },
  { id: "screen", label: "Screen", hint: "Eligibility checked by rule", states: ["ApplicationsClosed", "Screening"] },
  { id: "evaluate", label: "Evaluate", hint: "Blind panel scoring", states: ["Evaluation", "Shortlisted"] },
  { id: "pilot", label: "Pilot", hint: "Simulated, then run", states: ["PilotDesign", "PilotActive"] },
  { id: "validate", label: "Validate", hint: "Independent sign-off", states: ["Validation"] },
  { id: "decide", label: "Decide", hint: "Scale or close", states: ["DecisionPending", "Scaled", "Closed"] },
];

export function stageOf(state: string): string {
  return LIFECYCLE.find((stage) => stage.states.includes(state))?.id ?? "define";
}

export function Lifecycle({ state, size = "default" }: { state: string; size?: "sm" | "default" }) {
  const outcome = state === "Scaled" ? "won" : state === "Cancelled" ? "lost" : null;
  const index = LIFECYCLE.findIndex((stage) => stage.id === stageOf(state));
  const current = LIFECYCLE[index];
  const next = LIFECYCLE[index + 1];
  const caption =
    state === "Scaled"
      ? "Scaled: every stage complete"
      : state === "Cancelled"
        ? `Cancelled during ${current.label.toLowerCase()}`
        : state === "Closed"
          ? "Closed"
          : `Stage ${index + 1} of ${LIFECYCLE.length}: ${current.label}`;
  return (
    <div className="flex flex-col gap-2">
      <PipelineStages
        stages={LIFECYCLE.map(({ id, label, hint }) => ({ id, label, hint }))}
        value={current.id}
        outcome={outcome}
        disabled
        size={size}
        className="[&_[data-slot=pipeline-stages-caption]]:hidden!"
      />
      <p className="flex items-baseline justify-between gap-3 px-1 text-xs text-muted-foreground md:hidden">
        <span className="truncate">{caption}</span>
        {!outcome && state !== "Closed" && next && (
          <span className="truncate">
            Next <span className="font-medium text-foreground">{next.label}</span>
          </span>
        )}
      </p>
    </div>
  );
}
