import { createHmac, randomBytes } from "node:crypto";

/** RFC 3986 percent-encoding — stricter than encodeURIComponent. */
function pct(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

export interface OAuth1Credentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/**
 * OAuth 1.0a signed Authorization header (HMAC-SHA1), which is what X still
 * requires for user-context calls such as posting.
 */
/**
 * Nonce and timestamp are generated internally, which makes the output
 * non-deterministic. Tests override them to check the signature against the
 * published OAuth spec vector — the only way to prove the signing is correct
 * rather than merely well-formed.
 */
export interface OAuth1Overrides {
  nonce?: string;
  timestamp?: string;
}

export function oauth1Header(
  method: string,
  url: string,
  creds: OAuth1Credentials,
  extraParams: Record<string, string> = {},
  overrides: OAuth1Overrides = {}
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: overrides.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: overrides.timestamp ?? Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // RFC 5849 §3.4.1.2: the base string URI excludes the query, and §3.4.1.3
  // requires those query parameters to be normalised in alongside the oauth_*
  // ones. Signing the whole URL instead produces a signature X rejects with a
  // bare 401 — which reads like a credentials or scope problem rather than a
  // signing one. Every call here was previously query-free (POSTs to /2/tweets
  // and the media endpoints), so this stayed latent until the first GET that
  // needed parameters.
  const [baseUrl, queryString = ""] = url.split("?");
  const queryParams: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryString)) {
    queryParams[key] = value;
  }

  const allParams = { ...oauthParams, ...queryParams, ...extraParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${pct(k)}=${pct(allParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    pct(baseUrl),
    pct(paramString),
  ].join("&");

  const signingKey = `${pct(creds.apiSecret)}&${pct(creds.accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };
  return (
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${pct(k)}="${pct(headerParams[k])}"`)
      .join(", ")
  );
}
