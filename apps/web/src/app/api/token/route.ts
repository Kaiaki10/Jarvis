import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
// The token file is read at request time, never captured into a build artifact.
export const dynamic = "force-dynamic";

/**
 * Hands the browser the orchestrator's API token.
 *
 * The dashboard talks to the orchestrator directly from the browser, so the
 * token has to reach client code somehow. Serving it from a route handler
 * rather than a `NEXT_PUBLIC_` variable keeps it out of the static JavaScript
 * bundle, so it is never written to disk in `.next/` and never survives in a
 * copied build. A page on another origin cannot read this response.
 *
 * This is a same-machine trust boundary, not a user-authentication one: anyone
 * who can reach this dashboard is already the operator.
 */
const TOKEN_PATH =
  process.env.JARVIS_TOKEN_PATH ??
  join(process.cwd(), "..", "orchestrator", "jarvis.token");

export async function GET() {
  if (!existsSync(TOKEN_PATH)) {
    // The orchestrator writes this on first start. Saying so beats a bare 500.
    return Response.json(
      { error: "Orchestrator token not found. Start the orchestrator once to generate it." },
      { status: 503 }
    );
  }
  const token = readFileSync(TOKEN_PATH, "utf-8").trim();
  if (!token) {
    return Response.json({ error: "Orchestrator token file is empty." }, { status: 503 });
  }
  return Response.json(
    { token },
    // Never let a proxy or the browser cache a credential.
    { headers: { "Cache-Control": "no-store" } }
  );
}
