import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Silent session refresh.
 *
 * The access token lasts 15 minutes by design (PRD 11.1). Without this, a user reading a
 * long Evidence Report would be bounced to the sign-in page mid-task even though their
 * 8-hour refresh token is still valid. Server components cannot set cookies, so the
 * rotation happens here, where it can.
 *
 * The refresh token rotates on every use and reuse is detected by the API, so this does
 * not weaken the session model: it just stops a valid session from appearing expired.
 */

const API_ORIGIN = process.env.API_ORIGIN || "http://127.0.0.1:8000";

const PUBLIC_PATHS = [
  "/signin",
  "/challenges-board",
  "/demand",
  "/transparency",
  "/passports/shared",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasAccess = Boolean(request.cookies.get("ps_access")?.value);
  const hasRefresh = Boolean(request.cookies.get("ps_refresh")?.value);

  // Nothing to do when the session is intact, or when there is nothing to refresh from.
  if (hasAccess || !hasRefresh) {
    return NextResponse.next();
  }
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"))) {
    return NextResponse.next();
  }

  try {
    const refreshed = await fetch(API_ORIGIN + "/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: request.cookies
          .getAll()
          .map((cookie) => cookie.name + "=" + cookie.value)
          .join("; "),
      },
      cache: "no-store",
    });

    if (!refreshed.ok) {
      // The refresh token is spent or revoked. Let the page redirect to sign-in.
      const response = NextResponse.next();
      for (const name of ["ps_access", "ps_refresh", "ps_csrf"]) {
        response.cookies.delete(name);
      }
      return response;
    }

    const response = NextResponse.next();
    for (const raw of refreshed.headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(";");
      const index = pair.indexOf("=");
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const options: Parameters<typeof response.cookies.set>[2] = {
        path: "/",
        sameSite: "strict",
      };
      for (const attribute of attributes) {
        const [key, attributeValue] = attribute.split("=").map((part) => part.trim().toLowerCase());
        if (key === "httponly") options.httpOnly = true;
        if (key === "secure") options.secure = true;
        if (key === "max-age") options.maxAge = Number(attributeValue);
      }
      response.cookies.set(name, value, options);
      // The incoming request is served from the same rotated values, so the page that
      // renders on this very request is already authenticated.
      request.cookies.set(name, value);
    }
    return response;
  } catch {
    // The API is unreachable. The page renders its own "service unavailable" message.
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Everything except static assets and the API proxy, which carries its own cookies.
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
