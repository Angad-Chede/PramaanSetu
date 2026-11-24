"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { apiPost, apiPut } from "@/lib/api";
import {
  checkbox,
  idempotencyKey,
  ifMatch,
  keyHeaders,
  list,
  number,
  optionalNumber,
  problemUrl,
  text,
  withResult,
} from "@/lib/forms";
import type { Application, SimulationRun } from "@/lib/types";

/** Applications, evaluation, pilot design, agreement, metrics, payments, evidence, scale. */

// --- Applications ----------------------------------------------------------

export async function startApplication(form: FormData): Promise<void> {
  const challengeId = text(form, "challenge_id");
  let application: Application;
  try {
    application = await apiPost<Application>(
      "/challenges/" + challengeId + "/applications",
      {},
      keyHeaders(idempotencyKey("apply:" + challengeId, form)),
    );
  } catch (error) {
    redirect(problemUrl("/challenges-board/" + challengeId, error));
  }
  revalidatePath("/my-applications");
  redirect("/my-applications/" + application.id);
}

function applicationBody(form: FormData) {
  const kpiIds = list(form, "commit_kpi_id");
  return {
    proposal_summary: text(form, "proposal_summary"),
    approach: text(form, "approach"),
    kpi_commitments: kpiIds
      .map((kpiId, index) => ({
        kpi_id: kpiId,
        committed_value: Number((form.getAll("commit_value")[index] as string) ?? ""),
        note: (form.getAll("commit_note")[index] as string) ?? "",
      }))
      .filter((row) => Number.isFinite(row.committed_value)),
    pilot_cost_rupees: number(form, "pilot_cost_rupees", 0),
    timeline_weeks: number(form, "timeline_weeks", 8),
    data_declaration: text(form, "data_declaration"),
    ip_declaration: text(form, "ip_declaration"),
    conflict_declaration: checkbox(form, "conflict_declaration"),
  };
}

export async function saveApplication(form: FormData): Promise<void> {
  const id = text(form, "application_id");
  await apiPut("/applications/" + id, applicationBody(form), ifMatch(text(form, "version")));
  revalidatePath("/my-applications/" + id);
}

export async function submitApplication(form: FormData): Promise<void> {
  const id = text(form, "application_id");
  let destination = "/my-applications/" + id + "?notice=" +
    encodeURIComponent(
      "Your application has been received. You can keep editing until the deadline; the last submitted version is the one that counts.",
    );
  try {
    await apiPut("/applications/" + id, applicationBody(form), ifMatch(text(form, "version")));
    await apiPost(
      "/applications/" + id + "/submit",
      {},
      keyHeaders(idempotencyKey("submit-application:" + id, form)),
    );
    revalidatePath("/my-applications");
  } catch (error) {
    destination = problemUrl("/my-applications/" + id, error);
  }
  redirect(destination);
}

export async function withdrawApplication(form: FormData): Promise<void> {
  const id = text(form, "application_id");
  await withResult("/my-applications/" + id, "The application has been withdrawn.", async () => {
    await apiPost("/applications/" + id + "/withdraw");
    revalidatePath("/my-applications");
  });
}

// --- Evaluation ------------------------------------------------------------

export async function declareConflict(form: FormData): Promise<void> {
  const applicationId = text(form, "application_id");
  const challengeId = text(form, "challenge_id");
  const hasConflict = text(form, "has_conflict") === "yes";
  await withResult(
    "/evaluation/" + challengeId,
    hasConflict
      ? "Your declared conflict is recorded. This application has been removed from your list."
      : "Declaration recorded. You can now score this application.",
    async () => {
      await apiPost("/evaluation/applications/" + applicationId + "/coi", {
        has_conflict: hasConflict,
        statement: text(form, "statement"),
      });
      revalidatePath("/evaluation/" + challengeId);
    },
  );
}

