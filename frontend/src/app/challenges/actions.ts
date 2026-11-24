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
import type { Challenge } from "@/lib/types";

/** Challenge Builder, publication workflow, screening and evaluation set-up. */

export async function createChallenge(form: FormData): Promise<void> {
  const problem = text(form, "problem_statement");
  const departmentId = text(form, "department_id") || undefined;
  let challenge: Challenge;
  try {
    challenge = await apiPost<Challenge>(
      "/challenges",
      { department_id: departmentId, problem_statement: problem, title: text(form, "title") },
      keyHeaders(idempotencyKey("create-challenge", form)),
    );
  } catch (error) {
    redirect(problemUrl("/challenges/new", error));
  }
  if (problem.length >= 40 && checkbox(form, "use_ai")) {
    try {
      await apiPost("/challenges/" + challenge.id + "/ai-draft", {
        problem_statement: problem,
        current_situation: text(form, "current_situation"),
        constraints: text(form, "constraints"),
      });
    } catch {
      // Drafting is a convenience. The manual form and the Template Kit still work.
    }
  }
  revalidatePath("/challenges");
  redirect("/challenges/" + challenge.id + "/edit");
}

export async function requestAiDraft(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  await withResult("/challenges/" + id + "/edit", null, async () => {
    await apiPost("/challenges/" + id + "/ai-draft", {
      problem_statement: text(form, "problem_statement"),
      current_situation: text(form, "current_situation"),
      constraints: text(form, "constraints"),
    });
    revalidatePath("/challenges/" + id + "/edit");
  });
}

function kpisFrom(form: FormData) {
  const names = list(form, "kpi_name");
  return names.map((name, index) => ({
    name,
    unit: (form.getAll("kpi_unit")[index] as string) ?? "",
    kind: (form.getAll("kpi_kind")[index] as string) ?? "continuous",
    direction: (form.getAll("kpi_direction")[index] as string) ?? "lower",
    baseline_value: parseOptional(form.getAll("kpi_baseline")[index]),
    baseline_sd: parseOptional(form.getAll("kpi_baseline_sd")[index]),
    baseline_source: (form.getAll("kpi_baseline_source")[index] as string) ?? "",
    baseline_method: (form.getAll("kpi_baseline_method")[index] as string) ?? "",
    baseline_plan: (form.getAll("kpi_baseline_plan")[index] as string) ?? "",
    target_value: parseOptional(form.getAll("kpi_target")[index]),
    is_primary: text(form, "primary_kpi") === String(index),
  }));
}

function criteriaFrom(form: FormData) {
  const names = list(form, "criterion_name");
  return names.map((name, index) => ({
    name,
    description: (form.getAll("criterion_description")[index] as string) ?? "",
    weight: Number((form.getAll("criterion_weight")[index] as string) ?? 0) || 0,
    anchors: {
      "1": (form.getAll("criterion_anchor_low")[index] as string) ?? "",
      "5": (form.getAll("criterion_anchor_high")[index] as string) ?? "",
    },
    round_number: 1,
  }));
}

