import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

/**
 * Server-side API client.
 *
 * Pages render on the server, so every call forwards the caller's session cookie to the
 * API. Writes also echo the CSRF cookie in the header the API expects, which is the
 * double-submit check described in PRD 11.1.
 */

const API_ORIGIN = process.env.API_ORIGIN || "http://127.0.0.1:8000";
const PREFIX = "/api/v1";

import type { FieldError } from "@/lib/types";

export type { FieldError };

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: FieldError[];
  [key: string]: unknown;
};

export class ApiError extends Error {
  status: number;
  problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail || problem.title);
    this.status = problem.status;
    this.problem = problem;
  }

  get fieldErrors(): FieldError[] {
    return this.problem.errors ?? [];
  }
}

async function cookieHeader(): Promise<string> {
  return (await cookies())
    .getAll()
    .map((c) => c.name + "=" + c.value)
    .join("; ");
}

async function csrfToken(): Promise<string> {
  return (await cookies()).get("ps_csrf")?.value ?? "";
}

async function acceptLanguage(): Promise<string> {
  try {
    return (await headers()).get("accept-language") ?? "en";
  } catch {
    return "en";
  }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
  cache: RequestCache = "no-store",
): Promise<T> {
  const url = API_ORIGIN + PREFIX + path;
  const init: RequestInit = {
    method,
    cache,
    headers: {
      Accept: "application/json",
      "Accept-Language": await acceptLanguage(),
      Cookie: await cookieHeader(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": await csrfToken() } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw new ApiError({
      type: "network",
      title: "The service could not be reached",
      status: 503,
      detail:
        "The PramaanSetu service is not responding. Check that the API is running, then reload this page.",
    });
  }

  const payload = await parse(response);

  if (!response.ok) {
    const problem =
      payload && typeof payload === "object"
        ? ({ status: response.status, title: "Request failed", type: "error", detail: "", ...(payload as object) } as Problem)
        : ({
            type: "error",
            title: "Request failed",
            status: response.status,
            detail: typeof payload === "string" && payload ? payload : "The request could not be completed.",
          } as Problem);
    throw new ApiError(problem);
  }

  return payload as T;
}

export function apiGet<T>(path: string, cache: RequestCache = "no-store"): Promise<T> {
  return request<T>("GET", path, undefined, {}, cache);
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  return request<T>("POST", path, body ?? {}, extraHeaders);
}

export function apiPut<T>(
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  return request<T>("PUT", path, body ?? {}, extraHeaders);
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}

/**
 * A GET for a record addressed by a route parameter. A missing record, or one the caller
 * may not see, renders the not-found page rather than a stack trace.
 */
export async function apiGetOrNotFound<T>(path: string): Promise<T> {
  try {
    return await apiGet<T>(path);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }
}

/** A GET that returns null instead of throwing when the record does not exist. */
export async function apiGetOptional<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}

/** Raw fetch for binary downloads such as generated PDFs. */
export async function apiFetchRaw(path: string): Promise<Response> {
  return fetch(API_ORIGIN + PREFIX + path, {
    headers: { Cookie: await cookieHeader() },
    cache: "no-store",
  });
}

export function problemMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail || error.problem.title;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}

export function fieldErrorsOf(error: unknown): FieldError[] {
  return error instanceof ApiError ? error.fieldErrors : [];
}
