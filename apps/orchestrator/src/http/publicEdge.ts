import type { IncomingHttpHeaders } from "node:http";

/**
 * The orchestrator listens on loopback only. The one way in from the internet
 * is the Cloudflare tunnel (`scripts/install-tunnel.ps1`), which forwards just
 * the routes outsiders legitimately need: the embeddable chat widget and the
 * signed provider webhooks.
 *
 * The tunnel's ingress rules already enforce that. This is the second lock, so
 * that one mistaken edit to the tunnel config can't publish the whole API, and
 * above all `/shutdown`, which is unauthenticated because only local processes
 * were ever supposed to reach it (see `authGuard.ts`).
 */
export const PUBLIC_PREFIXES = ["/widget", "/webhooks"] as const;

export function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Whether a request arrived through Cloudflare. Cloudflare sets
 * `CF-Connecting-IP` on every proxied request. A local process could forge the
 * header, but that only gets it treated as an outsider, which is never more
 * access than it already has.
 */
export function viaTunnel(headers: IncomingHttpHeaders): boolean {
  return typeof headers["cf-connecting-ip"] === "string" && headers["cf-connecting-ip"].length > 0;
}

/** The visitor's address for rate limiting: Cloudflare's client IP when tunnelled, the socket otherwise. */
export function clientKey(headers: IncomingHttpHeaders, socketAddress: string | undefined): string {
  return viaTunnel(headers) ? String(headers["cf-connecting-ip"]) : socketAddress ?? "unknown";
}

/**
 * The origin the caller actually used. Behind the tunnel the socket is plain
 * HTTP from cloudflared, but the visitor is on HTTPS, which matters for the
 * widget's own-origin check and for URLs handed back to a browser.
 */
export function requestOrigin(headers: IncomingHttpHeaders, protocol: string, host: string | undefined): string {
  const forwarded = headers["x-forwarded-proto"];
  const proto = viaTunnel(headers) && (forwarded === "https" || forwarded === "http") ? forwarded : protocol;
  return `${proto}://${host ?? "localhost"}`;
}