export async function submitScores(form: FormData): Promise<void> {
  const applicationId = text(form, "application_id");
  const challengeId = text(form, "challenge_id");
  const criterionIds = list(form, "criterion_id");
  const scores = criterionIds.map((criterionId, index) => ({
    criterion_id: criterionId,
    score: Number((form.getAll("criterion_score")[index] as string) ?? 0),
    justification: (form.getAll("criterion_justification")[index] as string) ?? "",
  }));

  await withResult(
    "/evaluation/" + challengeId,
    "Your scores are saved. They lock when every evaluator has submitted, or at the evaluation deadline.",
    async () => {
      await apiPut(
        "/evaluation/applications/" + applicationId + "/scores",
        { round_number: 1, scores },
        keyHeaders(idempotencyKey("scores:" + applicationId, form)),
      );
      revalidatePath("/evaluation/" + challengeId);
      revalidatePath("/home");
    },
  );
}

// --- Simulator and design --------------------------------------------------

export async function runSimulation(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  const whatIf: number[][] = [];
  const altWeeks = list(form, "what_if_weeks");
  const altUnits = list(form, "what_if_units");
  altWeeks.forEach((weeks, index) => {
    const units = altUnits[index];
    if (weeks && units) whatIf.push([Number(weeks), Number(units)]);
  });

  const body: Record<string, unknown> = {
    duration_weeks: number(form, "duration_weeks", 8),
    units: number(form, "units", 20),
    comparison_units: number(form, "comparison_units", 0),
    measurements_per_week: number(form, "measurements_per_week", 1),
    what_if: whatIf.slice(0, 3),
  };
  const optional: [string, string][] = [
    ["baseline_mean", "baseline_mean"],
    ["baseline_sd", "baseline_sd"],
    ["claimed_effect", "claimed_effect"],
    ["cost_per_unit_week_rupees", "cost_per_unit_week_rupees"],
    ["fixed_cost_rupees", "fixed_cost_rupees"],
    ["realism_factor", "realism_factor"],
    ["effect_uncertainty", "effect_uncertainty"],
    ["within_unit_share", "within_unit_share"],
    ["min_duration_weeks", "min_duration_weeks"],
  ];
  for (const [field, key] of optional) {
    const value = optionalNumber(form, field);
    if (value !== undefined) body[key] = value;
  }
  const confidence = text(form, "baseline_confidence");
  if (confidence) body.baseline_confidence = confidence;

  let runId = "";
  let destination = "/pilots/" + pilotId + "/design";
  try {
    const queued = await apiPost<{ run_id: string }>("/pilots/" + pilotId + "/simulations", body);
    runId = queued.run_id;
    destination = "/pilots/" + pilotId + "/design?run=" + runId;
  } catch (error) {
    destination = problemUrl("/pilots/" + pilotId + "/design", error);
  }
  revalidatePath("/pilots/" + pilotId + "/design");
  redirect(destination);
}

export async function freezeDesign(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  await withResult(
    "/pilots/" + pilotId + "/design",
    "The plan is pre-registered and locked. The success bar cannot move after the results are seen.",
    async () => {
      await apiPost(
        "/pilots/" + pilotId + "/design/freeze",
        {
          simulation_run_id: text(form, "simulation_run_id") || null,
          duration_weeks: number(form, "duration_weeks", 8),
          units: number(form, "units", 20),
          comparison_units: number(form, "comparison_units", 0),
          measurements_per_week: number(form, "measurements_per_week", 1),
          pass_mark: number(form, "pass_mark", 0),
          analysis_method: text(form, "analysis_method", "paired_t"),
          alpha: number(form, "alpha", 0.05),
          acknowledge: checkbox(form, "acknowledge"),
        },
        keyHeaders(idempotencyKey("freeze:" + pilotId, form)),
      );
      revalidatePath("/pilots/" + pilotId);
    },
  );
}

