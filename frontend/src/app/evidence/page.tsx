import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyState, PageHeader, Pill, Section } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { bandTone, decimal, formatDate, signed } from "@/lib/format";
import { single } from "@/lib/forms";
import { getSession } from "@/lib/session";
import type { Passport } from "@/lib/types";

export const metadata: Metadata = { title: "Validated evidence" };
export const dynamic = "force-dynamic";

export default async function EvidenceIndexPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getSession();
  const query = new URLSearchParams({ limit: "60" });
  for (const key of ["category", "sector", "query", "min_score"]) {
    const value = single(searchParams?.[key]);
    if (value) query.set(key, value);
  }

  const path = session ? "/passports?" + query.toString() : "/public/passports?" + query.toString();
  const body = await apiGet<{ items: Passport[]; count?: number; note?: string }>(path);

  const categories = Array.from(new Set(body.items.map((item) => item.category))).sort();

  return (
    <div>
      <PageHeader
        title="Validated evidence"
        subtitle="Every entry here rests on a pilot whose plan was frozen before data collection and whose result an independent validator verified. Read the context before assuming the same result in a different setting."
        meta={<Pill>{body.items.length} Innovation Passport{body.items.length === 1 ? "" : "s"}</Pill>}
      />

      <Section title="Filter">
        <form method="get" className="grid gap-4 sm:grid-cols-4">
          <div className="field sm:col-span-2">
            <label htmlFor="query">Search</label>
            <input
              id="query"
              name="query"
              defaultValue={single(searchParams?.query) ?? ""}
              placeholder="Solution or problem category"
            />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" name="category" defaultValue={single(searchParams?.category) ?? ""}>
              <option value="">Every category</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="min_score">Minimum score</label>
            <select id="min_score" name="min_score" defaultValue={single(searchParams?.min_score) ?? ""}>
              <option value="">Any score</option>
              <option value="80">Strong evidence, 80 and above</option>
              <option value="60">Moderate or better, 60 and above</option>
            </select>
          </div>
          <div className="flex items-end gap-3 sm:col-span-4">
            <button type="submit" className="btn btn-primary">
              Apply the filter
            </button>
            <Link href="/evidence" className="btn btn-secondary">
              Clear
            </Link>
          </div>
        </form>
      </Section>

      <Section
        title="Innovation Passports"
        description="A passport packages a validated pilot so another department can reuse the evidence instead of repeating the experiment."
      >
        {body.items.length ? (
          <DataTable
            columns={["Solution", "Category", "Where it ran", "Measured result", "Score", "Validated", ""]}
          >
            {body.items.map((passport) => {
              const result = passport.result_summary ?? {};
              return (
                <tr key={passport.reference}>
                  <td>
                    {session ? (
                      <Link href={"/evidence/" + passport.id} className="font-medium">
                        {passport.solution_name}
                      </Link>
                    ) : (
                      <span className="font-medium">{passport.solution_name}</span>
                    )}
                    <p className="mt-0.5 text-sm text-ink-muted">{passport.startup_name}</p>
                  </td>
                  <td className="text-sm">{passport.category}</td>
                  <td className="text-sm">
                    {passport.department_name}
                    {passport.state_code ? (
                      <span className="block text-ink-muted">{passport.state_code}</span>
                    ) : null}
                  </td>
                  <td className="text-sm">
                    {result.measure ? (
                      <>
                        <span className="num font-medium">{signed(Number(result.effect), 2)}</span>{" "}
                        {String(result.unit ?? "")}
                        <span className="block text-ink-muted">
                          on {String(result.measure)}, interval {decimal(Number(result.ci_low), 2)} to{" "}
                          {decimal(Number(result.ci_high), 2)}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-muted">Not recorded</span>
                    )}
                  </td>
                  <td>
                    <Pill tone={bandTone(passport.band)}>
                      {decimal(passport.confidence_score, 0)} of 100
                    </Pill>
                    <span className="mt-1 block text-xs text-ink-muted">{passport.band}</span>
                  </td>
                  <td className="whitespace-nowrap text-sm">{formatDate(passport.validated_on)}</td>
                  <td className="text-right">
                    {session ? <Link href={"/evidence/" + passport.id}>Open</Link> : null}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <EmptyState message="No validated evidence matches this filter yet. A passport is issued automatically when an independent validator signs off a pilot." />
        )}
      </Section>

      <Section title="How to use a passport">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">
          <li>
            Read the measured result with its confidence interval, not just the headline number.
            The interval is the range the true effect most likely lies in.
          </li>
          <li>
            Read the context. A result from 24 metering areas in one city is evidence about that
            setting, not a guarantee about yours.
          </li>
          <li>
            Run the context fit check against your own scale, population and environment. It
            highlights the differences you have to judge.
          </li>
          <li>
            Raise an adoption request. The platform pre-fills a challenge from the original with the
            evidence attached, leaving the baseline blank for you to collect locally.
          </li>
        </ol>
      </Section>
    </div>
  );
}
