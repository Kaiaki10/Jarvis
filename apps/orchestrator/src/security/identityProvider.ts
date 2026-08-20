/**
 * A way to prove a browser belongs to this install's operator. WebAuthn
 * (`operatorAuth.ts`) is the only implementation today; this interface exists
 * so a second provider — most plausibly "Sign in with ChatGPT" once/if its
 * developer registration is confirmed open for a project like this — can
 * attach to an *existing* operator later without a rewrite. See
 * `operator_identities` in `db/schema.sql` for the matching storage: a link
 * table keyed by (provider, provider_subject), empty until a second provider
 * ships.
 */
export interface IdentityProviderResult {
  operatorId: string;
  displayName: string;
}

export interface IdentityProvider {
  /** Matches `operator_identities.provider` and any route path segment for this provider. */
  id: string;
  /** Starts a login attempt; the shape of both the input and the returned challenge is provider-specific. */
  beginLogin(input: unknown): Promise<unknown>;
  /** Finishes a login attempt, resolving to the operator it authenticated as. */
  completeLogin(input: unknown): Promise<IdentityProviderResult>;
}
