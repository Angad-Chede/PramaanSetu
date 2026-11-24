import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyState, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { compactRupees, formatDate, relativeDeadline } from "@/lib/format";
import { single } from "@/lib/forms";

export const metadata: Metadata = { title: "Challenge board" };
export const dynamic = "force-dynamic";

type BoardItem = {
  id: string;
  reference: string;
  title: string;
  outcome_statement: string;
  sector: string | null;
  state_code: string | null;
  district: string | null;
  department_name: string | null;
  budget_ceiling: { paise: number } | null;
  pilot_duration_weeks: number;
  application_deadline: string | null;
  days_remaining: number | null;
  closing_soon: boolean;
  state: string;
};

type Board = {
  items: BoardItem[];
  count: number;
  filters: { budget_bands: { value: string; label: string }[] };
};

const SECTORS = [
  "Water",
  "Urban solid waste",
  "Urban mobility",
  "Public health",
  "Agriculture",
  "Energy",
  "Education",
  "Disaster management",
];

export default async function BoardPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = new URLSearchParams();
  for (const key of ["query", "sector", "state_code", "budget_band", "closing_within_days"]) {
    const value = single(searchParams?.[key]);
    if (value) query.set(key, value);
  }
  if (single(searchParams?.include_closed) === "yes") query.set("include_closed", "true");
  query.set("limit", "100");

  const board = await apiGet<Board>("/public/challenges?" + query.toString());
  const activeSector = single(searchParams?.sector);

  return (
    <div>
      <PageHeader
        title="Challenge board"
        subtitle="Open challenges from every department on the platform. Any eligible startup can apply, whether or not the platform matched it to the challenge."
        meta={<Pill>{board.count} challenge{board.count === 1 ? "" : "s"}</Pill>}
      />

      <Section title="Filter" description="Narrow by sector, state, budget band or how soon a challenge closes.">
        <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="field lg:col-span-2">
            <label htmlFor="query">Search</label>
            <input
              id="query"
              name="query"
              defaultValue={single(searchParams?.query) ?? ""}
              placeholder="Words from the title or the outcome"
            />
          </div>
          <div className="field">
            <label htmlFor="sector">Sector</label>
            <select id="sector" name="sector" defaultValue={activeSector ?? ""}>
              <option value="">Every sector</option>
              {SECTORS.map((sector) => (
                <option key={sector} value={sector}>
                  {sector}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="budget_band">Budget band</label>
            <select
              id="budget_band"
              name="budget_band"
              defaultValue={single(searchParams?.budget_band) ?? ""}
            >
              <option value="">Any budget</option>
              {board.filters.budget_bands.map((band) => (
                <option key={band.value} value={band.value}>
                  {band.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="closing_within_days">Closing within</label>
            <select
              id="closing_within_days"
              name="closing_within_days"
              defaultValue={single(searchParams?.closing_within_days) ?? ""}
            >
              <option value="">Any time</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </div>
          <div className="flex items-end gap-3 lg:col-span-5">
            <button type="submit" className="btn btn-primary">
              Apply the filter
            </button>
            <Link href="/challenges-board" className="btn btn-secondary">
              Clear
            </Link>
          </div>
        </form>
      </Section>

      <Section title="Open challenges" description="Sorted by the closing date, soonest first.">
        {board.items.length ? (
          <DataTable
            columns={["Reference", "Challenge", "Department", "Budget ceiling", "Closes", ""]}
            caption="Open challenges"
          >
            {board.items.map((item) => (
              <tr key={item.id}>
                <td className="num whitespace-nowrap text-sm">{item.reference}</td>
                <td>
                  <Link href={"/challenges-board/" + item.id} className="font-medium">
                    {item.title}
                  </Link>
                  <p className="mt-0.5 max-w-prose text-sm text-ink-muted">
                    {item.outcome_statement.slice(0, 180)}
                    {item.outcome_statement.length > 180 ? "..." : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.sector ? <Pill>{item.sector}</Pill> : null}
                    {item.state_code ? <Pill>{item.state_code}</Pill> : null}
                    <Pill>{item.pilot_duration_weeks} week pilot</Pill>
                  </div>
                </td>
                <td className="text-sm">{item.department_name}</td>
                <td className="num whitespace-nowrap text-sm">
                  {item.budget_ceiling && item.budget_ceiling.paise > 0
                    ? compactRupees(item.budget_ceiling.paise)
                    : "Not published"}
                </td>
                <td className="whitespace-nowrap text-sm">
                  {item.application_deadline ? (
                    <>
                      {formatDate(item.application_deadline)}
                      <span
                        className={
                          "block " + (item.closing_soon ? "font-semibold text-bad" : "text-ink-muted")
                        }
                      >
                        {relativeDeadline(item.application_deadline)}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-muted">Not set</span>
                  )}
                </td>
                <td className="whitespace-nowrap text-right">
                  <Link href={"/challenges-board/" + item.id}>Open</Link>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No challenge matches this filter. Clear the filter, or check the demand view to see what is coming." />
        )}
      </Section>

      <Section title="How applying works">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">
          <li>
            Check your eligibility on the challenge page. Prior turnover and prior experience are
            relaxed automatically for a recognised startup; quality and technical criteria are not.
          </li>
          <li>
            Apply using your saved profile. The form is generated from the challenge, so you commit
            to a value on each published measure.
          </li>
          <li>
            You can edit until the deadline. The last submitted version is the one that counts, and
            the deadline is enforced against server time to the second.
          </li>
          <li>
            Every question is answered to all applicants at once, and the asker is never named.
          </li>
        </ol>
      </Section>
    </div>
  );
}
