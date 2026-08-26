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

interface Operator {
  id: string;
  displayName: string;
}

async function resolveOperator(cookieHeader: string | null): Promise<Operator | null> {
  const res = await fetch(`${BASE_URL}/auth/session`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { operator?: Operator } | null;
  return body?.operator ?? null;
}

/**
 * The turbopackIgnore markers are deliberate. The bundler sees a path built at
 * runtime and assumes the whole source tree might need bundling into the server
 * output; this read is intentionally outside the app directory, pointing at the
 * orchestrator's generated token, so there is nothing to trace or include.
 */
export async function GET(request: Request) {
  const agentId = new URL(request.url).searchParams.get("agentId");

  // Same switch the proxy reads, from the same module — the two gates have to
  // agree or the dashboard loads and then fails every request.
  let operator: Operator | null = null;
  if (loginRequired()) {
    operator = await resolveOperator(request.headers.get("cookie"));
    if (!operator) return Response.json({ error: "Not logged in" }, { status: 401 });
  }

  if (!existsSync(/*turbopackIgnore: true*/ TOKEN_PATH)) {
    // The orchestrator writes this on first start. Saying so beats a bare 500.
    return Response.json(
      { error: "Orchestrator token not found. Start the orchestrator once to generate it." },
      { status: 503 }
    );
  }
  const masterToken = readFileSync(/*turbopackIgnore: true*/ TOKEN_PATH, "utf-8").trim();
  if (!masterToken) {
    return Response.json({ error: "Orchestrator token file is empty." }, { status: 503 });
  }

  if (agentId) {
    // Minted server-to-server: this process already legitimately holds the
    // master token (the file read above), and has already confirmed the
    // operator session same-origin, which a direct browser request to the
    // orchestrator never reliably would (different port — see api.ts's own
    // note on why it doesn't send credentials cross-origin).
    const mint = await fetch(`${BASE_URL}/agent-tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${masterToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, ...(operator ? { operatorId: operator.id } : {}) }),
      cache: "no-store",
    }).catch(() => null);
    if (!mint) return Response.json({ error: "Could not reach the orchestrator to mint an agent token." }, { status: 502 });
    const body = await mint.json().catch(() => ({}));
    return Response.json(body, { status: mint.status, headers: { "Cache-Control": "no-store" } });
  }

  return Response.json(
    { token: masterToken },
    // Never let a proxy or the browser cache a credential.
    { headers: { "Cache-Control": "no-store" } }
  );
}
