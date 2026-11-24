import type { Metadata } from "next";
import { ArrowRight, Building2, Clock3, FileStack, IndianRupee, Radar } from "lucide-react";

import { EmptyState, Figure, FigureGrid, LinkButton, Meter, Page, PageHeader, Panel } from "@/components/app/kit";
import { BarList } from "@/components/ui/bar-list";
import { ClientDonut as DonutChart } from "./_components/donut";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

const inr = (paise: number) => compactRupees(paise).replace("INR ", "₹");

/** budget in lakh of rupees, one decimal, for charts */
const lakh = (paise: number) => Math.round(paise / 100 / 100000 * 10) / 10;

export default async function DemandPage() {
  const demand = await apiGet<Demand>("/public/demand/summary");
  const sectors = demand.open_by_sector;
  const departments = demand.open_by_department;

  const openTotal = sectors.reduce((sum, row) => sum + row.open_challenges, 0);
  const budgetTotal = sectors.reduce((sum, row) => sum + row.total_budget.paise, 0);
  const maxDeptBudget = Math.max(1, ...departments.map((row) => row.total_budget.paise));

  const byState = new Map<string, { open: number; paise: number }>();
  for (const row of departments) {
    const key = row.state_code ?? "Central";
    const entry = byState.get(key) ?? { open: 0, paise: 0 };
    entry.open += row.open_challenges;
    entry.paise += row.total_budget.paise;
    byState.set(key, entry);
  }

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Live from published challenges
          </>
        }
        title="Where departments are buying"
        description={demand.note}
        actions={
          <LinkButton href="/challenges-board" variant="default">
            Open the challenge board
            <ArrowRight />
          </LinkButton>
        }
      />

      <FigureGrid className="grid-cols-2">
        <Figure label="Open challenges" value={openTotal} icon={FileStack} tone="brand" hint={`Across ${sectors.length} sector${sectors.length === 1 ? "" : "s"}`} />
        <Figure label="Budget on offer" value={
            <>
              {inr(budgetTotal).split(" ")[0]}
              <span className="ml-1 text-base font-medium text-muted-foreground">{inr(budgetTotal).split(" ").slice(1).join(" ")}</span>
            </>
          } icon={IndianRupee} tone="success" hint="Sum of published budget ceilings" />
        <Figure label="Departments buying" value={departments.length} icon={Building2} tone="info" hint={`In ${byState.size} state${byState.size === 1 ? "" : "s"} or central`} />
        <Figure label="Awaiting approval" value={demand.upcoming_in_review} icon={Clock3} tone="warning" hint="Published once an approver signs off" />
      </FigureGrid>

      {sectors.length ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Open challenges by sector" description="Select a sector to see its open challenges on the board.">
              <BarList
                data={sectors.map((row) => ({
                  name: row.sector,
                  value: row.open_challenges,
                  meta: inr(row.total_budget.paise),
                  href: "/challenges-board?sector=" + encodeURIComponent(row.sector),
                }))}
                header={{ name: "Sector", value: "Open" }}
                showShare
              />
            </Panel>
            <Panel title="By state" description="Open challenges grouped by the buying department's state.">
              <BarList
                data={Array.from(byState.entries()).map(([state, entry]) => ({
                  name: state === "Central" ? "Central government" : state,
                  value: entry.open,
                  meta: inr(entry.paise),
                }))}
                header={{ name: "State", value: "Open" }}
                color="var(--info)"
              />
            </Panel>
            </div>
            <Panel className="lg:sticky lg:top-20" title="Budget by sector" description="Published ceilings, in lakh of rupees.">
              <DonutChart
                data={sectors.map((row) => ({ name: row.sector, value: lakh(row.total_budget.paise) }))}
                prefix="₹"
                suffix=" L"
                decimals={0}
                label="On offer"
                size={176}
                legend="bottom"
              />
            </Panel>
          </div>

          <Panel flush title="Departments buying now" description="Which departments are buying outcomes right now, and how much they have published.">
              <ul className="divide-y divide-border/70 border-t md:hidden">
                {departments.map((row) => (
                  <li key={row.department} className="flex flex-col gap-2 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{row.department}</span>
                      <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[12px] font-medium tabular-nums">{row.open_challenges} open</span>
                    </div>
                    <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                      <span>{row.state_code ? "State " + row.state_code : "Central"}</span>
                      <span className="tabular-nums">{inr(row.total_budget.paise)}</span>
                    </div>
                    <Meter value={row.total_budget.paise} max={maxDeptBudget} label={"Budget published by " + row.department} />
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="first:pl-5 md:first:pl-6">Department</TableHead>
                      <TableHead numeric>Open</TableHead>
                      <TableHead className="w-[38%] last:pr-5 md:last:pr-6">Published budget</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departments.map((row) => (
                      <TableRow key={row.department}>
                        <TableCell className="whitespace-normal first:pl-5 md:first:pl-6">
                          <div className="flex items-center gap-3 py-1.5">
                            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface font-display text-[12px] font-semibold text-muted-foreground">
                              {row.state_code ?? "IN"}
                            </span>
                            <span className="flex min-w-0 flex-col">
                              <span className="font-medium text-foreground">{row.department}</span>
                              <span className="text-[12px] text-muted-foreground">{row.state_code ? "State " + row.state_code : "Central"}</span>
                            </span>
                          </div>
                        </TableCell>
                        <TableCell numeric className="font-medium">
                          {row.open_challenges}
                        </TableCell>
                        <TableCell className="last:pr-5 md:last:pr-6">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[13px] tabular-nums">{inr(row.total_budget.paise)}</span>
                            <Meter value={row.total_budget.paise} max={maxDeptBudget} label={"Budget published by " + row.department} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
        </>
      ) : (
        <EmptyState
          icon={Radar}
          title="No challenge is open right now"
          description="Check back soon, or watch the transparency page for activity."
          action={<LinkButton href="/transparency">See platform figures</LinkButton>}
        />
      )}

      <section className="relative overflow-hidden rounded-3xl bg-[#0e0e10] p-6 text-white ring-white/10 md:p-8 dark:bg-card dark:ring-1">
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-32 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(252,76,1,0.35),transparent)]" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-2xl flex-col gap-2">
            <span className="w-fit rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/80">Why this view exists</span>
            <h2 className="font-display text-xl font-semibold tracking-tight md:text-2xl">Demand you can plan a product around</h2>
            <p className="text-[15px] leading-relaxed text-white/65">
              A startup that cannot see where public demand is has to discover opportunities by chance, which makes product planning guesswork and bidding
              expensive. This view is published from the platform&apos;s own records and updates as challenges are approved and published.
            </p>
          </div>
          <LinkButton href="/challenges-board" variant="brand" size="lg" className="shrink-0">
            Go to the challenge board
            <ArrowRight />
          </LinkButton>
        </div>
      </section>
    </Page>
  );
}
