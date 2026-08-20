import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxies /api/auth/* to the orchestrator's /auth/* — same routes
 * authGuard.ts already treats as unauthenticated-by-necessity, just reached
 * same-origin instead of directly by the browser.
 *
 * This exists because the direct-from-browser version (the login page
 * calling the orchestrator cross-port with `credentials: "include"`) proved
 * fragile in practice: a real user's Firefox accepted the WebAuthn ceremony
 * and the orchestrator issued a valid session, but the resulting Set-Cookie
 * — from a cross-origin (cross-port) fetch response — never actually landed
 * in the browser's cookie jar, so every subsequent request looked
 * unauthenticated. Cookies set by cross-origin XHR/fetch responses are
 * exactly what browsers' cross-site cookie protections (Firefox's Total
 * Cookie Protection foremost, but not only there) are designed to restrict,
 * and that restriction can vary by privacy setting in ways this app has no
 * way to detect or work around client-side.
 *
 * Routing through this same-origin proxy instead makes the cookie a normal
 * first-party cookie from the browser's point of view — the browser only
 * ever talks to its own origin, and this server-to-server hop to the
 * orchestrator is exactly as unaffected by browser cookie policy as
 * proxy.ts's own session check already is.
 */
const BASE_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4317";

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const search = req.nextUrl.search;
  const url = `${BASE_URL}/auth/${path.join("/")}${search}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  const upstream = await fetch(url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      cookie: req.headers.get("cookie") ?? "",
    },
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
  }).catch((err) => {
    throw new Error(`Could not reach the orchestrator: ${err instanceof Error ? err.message : String(err)}`);
  });

  const text = await upstream.text();
  const res = new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
  // getSetCookie() (not headers.get) because a response can carry more than
  // one Set-Cookie header, and headers.get would only surface the first.
  for (const cookie of upstream.headers.getSetCookie()) {
    res.headers.append("set-cookie", cookie);
  }
  return res;
}

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  try {
    return await proxy(req, path);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Proxy error" }, { status: 502 });
  }
}

export { handler as GET, handler as POST, handler as DELETE };
