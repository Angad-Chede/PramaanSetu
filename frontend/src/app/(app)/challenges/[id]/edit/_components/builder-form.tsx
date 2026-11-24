"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, CloudCheck, Loader2, Plus, Send, Star, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { SelectField, SubmitButton, TextAreaField, TextField } from "@/components/app/forms";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Criterion, Kpi } from "@/lib/types";

type FormAction = (formData: FormData) => void | Promise<void>;
type AutosaveAction = (formData: FormData) => Promise<{ ok: true; version: number } | { ok: false; message: string }>;

export type BuilderValues = {
  id: string;
  version: number;
  title: string;
  problem_statement: string;
  current_situation: string;
  outcome_statement: string;
  constraints: string;
  pilot_scope: string;
  commercial_terms: string;
  sector: string;
  state_code: string;
  district: string;
  location_required: boolean;
  application_deadline: string;
  clarification_cutoff: string;
  evaluation_deadline: string;
  pilot_duration_weeks: number;
  budget_ceiling_rupees: number | "";
  ip_option: string;
  min_turnover_rupees: number;
  min_experience_years: number;
  require_dpiit: boolean;
  eligibility_notes: string;
  kpis: Kpi[];
  criteria: Criterion[];
};

const SECTORS = ["Water", "Urban solid waste", "Urban mobility", "Public health", "Agriculture", "Energy", "Education", "Disaster management"];

const EMPTY_KPI: Kpi = {
  id: "",
  name: "",
  unit: "",
  kind: "continuous",
  direction: "lower",
  baseline_value: null,
  baseline_sd: null,
  baseline_source: "",
  baseline_method: "",
  baseline_plan: "",
  target_value: null,
  is_primary: false,
  direction_label: "",
  problems: [],
};

const EMPTY_CRITERION: Criterion = { id: "", name: "", description: "", weight: 0, anchors: {}, round_number: 1 };
const WEIGHT_TONES = ["bg-brand", "bg-info", "bg-success", "bg-chart-4", "bg-warning", "bg-glyph", "bg-chart-5", "bg-foreground/40"];
const MAX_KPIS = 5;
const MAX_CRITERIA = 8;
const AUTOSAVE_MS = 10000;

let keySeed = 0;
const nextKey = () => "row-" + ++keySeed;

