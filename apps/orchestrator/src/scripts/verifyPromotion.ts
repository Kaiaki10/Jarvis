/**
 * A real, end-to-end smoke test run after a promotion restart — not just
 * `/health` (which only proves the HTTP server bound a port), but a genuine
 * agent turn through the actual Claude Agent SDK path, so a promotion that
 * merged something that breaks session startup gets caught and rolled back
 * rather than left running broken. Exits non-zero on any failure, which
 * `scripts/promote-lab.ps1` treats as "roll back."
 *
 * Runs as its own short-lived process (not a function call from inside the
 * orchestrator) because by the time this runs, the orchestrator has just been
 * restarted onto the code being verified — there is no "before" process left
 * to call it from.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? "4317";
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_PATH = process.env.JARVIS_TOKEN_PATH ?? join(__dirname, "..", "..", "jarvis.token");
const ORCHESTRATOR_DIR = join(__dirname, "..", "..");

interface SessionEvent {
  type: string;
  payload: unknown;
}

async function main(): Promise<void> {
  const token = readFileSync(TOKEN_PATH, "utf-8").trim();
  const headers = {
    Authorization: `Bearer ${token}`,
    Origin: "http://127.0.0.1:3000",
    "Content-Type": "application/json",
  };

  const health = await fetch(`${BASE}/health`);
  if (!health.ok) throw new Error(`/health returned HTTP ${health.status}`);

  const created = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: "Reply with exactly the word OK and nothing else.",
      cwd: ORCHESTRATOR_DIR,
      permissionMode: "default",
    }),
  });
  if (!created.ok) {
    throw new Error(`Could not start a verification session (HTTP ${created.status}): ${await created.text()}`);
  }
  const session = (await created.json()) as { id: string };

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/sessions/${session.id}/events`, { headers });
    if (!res.ok) throw new Error(`Could not read verification session events (HTTP ${res.status})`);
    const events = (await res.json()) as SessionEvent[];
    const result = events.find((e) => e.type === "result");
    if (result) {
      const payload = result.payload as { is_error?: boolean; errors?: unknown };
      if (payload.is_error) {
        throw new Error(`Verification session ended in error: ${JSON.stringify(payload.errors)}`);
      }
      console.log("Verification session completed successfully.");
      await fetch(`${BASE}/sessions/${session.id}`, { method: "DELETE", headers }).catch(() => {});
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Verification session did not complete within 90 seconds.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
