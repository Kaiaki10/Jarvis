/**
 * Whether the dashboard demands a passkey login.
 *
 * Two places gate on the operator session — `proxy.ts` for every page, and
 * `app/api/token/route.ts` for the API token itself — and they must agree. If
 * one let you in and the other did not, the dashboard would load and then fail
 * every request, which looks like a broken app rather than a locked one. Hence
 * one function, imported by both, rather than two reads of the same variable.
 *
 * Server-side only: deliberately not `NEXT_PUBLIC_`, so nothing the browser
 * sends can turn the gate off.
 *
 * Defaults to requiring login. A missing or misspelled variable should leave
 * the door shut, not open it.
 *
 * ## What is still protecting things when this is off
 *
 * The passkey is the newest of several layers, not the only one. With it off,
 * the trust model returns to what it was before: *reaching the dashboard means
 * sitting at this machine*. Specifically, all of this still holds:
 *
 * - Both services bind to `127.0.0.1`, so nothing on the network can reach
 *   them.
 * - The orchestrator still requires its API token on every route that matters.
 * - The origin guard (`http/authGuard.ts`) still rejects any browser request
 *   carrying an unrecognised `Origin`, which is what closes the drive-by case:
 *   a page on some website can send a request to a loopback port, and CORS
 *   stops it *reading* the reply but not the request landing.
 *
 * What is genuinely given up: another user account on this machine, or any
 * process running as you, can drive Jarvis — including the money rails — with
 * no further challenge.
 *
 * ## Changing it
 *
 * Set `JARVIS_REQUIRE_LOGIN=0` in `apps/web/.env.local`, then rebuild. The
 * rebuild is not optional: the value is baked into the proxy bundle, and the
 * live service runs compiled output either way (see CLAUDE.md).
 */
export function loginRequired(): boolean {
  const value = process.env.JARVIS_REQUIRE_LOGIN?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}