function parseOptional(value: FormDataEntryValue | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function challengeBody(form: FormData) {
  const body: Record<string, unknown> = {
    title: text(form, "title"),
    problem_statement: text(form, "problem_statement"),
    current_situation: text(form, "current_situation"),
    outcome_statement: text(form, "outcome_statement"),
    constraints: text(form, "constraints"),
    pilot_scope: text(form, "pilot_scope"),
    commercial_terms: text(form, "commercial_terms"),
    sector: text(form, "sector") || null,
    state_code: text(form, "state_code") || null,
    district: text(form, "district") || null,
    location_required: checkbox(form, "location_required"),
    ip_option: text(form, "ip_option", "startup_retains"),
    budget_ceiling_rupees: number(form, "budget_ceiling_rupees", 0),
    pilot_duration_weeks: number(form, "pilot_duration_weeks", 8),
    eligibility_rules: {
      require_dpiit: checkbox(form, "require_dpiit"),
      min_turnover_paise: Math.round(number(form, "min_turnover_rupees", 0) * 100),
      min_experience_years: number(form, "min_experience_years", 0),
      notes: text(form, "eligibility_notes"),
    },
  };
  for (const field of ["application_deadline", "clarification_cutoff", "evaluation_deadline"]) {
    const value = text(form, field);
    if (value) body[field] = new Date(value).toISOString();
  }
  const kpis = kpisFrom(form);
  if (kpis.length) body.kpis = kpis;
  const criteria = criteriaFrom(form);
  if (criteria.length) body.criteria = criteria;
  return body;
}

/** Autosave and explicit save share one path, so a saved draft is always complete. */
export async function saveChallenge(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  const version = text(form, "version");
  await apiPut("/challenges/" + id, challengeBody(form), ifMatch(version));
  revalidatePath("/challenges/" + id + "/edit");
}

export async function saveChallengeAndReturn(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  await withResult("/challenges/" + id + "/edit", "Your changes have been saved.", async () => {
    await apiPut("/challenges/" + id, challengeBody(form), ifMatch(text(form, "version")));
    revalidatePath("/challenges/" + id);
  });
}

export async function submitChallenge(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  let failed = false;
  let destination = "/challenges/" + id;
  try {
    await apiPut("/challenges/" + id, challengeBody(form), ifMatch(text(form, "version")));
    await apiPost(
      "/challenges/" + id + "/submit",
      {},
      keyHeaders(idempotencyKey("submit-challenge:" + id, form)),
    );
  } catch (error) {
    failed = true;
    destination = problemUrl("/challenges/" + id + "/edit", error);
  }
  if (!failed) revalidatePath("/challenges");
  redirect(destination);
}

export async function decideChallenge(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  const action = text(form, "action");
  const reason = text(form, "reason");
  const notices: Record<string, string> = {
    approve: "The challenge is published and matched startups are being notified.",
    return: "The challenge has been returned to the officer with your comments.",
    cancel: "The challenge has been cancelled and applicants have been notified.",
  };
  await withResult("/challenges/" + id, notices[action] ?? "Recorded.", async () => {
    await apiPost(
      "/challenges/" + id + "/" + action,
      { reason: reason || undefined },
      keyHeaders(idempotencyKey(action + ":" + id, form)),
    );
    revalidatePath("/challenges");
    revalidatePath("/home");
  });
}

export async function runWorkflowStep(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  const action = text(form, "action");
  const back = text(form, "back", "/challenges/" + id);
  const notices: Record<string, string> = {
    "close-applications": "Applications are closed and every submission is locked.",
    screen: "Eligibility screening has run. Each result carries its reasons.",
    "start-evaluation": "Evaluation has started and the panel has been notified.",
    "lock-scores": "Scores are locked. The approver can now confirm the shortlist.",
  };
  await withResult(back, notices[action] ?? "Recorded.", async () => {
    await apiPost(
      "/challenges/" + id + "/" + action,
      {},
      keyHeaders(idempotencyKey(action + ":" + id, form)),
    );
    revalidatePath(back);
    revalidatePath("/home");
  });
}

export async function assignPanel(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  const evaluators = list(form, "evaluator_ids");
  const validators = list(form, "validator_ids");
  await withResult(
    "/challenges/" + id + "/panel",
    "The panel has been assigned and every member has been notified.",
    async () => {
      await apiPost(
        "/challenges/" + id + "/panel",
        { evaluator_ids: evaluators, validator_ids: validators },
        keyHeaders(idempotencyKey("panel:" + id, form)),
      );
      revalidatePath("/challenges/" + id + "/panel");
    },
  );
}

export async function confirmShortlist(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  const applicationIds = list(form, "application_ids");
  await withResult(
    "/challenges/" + id + "/ranking",
    "The shortlist is confirmed and a pilot record has been created for each shortlisted application.",
    async () => {
      await apiPost(
        "/challenges/" + id + "/shortlist",
        { application_ids: applicationIds },
        keyHeaders(idempotencyKey("shortlist:" + id, form)),
      );
      revalidatePath("/challenges/" + id);
      revalidatePath("/pilots");
    },
  );
}

export async function overrideEligibility(form: FormData): Promise<void> {
  const challengeId = text(form, "challenge_id");
  const applicationId = text(form, "application_id");
  await withResult(
    "/challenges/" + challengeId + "/screening",
    "The override is recorded in the audit log and is visible to the approver.",
    async () => {
      await apiPost(
        "/challenges/" + challengeId + "/applications/" + applicationId + "/eligibility/override",
        { outcome: text(form, "outcome"), justification: text(form, "justification") },
        keyHeaders(idempotencyKey("override:" + applicationId, form)),
      );
      revalidatePath("/challenges/" + challengeId + "/screening");
    },
  );
}

export async function issueCorrigendum(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  const changes: Record<string, unknown> = {};
  const deadline = text(form, "application_deadline");
  if (deadline) changes.application_deadline = new Date(deadline).toISOString();
  const budget = optionalNumber(form, "budget_ceiling_rupees");
  if (budget !== undefined) changes.budget_ceiling_paise = Math.round(budget * 100);
  const scope = text(form, "pilot_scope");
  if (scope) changes.pilot_scope = scope;

  await withResult(
    "/challenges/" + id,
    "The corrigendum is published and every startup that viewed or applied has been notified.",
    async () => {
      await apiPost("/challenges/" + id + "/corrigenda", {
        summary: text(form, "summary"),
        changes,
      });
      revalidatePath("/challenges/" + id);
    },
  );
}

export async function askClarification(form: FormData): Promise<void> {
  const id = text(form, "challenge_id");
  await withResult(
    "/challenges-board/" + id,
    "Your question has been recorded. The answer is published to every applicant at once, without naming who asked.",
    async () => {
      await apiPost("/challenges/" + id + "/clarifications", { question: text(form, "question") });
      revalidatePath("/challenges-board/" + id);
    },
  );
}

export async function answerClarification(form: FormData): Promise<void> {
  const challengeId = text(form, "challenge_id");
  const clarificationId = text(form, "clarification_id");
  await withResult(
    "/challenges/" + challengeId + "/clarifications",
    "The answer is published to every applicant.",
    async () => {
      await apiPut("/challenges/" + challengeId + "/clarifications/" + clarificationId, {
        answer: text(form, "answer"),
      });
      revalidatePath("/challenges/" + challengeId + "/clarifications");
    },
  );
}

/**
 * Background save for the builder. It returns the new record version instead of
 * redirecting, so the open form keeps its place and its next save is not stale.
 */
export async function autosaveChallenge(
  form: FormData,
): Promise<{ ok: true; version: number } | { ok: false; message: string }> {
  const id = text(form, "challenge_id");
  try {
    const saved = await apiPut<Challenge>(
      "/challenges/" + id,
      challengeBody(form),
      ifMatch(text(form, "version")),
    );
    return { ok: true, version: saved.version };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The draft could not be saved.",
    };
  }
}