export async function recordAmendment(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  await withResult(
    "/pilots/" + pilotId + "/design",
    "The amendment is recorded and will be shown in the Evidence Report.",
    async () => {
      await apiPost("/pilots/" + pilotId + "/design/amend", {
        description: text(form, "description"),
        approved: checkbox(form, "approved"),
      });
      revalidatePath("/pilots/" + pilotId + "/design");
    },
  );
}

// --- Agreement and lifecycle -----------------------------------------------

export async function draftAgreement(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  const seqs = list(form, "milestone_seq");
  const milestones = seqs.map((seq, index) => ({
    seq: Number(seq),
    title: (form.getAll("milestone_title")[index] as string) ?? "",
    deliverable: (form.getAll("milestone_deliverable")[index] as string) ?? "",
    evidence_required: (form.getAll("milestone_evidence")[index] as string) ?? "",
    amount_rupees: Number((form.getAll("milestone_amount")[index] as string) ?? 0),
    due_date: new Date((form.getAll("milestone_due")[index] as string) ?? "").toISOString(),
  }));

  const dataTerms: Record<string, unknown> = {};
  for (const key of [
    "datasets",
    "identifiers_removed",
    "storage_location",
    "processing_purpose",
    "deletion_obligation",
    "access_log",
    "sub_processors",
    "export_format",
  ]) {
    const value = text(form, "data_" + key);
    if (value) dataTerms[key] = value;
  }
  dataTerms.retention_months = number(form, "data_retention_months", 12);

  await withResult(
    "/pilots/" + pilotId + "/agreement",
    "The agreement has been drafted, its hash recorded in the audit log, and it is now with the approver.",
    async () => {
      await apiPost(
        "/pilots/" + pilotId + "/agreements",
        {
          ip_option: text(form, "ip_option", "startup_retains"),
          data_terms: dataTerms,
          milestones,
          change_note: text(form, "change_note") || null,
        },
        keyHeaders(idempotencyKey("agreement:" + pilotId, form)),
      );
      revalidatePath("/pilots/" + pilotId);
    },
  );
}

export async function pilotTransition(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  const action = text(form, "action");
  const back = text(form, "back", "/pilots/" + pilotId);
  const notices: Record<string, string> = {
    "approve-agreement": "The agreement is approved and is now with the startup for acceptance.",
    "accept-agreement": "The agreement is accepted and the pilot is active. The plan is locked.",
    "request-changes": "Your change request has been sent to the department.",
    pause: "The pilot is paused and the startup has been notified.",
    resume: "The pilot has resumed.",
    complete: "The pilot is complete. Run the Evidence Engine next.",
    terminate: "The pilot has been terminated under the exit clause.",
  };
  await withResult(back, notices[action] ?? "Recorded.", async () => {
    await apiPost(
      "/pilots/" + pilotId + "/" + action,
      { reason: text(form, "reason") || undefined },
      keyHeaders(idempotencyKey(action + ":" + pilotId, form)),
    );
    revalidatePath("/pilots/" + pilotId);
    revalidatePath("/home");
  });
}

export async function completeCyberChecklist(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  const answers: Record<string, boolean> = {};
  for (const key of list(form, "control_key")) {
    answers[key] = checkbox(form, "control_" + key);
  }
  await withResult(
    "/pilots/" + pilotId + "/agreement",
    "The cybersecurity checklist is recorded as a schedule to the agreement.",
    async () => {
      await apiPost("/pilots/" + pilotId + "/cyber-checklist", { answers });
      revalidatePath("/pilots/" + pilotId + "/agreement");
    },
  );
}

// --- Metrics ---------------------------------------------------------------

