import type { Metadata } from "next";
import { Check, Circle, EyeOff, UserRoundCheck, UsersRound } from "lucide-react";

import { assignPanel, runWorkflowStep } from "@/app/challenges/actions";
import { SubmitButton } from "@/components/app/forms";
import { EmptyState, Flash, Meter, Page, PageHeader, Panel, StateBadge, ToneBadge } from "@/components/app/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { all, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, ROLE_LABELS, formatDate } from "@/lib/format";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Initials, ReviewNav, Split } from "../_review/shared";

export const metadata: Metadata = { title: "Evaluation panel" };
export const dynamic = "force-dynamic";

type Member = { user_id: string; name: string | null; role: string; assigned_at: string | null };
type AdminUser = {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  department_id: string | null;
  roles: string[];
};
type Progress = {
  items: { evaluator_id: string; name: string | null; total: number; declared: number; scored: number; pending: number }[];
  panel_size: number;
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-relaxed">
      <span
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full",
          met ? "bg-success text-white" : "bg-recess text-glyph",
        )}
      >
        {met ? <Check className="size-2.5" strokeWidth={3} /> : <Circle className="size-1.5 fill-current" />}
      </span>
      <span className={met ? "text-foreground" : "text-muted-foreground"}>
        {children}
        <span className="sr-only">{met ? " (met)" : " (not yet met)"}</span>
      </span>
    </li>
  );
}

