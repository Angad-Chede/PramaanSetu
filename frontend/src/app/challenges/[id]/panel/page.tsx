import type { Metadata } from "next";
import Link from "next/link";

import { assignPanel, runWorkflowStep } from "@/app/challenges/actions";
import { SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  EmptyState,
  PageHeader,
  Pill,
  ProblemList,
  Section,
  Timestamp,
} from "@/components/ui";
import { apiGet, apiGetOptional, apiGetOrNotFound } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, ROLE_LABELS } from "@/lib/format";
import { readNotice, readProblem } from "@/lib/forms";
import { hasRole, requireSession } from "@/lib/session";
import type { Challenge } from "@/lib/types";

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

export default async function PanelPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await requireSession("/challenges/" + params.id + "/panel");
  const challenge = await apiGetOrNotFound<Challenge>("/challenges/" + params.id);
  const panel = await apiGet<{ items: Member[] }>("/challenges/" + params.id + "/panel");
  const progress = await apiGetOptional<Progress>("/evaluation/" + params.id + "/progress");
  const candidates = await apiGetOptional<{ items: AdminUser[] }>("/admin/users?limit=300");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const canAssign = hasRole(session, "DO") && session.department_id === challenge.department_id;

  const evaluators = panel.items.filter((m) => m.role === "EE");
  const validators = panel.items.filter((m) => m.role === "IV");

  // An evaluator is anyone outside the owning department; a validator must also be
  // outside it, which the API enforces.
  const pool = (candidates?.items ?? []).filter(
    (user) => user.department_id !== challenge.department_id && !user.roles.includes("SU"),
  );

  return (
    <div>
      <PageHeader
        title="Evaluation panel"
        subtitle="At least three evaluators. A validator cannot belong to the department running the pilot, and nobody can both evaluate and validate the same challenge."
        meta={
          <>
            <Pill>{challenge.reference}</Pill>
            <Pill>{CHALLENGE_STATE_LABELS[challenge.state] ?? challenge.state}</Pill>
          </>
        }
        actions={<Link href={"/challenges/" + challenge.id} className="btn btn-secondary">Back to the challenge</Link>}
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good" title="Done">{notice}</Callout>
        </div>
      ) : null}
      {problem ? (
        <div className="mb-5 space-y-3">
          <Callout tone="bad" title="The panel could not be assigned">{problem.message}</Callout>
          <ProblemList problems={problem.fields} />
        </div>
      ) : null}

      <Section title="Current panel">
        {panel.items.length ? (
          <DataTable columns={["Name", "Role", "Assigned"]}>
            {panel.items.map((member) => (
              <tr key={member.user_id + member.role}>
                <td className="font-medium">{member.name ?? member.user_id}</td>
                <td>
                  <Pill tone={member.role === "IV" ? "warn" : "neutral"}>
                    {ROLE_LABELS[member.role] ?? member.role}
                  </Pill>
                </td>
                <td className="text-sm text-ink-muted">
                  <Timestamp value={member.assigned_at} />
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No panel has been assigned yet. Evaluation cannot start until it is." />
        )}
      </Section>

      {progress && progress.items.length ? (
        <Section
          title="Scoring progress"
          description="How far each evaluator has got. A declared conflict removes an application from that evaluator's list."
        >
          <DataTable columns={["Evaluator", "Applications", "Conflicts declared", "Scored", "Still to score"]}>
            {progress.items.map((row) => (
              <tr key={row.evaluator_id}>
                <td className="font-medium">{row.name ?? row.evaluator_id}</td>
                <td className="num">{row.total}</td>
                <td className="num">{row.declared}</td>
                <td className="num">{row.scored}</td>
                <td className="num">
                  {row.pending > 0 ? <Pill tone="warn">{row.pending}</Pill> : <Pill tone="good">0</Pill>}
                </td>
              </tr>
            ))}
          </DataTable>
        </Section>
      ) : null}

      {canAssign ? (
        <Section
          title="Assign the panel"
          description="Select at least three evaluators and one independent validator. Everyone selected is notified, and each must declare any conflict of interest before scoring."
        >
          {pool.length ? (
            <form action={assignPanel} className="space-y-5">
              <input type="hidden" name="challenge_id" value={challenge.id} />

              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink">
                  Expert evaluators (at least three)
                </legend>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {pool.map((user) => (
                    <li key={"ee-" + user.id} className="flex items-start gap-2 rounded border border-line px-3 py-2">
                      <input
                        id={"ee-" + user.id}
                        type="checkbox"
                        name="evaluator_ids"
                        value={user.id}
                        defaultChecked={evaluators.some((m) => m.user_id === user.id)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <label htmlFor={"ee-" + user.id} className="font-normal">
                        <span className="block font-medium text-ink">{user.name}</span>
                        <span className="block text-sm text-ink-muted">
                          {user.designation ?? user.email}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink">
                  Independent validator (one, from outside your department)
                </legend>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {pool.map((user) => (
                    <li key={"iv-" + user.id} className="flex items-start gap-2 rounded border border-line px-3 py-2">
                      <input
                        id={"iv-" + user.id}
                        type="checkbox"
                        name="validator_ids"
                        value={user.id}
                        defaultChecked={validators.some((m) => m.user_id === user.id)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <label htmlFor={"iv-" + user.id} className="font-normal">
                        <span className="block font-medium text-ink">{user.name}</span>
                        <span className="block text-sm text-ink-muted">
                          {user.designation ?? user.email}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>

              <SubmitButton pendingLabel="Assigning...">Assign the panel</SubmitButton>
            </form>
          ) : (
            <EmptyState message="No empanelled evaluators or validators are available. Ask the platform administrator to create the accounts." />
          )}
        </Section>
      ) : null}

      {challenge.state === "Screening" && canAssign && evaluators.length >= 3 ? (
        <Section
          title="Start evaluation"
          description="Round one is blind: applicant name, founders and case-reference names are hidden from evaluators."
        >
          <form action={runWorkflowStep}>
            <input type="hidden" name="challenge_id" value={challenge.id} />
            <input type="hidden" name="action" value="start-evaluation" />
            <input type="hidden" name="back" value={"/challenges/" + challenge.id + "/panel"} />
            <SubmitButton pendingLabel="Starting...">Start evaluation</SubmitButton>
          </form>
        </Section>
      ) : null}
    </div>
  );
}
