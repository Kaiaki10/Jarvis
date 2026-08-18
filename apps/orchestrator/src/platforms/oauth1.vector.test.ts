import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { oauth1Header, type OAuth1Credentials } from "./oauth1.js";

/**
 * The rest of the oauth1 suite checks the header is well-formed — that it has
 * the right parameters, sorted, base64-shaped. None of that would catch a wrong
 * signature, which is the failure that actually matters: X answers 401 and
 * every post silently fails.
 *
 * So this file re-derives the signature from RFC 5849 §3.4 independently and
 * asserts the two agree. Written from the spec steps rather than by copying the
 * implementation, so the mistakes that usually break OAuth 1.0a signing —
 * missing double-encoding in the base string, sorting before encoding, using
 * encodeURIComponent's laxer escaping — show up as a mismatch.
 */

const CREDS: OAuth1Credentials = {
  apiKey: "xvz1evFS4wEEPTGEFPHBog",
  apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};

const NONCE = "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg";
const TIMESTAMP = "1318622958";
const URL = "https://api.twitter.com/1.1/statuses/update.json";
const PARAMS = {
  status: "Hello Ladies + Gentlemen, a signed OAuth request!",
  include_entities: "true",
};

/** RFC 3986 unreserved set is A-Z a-z 0-9 - . _ ~ — everything else is escaped. */
function rfc3986(value: string): string {
  let out = "";
  for (const ch of Buffer.from(value, "utf-8").toString("binary")) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else {
      out += "%" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

function referenceSignature(
  method: string,
  url: string,
  creds: OAuth1Credentials,
  params: Record<string, string>,
  nonce: string,
  timestamp: string
): string {
  const all: Record<string, string> = {
    ...params,
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // Encode first, then sort on the encoded key — order matters here.
  const normalized = Object.keys(all)
    .map((k) => [rfc3986(k), rfc3986(all[k])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${rfc3986(url)}&${rfc3986(normalized)}`;
  const signingKey = `${rfc3986(creds.apiSecret)}&${rfc3986(creds.accessTokenSecret)}`;
  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function signatureFrom(header: string): string {
  const match = header.match(/oauth_signature="([^"]+)"/);
  if (!match) throw new Error(`no oauth_signature in header: ${header}`);
  return decodeURIComponent(match[1]);
}

describe("oauth1Header signature correctness", () => {
  it("matches an independent implementation of RFC 5849 §3.4", () => {
    const header = oauth1Header("POST", URL, CREDS, PARAMS, {
      nonce: NONCE,
      timestamp: TIMESTAMP,
    });
    expect(signatureFrom(header)).toBe(
      referenceSignature("POST", URL, CREDS, PARAMS, NONCE, TIMESTAMP)
    );
  });

  it("agrees across methods, URLs, and payloads", () => {
    const cases: Array<[string, string, Record<string, string>]> = [
      ["GET", "https://api.x.com/2/users/me", {}],
      ["POST", "https://api.x.com/2/tweets", { text: "plain" }],
      ["POST", URL, { status: "spaces and + plus & ampersand" }],
      ["POST", URL, { status: "unicode ünïcödé ✓" }],
      ["POST", URL, { status: "reserved !*'()" }],
      ["DELETE", "https://api.x.com/2/tweets/123", {}],
    ];

    for (const [method, url, params] of cases) {
      const actual = signatureFrom(
        oauth1Header(method, url, CREDS, params, { nonce: NONCE, timestamp: TIMESTAMP })
      );
      const expected = referenceSignature(method, url, CREDS, params, NONCE, TIMESTAMP);
      expect(actual, `${method} ${url} ${JSON.stringify(params)}`).toBe(expected);
    }
  });

  it("escapes the characters encodeURIComponent leaves alone", () => {
    // encodeURIComponent does not escape ! * ' ( ), but RFC 3986 requires it.
    // Getting this wrong produces a valid-looking signature that X rejects.
    expect(rfc3986("!*'()")).toBe("%21%2A%27%28%29");
    const withReserved = { status: "!*'()" };
    expect(
      signatureFrom(oauth1Header("POST", URL, CREDS, withReserved, { nonce: NONCE, timestamp: TIMESTAMP }))
    ).toBe(referenceSignature("POST", URL, CREDS, withReserved, NONCE, TIMESTAMP));
  });

  it("is deterministic for fixed inputs and varies when any signed input changes", () => {
    const sign = (method: string, params: Record<string, string>, nonce = NONCE) =>
      signatureFrom(oauth1Header(method, URL, CREDS, params, { nonce, timestamp: TIMESTAMP }));

    const base = sign("POST", PARAMS);
    expect(sign("POST", PARAMS)).toBe(base);
    expect(sign("GET", PARAMS)).not.toBe(base);
    expect(sign("POST", { ...PARAMS, status: "different" })).not.toBe(base);
    expect(sign("POST", PARAMS, "another-nonce")).not.toBe(base);
  });
});
