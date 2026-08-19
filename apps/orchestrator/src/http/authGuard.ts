/**
 * The two decisions that guard every orchestrator request, kept apart from the
 * Express wiring so they can be tested directly. Getting either wrong silently
 * opens the whole API, which is not something to leave to an integration test
 * that happens to cover a couple of routes.
 */

/**
 * Routes that must stay reachable without the dashboard's token.
 *
 * - `/widget` is embedded on customer websites by design and runs its own
 *   origin allowlist.
 * - `/webhooks` is called by Resend, X, and Meta, which authenticate by signing
 *   the payload rather than by bearing a secret of ours.
 * - `/health` is a liveness probe that reveals nothing.
 * - `/shutdown` is how `scripts/restart-service.ps1` stops the service. Its
 *   fallback (killing the port owner) can fail against an S4U-protected child,
 *   so requiring a token here would put the documented restart path at risk of
 *   degrading silently. The origin guard still blocks a browser from reaching
 *   it, which is the attack that matters; the residual exposure is a local
 *   process stopping a local service, strictly less than the access it has now.
 */
export const UNAUTHENTICATED_PREFIXES = [
  "/widget",
  "/webhooks",
  "/health",
  "/shutdown",
] as const;

export function isUnauthenticatedPath(path: string): boolean {
  return UNAUTHENTICATED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/**
 * Whether a request may proceed given its `Origin` header.
 *
 * A page on any website can issue a cross-origin request to a loopback port;
 * CORS stops it reading the reply but not the request landing, so a plain POST
 * still has its effect. Browsers always attach `Origin` to those requests, so
 * refusing an unrecognised one closes the drive-by case for every route —
 * including the ones that cannot carry a token.
 *
 * Absent `Origin` means the caller is not a browser page: curl, the restart
 * script, and provider webhooks all arrive that way, and are covered by the
 * token check or their own signatures instead.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowed: readonly string[]
): boolean {
  if (origin === undefined) return true;
  return allowed.includes(origin);
}
