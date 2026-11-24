import type { Metadata } from "next";

import { grantRole } from "@/app/actions";
import { Disclosure, SubmitButton } from "@/components/forms";
import {
  Callout,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  Pill,
  ProblemList,
  Section,
} from "@/components/ui";
import { apiGet } from "@/lib/api";
import { ROLE_LABELS, formatDateTime } from "@/lib/format";
import { readNotice, readProblem, single } from "@/lib/forms";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Users and roles" };
export const dynamic = "force-dynamic";

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

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/admin/users");

  const roleFilter = single(searchParams?.role);
  const query = new URLSearchParams({ limit: "300" });
  if (roleFilter) query.set("role", roleFilter);

  const users = await apiGet<{ items: AdminUser[] }>("/admin/users?" + query.toString());
  const departments = await apiGet<{ items: Department[] }>("/admin/departments");

  const notice = readNotice(searchParams);
  const problem = readProblem(searchParams);
  const departmentName = new Map(departments.items.map((d) => [d.id, d.name]));

  return (
    <div>
      <PageHeader
        title="Users and roles"
        subtitle="A person may hold several roles, each scoped to a department, a challenge or a startup. Conflict rules are enforced by the platform, not by convention."
        meta={<Pill>{users.items.length} user{users.items.length === 1 ? "" : "s"}</Pill>}
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

      <Section title="Departments">
        <DataTable columns={["Name", "Code", "Level", "Location", "Service levels in days"]}>
          {departments.items.map((department) => (
            <tr key={department.id}>
              <td className="font-medium">{department.name}</td>
              <td className="num text-sm">{department.code}</td>
              <td className="text-sm">{department.level}</td>
              <td className="text-sm">
                {[department.district, department.state_code].filter(Boolean).join(", ") || "Central"}
              </td>
              <td className="num text-sm">
                accept {department.service_levels.accept_days}, approve{" "}
                {department.service_levels.approve_days}, release{" "}
                {department.service_levels.release_days}
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section
        title="Users"
        description="Evaluator and validator roles are always bound to a specific challenge, and are assigned from the challenge panel page."
        actions={
          <div className="flex flex-wrap gap-2">
            {["", "DO", "DA", "FO", "SU", "EE", "IV", "PA"].map((role) => (
              <a
                key={role || "all"}
                href={role ? "/admin/users?role=" + role : "/admin/users"}
                className={"pill no-underline " + (roleFilter === role || (!roleFilter && !role) ? "pill-good" : "pill-neutral")}
              >
                {role ? ROLE_LABELS[role] : "All"}
              </a>
            ))}
          </div>
        }
      >
        {users.items.length ? (
          <DataTable columns={["Name", "Email", "Department or startup", "Roles", "Last signed in"]}>
            {users.items.map((user) => (
              <tr key={user.id}>
                <td>
                  <span className="font-medium">{user.name}</span>
                  {user.designation ? (
                    <span className="block text-sm text-ink-muted">{user.designation}</span>
                  ) : null}
                </td>
                <td className="text-sm">{user.email}</td>
                <td className="text-sm">
                  {user.department_id
                    ? departmentName.get(user.department_id) ?? "Department"
                    : user.startup_id
                      ? "Startup"
                      : "Not attached"}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {user.roles.length ? (
                      user.roles.map((role) => <Pill key={role}>{ROLE_LABELS[role] ?? role}</Pill>)
                    ) : (
                      <span className="text-sm text-ink-muted">No roles</span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap text-sm text-ink-muted">
                  {user.last_login_at ? formatDateTime(user.last_login_at) : "Never"}
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState message="No user matches this filter." />
        )}
      </Section>

      <Section title="Grant a role">
        <Disclosure summary="Grant a scoped role to a user">
          <form action={grantRole} className="max-w-form space-y-4">
            <Field label="User" name="user_id" required>
              <select id="user_id" name="user_id" required>
                {users.items.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role" name="role" required>
              <select id="role" name="role" required defaultValue="DO">
                {["DO", "DA", "FO", "SU", "PA"].map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scope type" name="scope_type" required>
              <select id="scope_type" name="scope_type" defaultValue="department" required>
                <option value="department">A department</option>
                <option value="startup">A startup</option>
                <option value="global">The whole platform</option>
              </select>
            </Field>
            <Field
              label="Scope"
              name="scope_id"
              help="Leave blank for a platform-wide role. Evaluator and validator roles are assigned from the challenge panel page instead."
            >
              <select id="scope_id" name="scope_id" defaultValue="">
                <option value="">No scope</option>
                {departments.items.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton>Grant the role</SubmitButton>
          </form>
        </Disclosure>
      </Section>

      <Section title="Separation of duties">
        <ul className="list-disc space-y-2 pl-5 text-sm text-ink-soft">
          <li>The officer who drafts a challenge cannot approve it.</li>
          <li>An evaluator on a challenge cannot validate the same challenge.</li>
          <li>A finance officer cannot approve a payment they will release.</li>
          <li>An independent validator cannot belong to the department running the pilot.</li>
          <li>
            The platform administrator reads across the platform and manages configuration, but
            holds no business approval.
          </li>
        </ul>
      </Section>
    </div>
  );
}
