import type { Metadata } from "next";
import Link from "next/link";

import { freezeDesign, recordAmendment, runSimulation } from "@/app/pilots/actions";
import { ConfirmCheckbox, Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  Field,
  KeyValue,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import {
  ANALYSIS_METHOD_LABELS,
  compactRupees,
  decimal,
  money,
  percent,
} from "@/lib/format";
import { readNotice, readProblem, single } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Pilot, SimulationRun } from "@/lib/types";

export const metadata: Metadata = { title: "Pilot Flight Simulator" };
export const dynamic = "force-dynamic";

type Defaults = {
  inputs: Record<string, number | string>;
  primary_kpi: {
    id: string;
    name: string;
    unit: string;
    kind: string;
    direction: string;
    baseline_value: number | null;
    target_value: number | null;
  };
  budget_ceiling: { paise: number } | null;
  target_power: number;
  guidance: string[];
};

function powerTone(power: number): "good" | "warn" | "bad" {
  if (power >= 0.8) return "good";
  if (power >= 0.5) return "warn";
  return "bad";
}

export default async function DesignPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/pilots/" + params.id + "/design");
  const pilot = await apiGetOrNotFound<Pilot>("/pilots/" + params.id);
  const defaults = await apiGetOptional<Defaults>("/pilots/" + params.id + "/simulations/defaults");
  const runs = await apiGetOptional<{ items: { id: string; status: string; created_at: string; power: number | null }[] }>(
    "/pilots/" + params.id + "/simulations?limit=10",
  );

  const requestedRun = single(searchParams?.run) ?? runs?.items[0]?.id ?? null;
  const run = requestedRun
    ? await apiGetOptional<SimulationRun>("/simulations/" + requestedRun)
    : null;

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const canDesign = hasRole(session, "DO") && session.department_id === pilot.department_id;
  const frozen = Boolean(pilot.design?.frozen);
  const inputs = (run?.inputs ?? defaults?.inputs ?? {}) as Record<string, number>;
  const results = run?.results ?? null;

  return (
    <div>
      <PageHeader
        title="Pilot Flight Simulator"
        subtitle="One question, answered before the pilot starts: if the solution really delivers the improvement it claims, will this design detect it, and at what cost?"
        meta={
          <>
            <Pill>{pilot.reference}</Pill>
            {frozen ? <Pill tone="good">Plan frozen</Pill> : <Pill tone="warn">Plan not frozen</Pill>}
            {defaults?.budget_ceiling ? (
              <Pill>Budget ceiling {compactRupees(defaults.budget_ceiling.paise)}</Pill>
            ) : null}
          </>
        }
        actions={<Link href={"/pilots/" + pilot.id} className="btn btn-secondary">Back to the pilot</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="That could not be completed">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      {frozen && pilot.design ? (
        <Section
          title="The pre-registered plan"
          description="Frozen before data collection. It cannot change except by an amendment approved by the competent authority, and every amendment is recorded on the Evidence Report."
        >
          <KeyValue
            rows={[
              { label: "Primary measure", value: pilot.design.primary_kpi_name },
              { label: "Pass mark", value: decimal(pilot.design.pass_mark, 2) + " " + pilot.design.unit },
              { label: "Duration", value: pilot.design.duration_weeks + " weeks" },
              { label: "Units", value: pilot.design.units },
              {
                label: "Analysis method",
                value: ANALYSIS_METHOD_LABELS[pilot.design.analysis_method] ?? pilot.design.analysis_method,
              },
              {
                label: "Expected power at freeze",
                value:
                  pilot.design.expected_power === null
                    ? "Not recorded"
                    : percent(pilot.design.expected_power),
              },
              {
                label: "Expected cost",
                value: pilot.design.expected_cost ? money(pilot.design.expected_cost) : "Not recorded",
              },
              { label: "Frozen", value: <Timestamp value={pilot.design.frozen_at} /> },
            ]}
          />

          {canDesign ? (
            <div className="mt-5">
              <Disclosure summary="Record an amendment to the frozen plan">
                <form action={recordAmendment} className="max-w-form space-y-3">
                  <input type="hidden" name="pilot_id" value={pilot.id} />
                  <Field
                    label="What changed, and why"
                    name="description"
                    required
                    help="At least 20 characters. This appears on the Evidence Report."
                  >
                    <textarea id="description" name="description" rows={3} required minLength={20} />
                  </Field>
                  {hasRole(session, "DA") ? (
                    <div className="flex items-center gap-2">
                      <input id="approved" name="approved" type="checkbox" className="h-4 w-4" />
                      <label htmlFor="approved" className="font-normal">
                        Approved by the competent authority
                      </label>
                    </div>
                  ) : null}
                  <p className="text-sm text-ink-muted">
                    An approved amendment costs 2 points of protocol adherence. An unapproved
                    deviation costs 5.
                  </p>
                  <SubmitButton variant="secondary">Record the amendment</SubmitButton>
                </form>
              </Disclosure>
            </div>
          ) : null}
        </Section>
      ) : null}

      {defaults ? (
        <Section
          title="Run a simulation"
          description={"Primary measure: " + defaults.primary_kpi.name + " (" + defaults.primary_kpi.unit + "). The simulator runs the whole pilot ten thousand times."}
        >
          <form action={runSimulation} className="space-y-5">
            <input type="hidden" name="pilot_id" value={pilot.id} />

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Pilot length in weeks" name="duration_weeks" required>
                <input
                  id="duration_weeks"
                  name="duration_weeks"
                  type="number"
                  min={1}
                  max={52}
                  defaultValue={Number(inputs.duration_weeks ?? 8)}
                />
              </Field>
              <Field label="Number of units" name="units" required help="Sites, wards, facilities or cases.">
                <input
                  id="units"
                  name="units"
                  type="number"
                  min={2}
                  max={500}
                  defaultValue={Number(inputs.units ?? 20)}
                />
              </Field>
              <Field
                label="Shortest pilot you would run"
                name="min_duration_weeks"
                help="In weeks. The recommendation never goes below this, because a design can be statistically adequate and still too short to say anything useful about the solution in service."
              >
                <input
                  id="min_duration_weeks"
                  name="min_duration_weeks"
                  type="number"
                  min={1}
                  max={52}
                  defaultValue={Number(inputs.min_duration_weeks ?? 4)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Measurements per week"
                name="measurements_per_week"
                help="Measuring more often reduces noise, which raises power without adding units."
              >
                <input
                  id="measurements_per_week"
                  name="measurements_per_week"
                  type="number"
                  min={1}
                  max={7}
                  defaultValue={Number(inputs.measurements_per_week ?? 1)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Baseline value" name="baseline_mean">
                <input
                  id="baseline_mean"
                  name="baseline_mean"
                  type="number"
                  step="any"
                  defaultValue={Number(inputs.baseline_mean ?? 0)}
                />
              </Field>
              <Field
                label="Baseline variability"
                name="baseline_sd"
                help="The spread across units, not the average."
              >
                <input
                  id="baseline_sd"
                  name="baseline_sd"
                  type="number"
                  step="any"
                  min={0.0001}
                  defaultValue={Number(inputs.baseline_sd ?? 1)}
                />
              </Field>
              <Field
                label="Improvement claimed"
                name="claimed_effect"
                help="Signed. Negative when lower is better."
              >
                <input
                  id="claimed_effect"
                  name="claimed_effect"
                  type="number"
                  step="any"
                  defaultValue={Number(inputs.claimed_effect ?? 0)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Comparison units"
                name="comparison_units"
                help="Similar units not receiving the solution. Leave at zero if none are available."
              >
                <input
                  id="comparison_units"
                  name="comparison_units"
                  type="number"
                  min={0}
                  max={500}
                  defaultValue={Number(inputs.comparison_units ?? 0)}
                />
              </Field>
              <Field label="Cost per unit per week in rupees" name="cost_per_unit_week_rupees">
                <input
                  id="cost_per_unit_week_rupees"
                  name="cost_per_unit_week_rupees"
                  type="number"
                  min={0}
                  defaultValue={Number(inputs.cost_per_unit_week_paise ?? 0) / 100}
                />
              </Field>
              <Field label="Fixed cost in rupees" name="fixed_cost_rupees">
                <input
                  id="fixed_cost_rupees"
                  name="fixed_cost_rupees"
                  type="number"
                  min={0}
                  defaultValue={Number(inputs.fixed_cost_paise ?? 0) / 100}
                />
              </Field>
            </div>

            <Disclosure summary="Model assumptions">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label="Realism factor"
                  name="realism_factor"
                  help="Claimed effects are usually optimistic. 0.7 means the simulator assumes 70 percent of the claim is real. Set to 1 only with independent evidence."
                >
                  <input
                    id="realism_factor"
                    name="realism_factor"
                    type="number"
                    step="0.05"
                    min={0.05}
                    max={1}
                    defaultValue={Number(inputs.realism_factor ?? 0.7)}
                  />
                </Field>
                <Field
                  label="Uncertainty in the claim"
                  name="effect_uncertainty"
                  help="As a share of the claimed effect."
                >
                  <input
                    id="effect_uncertainty"
                    name="effect_uncertainty"
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    defaultValue={Number(inputs.effect_uncertainty ?? 0.25)}
                  />
                </Field>
                <Field
                  label="Share of variation that is period to period"
                  name="within_unit_share"
                  help="The rest is stable difference between units, which cancels in a paired design."
                >
                  <input
                    id="within_unit_share"
                    name="within_unit_share"
                    type="number"
                    step="0.05"
                    min={0.05}
                    max={0.95}
                    defaultValue={Number(inputs.within_unit_share ?? 0.5)}
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="How confident are you in the baseline?" name="baseline_confidence">
                  <select
                    id="baseline_confidence"
                    name="baseline_confidence"
                    defaultValue={String(inputs.baseline_confidence ?? "measured")}
                  >
                    <option value="measured">Measured from real data</option>
                    <option value="estimated_high">Estimated, and I am fairly confident</option>
                    <option value="estimated_low">Estimated, and I am not confident</option>
                  </select>
                </Field>
                <p className="help mt-1">
                  An estimated baseline inflates the assumed noise, so the simulator does not flatter
                  a design built on a guess.
                </p>
              </div>
            </Disclosure>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">
                Compare up to three other designs
              </legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="grid grid-cols-2 gap-2">
                    <div className="field">
                      <label htmlFor={"what_if_weeks_" + index}>Weeks</label>
                      <input
                        id={"what_if_weeks_" + index}
                        name="what_if_weeks"
                        type="number"
                        min={1}
                        max={52}
                        defaultValue={index === 0 ? 12 : ""}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={"what_if_units_" + index}>Units</label>
                      <input
                        id={"what_if_units_" + index}
                        name="what_if_units"
                        type="number"
                        min={2}
                        max={500}
                        defaultValue={index === 0 ? 30 : ""}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>

            <SubmitButton pendingLabel="Running ten thousand pilots...">Run the simulation</SubmitButton>
          </form>

          <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {defaults.guidance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      ) : (
        <Section title="Simulator not available">
          <Callout tone="warn" title="This pilot cannot be simulated yet">
            The challenge needs a primary measure with a baseline and a target, and the proposal
            needs a committed value, before a design can be tested.
          </Callout>
        </Section>
      )}

      {run && run.status !== "Succeeded" ? (
        <Section title="Simulation running">
          <Callout tone="neutral">
            The run is in state {run.status}. Reload this page in a moment; results for the default
            configuration appear within a few seconds.
          </Callout>
        </Section>
      ) : null}

      {results ? (
        <>
          <Section
            title="What this design would do"
            description={"Based on " + results.iterations.toLocaleString("en-IN") + " simulated pilots, with seed " + results.seed + " recorded so the result can be reproduced exactly."}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div
                className={
                  "rounded border px-4 py-3 " +
                  (powerTone(results.proposed.power) === "good"
                    ? "border-good bg-good-light"
                    : powerTone(results.proposed.power) === "warn"
                      ? "border-warn bg-warn-light"
                      : "border-bad bg-bad-light")
                }
              >
                <p className="num text-3xl font-semibold text-ink">
                  {Math.round(results.proposed.power * 100)}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  pilots in 100 would detect the claimed improvement
                </p>
              </div>
              <div className="rounded border border-line bg-paper-soft px-4 py-3">
                <p className="num text-3xl font-semibold text-ink">
                  {decimal(results.proposed.minimum_detectable_effect, 2)}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  smallest change this design can reliably detect, in{" "}
                  {defaults?.primary_kpi.unit ?? "the measure"}
                </p>
              </div>
              <div className="rounded border border-line bg-paper-soft px-4 py-3">
                <p className="num text-2xl font-semibold text-ink">
                  {compactRupees(results.proposed.expected_cost_paise)}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  expected cost, between {compactRupees(results.proposed.cost_p5_paise)} and{" "}
                  {compactRupees(results.proposed.cost_p95_paise)}
                </p>
              </div>
            </div>

            {run?.explanation ? (
              <ul className="mt-5 space-y-2 text-sm text-ink-soft">
                {run.explanation.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}

            {results.proposed.notes.length ? (
              <div className="mt-4">
                <Callout tone="warn">
                  <ul className="space-y-2">
                    {results.proposed.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </Callout>
              </div>
            ) : null}
          </Section>

          <Section
            title="Recommendation"
            description="The smallest design that reaches the target power within the published budget ceiling."
          >
            <Callout tone={results.recommendation_found ? "good" : "warn"}>
              {results.recommendation_message}
            </Callout>
          </Section>

          <Section
            title="Designs side by side"
            description="A design below the target power is not a cheaper pilot; it is a pilot whose result you will not be able to interpret."
          >
            <DataTable
              columns={[
                "Design",
                "Weeks",
                "Units",
                "Power",
                "Smallest detectable change",
                "Expected cost",
                "Cost range",
                "Within budget",
              ]}
            >
              {results.comparison.map((design, index) => (
                <tr key={design.label + index}>
                  <td className="font-medium">{design.label}</td>
                  <td className="num">{design.duration_weeks}</td>
                  <td className="num">{design.units}</td>
                  <td className="num">
                    <Pill tone={powerTone(design.power)}>{Math.round(design.power * 100)} percent</Pill>
                  </td>
                  <td className="num text-sm">{decimal(design.minimum_detectable_effect, 2)}</td>
                  <td className="num text-sm">{compactRupees(design.expected_cost_paise)}</td>
                  <td className="num text-sm">
                    {compactRupees(design.cost_p5_paise)} to {compactRupees(design.cost_p95_paise)}
                  </td>
                  <td className="text-sm">
                    {design.within_budget ? <Pill tone="good">Yes</Pill> : <Pill tone="bad">No</Pill>}
                  </td>
                </tr>
              ))}
            </DataTable>
            <p className="mt-3 text-xs text-ink-muted">
              Engine {results.engine_version}, {results.grid_searched} candidate designs screened,
              run in {results.runtime_ms} milliseconds. The closed-form power for the proposed design
              is {percent(results.analytical_power)}, within {decimal(results.analytical_gap * 100, 1)}{" "}
              percentage points of the simulated figure.
            </p>
          </Section>

          {canDesign && !frozen ? (
            <Section
              title="Freeze the design"
              description="Freezing pre-registers the plan. After this, the success bar cannot move, which is what makes the result at the end defensible."
            >
              <form action={freezeDesign} className="max-w-form space-y-4">
                <input type="hidden" name="pilot_id" value={pilot.id} />
                <input type="hidden" name="simulation_run_id" value={run?.id ?? ""} />

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Weeks" name="freeze_duration" required>
                    <input
                      id="freeze_duration"
                      name="duration_weeks"
                      type="number"
                      min={1}
                      max={52}
                      defaultValue={
                        results.recommendation?.duration_weeks ?? results.proposed.duration_weeks
                      }
                      required
                    />
                  </Field>
                  <Field label="Units" name="freeze_units" required>
                    <input
                      id="freeze_units"
                      name="units"
                      type="number"
                      min={2}
                      max={500}
                      defaultValue={results.recommendation?.units ?? results.proposed.units}
                      required
                    />
                  </Field>
                  <Field label="Measurements per week" name="freeze_frequency">
                    <input
                      id="freeze_frequency"
                      name="measurements_per_week"
                      type="number"
                      min={1}
                      max={7}
                      defaultValue={Number(inputs.measurements_per_week ?? 1)}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Pass mark"
                    name="pass_mark"
                    required
                    help={
                      "The value on " +
                      (defaults?.primary_kpi.name ?? "the primary measure") +
                      " the pilot must reach to count as a success."
                    }
                  >
                    <input
                      id="pass_mark"
                      name="pass_mark"
                      type="number"
                      step="any"
                      defaultValue={defaults?.primary_kpi.target_value ?? ""}
                      required
                    />
                  </Field>
                  <Field label="Analysis method" name="analysis_method" required>
                    <select
                      id="analysis_method"
                      name="analysis_method"
                      defaultValue={
                        Number(inputs.comparison_units ?? 0) > 0
                          ? "welch_did"
                          : defaults?.primary_kpi.kind === "proportion"
                            ? "two_proportion"
                            : "paired_t"
                      }
                      required
                    >
                      {Object.entries(ANALYSIS_METHOD_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <input
                  type="hidden"
                  name="comparison_units"
                  value={Number(inputs.comparison_units ?? 0)}
                />
                <input type="hidden" name="alpha" value={Number(inputs.alpha ?? 0.05)} />

                <ConfirmCheckbox
                  name="acknowledge"
                  label="I confirm this plan is final"
                  help="The primary measure, pass mark, duration, unit count and analysis method are locked once frozen. Changing any of them afterwards requires an amendment approved by the competent authority, and every amendment costs protocol adherence points on the Evidence Confidence Score."
                />

                <SubmitButton
                  pendingLabel="Freezing..."
                  confirm="Freeze this design? After freezing, the plan can only change through a recorded, approved amendment."
                >
                  Freeze the design
                </SubmitButton>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {runs && runs.items.length > 1 ? (
        <Section title="Earlier runs" description="Every run stores its inputs and its seed, so any result can be reproduced.">
          <DataTable columns={["Run", "Status", "Power", ""]}>
            {runs.items.map((item) => (
              <tr key={item.id}>
                <td className="num text-sm">{item.id.slice(0, 8)}</td>
                <td className="text-sm">{item.status}</td>
                <td className="num text-sm">
                  {item.power === null ? "Not available" : Math.round(item.power * 100) + " percent"}
                </td>
                <td className="text-right">
                  <Link href={"/pilots/" + pilot.id + "/design?run=" + item.id}>View</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        </Section>
      ) : null}
    </div>
  );
}