export function BuilderForm({
  values,
  editable,
  readyToSubmit,
  saveAction,
  submitAction,
  autosaveAction,
  ipOptions,
}: {
  values: BuilderValues;
  editable: boolean;
  readyToSubmit: boolean;
  saveAction: FormAction;
  submitAction: FormAction;
  autosaveAction: AutosaveAction;
  ipOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const formRef = React.useRef<HTMLFormElement>(null);
  const dirty = React.useRef(false);
  const busy = React.useRef(false);
  const [version, setVersion] = React.useState(values.version);
  const [status, setStatus] = React.useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });

  const [kpis, setKpis] = React.useState(() =>
    (values.kpis.length ? values.kpis : [EMPTY_KPI, EMPTY_KPI]).map((kpi, index) => ({ key: "kpi-" + index, kpi })),
  );
  const primaryIndex = Math.max(0, values.kpis.findIndex((kpi) => kpi.is_primary));
  const [criteria, setCriteria] = React.useState(() =>
    (values.criteria.length ? values.criteria : [EMPTY_CRITERION, EMPTY_CRITERION, EMPTY_CRITERION]).map((criterion, index) => ({
      key: "criterion-" + index,
      criterion,
      weight: criterion.weight || 0,
    })),
  );
  const total = criteria.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);

  const markDirty = () => {
    dirty.current = true;
  };

  const save = React.useCallback(async () => {
    const form = formRef.current;
    if (!editable || !form || !dirty.current || busy.current) return;
    busy.current = true;
    setStatus({ kind: "saving" });
    const result = await autosaveAction(new FormData(form)).catch(() => ({ ok: false as const, message: "The service did not answer." }));
    busy.current = false;
    if (result.ok) {
      dirty.current = false;
      setVersion(result.version);
      setStatus({ kind: "saved", text: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) });
      // refresh the readiness checklist beside the form without touching what is typed
      router.refresh();
    } else {
      setStatus({ kind: "error", text: result.message });
    }
  }, [autosaveAction, editable, router]);

  React.useEffect(() => {
    if (!editable) return;
    const timer = window.setInterval(save, AUTOSAVE_MS);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [editable, save]);

  const motionProps = {
    initial: reduced ? false : { opacity: 0, y: -6, height: 0 },
    animate: { opacity: 1, y: 0, height: "auto" },
    exit: reduced ? { opacity: 0 } : { opacity: 0, y: -6, height: 0 },
    transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] as const },
  };

  return (
    <form
      ref={formRef}
      action={saveAction}
      onChange={markDirty}
      onBlur={() => void save()}
      onSubmit={() => {
        dirty.current = false;
      }}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="challenge_id" value={values.id} />
      <input type="hidden" name="version" value={version} />

      <Step id="step-1" number={1} title="The problem" description="What is going wrong, who is affected and how often.">
        <TextField label="Title" name="title" defaultValue={values.title} disabled={!editable} required hint="Name the outcome and the place, not the technology." />
        <TextAreaField label="Problem description" name="problem_statement" rows={7} defaultValue={values.problem_statement} disabled={!editable} />
      </Step>

      <Step id="step-2" number={2} title="The current situation" description="How the service runs today, and where its data comes from.">
        <TextAreaField
          label="How it is handled today"
          name="current_situation"
          rows={5}
          defaultValue={values.current_situation}
          disabled={!editable}
          hint="The current process, the data already collected and who collects it."
        />
      </Step>

      <Step
        id="step-3"
        number={3}
        title="The outcome and how it is measured"
        description="State the change you want in a measure, with a number. Words like improve or optimise with nothing behind them get flagged."
      >
        <TextAreaField label="Outcome statement" name="outcome_statement" rows={4} defaultValue={values.outcome_statement} disabled={!editable} />

        <div className="flex flex-col gap-3 pt-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Measures</h3>
              <p className="text-[13px] text-muted-foreground">Between 1 and 5. Exactly one is primary: the pilot design and the Evidence Report are built around it.</p>
            </div>
            <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
              {kpis.length} of {MAX_KPIS}
            </span>
          </div>

          <AnimatePresence initial={false}>
            {kpis.map((row, index) => (
              <motion.fieldset key={row.key} {...motionProps} className="overflow-hidden">
                <div className="flex flex-col gap-5 rounded-2xl bg-surface/60 p-4 ring-1 ring-border/60 has-[input[name=primary_kpi]:checked]:bg-brand/[0.05] has-[input[name=primary_kpi]:checked]:ring-brand/30 md:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <legend className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="grid size-6 place-items-center rounded-full bg-card text-[11px] tabular-nums shadow-lift">{index + 1}</span>
                      Measure {index + 1}
                    </legend>
                    <div className="flex items-center gap-1">
                      <label className="group inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground ring-1 ring-border transition-colors select-none hover:text-foreground has-checked:bg-brand has-checked:text-brand-foreground has-checked:ring-brand has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-default">
                        <input
                          type="radio"
                          name="primary_kpi"
                          value={String(index)}
                          defaultChecked={index === primaryIndex}
                          disabled={!editable}
                          className="sr-only"
                        />
                        <Star className="size-3.5 group-has-checked:fill-current" />
                        Primary
                      </label>
                      {editable && kpis.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove measure ${index + 1}`}
                          onClick={() => {
                            setKpis((rows) => rows.filter((r) => r.key !== row.key));
                            markDirty();
                          }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextField label="Name" id={`kpi_name_${row.key}`} name="kpi_name" defaultValue={row.kpi.name} disabled={!editable} />
                    <TextField label="Unit" id={`kpi_unit_${row.key}`} name="kpi_unit" defaultValue={row.kpi.unit} disabled={!editable} hint="For example percent, hours, rupees per case." />
                    <SelectField
                      label="Kind"
                      id={`kpi_kind_${row.key}`}
                      name="kpi_kind"
                      defaultValue={row.kpi.kind}
                      disabled={!editable}
                      options={[
                        { value: "continuous", label: "A continuous quantity" },
                        { value: "proportion", label: "A rate or percentage" },
                      ]}
                    />
                    <SelectField
                      label="Which direction is better?"
                      id={`kpi_direction_${row.key}`}
                      name="kpi_direction"
                      defaultValue={row.kpi.direction}
                      disabled={!editable}
                      options={[
                        { value: "lower", label: "Lower is better" },
                        { value: "higher", label: "Higher is better" },
                      ]}
                    />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-3">
                    <TextField
                      label="Baseline"
                      id={`kpi_baseline_${row.key}`}
                      name="kpi_baseline"
                      type="number"
                      step="any"
                      inputMode="decimal"
                      defaultValue={row.kpi.baseline_value ?? ""}
                      disabled={!editable}
                      hint="Blank only if you collect it before the pilot."
                    />
                    <TextField
                      label="Variability"
                      id={`kpi_baseline_sd_${row.key}`}
                      name="kpi_baseline_sd"
                      type="number"
                      step="any"
                      inputMode="decimal"
                      defaultValue={row.kpi.baseline_sd ?? ""}
                      disabled={!editable}
                      hint="Spread between units. The simulator needs it."
                    />
                    <TextField
                      label="Target"
                      id={`kpi_target_${row.key}`}
                      name="kpi_target"
                      type="number"
                      step="any"
                      inputMode="decimal"
                      defaultValue={row.kpi.target_value ?? ""}
                      disabled={!editable}
                    />
                  </div>

                  <TextField label="Where the data comes from" id={`kpi_baseline_source_${row.key}`} name="kpi_baseline_source" defaultValue={row.kpi.baseline_source} disabled={!editable} />
                  <TextAreaField
                    label="How is it measured?"
                    id={`kpi_baseline_method_${row.key}`}
                    name="kpi_baseline_method"
                    rows={3}
                    defaultValue={row.kpi.baseline_method}
                    disabled={!editable}
                    hint="Precise enough that a validator could reproduce the number from the source."
                  />
                  <TextField
                    label="Baseline collection plan"
                    id={`kpi_baseline_plan_${row.key}`}
                    name="kpi_baseline_plan"
                    defaultValue={row.kpi.baseline_plan}
                    disabled={!editable}
                    hint="Only needed when the baseline is blank."
                  />

                  {values.kpis[index]?.problems?.length ? (
                    <ul className="flex flex-col gap-1.5 rounded-xl bg-destructive/8 px-3.5 py-3 text-[13px] text-destructive-ink">
                      {values.kpis[index].problems.map((problem) => (
                        <li key={problem} className="flex gap-2">
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                          {problem}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </motion.fieldset>
            ))}
          </AnimatePresence>

          {editable && kpis.length < MAX_KPIS && (
            <AddRow
              label="Add a measure"
              onClick={() => {
                setKpis((rows) => [...rows, { key: nextKey(), kpi: EMPTY_KPI }]);
                markDirty();
              }}
            />
          )}
        </div>
      </Step>

      <Step id="step-4" number={4} title="Constraints" description="What the solution must respect, whatever it is.">
        <TextAreaField label="Constraints" name="constraints" rows={5} defaultValue={values.constraints} disabled={!editable} />
        <div className="grid gap-5 sm:grid-cols-3">
          <SelectField
            label="Sector"
            name="sector"
            defaultValue={values.sector}
            disabled={!editable}
            placeholder="Open to all sectors"
            options={SECTORS.map((sector) => ({ value: sector, label: sector }))}
          />
          <TextField label="State code" name="state_code" defaultValue={values.state_code} maxLength={4} disabled={!editable} hint="Two letters, for example MH." />
          <TextField label="District" name="district" defaultValue={values.district} disabled={!editable} />
        </div>
        <Toggle name="location_required" label="Restrict applicants to this state" defaultChecked={values.location_required} disabled={!editable} />
      </Step>

      <Step
        id="step-5"
        number={5}
        title="The pilot scope and the deadlines"
        description="Name the area, the units and the period. Small enough to run, large enough to measure."
      >
        <TextAreaField label="Pilot scope" name="pilot_scope" rows={5} defaultValue={values.pilot_scope} disabled={!editable} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="Application deadline" name="application_deadline" type="datetime-local" defaultValue={values.application_deadline} disabled={!editable} />
          <TextField label="Questions close on" name="clarification_cutoff" type="datetime-local" defaultValue={values.clarification_cutoff} disabled={!editable} />
          <TextField label="Evaluation deadline" name="evaluation_deadline" type="datetime-local" defaultValue={values.evaluation_deadline} disabled={!editable} />
          <TextField
            label="Indicative pilot length in weeks"
            name="pilot_duration_weeks"
            type="number"
            min={1}
            max={52}
            defaultValue={values.pilot_duration_weeks}
            disabled={!editable}
          />
        </div>
      </Step>

      <Step id="step-6" number={6} title="Commercial terms and eligibility" description="The budget ceiling, the intellectual property position and the published criteria.">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Budget ceiling in rupees"
            name="budget_ceiling_rupees"
            type="number"
            min={0}
            step={1000}
            defaultValue={values.budget_ceiling_rupees}
            disabled={!editable}
            hint="Startups size proposals against it, and screening checks cost against it."
          />
          <SelectField label="Intellectual property option" name="ip_option" defaultValue={values.ip_option} disabled={!editable} options={ipOptions} />
        </div>
        <TextAreaField label="Commercial terms" name="commercial_terms" rows={4} defaultValue={values.commercial_terms} disabled={!editable} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Minimum prior turnover in rupees"
            name="min_turnover_rupees"
            type="number"
            min={0}
            defaultValue={values.min_turnover_rupees}
            disabled={!editable}
            hint="Relaxed for a recognised startup, with the rule recorded."
          />
          <TextField
            label="Minimum prior experience in years"
            name="min_experience_years"
            type="number"
            min={0}
            defaultValue={values.min_experience_years}
            disabled={!editable}
            hint="Also relaxed for a recognised startup."
          />
        </div>
        <Toggle
          name="require_dpiit"
          label="Applicants must be recognised by the Department for Promotion of Industry and Internal Trade"
          defaultChecked={values.require_dpiit}
          disabled={!editable}
        />
        <TextAreaField label="Eligibility notes shown to applicants" name="eligibility_notes" rows={4} defaultValue={values.eligibility_notes} disabled={!editable} />

        <div className="flex flex-col gap-3 border-t border-border/70 pt-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Evaluation rubric</h3>
              <p className="text-[13px] text-muted-foreground">Weights must sum to exactly 100. Evaluators score each criterion from 1 to 5 against the anchors, with a written justification.</p>
            </div>
            <span
              aria-live="polite"
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 font-display text-sm font-semibold tabular-nums",
                total === 100 ? "bg-success/12 text-success-ink" : "bg-warning/14 text-warning-ink",
              )}
            >
              {total} / 100
            </span>
          </div>
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-recess" aria-hidden>
            {criteria.map((row, index) => (
              <div
                key={row.key}
                className={cn("h-full transition-[width] duration-500 ease-out-soft first:rounded-l-full last:rounded-r-full", WEIGHT_TONES[index % WEIGHT_TONES.length])}
                style={{ width: ((Number(row.weight) || 0) / Math.max(total, 100)) * 100 + "%" }}
              />
            ))}
          </div>

          <AnimatePresence initial={false}>
            {criteria.map((row, index) => (
              <motion.fieldset key={row.key} {...motionProps} className="overflow-hidden">
                <div className="flex flex-col gap-5 rounded-2xl bg-surface/60 p-4 ring-1 ring-border/60 md:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <legend className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className={cn("size-2.5 rounded-full", WEIGHT_TONES[index % WEIGHT_TONES.length])} />
                      Criterion {index + 1}
                    </legend>
                    {editable && criteria.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove criterion ${index + 1}`}
                        onClick={() => {
                          setCriteria((rows) => rows.filter((r) => r.key !== row.key));
                          markDirty();
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <TextField label="Name" id={`criterion_name_${row.key}`} name="criterion_name" defaultValue={row.criterion.name} disabled={!editable} />
                    <TextField
                      label="Weight"
                      id={`criterion_weight_${row.key}`}
                      name="criterion_weight"
                      type="number"
                      min={0}
                      max={100}
                      inputMode="numeric"
                      defaultValue={row.criterion.weight}
                      disabled={!editable}
                      onChange={(event) => {
                        const weight = Number(event.target.value) || 0;
                        setCriteria((rows) => rows.map((r) => (r.key === row.key ? { ...r, weight } : r)));
                      }}
                    />
                  </div>
                  <TextAreaField label="What is being judged" id={`criterion_description_${row.key}`} name="criterion_description" rows={2} defaultValue={row.criterion.description} disabled={!editable} />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextField label="What a score of 1 looks like" id={`criterion_anchor_low_${row.key}`} name="criterion_anchor_low" defaultValue={row.criterion.anchors?.["1"] ?? ""} disabled={!editable} />
                    <TextField label="What a score of 5 looks like" id={`criterion_anchor_high_${row.key}`} name="criterion_anchor_high" defaultValue={row.criterion.anchors?.["5"] ?? ""} disabled={!editable} />
                  </div>
                </div>
              </motion.fieldset>
            ))}
          </AnimatePresence>

          {editable && criteria.length < MAX_CRITERIA && (
            <AddRow
              label="Add a criterion"
              onClick={() => {
                setCriteria((rows) => [...rows, { key: nextKey(), criterion: EMPTY_CRITERION, weight: 0 }]);
                markDirty();
              }}
            />
          )}
        </div>
      </Step>

      {editable && (
        <div className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-3xl bg-card/90 p-3 shadow-float backdrop-blur-xl sm:flex-row sm:items-center sm:pl-5">
          <SaveStatus status={status} />
          <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
            <SubmitButton variant="secondary" pendingLabel="Saving">
              Save draft
            </SubmitButton>
            <SubmitButton
              variant="brand"
              formAction={submitAction}
              pendingLabel="Submitting"
              disabled={!readyToSubmit}
              confirmTitle="Submit for approval?"
              confirm="Your approver reads a one-page summary and either approves it for publication or returns it with comments."
              confirmLabel="Submit"
            >
              <Send />
              Save and submit for approval
            </SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}

function Step({ id, number, title, description, children }: { id: string; number: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-3xl bg-card p-5 shadow-card md:p-7">
      <header className="mb-6 flex gap-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-foreground font-display text-sm font-semibold text-background tabular-nums">{number}</span>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors duration-150 outline-none hover:border-ring hover:bg-surface/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
    >
      <Plus className="size-4" />
      {label}
    </button>
  );
}

function Toggle({ name, label, defaultChecked, disabled }: { name: string; label: string; defaultChecked?: boolean; disabled?: boolean }) {
  const id = React.useId();
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface/60 px-4 py-3.5">
      <Checkbox id={id} name={name} value="yes" defaultChecked={defaultChecked} disabled={disabled} className="mt-0.5" />
      <Label htmlFor={id} className="text-sm leading-snug font-normal">
        {label}
      </Label>
    </div>
  );
}

function SaveStatus({ status }: { status: { kind: "idle" | "saving" | "saved" | "error"; text?: string } }) {
  return (
    <p aria-live="polite" className={cn("inline-flex min-w-0 items-center gap-2 text-[13px]", status.kind === "error" ? "text-destructive-ink" : "text-muted-foreground")}>
      {status.kind === "saving" ? (
        <Loader2 className="size-4 shrink-0 animate-spin" />
      ) : status.kind === "error" ? (
        <AlertCircle className="size-4 shrink-0" />
      ) : (
        <CloudCheck className="size-4 shrink-0" />
      )}
      <span className="truncate">
        {status.kind === "saving"
          ? "Saving your draft"
          : status.kind === "saved"
            ? `Draft saved at ${status.text}`
            : status.kind === "error"
              ? `Not saved: ${status.text}`
              : "Saves by itself every few seconds"}
      </span>
    </p>
  );
}
