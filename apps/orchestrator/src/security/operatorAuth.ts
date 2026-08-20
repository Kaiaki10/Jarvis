import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import type { IdentityProviderResult } from "./identityProvider.js";
import {
  addCredential,
  countOperators,
  createOperator,
  createOperatorSession,
  createWebauthnChallenge,
  consumeWebauthnChallenge,
  deleteOperatorSession,
  getCredential,
  getOperator,
  getValidOperatorSession,
  listAllCredentials,
  listCredentialsForOperator,
  touchCredential,
  touchOperatorSession,
  type OperatorRecord,
} from "../db/operatorRepo.js";

/**
 * The origin the WebAuthn ceremony actually runs in — the web app's page, not
 * the orchestrator's own. Defaults off the same `WEB_ORIGIN` the CORS
 * allowlist already uses (`http/server.ts`), landing on `http://localhost:3000`.
 *
 * That default is load-bearing, not arbitrary — proven live while building
 * this: Chromium's WebAuthn implementation rejects an IP-literal RP ID
 * outright ("This is an invalid domain."), so `127.0.0.1` cannot be an RP
 * origin at all, ever, on any machine. `localhost` is the only loopback
 * hostname WebAuthn accepts without a real DNS domain. Because of that,
 * `lib/api.ts`'s browser-facing `BASE_URL` was changed to default to
 * `http://localhost:4317` to match (its old default, `127.0.0.1`, would
 * otherwise make the session cookie a different *site* from the orchestrator
 * and never reach it) — see that file's comment for the full chain. The
 * practical upshot: reach the dashboard at `http://localhost:3000`, not
 * `http://127.0.0.1:3000`, for login to work.
 *
 * Set `JARVIS_ORIGIN`/`JARVIS_RP_ID` when fronting the dashboard with a
 * reverse proxy or tunnel for real remote access — WebAuthn requires the RP
 * ID to be the exact domain the browser sees.
 */
const RP_ORIGIN = process.env.JARVIS_ORIGIN ?? process.env.WEB_ORIGIN ?? "http://localhost:3000";
const RP_ID = process.env.JARVIS_RP_ID ?? new URL(RP_ORIGIN).hostname;
const RP_NAME = "Jarvis";

const CEREMONY_TTL_MS = 2 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export const SESSION_COOKIE_NAME = "jarvis_operator_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  // `Uint8Array.from` copies into a plain ArrayBuffer-backed array; wrapping
  // Buffer's own backing buffer directly types as `ArrayBufferLike` (which
  // admits `SharedArrayBuffer`), which SimpleWebAuthn's stricter types reject.
  // The bare `Uint8Array` return-type annotation would itself widen back to
  // `ArrayBufferLike`, so the annotation has to say `ArrayBuffer` explicitly.
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

/**
 * Registration is only ever for two situations: bootstrapping the very first
 * (and normally only) operator on an install with none yet, or an already
 * logged-in operator adding another passkey (a phone, a backup key). Neither
 * lets an anonymous caller claim an operator that already exists — the route
 * layer decides which case applies and passes the acting operator's id, or
 * null for the bootstrap case, which this function re-validates itself
 * rather than trusting the caller.
 */
export async function beginRegistration(actingOperatorId: string | null) {
  if (actingOperatorId === null && countOperators() > 0) {
    throw new Error("An operator already exists on this install. Log in to add another passkey.");
  }
  const excludeCredentials = actingOperatorId
    ? listCredentialsForOperator(actingOperatorId).map((c) => ({ id: c.credentialId }))
    : [];

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: "operator",
    userDisplayName: "Jarvis operator",
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const ceremonyId = createWebauthnChallenge({
    type: "registration",
    challenge: options.challenge,
    operatorId: actingOperatorId,
    ttlMs: CEREMONY_TTL_MS,
  });

  return { ceremonyId, options };
}

export async function completeRegistration(input: {
  ceremonyId: string;
  response: RegistrationResponseJSON;
  displayName?: string;
  deviceLabel?: string;
}): Promise<{ operator: OperatorRecord }> {
  const ceremony = consumeWebauthnChallenge(input.ceremonyId);
  if (!ceremony || ceremony.type !== "registration") {
    throw new Error("This registration link has expired. Start again.");
  }

  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey registration could not be verified.");
  }

  const { credential } = verification.registrationInfo;

  // Re-check at the moment of writing, not just at ceremony start, so two
  // concurrent bootstrap attempts can't both succeed and mint two operators.
  let operator: OperatorRecord;
  if (ceremony.operatorId) {
    const existing = getOperator(ceremony.operatorId);
    if (!existing) throw new Error("The operator adding this passkey no longer exists.");
    operator = existing;
  } else {
    if (countOperators() > 0) {
      throw new Error("An operator already exists on this install. Log in to add another passkey.");
    }
    operator = createOperator(input.displayName?.trim() || "Operator");
  }

  addCredential({
    credentialId: credential.id,
    operatorId: operator.id,
    publicKey: toBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    deviceLabel: input.deviceLabel,
  });

  return { operator };
}

export async function beginAuthentication() {
  const allowCredentials = listAllCredentials().map((c) => ({
    id: c.credentialId,
    transports: (c.transports as AuthenticatorTransportFuture[] | null) ?? undefined,
  }));

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: "preferred",
  });

  const ceremonyId = createWebauthnChallenge({
    type: "authentication",
    challenge: options.challenge,
    ttlMs: CEREMONY_TTL_MS,
  });

  return { ceremonyId, options };
}

export async function completeAuthentication(input: {
  ceremonyId: string;
  response: AuthenticationResponseJSON;
}): Promise<IdentityProviderResult> {
  const ceremony = consumeWebauthnChallenge(input.ceremonyId);
  if (!ceremony || ceremony.type !== "authentication") {
    throw new Error("This login attempt has expired. Try again.");
  }

  const stored = getCredential(input.response.id);
  if (!stored) {
    throw new Error("This passkey is not registered with Jarvis.");
  }

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: stored.credentialId,
      publicKey: fromBase64Url(stored.publicKey),
      counter: stored.counter,
      transports: (stored.transports as AuthenticatorTransportFuture[] | null) ?? undefined,
    },
  });
  if (!verification.verified) {
    throw new Error("Passkey login could not be verified.");
  }

  touchCredential(stored.credentialId, verification.authenticationInfo.newCounter);

  const operator = getOperator(stored.operatorId);
  if (!operator) throw new Error("This passkey's operator no longer exists.");
  return { operatorId: operator.id, displayName: operator.displayName };
}

export function startOperatorSession(operatorId: string, label?: string) {
  const session = createOperatorSession({ operatorId, ttlMs: SESSION_TTL_MS, label });
  return session;
}

/** Returns the operator for a valid session cookie value, or null. Refreshes last-seen as a side effect. */
export function resolveSession(sessionId: string | undefined): OperatorRecord | null {
  if (!sessionId) return null;
  const session = getValidOperatorSession(sessionId);
  if (!session) return null;
  const operator = getOperator(session.operatorId);
  if (!operator) return null;
  touchOperatorSession(session.id);
  return operator;
}

export function endOperatorSession(sessionId: string | undefined): void {
  if (!sessionId) return;
  deleteOperatorSession(sessionId);
}

/**
 * Express only parses cookies with the separate `cookie-parser` middleware,
 * which nothing else here needs — a raw `Cookie` header is `k=v; k2=v2`, cheap
 * enough to read directly rather than adding a dependency for one lookup.
 */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: RP_ORIGIN.startsWith("https://"),
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
  };
}