function PickList({
  name,
  prefix,
  pool,
  selected,
}: {
  name: string;
  prefix: string;
  pool: AdminUser[];
  selected: (id: string) => boolean;
}) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {pool.map((user) => {
        const id = prefix + "-" + user.id;
        return (
          <li key={id}>
            <label
              htmlFor={id}
              className="group flex h-full cursor-pointer items-center gap-3 rounded-2xl bg-surface/60 p-3 ring-1 ring-transparent transition-[background-color,box-shadow] duration-200 ease-ios hover:bg-surface has-[[data-state=checked]]:bg-card has-[[data-state=checked]]:shadow-lift has-[[data-state=checked]]:ring-brand/40"
            >
              <Initials name={user.name} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
                <span className="truncate text-[12px] text-muted-foreground">{user.designation ?? user.email}</span>
              </span>
              <Checkbox id={id} name={name} value={user.id} defaultChecked={selected(user.id)} />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export default async function PanelPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [session, challenge, panel, progress, candidates] = await all(
    requireSession("/challenges/" + id + "/panel"),
    apiGetOrNotFound<Challenge>("/challenges/" + id),
    apiGetOrNotFound<{ items: Member[] }>("/challenges/" + id + "/panel"),
    apiGetOptional<Progress>("/evaluation/" + id + "/progress"),
    apiGetOptional<{ items: AdminUser[] }>("/admin/users?limit=300"),
  );

  const canAssign = hasRole(session, "DO") && session.department_id === challenge.department_id;
  const evaluators = panel.items.filter((m) => m.role === "EE");
  const validators = panel.items.filter((m) => m.role === "IV");
  const overlap = evaluators.some((e) => validators.some((v) => v.user_id === e.user_id));

  // an evaluator is anyone outside the owning department; a validator must also be
  // outside it, which the API enforces
  const pool = (candidates?.items ?? []).filter((user) => user.department_id !== challenge.department_id && !user.roles.includes("SU"));

  const progressById = new Map((progress?.items ?? []).map((row) => [row.evaluator_id, row]));
  const totals = (progress?.items ?? []).reduce(
    (sum, row) => ({ total: sum.total + row.total, scored: sum.scored + row.scored, pending: sum.pending + row.pending }),
    { total: 0, scored: 0, pending: 0 },
  );
  const canStart = challenge.state === "Screening" && canAssign && evaluators.length >= 3;

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/challenges/" + challenge.id, label: "Back to the challenge" }}
        eyebrow={
          <>
            <span className="font-mono text-[12px] tracking-tight">{challenge.reference}</span>
            <StateBadge state={challenge.state} labels={CHALLENGE_STATE_LABELS} />
          </>
        }
        title="Evaluation panel"
        description="At least three evaluators. A validator cannot belong to the department running the pilot, and nobody can both evaluate and validate the same challenge."
      />
      <ReviewNav challengeId={challenge.id} active="panel" />
      <Flash searchParams={query} />

      <Split
        main={
          <>
            <Panel
              title="Current panel"
              description={
                panel.items.length
                  ? `${evaluators.length} evaluator${evaluators.length === 1 ? "" : "s"} and ${validators.length} validator${validators.length === 1 ? "" : "s"}`
                  : undefined
              }
              flush={panel.items.length > 0}
            >
              {panel.items.length ? (
                <ul className="divide-y divide-border/70">
                  {panel.items.map((member) => {
                    const row = member.role === "EE" ? progressById.get(member.user_id) : undefined;
                    const name = member.name ?? member.user_id;
                    return (
                      <li key={member.user_id + member.role} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center md:px-6">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <Initials name={name} className="size-10" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{name}</p>
                            <p className="text-[12px] text-muted-foreground">Assigned {formatDate(member.assigned_at)}</p>
                          </div>
                        </div>
                        {row ? (
                          <div className="flex w-full flex-col gap-1.5 sm:w-56">
                            <div className="flex items-center justify-between text-[12px] text-muted-foreground tabular-nums">
                              <span>
                                <span className="font-medium text-foreground">{row.scored}</span> of {row.total} scored
                              </span>
                              {row.declared > 0 && <span>{row.declared} declared</span>}
                            </div>
                            <Meter
                              value={row.scored}
                              max={row.total || 1}
                              tone={row.pending > 0 ? "warning" : "success"}
                              label={`${name} has scored ${row.scored} of ${row.total}`}
                            />
                          </div>
                        ) : null}
                        <div className="flex shrink-0 items-center gap-1.5 sm:min-w-52 sm:justify-end">
                          <ToneBadge tone={member.role === "IV" ? "info" : "neutral"} dot={false}>
                            {ROLE_LABELS[member.role] ?? member.role}
                          </ToneBadge>
                          {row && (row.pending > 0 ? <ToneBadge tone="warning">{row.pending} to score</ToneBadge> : <ToneBadge tone="success">Done</ToneBadge>)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  icon={UsersRound}
                  title="No panel yet"
                  description="Evaluation cannot start until at least three evaluators and one independent validator are assigned."
                  className="border-0 bg-surface/40"
                />
              )}
            </Panel>

            {canAssign && (
              <Panel
                title="Assign the panel"
                description="Everyone selected is notified, and each must declare any conflict of interest before scoring."
              >
                {pool.length ? (
                  <form action={assignPanel} className="flex flex-col gap-6">
                    <input type="hidden" name="challenge_id" value={challenge.id} />
                    <fieldset className="flex min-w-0 flex-col gap-3">
                      <legend className="mb-3 flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm font-medium text-foreground">Expert evaluators</span>
                        <span className="text-[12px] text-muted-foreground">At least three</span>
                      </legend>
                      <PickList name="evaluator_ids" prefix="ee" pool={pool} selected={(uid) => evaluators.some((m) => m.user_id === uid)} />
                    </fieldset>
                    <fieldset className="flex min-w-0 flex-col gap-3">
                      <legend className="mb-3 flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm font-medium text-foreground">Independent validator</span>
                        <span className="text-[12px] text-muted-foreground">One, from outside your department</span>
                      </legend>
                      <PickList name="validator_ids" prefix="iv" pool={pool} selected={(uid) => validators.some((m) => m.user_id === uid)} />
                    </fieldset>
                    <div className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[13px] text-muted-foreground">The API rejects a panel that breaks the independence rules, and says which one.</p>
                      <SubmitButton pendingLabel="Assigning" className="shrink-0">
                        <UserRoundCheck />
                        Assign the panel
                      </SubmitButton>
                    </div>
                  </form>
                ) : (
                  <EmptyState
                    icon={UsersRound}
                    title="Nobody available to empanel"
                    description="No evaluators or validators exist outside your department. Ask the platform administrator to create the accounts."
                    className="border-0 bg-surface/40"
                  />
                )}
              </Panel>
            )}
          </>
        }
        aside={
          <>
            {canStart && (
              <Panel title="Start evaluation" description="Round one is blind. Applicant names, founders and case-reference names are hidden from evaluators.">
                <form action={runWorkflowStep}>
                  <input type="hidden" name="challenge_id" value={challenge.id} />
                  <input type="hidden" name="action" value="start-evaluation" />
                  <input type="hidden" name="back" value={"/challenges/" + challenge.id + "/panel"} />
                  <SubmitButton
                    variant="brand"
                    className="w-full"
                    pendingLabel="Starting"
                    confirm="The panel is notified and blind scoring opens. Applicants cannot be added after this."
                    confirmTitle="Start evaluation?"
                  >
                    <EyeOff />
                    Start blind evaluation
                  </SubmitButton>
                </form>
              </Panel>
            )}

            <Panel title="Panel rules">
              <ul className="flex flex-col gap-2.5">
                <Requirement met={evaluators.length >= 3}>
                  At least three evaluators <span className="tabular-nums text-muted-foreground">({evaluators.length} now)</span>
                </Requirement>
                <Requirement met={validators.length >= 1}>One independent validator from outside the department</Requirement>
                <Requirement met={panel.items.length > 0 && !overlap}>Nobody both evaluates and validates</Requirement>
                <Requirement met={panel.items.length > 0}>Every member declares conflicts before scoring</Requirement>
              </ul>
            </Panel>

            {progress && progress.items.length > 0 && (
              <Panel title="Scoring progress" description="A declared conflict removes that application from the evaluator's list.">
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[40px] font-normal tracking-[-0.03em] tabular-nums">
                      {totals.total ? Math.round((totals.scored / totals.total) * 100) : 0}%
                    </span>
                    <span className="text-sm text-muted-foreground">of score sheets in</span>
                  </div>
                  <Meter value={totals.scored} max={totals.total || 1} tone={totals.pending ? "brand" : "success"} label="Panel scoring progress" />
                  <p className="text-[13px] text-muted-foreground tabular-nums">
                    {totals.scored} scored, {totals.pending} still to score across {progress.items.length} evaluators
                  </p>
                </div>
              </Panel>
            )}
          </>
        }
      />
    </Page>
  );
}
