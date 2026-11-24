import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyState, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { compactRupees } from "@/lib/format";

export const metadata: Metadata = { title: "Demand" };
export const dynamic = "force-dynamic";

type Demand = {
  open_by_sector: { sector: string; open_challenges: number; total_budget: { paise: number } }[];
  open_by_department: {
    department: string;
    state_code: string | null;
    open_challenges: number;
    total_budget: { paise: number };
  }[];
  upcoming_in_review: number;
  note: string;
};

export default async function DemandPage() {
  const demand = await apiGet<Demand>("/public/demand/summary");
  const maxSector = Math.max(1, ...demand.open_by_sector.map((row) => row.open_challenges));

  return (
    <div>
      <PageHeader
        title="Where departmental demand is"
        subtitle={demand.note}
        meta={
          <Pill>
            {demand.upcoming_in_review} more awaiting approval
          </Pill>
        }
      />

      <Section
        title="Open challenges by sector"
        description="The bar shows the count relative to the busiest sector; the number is the count itself."
      >
        {demand.open_by_sector.length ? (
          <ul className="space-y-3">
            {demand.open_by_sector.map((row) => (
              <li key={row.sector}>
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={"/challenges-board?sector=" + encodeURIComponent(row.sector)}
                    className="font-medium"
                  >
                    {row.sector}
                  </Link>
                  <span className="num text-sm text-ink-muted">
                    {row.open_challenges} open, up to {compactRupees(row.total_budget.paise)}
                  </span>
                </div>
                <div
                  className="mt-1 h-2 w-full overflow-hidden rounded bg-paper-sunk"
                  role="meter"
                  aria-valuenow={row.open_challenges}
                  aria-valuemin={0}
                  aria-valuemax={maxSector}
                  aria-label={"Open challenges in " + row.sector}
                >
                  <div
                    className="h-full bg-brand"
                    style={{ width: ((row.open_challenges / maxSector) * 100).toFixed(1) + "%" }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="No challenge is open right now. Check back, or watch the transparency page for activity." />
        )}
      </Section>

      <Section
        title="Open challenges by department"
        description="Which departments are buying outcomes right now, and how much they have published."
      >
        <DataTable
          columns={["Department", "State", "Open challenges", "Total published budget"]}
          empty="No department has an open challenge right now."
        >
          {demand.open_by_department.map((row) => (
            <tr key={row.department}>
              <td className="font-medium">{row.department}</td>
              <td className="text-sm">{row.state_code ?? "Central"}</td>
              <td className="num">{row.open_challenges}</td>
              <td className="num text-sm">{compactRupees(row.total_budget.paise)}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Why this view exists">
        <p className="max-w-prose text-sm text-ink-soft">
          A startup that cannot see where public demand is has to discover opportunities by chance,
          which makes product planning guesswork and bidding expensive. This view is published from
          the platform&apos;s own records and updates as challenges are approved and published.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/challenges-board">Go to the challenge board</Link>
        </p>
      </Section>
    </div>
  );
}
