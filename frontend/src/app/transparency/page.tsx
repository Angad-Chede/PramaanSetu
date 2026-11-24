import type { Metadata } from "next";

import { DataTable, PageHeader, Section } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { CHALLENGE_STATE_LABELS, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Transparency" };
export const dynamic = "force-dynamic";

type Transparency = {
  challenges_published: number;
  challenges_by_stage: Record<string, number>;
  pilots_run: number;
  validated_passports: number;
  evidence_reports: number;
  average_confidence_score: number;
  registered_startups: number;
  average_days_submission_to_payment: number | null;
  note: string;
  generated_at: string;
};

export default async function TransparencyPage() {
  const data = await apiGet<Transparency>("/public/transparency");

  const headline = [
    { label: "Challenges published", value: data.challenges_published },
    { label: "Pilots run", value: data.pilots_run },
    { label: "Evidence Reports produced", value: data.evidence_reports },
    { label: "Independently validated passports", value: data.validated_passports },
    {
      label: "Average Evidence Confidence Score",
      value: data.average_confidence_score ? data.average_confidence_score + " of 100" : "Not yet measured",
    },
    { label: "Startups registered", value: data.registered_startups },
    {
      label: "Average days, milestone submission to payment",
      value:
        data.average_days_submission_to_payment === null
          ? "Not yet measured"
          : data.average_days_submission_to_payment,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Transparency"
        subtitle={data.note}
      />

      <Section title="The platform in numbers">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {headline.map((item) => (
            <div key={item.label} className="rounded border border-line bg-paper-soft px-3 py-3">
              <dd className="num text-2xl font-semibold text-ink">{item.value}</dd>
              <dt className="mt-1 text-sm text-ink-muted">{item.label}</dt>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        title="Challenges by stage"
        description="Every challenge on the platform, counted by the stage it is in. A challenge cannot skip a stage."
      >
        <DataTable columns={["Stage", "Count"]} empty="No challenges yet.">
          {Object.entries(data.challenges_by_stage).map(([stage, count]) => (
            <tr key={stage}>
              <td>{CHALLENGE_STATE_LABELS[stage] ?? stage}</td>
              <td className="num">{count}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="What these figures mean">
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
          <li>
            A pilot only produces an Evidence Report if it had a plan frozen before data collection
            began. A report only carries a score once an independent validator has signed it off.
          </li>
          <li>
            A scale decision cannot be recorded without a signed-off report, so every scale decision
            on this platform rests on measured, verified evidence.
          </li>
          <li>
            The payment figure counts calendar days from a startup submitting milestone evidence to
            the finance office recording the release, including any time spent resubmitting.
          </li>
          <li>Figures contain no personal data and are recomputed from the platform&apos;s own records.</li>
        </ul>
        <p className="mt-3 text-sm text-ink-muted">
          Generated {formatDateTime(data.generated_at)}.
        </p>
      </Section>
    </div>
  );
}
