import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError } from "@/lib/api";
import type { FieldError } from "@/lib/types";

/**
 * Server actions report failure by redirecting back to the page with the problem in the
 * query string. Everything stays server-rendered, the message survives a refresh, and
 * the page shows the field, the problem and the fix exactly as the API returned them.
 */

const MESSAGE_KEY = "problem";
const FIELDS_KEY = "fields";
const NOTICE_KEY = "notice";

export type PageProblem = { message: string; fields: FieldError[] };

export function readProblem(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): PageProblem | null {
  if (!searchParams) return null;
  const message = single(searchParams[MESSAGE_KEY]);
  if (!message) return null;
  let fields: FieldError[] = [];
  const raw = single(searchParams[FIELDS_KEY]);
  if (raw) {
    try {
      fields = JSON.parse(raw) as FieldError[];
    } catch {
      fields = [];
    }
  }
  return { message, fields };
}

export function readNotice(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string | null {
  return searchParams ? single(searchParams[NOTICE_KEY]) : null;
}

export function single(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function problemUrl(path: string, error: unknown): string {
  const params = new URLSearchParams();
  if (error instanceof ApiError) {
    params.set(MESSAGE_KEY, error.problem.detail || error.problem.title);
    const fields = error.fieldErrors;
    if (fields.length) params.set(FIELDS_KEY, JSON.stringify(fields.slice(0, 12)));
  } else if (error instanceof Error) {
    params.set(MESSAGE_KEY, error.message);
  } else {
    params.set(MESSAGE_KEY, "The action could not be completed. Try again.");
  }
  return path + (path.includes("?") ? "&" : "?") + params.toString();
}

export function noticeUrl(path: string, message: string): string {
  const params = new URLSearchParams({ [NOTICE_KEY]: message });
  return path + (path.includes("?") ? "&" : "?") + params.toString();
}

/** Run an action and return to `path`, carrying either a notice or the problem. */
export async function withResult(
  path: string,
  notice: string | null,
  work: () => Promise<void>,
): Promise<never> {
  let destination = notice ? noticeUrl(path, notice) : path;
  try {
    await work();
  } catch (error) {
    destination = problemUrl(path, error);
  }
  // Visited pages are kept briefly in the browser (staleTimes in next.config.mjs); after a
  // change, every one of them has to be read again.
  revalidatePath("/", "layout");
  redirect(destination);
}

export function text(form: FormData, name: string, fallback = ""): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : fallback;
}

export function optionalText(form: FormData, name: string): string | undefined {
  const value = text(form, name);
  return value === "" ? undefined : value;
}

export function number(form: FormData, name: string, fallback = 0): number {
  const value = text(form, name);
  if (value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalNumber(form: FormData, name: string): number | undefined {
  const value = text(form, name);
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function checkbox(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === "on" || value === "yes" || value === "true";
}

export function list(form: FormData, name: string): string[] {
  return form.getAll(name).filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/** A stable idempotency key so a resubmitted form cannot apply the same action twice. */
export function idempotencyKey(scope: string, form?: FormData): string {
  const supplied = form ? text(form, "idempotency_key") : "";
  if (supplied) return supplied;
  return scope + ":" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function keyHeaders(key: string): Record<string, string> {
  return { "Idempotency-Key": key };
}

export function ifMatch(version: number | string | undefined): Record<string, string> {
  if (version === undefined || version === null || version === "") return {};
  return { "If-Match": '"' + String(version) + '"' };
}
