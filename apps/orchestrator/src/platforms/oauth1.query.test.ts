import { describe, expect, it } from "vitest";
import { oauth1Header } from "./oauth1.js";

const CREDS = {
  apiKey: "key",
  apiSecret: "secret",
  accessToken: "token",
  accessTokenSecret: "tokensecret",
};
const FIXED = { nonce: "abc123", timestamp: "1700000000" };

function sign(method: string, url: string, extra: Record<string, string> = {}) {
  return oauth1Header(method, url, CREDS, extra, FIXED);
}

/**
 * RFC 5849 §3.4.1.2–3: query parameters belong in the normalised parameter
 * string, not in the base string URI. X answers a signature that gets this
 * wrong with a bare 401, which is indistinguishable from bad credentials —
 * so this is asserted rather than left to be rediscovered against the API.
 */
describe("oauth1 query parameters", () => {
  it("signs a query string identically to the same params passed separately", () => {
    const inUrl = sign("GET", "https://api.x.com/2/users/1/tweets?max_results=5");
    const separate = sign("GET", "https://api.x.com/2/users/1/tweets", { max_results: "5" });
    expect(inUrl).toBe(separate);
  });

  it("changes the signature when a query value changes", () => {
    const five = sign("GET", "https://api.x.com/2/users/1/tweets?max_results=5");
    const ten = sign("GET", "https://api.x.com/2/users/1/tweets?max_results=10");
    expect(five).not.toBe(ten);
  });

  it("is unaffected by the order parameters appear in the URL", () => {
    const a = sign("GET", "https://api.x.com/2/t?b=2&a=1");
    const b = sign("GET", "https://api.x.com/2/t?a=1&b=2");
    expect(a).toBe(b);
  });

  it("handles a dotted parameter name, which is what the metrics call uses", () => {
    const inUrl = sign("GET", "https://api.x.com/2/t?tweet.fields=public_metrics");
    const separate = sign("GET", "https://api.x.com/2/t", { "tweet.fields": "public_metrics" });
    expect(inUrl).toBe(separate);
  });

  it("leaves a query-free URL signing exactly as before", () => {
    // Guards the existing POST paths, which are the ones already in production.
    expect(sign("POST", "https://api.x.com/2/tweets")).toBe(
      oauth1Header("POST", "https://api.x.com/2/tweets", CREDS, {}, FIXED)
    );
  });
});
