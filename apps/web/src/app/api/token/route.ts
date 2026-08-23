import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loginRequired } from "@/lib/authMode";

export const runtime = "nodejs";
// The token file is read at request time, never captured into a build artifact.
export const dynamic = "force-dynamic";

/**
 * Hands the browser the orchestrator's API token — now only once a real
 * operator session says it may. Serving it from a route handler rather than
 * a `NEXT_PUBLIC_` variable keeps it out of the static JavaScript bundle, so
 * it is never written to disk in `.next/` and never survives in a copied
 * build. A page on another origin cannot read this response.
 *
 * The dashboard-wide gate lives in `proxy.ts`; this is a second, narrower
 * check specifically on the token itself, since a proxy matcher change or a
 * refactor could otherwise silently stop covering this one route (the
 * bundled Next.js docs call this out directly: "Always verify authentication
 * and authorization inside each Server Function rather than relying on
 * Proxy alone").
 */
const BASE_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://127.0.0.1:4317";
const TOKEN_PATH =
  process.env.JARVIS_TOKEN_PATH ??
  join(process.cwd(), "..", "orchestrator", "jarvis.token");

async function hasValidSession(cookieHeader: string | null): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/auth/session`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  }).catch(() => null);
  return res?.ok ?? false;
}

/**
 * The turbopackIgnore markers are deliberate. The bundler sees a path built at
 * runtime and assumes the whole source tree might need bundling into the server
 * output; this read is intentionally outside the app directory, pointing at the
 * orchestrator's generated token, so there is nothing to trace or include.
 */
export async function GET(request: Request) {
  // Same switch the proxy reads, from the same module — the two gates have to
  // agree or the dashboard loads and then fails every request.
  if (loginRequired() && !(await hasValidSession(request.headers.get("cookie")))) {
    return Response.json({ error: "Not logged in" }, { status: 401 });
  }
  if (!existsSync(/*turbopackIgnore: true*/ TOKEN_PATH)) {
    // The orchestrator writes this on first start. Saying so beats a bare 500.
    return Response.json(
      { error: "Orchestrator token not found. Start the orchestrator once to generate it." },
      { status: 503 }
    );
  }
  const token = readFileSync(/*turbopackIgnore: true*/ TOKEN_PATH, "utf-8").trim();
  if (!token) {
    return Response.json({ error: "Orchestrator token file is empty." }, { status: 503 });
  }
  return Response.json(
    { token },
    // Never let a proxy or the browser cache a credential.
    { headers: { "Cache-Control": "no-store" } }
  );
}
