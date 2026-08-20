import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gates the dashboard behind a real login. Before this, "reach the dashboard"
 * meant "sit at this machine" (see `app/api/token/route.ts`'s own comment on
 * that trust model) — this replaces that with an operator session the
 * orchestrator issues on passkey login (`security/operatorAuth.ts`).
 *
 * Named `proxy.ts`, not `middleware.ts` — the latter is deprecated as of
 * Next.js 16 (see `node_modules/next/dist/docs/.../proxy.md`).
 *
 * The orchestrator, not this file, is the source of truth for whether a
 * session is valid: a cookie's mere presence proves nothing, so every
 * navigation asks `GET /auth/session` rather than trusting the cookie's
 * shape. This is a local round trip (both processes are loopback/LAN), not a
 * remote one.
 */
const BASE_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://127.0.0.1:4317";

export async function proxy(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie");
  const sessionCheck = await fetch(`${BASE_URL}/auth/session`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  }).catch(() => null);

  if (sessionCheck?.ok) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
