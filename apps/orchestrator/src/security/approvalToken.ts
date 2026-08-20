import { createHmac, timingSafeEqual } from "node:crypto";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { deriveKey } from "./secretStore.js";

const APPROVE_PORT = Number(process.env.JARVIS_APPROVE_PORT ?? 4318);

export type ApprovalDecision = "allow" | "deny";

export interface ApprovalTokenPayload {
  sessionId: string;
  requestId: string;
  expiresAt: number;
}

function signingKey(): Buffer {
  return deriveKey("approval-token-v1");
}

/**
 * A short-lived, single-purpose link a push notification can carry —
 * deliberately not the dashboard's bearer token (`security/apiToken.ts`),
 * which has no per-action scope and must not be widened by handing it to a
 * phone notification. Expiry mirrors the existing approval deadline; the
 * underlying permission resolution is already one-shot per `requestId`
 * (`resolvePermission` deletes its pending entry once answered, so a second
 * attempt with the same token just finds nothing pending), so this token
 * needs no separate single-use ledger of its own.
 */
export function createApprovalToken(sessionId: string, requestId: string, ttlMs: number): string {
  const payload: ApprovalTokenPayload = { sessionId, requestId, expiresAt: Date.now() + ttlMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = createHmac("sha256", signingKey()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

// A VPN/virtual adapter (NordLynx, WireGuard, Tailscale, a Docker/WSL/Hyper-V
// switch, ...) has its own private address space a phone on the same
// physical WiFi cannot reach unless it happens to be in that same tunnel too
// — the common case is the opposite: the PC runs a VPN for its own browsing
// while the phone is plainly on the home WiFi. Picking "the first non-
// internal IPv4 address" found one of these on the very first real machine
// this ran on, so it needs to actively prefer a real adapter instead.
const VPN_LIKE = /vpn|tun\d|tap\d|nordlynx|wireguard|tailscale|zerotier|ppp|virtual|vethernet|vmware|vbox|hyper-v|docker|wsl/i;
const PHYSICAL_LIKE = /^(wi-?fi|ethernet|en\d|eth\d|wlan\d)/i;

/**
 * This machine's LAN IPv4 address, preferring a real WiFi/Ethernet adapter
 * over a VPN or virtual one. `JARVIS_APPROVE_HOST` overrides the guess
 * entirely for a setup this heuristic gets wrong.
 */
export function lanAddress(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): string | null {
  if (process.env.JARVIS_APPROVE_HOST) return process.env.JARVIS_APPROVE_HOST;

  const candidates: { name: string; address: string }[] = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const iface of addrs ?? []) {
      if (iface.family === "IPv4" && !iface.internal) candidates.push({ name, address: iface.address });
    }
  }
  const physical = candidates.find((c) => PHYSICAL_LIKE.test(c.name) && !VPN_LIKE.test(c.name));
  if (physical) return physical.address;
  const nonVpn = candidates.find((c) => !VPN_LIKE.test(c.name));
  if (nonVpn) return nonVpn.address;
  // Last resort: something is better than silently disabling the feature —
  // a wrong-but-visible address is at least diagnosable via JARVIS_APPROVE_HOST.
  return candidates[0]?.address ?? null;
}

/**
 * A push-notification-carriable link that resolves a specific pending
 * permission request, or null if this machine has no reachable LAN address
 * to put in it. Lives here rather than in `http/approveServer.ts` so callers
 * that need only a link (e.g. `sessionManager.ts`, which the approve server
 * itself already depends on for `resolvePermission`) don't create an import
 * cycle by reaching into the server module that serves it.
 */
export function approveLink(sessionId: string, requestId: string, ttlMs: number): string | null {
  const host = lanAddress();
  if (!host) return null;
  const token = createApprovalToken(sessionId, requestId, ttlMs);
  return `http://${host}:${APPROVE_PORT}/approve/${encodeURIComponent(token)}`;
}

/** Returns the decoded payload only if the signature is valid and it hasn't expired. */
export function verifyApprovalToken(token: string): ApprovalTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedSig = createHmac("sha256", signingKey()).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(sig, "utf-8");
  const expectedBuf = Buffer.from(expectedSig, "utf-8");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as ApprovalTokenPayload;
    if (
      typeof payload.sessionId !== "string" ||
      typeof payload.requestId !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      return null;
    }
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}