export async function submitMetrics(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  const kpiIds = list(form, "row_kpi_id");
  const rows = kpiIds
    .map((kpiId, index) => {
      const start = (form.getAll("row_period_start")[index] as string) ?? "";
      const end = (form.getAll("row_period_end")[index] as string) ?? "";
      const value = Number((form.getAll("row_value")[index] as string) ?? "");
      const unitRef = ((form.getAll("row_unit_ref")[index] as string) ?? "").trim();
      if (!start || !end || !unitRef || !Number.isFinite(value)) return null;
      return {
        kpi_id: kpiId,
        unit_ref: unitRef,
        period_start: new Date(start).toISOString(),
        period_end: new Date(end).toISOString(),
        phase: (form.getAll("row_phase")[index] as string) ?? "pilot",
        arm: (form.getAll("row_arm")[index] as string) ?? "treatment",
        value,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (!rows.length) {
    redirect(
      "/pilots/" +
        pilotId +
        "/metrics?problem=" +
        encodeURIComponent(
          "No complete rows were entered. Each row needs a unit, a period and a number.",
        ),
    );
  }

  await withResult(
    "/pilots/" + pilotId + "/metrics",
    rows.length + " measurement row(s) submitted.",
    async () => {
      const result = await apiPost<{ accepted: number; rejected_count: number; message: string }>(
        "/pilots/" + pilotId + "/metrics",
        { rows },
        keyHeaders(idempotencyKey("metrics:" + pilotId, form)),
      );
      if (result.rejected_count) {
        throw new Error(result.message);
      }
      revalidatePath("/pilots/" + pilotId + "/metrics");
    },
  );
}

export async function disputeMetric(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  await withResult(
    "/pilots/" + pilotId + "/metrics",
    "The measurement is marked as disputed and is excluded from interim views and the Evidence Report until it is resolved.",
    async () => {
      await apiPost("/pilots/" + pilotId + "/metrics/dispute", {
        submission_id: text(form, "submission_id"),
        reason: text(form, "reason"),
      });
      revalidatePath("/pilots/" + pilotId + "/metrics");
    },
  );
}

// --- Milestones ------------------------------------------------------------

export async function milestoneAction(form: FormData): Promise<void> {
  const milestoneId = text(form, "milestone_id");
  const action = text(form, "action");
  const back = text(form, "back", "/home");
  const version = text(form, "version");

  const bodies: Record<string, unknown> = {
    submit: { note: text(form, "note") },
    accept: { remarks: text(form, "remarks") || null },
    reject: {
      reason: text(form, "reason"),
      unmet_requirement: text(form, "unmet_requirement"),
    },
    "approve-payment": { remarks: text(form, "remarks") || null },
    "record-release": {
      reference_no: text(form, "reference_no"),
      amount_rupees: number(form, "amount_rupees", 0),
      released_on: text(form, "released_on") ? new Date(text(form, "released_on")).toISOString() : null,
      mode: text(form, "mode", "Bank transfer"),
      remarks: text(form, "remarks") || null,
    },
  };

  const notices: Record<string, string> = {
    submit: "Evidence submitted. The department service level clock is now running.",
    accept: "Milestone accepted. It is now with the approver for payment approval.",
    reject: "Returned to the startup with the requirement that was not met.",
    "approve-payment": "Payment approved. It is now in the finance queue.",
    "record-release": "Release recorded. The startup has been notified with the reference.",
  };

  await withResult(back, notices[action] ?? "Recorded.", async () => {
    await apiPost(
      "/milestones/" + milestoneId + "/" + action,
      bodies[action] ?? {},
      { ...keyHeaders(idempotencyKey(action + ":" + milestoneId, form)), ...ifMatch(version) },
    );
    revalidatePath(back);
    revalidatePath("/home");
  });
}

// --- Evidence and validation -----------------------------------------------

export async function runEvidence(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  await withResult(
    "/pilots/" + pilotId + "/evidence",
    "The analysis ran on the method and pass mark fixed at design freeze. The report is now with the independent validator.",
    async () => {
      await apiPost(
        "/pilots/" + pilotId + "/evidence/run",
        {},
        keyHeaders(idempotencyKey("evidence:" + pilotId, form)),
      );
      revalidatePath("/pilots/" + pilotId + "/evidence");
      revalidatePath("/home");
    },
  );
}

export async function signOffEvidence(form: FormData): Promise<void> {
  const reportId = text(form, "report_id");
  const decision = text(form, "decision");
  const checklist: Record<string, boolean> = {};
  for (const key of list(form, "checklist_key")) {
    checklist[key] = checkbox(form, "check_" + key);
  }
  const notices: Record<string, string> = {
    sign_off: "Signed off. The score is final and an Innovation Passport is being issued.",
    sign_off_with_qualifications:
      "Signed off with qualifications. Your remarks are carried on the report and in the passport.",
    refuse:
      "Validation refused. No Evidence Confidence Score is issued and no scale decision can be recorded on this pilot.",
  };
  await withResult("/validation/" + reportId, notices[decision] ?? "Recorded.", async () => {
    await apiPost(
      "/evidence/" + reportId + "/sign-off",
      { decision, remarks: text(form, "remarks"), checklist },
      keyHeaders(idempotencyKey("signoff:" + reportId, form)),
    );
    revalidatePath("/validation");
    revalidatePath("/home");
  });
}

// --- Scale decision and reuse ----------------------------------------------

export async function recordDecision(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  const projection = text(form, "scale_projection");
  await withResult(
    "/pilots/" + pilotId + "/decision",
    "The decision is recorded. If it is Scale, the procurement handoff pack is ready to download.",
    async () => {
      await apiPost(
        "/pilots/" + pilotId + "/decision",
        {
          decision: text(form, "decision"),
          reason: text(form, "reason"),
          estimated_value_rupees: number(form, "estimated_value_rupees", 0),
          qualified_vendor_count: optionalNumber(form, "qualified_vendor_count"),
          exit_plan_on_record: checkbox(form, "exit_plan_on_record"),
          scale_projection: projection ? JSON.parse(projection) : {},
        },
        keyHeaders(idempotencyKey("decision:" + pilotId, form)),
      );
      revalidatePath("/pilots/" + pilotId);
      revalidatePath("/evidence");
    },
  );
}

export async function projectScale(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  const params = new URLSearchParams({
    units: String(number(form, "units", 0)),
    cost: String(number(form, "cost_per_unit_rupees", 0)),
    value: String(number(form, "value_per_effect_unit_rupees", 0)),
  });
  redirect("/pilots/" + pilotId + "/decision?" + params.toString());
}

export async function raiseAdoption(form: FormData): Promise<void> {
  const passportId = text(form, "passport_id");
  await withResult(
    "/evidence/" + passportId,
    "The adoption request is recorded and a challenge draft has been pre-filled with the original evidence attached.",
    async () => {
      await apiPost(
        "/passports/" + passportId + "/adoption-requests",
        {
          intent: text(form, "intent", "new_challenge"),
          note: text(form, "note"),
          context: {
            scale_units: optionalNumber(form, "scale_units"),
            population: optionalNumber(form, "population"),
            environment: text(form, "environment") || undefined,
            state_code: text(form, "state_code") || undefined,
            sector: text(form, "sector") || undefined,
          },
        },
        keyHeaders(idempotencyKey("adopt:" + passportId, form)),
      );
      revalidatePath("/evidence/" + passportId);
      revalidatePath("/challenges");
    },
  );
}

export async function issuePilotApiKey(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  let notice = "";
  try {
    const result = await apiPost<{ api_key: string; endpoint: string }>(
      "/pilots/" + pilotId + "/api-key",
    );
    notice =
      "New API key: " +
      result.api_key +
      ". This is shown once. Send it as the X-Pilot-Key header on " +
      result.endpoint +
      ".";
  } catch {
    notice = "The API key could not be issued. Try again.";
  }
  redirect("/pilots/" + pilotId + "/metrics?notice=" + encodeURIComponent(notice));
}

export async function refreshSimulationView(form: FormData): Promise<void> {
  const pilotId = text(form, "pilot_id");
  const runId = text(form, "run_id");
  revalidatePath("/pilots/" + pilotId + "/design");
  redirect("/pilots/" + pilotId + "/design?run=" + runId);
}

export type { SimulationRun };
