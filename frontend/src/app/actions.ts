"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { ApiError, apiPost, apiPut } from "@/lib/api";
import { checkbox, ifMatch, number, text, withResult } from "@/lib/forms";

/** Authentication, notifications and administration. */

const API_ORIGIN = process.env.API_ORIGIN || "http://127.0.0.1:8000";

type SignInResult = {
  csrf_token: string;
  user: { roles: string[] };
};

async function storeSessionCookies(response: Response) {
  // The API sets HttpOnly session cookies. The web app runs on the same origin through
  // the rewrite in next.config.mjs, so they are copied across unchanged.
  const jar = await cookies();
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attributes] = raw.split(";");
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    const options: Record<string, unknown> = { path: "/", sameSite: "strict" };
    for (const attribute of attributes) {
      const [key, attributeValue] = attribute.split("=").map((part) => part.trim().toLowerCase());
      if (key === "httponly") options.httpOnly = true;
      if (key === "secure") options.secure = true;
      if (key === "max-age") options.maxAge = Number(attributeValue);
    }
    jar.set(name, value, options as never);
  }
}

async function callAuth(path: string, body: unknown): Promise<Response> {
  return fetch(API_ORIGIN + "/api/v1" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export async function requestCode(form: FormData): Promise<void> {
  const identifier = text(form, "identifier");
  const next = text(form, "next");
  const response = await callAuth("/auth/otp/request", { identifier });
  const payload = (await response.json().catch(() => ({}))) as {
    detail?: string;
    development_code?: string;
  };
  if (!response.ok) {
    redirect(
      "/signin?step=identifier&problem=" +
        encodeURIComponent(payload.detail ?? "The code could not be sent."),
    );
  }
  const params = new URLSearchParams({ step: "code", identifier });
  if (next) params.set("next", next);
  if (payload.development_code) params.set("code_hint", payload.development_code);
  redirect("/signin?" + params.toString());
}

export async function verifyCode(form: FormData): Promise<void> {
  const identifier = text(form, "identifier");
  const code = text(form, "code");
  const next = text(form, "next") || "/home";
  const response = await callAuth("/auth/otp/verify", { identifier, code });
  const payload = (await response.json().catch(() => ({}))) as { detail?: string } & SignInResult;
  if (!response.ok) {
    const params = new URLSearchParams({
      step: "code",
      identifier,
      problem: payload.detail ?? "That code is not correct.",
    });
    if (next) params.set("next", next);
    redirect("/signin?" + params.toString());
  }
  await storeSessionCookies(response);
  redirect(next);
}

export async function signInAs(form: FormData): Promise<void> {
  /** Local demonstration shortcut so a reviewer can switch persona in one click. */
  const identifier = text(form, "identifier");
  const next = text(form, "next") || "/home";
  const response = await callAuth("/auth/dev/impersonate", { identifier });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string };
    redirect(
      "/signin?problem=" + encodeURIComponent(payload.detail ?? "That account was not found."),
    );
  }
  await storeSessionCookies(response);
  redirect(next);
}

export async function signOut(): Promise<void> {
  try {
    await apiPost("/auth/logout");
  } catch {
    // Signing out locally is enough even if the API call fails.
  }
  const jar = await cookies();
  for (const name of ["ps_access", "ps_refresh", "ps_csrf"]) {
    jar.delete(name);
  }
  redirect("/signin");
}

export async function markNotificationsRead(form: FormData): Promise<void> {
  await withResult("/notifications", "All notifications marked as read.", async () => {
    await apiPost("/me/notifications/read", { all: true });
    revalidatePath("/notifications");
  });
}

export async function savePreferences(form: FormData): Promise<void> {
  const locale = text(form, "locale", "en");
  await withResult("/settings", "Your preferences have been saved.", async () => {
    await apiPut("/me/profile", { locale, designation: text(form, "designation") || undefined });
    revalidatePath("/", "layout");
  });
}

// --- Administration --------------------------------------------------------

export async function verifyAuditChain(): Promise<void> {
  let notice = "";
  try {
    const result = await apiPost<{ verified: boolean; entries_checked: number; detail: string }>(
      "/admin/audit/verify",
    );
    notice = result.detail;
  } catch (error) {
    notice = error instanceof ApiError ? error.problem.detail : "Verification could not be run.";
  }
  redirect("/admin/audit?notice=" + encodeURIComponent(notice));
}

export async function moveDemoClock(form: FormData): Promise<void> {
  const days = number(form, "days", 0);
  await withResult(
    "/admin",
    "The platform clock is fast-forwarded by " +
      days +
      " days. Run the scheduler to see the service level escalations.",
    async () => {
      await apiPost("/admin/clock", { days, confirm: checkbox(form, "confirm") });
      revalidatePath("/", "layout");
    },
  );
}

export async function runSchedulerNow(): Promise<void> {
  await withResult("/admin", "One scheduler cycle has run.", async () => {
    await apiPost("/admin/scheduler/run");
    revalidatePath("/", "layout");
  });
}

export async function retryDeadLetter(form: FormData): Promise<void> {
  const jobId = text(form, "job_id");
  await withResult("/admin/jobs", "The job has been queued again.", async () => {
    await apiPost("/admin/jobs/" + jobId + "/retry");
    revalidatePath("/admin/jobs");
  });
}

export async function installTemplates(): Promise<void> {
  await withResult("/admin/templates", "Any missing template versions have been installed.", async () => {
    await apiPost("/admin/templates/install");
    revalidatePath("/admin/templates");
  });
}

export async function grantRole(form: FormData): Promise<void> {
  const body = {
    user_id: text(form, "user_id"),
    role: text(form, "role"),
    scope_type: text(form, "scope_type", "department"),
    scope_id: text(form, "scope_id") || null,
  };
  await withResult("/admin/users", "The role has been granted.", async () => {
    await apiPost("/admin/roles", body);
    revalidatePath("/admin/users");
  });
}

export async function verifyDpiit(form: FormData): Promise<void> {
  const startupId = text(form, "startup_id");
  const back = text(form, "back", "/startup");
  await withResult(back, "The recognition check has been run.", async () => {
    await apiPost("/startups/" + startupId + "/verify-dpiit");
    revalidatePath(back);
  });
}

export async function saveStartupProfile(form: FormData): Promise<void> {
  const startupId = text(form, "startup_id");
  const version = text(form, "version");
  const body = {
    legal_name: text(form, "legal_name"),
    cin: text(form, "cin") || null,
    dpiit_number: text(form, "dpiit_number") || null,
    sectors: text(form, "sectors")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    state_code: text(form, "state_code") || null,
    district: text(form, "district") || null,
    product_description: text(form, "product_description"),
    capability_text: text(form, "capability_text"),
    team_size: number(form, "team_size", 1),
    website: text(form, "website") || null,
    contact_name: text(form, "contact_name"),
    contact_email: text(form, "contact_email") || null,
    contact_phone: text(form, "contact_phone") || null,
    annual_turnover_rupees: number(form, "annual_turnover_rupees", 0),
    years_of_experience: number(form, "years_of_experience", 0),
  };
  await withResult("/startup", "Your profile has been saved.", async () => {
    await apiPut("/startups/" + startupId, body, ifMatch(version));
    revalidatePath("/startup");
  });
}
