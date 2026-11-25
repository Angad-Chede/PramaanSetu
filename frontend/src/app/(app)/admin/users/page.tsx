import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Rocket, Scale, UserPlus, UserX } from "lucide-react";

import { grantRole } from "@/app/actions";
import { SelectField, SubmitButton } from "@/components/app/forms";
import { EmptyState, Flash, Page, PageHeader, Panel } from "@/components/app/kit";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { all, apiGet } from "@/lib/api";
import { ROLE_LABELS, formatDateTime, initials } from "@/lib/format";
import { single } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Users and roles" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type AdminUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  designation: string | null;
  department_id: string | null;
  startup_id: string | null;
  status: string;
  locale: string;
  roles: string[];
  role_labels: string[];
  last_login_at: string | null;
};

type Department = {
  id: string;
  name: string;
  code: string;
  level: string;
  state_code: string | null;
  district: string | null;
  service_levels: { accept_days: number; approve_days: number; release_days: number };
};

const FILTER_ROLES = ["", "DO", "DA", "FO", "SU", "EE", "IV", "PA"];

const TINTS = ["bg-brand/14 text-brand-ink", "bg-info/14 text-info-ink", "bg-success/14 text-success-ink", "bg-warning/16 text-warning-ink", "bg-chart-4/14 text-chart-4-ink"];

