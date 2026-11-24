import { FileSignature, Gauge, LineChart, Lock, Scale, Wallet } from "lucide-react";

import type { Pilot } from "@/lib/types";

import type { Stage } from "./lifecycle";

export type StageProgress = { periodsCompleted?: number; periodsPlanned?: number };

/** Where a pilot stands on each of its six stages, worked out from the pilot record alone. */
export function pilotStages(pilot: Pilot, progress: StageProgress = {}): Stage[] {
  const base = "/pilots/" + pilot.id;
  const running = pilot.state === "Active" || pilot.state === "Paused";
  const finished = pilot.state === "Completed" || pilot.state === "Terminated";
  const frozen = Boolean(pilot.design?.frozen);
  const accepted = Boolean(pilot.agreement?.accepted_at);
  const milestones = pilot.milestones ?? [];
  const paid = milestones.filter((milestone) => milestone.state === "Paid").length;
  const overdue = milestones.some((milestone) => milestone.overdue);
  const { periodsCompleted, periodsPlanned } = progress;

  return [
    {
      key: "design",
      label: "Plan",
      href: base + "/design",
      icon: Lock,
      status: frozen ? "done" : pilot.state === "AgreementDraft" || pilot.state === "AwaitingStartup" ? "current" : "blocked",
      detail: frozen ? "Pre-registered" : "Run the simulator, then freeze",
    },
    {
      key: "agreement",
      label: "Agreement",
      href: base + "/agreement",
      icon: FileSignature,
      status: accepted ? "done" : pilot.agreement ? "current" : pilot.state === "AgreementDraft" ? "current" : "upcoming",
      detail: accepted
        ? "Accepted, version " + (pilot.agreement?.number ?? 1)
        : pilot.agreement?.approved_at
          ? "With the startup"
          : pilot.agreement
            ? "Awaiting approval"
            : "Not drafted",
    },
    {
      key: "metrics",
      label: "Measurements",
      href: base + "/metrics",
      icon: LineChart,
      status: finished ? "done" : running ? (pilot.state === "Paused" ? "blocked" : "current") : "upcoming",
      detail:
        periodsPlanned !== undefined && periodsCompleted !== undefined
          ? `${periodsCompleted} of ${periodsPlanned} periods`
          : running
            ? "Collecting"
            : finished
              ? "Dataset locked"
              : "Starts with the pilot",
    },
    {
      key: "milestones",
      label: "Payments",
      href: base + "/milestones",
      icon: Wallet,
      status: overdue ? "blocked" : milestones.length && paid === milestones.length ? "done" : paid > 0 || running ? "current" : "upcoming",
      detail: milestones.length ? `${paid} of ${milestones.length} paid${overdue ? ", one overdue" : ""}` : "No schedule yet",
    },
    {
      key: "evidence",
      label: "Evidence",
      href: base + "/evidence",
      icon: Gauge,
      status: pilot.state === "Completed" ? "current" : "upcoming",
      detail: pilot.state === "Completed" ? "Ready for the engine" : "After completion",
    },
    {
      key: "decision",
      label: "Decision",
      href: base + "/decision",
      icon: Scale,
      status: "upcoming",
      detail: "Scale, extend or stop",
    },
  ];
}
