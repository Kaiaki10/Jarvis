/**
 * The authorization decisions behind per-agent scoped tokens, isolated from
 * Express the same way `authGuard.ts` isolates `isAllowedOrigin`/
 * `isUnauthenticatedPath` -- so the full decision matrix is a fast,
 * dependency-free test rather than something only exercisable through a live
 * request.
 */

export type AuthContext = { kind: "master" } | { kind: "agent"; agentId: string };

/** Given a bearer token and the two ways to validate it, decides who's calling. */
export function authenticate(
  token: string | undefined,
  isMasterToken: (t: string) => boolean,
  lookupAgentToken: (t: string) => { agentId: string } | undefined
): AuthContext | null {
  if (!token) return null;
  if (isMasterToken(token)) return { kind: "master" };
  const agentToken = lookupAgentToken(token);
  return agentToken ? { kind: "agent", agentId: agentToken.agentId } : null;
}

export type ScopeResult =
  | { ok: true; agentId: string | undefined }
  | { ok: false; status: 400 | 403; error: string };

/**
 * The crux of closing the per-agent authorization gap: a per-agent token
 * proves entitlement to exactly the one agent it was minted for, never more.
 * It is deliberately *not* sufficient for an unscoped request (no agentId
 * named at all), because an unscoped read can return every agent's data.
 */
export function resolveScopedAgentId(input: {
  /** undefined = the request didn't name an agent at all. */
  requestedAgentId: string | undefined;
  agentExists: (id: string) => boolean;
  auth: AuthContext;
}): ScopeResult {
  const { requestedAgentId, agentExists, auth } = input;
  if (requestedAgentId === undefined) {
    if (auth.kind === "agent") {
      return { ok: false, status: 403, error: "This token is scoped to one agent; name it explicitly or use an unscoped credential." };
    }
    return { ok: true, agentId: undefined };
  }
  if (!agentExists(requestedAgentId)) {
    return { ok: false, status: 400, error: "Unknown agent" };
  }
  if (auth.kind === "agent" && auth.agentId !== requestedAgentId) {
    return { ok: false, status: 403, error: "This token is not authorized for this agent." };
  }
  return { ok: true, agentId: requestedAgentId };
}