function tint(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

const DUTIES = [
  "The officer who drafts a challenge cannot approve it.",
  "An evaluator on a challenge cannot validate the same challenge.",
  "A finance officer cannot approve a payment they will release.",
  "An independent validator cannot belong to the department running the pilot.",
  "The platform administrator reads across the platform and manages configuration, but holds no business approval.",
];

export default async function AdminUsersPage({ searchParams }: Props) {
  const params = await searchParams;
  const roleFilter = single(params.role);
  const query = new URLSearchParams({ limit: "300" });
  if (roleFilter) query.set("role", roleFilter);

  const [, users, departments] = await all(
    requireSession("/admin/users"),
    apiGet<{ items: AdminUser[] }>("/admin/users?" + query.toString()),
    apiGet<{ items: Department[] }>("/admin/departments"),
  );
  const departmentName = new Map(departments.items.map((d) => [d.id, d.name]));

  const counts = new Map<string, number>();
  if (!roleFilter) for (const user of users.items) for (const role of user.roles) counts.set(role, (counts.get(role) ?? 0) + 1);

  return (
    <Page width="wide">
      <PageHeader
        title="Users and roles"
        description="A person may hold several roles, each scoped to a department, a challenge or a startup. Conflict rules are enforced by the platform, not by convention."
        meta={
          <Badge variant="secondary" className="tabular-nums">
            {users.items.length} user{users.items.length === 1 ? "" : "s"}
            {roleFilter ? ` with ${ROLE_LABELS[roleFilter] ?? roleFilter}` : ""}
          </Badge>
        }
      />

      <Flash searchParams={params} />

      <Panel
        flush
        title="People"
        description="Evaluator and validator roles are always bound to one challenge, and are assigned from that challenge's panel page."
      >
        <nav aria-label="Filter by role" className="-mt-1 flex w-0 min-w-full gap-1.5 overflow-x-auto px-5 pb-4 scrollbar-none md:px-6">
          {FILTER_ROLES.map((role) => {
            const active = (roleFilter ?? "") === role;
            const count = role ? counts.get(role) : undefined;
            return (
              <Link
                key={role || "all"}
                href={role ? "/admin/users?role=" + role : "/admin/users"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-foreground text-background" : "bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {role ? ROLE_LABELS[role] : "Everyone"}
                {count !== undefined && <span className={cn("tabular-nums", active ? "text-background/60" : "text-glyph")}>{count}</span>}
              </Link>
            );
          })}
        </nav>

        {users.items.length ? (
          <Table containerClassName="w-0 min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5 md:pl-6">Person</TableHead>
                <TableHead className="hidden lg:table-cell">Email</TableHead>
                <TableHead className="hidden md:table-cell">Department or startup</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="hidden pr-5 text-right sm:table-cell md:pr-6">Last signed in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="pl-5 md:pl-6">
                    <div className="flex items-center gap-3">
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold", tint(user.name))}>{initials(user.name)}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-foreground">{user.name}</span>
                        <span className="truncate text-[12px] text-muted-foreground">{user.designation ?? user.email}</span>
                      </span>
                      {user.status !== "Active" && (
                        <Badge variant="warning" className="ml-1">
                          {user.status}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{user.email}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      {user.department_id ? <Building2 className="size-3.5" /> : user.startup_id ? <Rocket className="size-3.5" /> : <UserX className="size-3.5" />}
                      <span className="max-w-56 truncate">
                        {user.department_id ? (departmentName.get(user.department_id) ?? "Department") : user.startup_id ? "Startup" : "Not attached"}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length ? (
                        user.roles.map((role) => (
                          <Badge key={role} variant={role === "PA" ? "brand" : "secondary"}>
                            {ROLE_LABELS[role] ?? role}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground">No roles</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden pr-5 text-right whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell md:pr-6">
                    {user.last_login_at ? formatDateTime(user.last_login_at) : "Never"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="px-5 pb-5 md:px-6">
            <EmptyState icon={UserX} title="No one matches this filter" description="Try another role, or show everyone." />
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Grant a role" description="Scope a role to a department, a startup or the whole platform. The grant is written to the audit chain.">
          <form action={grantRole} className="flex flex-col gap-4">
            <SelectField
              label="User"
              name="user_id"
              required
              options={users.items.map((user) => ({ value: user.id, label: `${user.name} (${user.email})` }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Role"
                name="role"
                required
                defaultValue="DO"
                options={["DO", "DA", "FO", "SU", "PA"].map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
              />
              <SelectField
                label="Scope type"
                name="scope_type"
                required
                defaultValue="department"
                options={[
                  { value: "department", label: "A department" },
                  { value: "startup", label: "A startup" },
                  { value: "global", label: "The whole platform" },
                ]}
              />
            </div>
            <SelectField
              label="Scope"
              name="scope_id"
              defaultValue=""
              hint="Leave blank for a platform-wide role. Evaluator and validator roles are assigned from the challenge panel page instead."
              options={[{ value: "", label: "No scope" }, ...departments.items.map((department) => ({ value: department.id, label: department.name }))]}
            />
            <div>
              <SubmitButton pendingLabel="Granting">
                <UserPlus />
                Grant the role
              </SubmitButton>
            </div>
          </form>
        </Panel>

        <Panel title="Separation of duties" description="Checked by the platform on every assignment and every action.">
          <ol className="flex flex-col gap-3">
            {DUTIES.map((duty, index) => (
              <li key={duty} className="flex gap-3 text-sm leading-relaxed">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold text-glyph tabular-nums">{index + 1}</span>
                <span className="text-pretty text-foreground/85">{duty}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-surface/70 px-4 py-3 text-[13px] text-muted-foreground">
            <Scale className="size-4 shrink-0 text-glyph" />A grant that would break one of these rules is refused with the rule it breaks.
          </div>
        </Panel>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="font-display text-lg font-semibold tracking-tight">Departments</h2>
          <p className="text-[13px] text-muted-foreground">Each department sets its own payment service levels, in days, within the platform policy.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {departments.items.map((department) => {
            const steps = [
              { label: "Accept", days: department.service_levels.accept_days },
              { label: "Approve", days: department.service_levels.approve_days },
              { label: "Release", days: department.service_levels.release_days },
            ];
            const total = steps.reduce((sum, step) => sum + step.days, 0);
            return (
              <article key={department.id} className="flex flex-col gap-4 rounded-3xl bg-card p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 className="text-sm leading-snug font-medium text-pretty">{department.name}</h3>
                    <p className="text-[12px] text-muted-foreground">
                      {[department.district, department.state_code].filter(Boolean).join(", ") || "Central"} <span aria-hidden>·</span> {department.level}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-surface px-2 py-1 font-mono text-[11px] text-muted-foreground">{department.code}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex h-2 overflow-hidden rounded-full bg-recess" role="img" aria-label={`Payment service levels: ${steps.map((step) => `${step.label.toLowerCase()} ${step.days} days`).join(", ")}`}>
                    {steps.map((step, index) => (
                      <span
                        key={step.label}
                        className={cn("h-full", index === 0 ? "bg-info" : index === 1 ? "bg-warning" : "bg-success", index > 0 && "border-l-2 border-card")}
                        style={{ width: `${(step.days / (total || 1)) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-[12px] text-muted-foreground tabular-nums">
                    {steps.map((step, index) => (
                      <span key={step.label} className="inline-flex items-center gap-1.5">
                        <span className={cn("size-1.5 rounded-full", index === 0 ? "bg-info" : index === 1 ? "bg-warning" : "bg-success")} />
                        {step.label} {step.days}d
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </Page>
  );
}
