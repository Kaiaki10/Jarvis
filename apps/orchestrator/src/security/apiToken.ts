import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Sits beside `jarvis.key`, and resolves to the same place in dev and in the
 * compiled build — `dist/security/../..` is the orchestrator root, exactly as
 * `src/security/../..` is.
 */
const TOKEN_PATH =
  process.env.JARVIS_TOKEN_PATH ?? join(__dirname, "..", "..", "jarvis.token");

/**
 * Shared secret the dashboard presents on every orchestrator request.
 *
 * The threat this addresses is not a remote attacker — both services bind to
 * loopback. It is anything else already running on this machine: a web page the
 * user happens to visit can POST to `127.0.0.1:4317` from their browser, and
 * CORS does not prevent the request being *sent*, only the response being read.
 * Without a token that drive-by can launch sessions and spend real credentials.
 *
 * Generated on first use so there is nothing to configure. It is NOT protection
 * against a process that can read the orchestrator's own directory — that
 * process could read `jarvis.key` too.
 */
function loadToken(): string {
  if (existsSync(TOKEN_PATH)) {
    const existing = readFileSync(TOKEN_PATH, "utf-8").trim();
    if (existing) return existing;
  }
  const token = randomBytes(32).toString("base64url");
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  try {
    chmodSync(TOKEN_PATH, 0o600);
  } catch {
    // Best effort — POSIX modes are advisory on Windows.
  }
  return token;
}

let cached: string | null = null;

export function apiToken(): string {
  if (!cached) cached = loadToken();
  return cached;
}

/** Constant-time, so a wrong token cannot be discovered one character at a time. */
export function isValidToken(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(apiToken());
  const actual = Buffer.from(candidate);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * EventSource cannot set request headers, so the stream endpoints accept the
 * token in the query string. Everything else prefers the Authorization header,
 * which stays out of logs and referrers.
 */
export function tokenFromRequest(req: {
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
}): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const header = req.headers["x-jarvis-token"];
  if (typeof header === "string" && header) return header;
  const query = req.query.token;
  if (typeof query === "string" && query) return query;
  return undefined;
}
