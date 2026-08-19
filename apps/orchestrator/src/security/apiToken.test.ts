import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.JARVIS_TOKEN_PATH = join(
    mkdtempSync(join(tmpdir(), "jarvis-token-")),
    "jarvis.token"
  );
});

describe("apiToken", () => {
  it("generates a token on first use and reuses it afterwards", async () => {
    const { apiToken } = await import("./apiToken.js");
    const first = apiToken();

    expect(first.length).toBeGreaterThan(20);
    // Stable across calls, and actually written to disk — a token regenerated
    // per process would log the dashboard out on every restart.
    expect(apiToken()).toBe(first);
    expect(readFileSync(process.env.JARVIS_TOKEN_PATH!, "utf-8").trim()).toBe(first);
  });

  it("is url-safe, so it survives being put in a query string", async () => {
    const { apiToken } = await import("./apiToken.js");
    const token = apiToken();
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("accepts the real token and rejects everything else", async () => {
    const { apiToken, isValidToken } = await import("./apiToken.js");
    const token = apiToken();

    expect(isValidToken(token)).toBe(true);
    expect(isValidToken(undefined)).toBe(false);
    expect(isValidToken("")).toBe(false);
    expect(isValidToken("wrong")).toBe(false);
    // A prefix must not pass — length is checked before the comparison, and a
    // truncated token is the shape a guessing attack produces.
    expect(isValidToken(token.slice(0, -1))).toBe(false);
    expect(isValidToken(token + "x")).toBe(false);
  });

  it("reads the token from a header, a bearer prefix, or the query string", async () => {
    const { tokenFromRequest } = await import("./apiToken.js");

    expect(
      tokenFromRequest({ headers: { authorization: "Bearer abc" }, query: {} })
    ).toBe("abc");
    expect(tokenFromRequest({ headers: { "x-jarvis-token": "abc" }, query: {} })).toBe("abc");
    // EventSource cannot set headers, so the stream endpoints depend on this.
    expect(tokenFromRequest({ headers: {}, query: { token: "abc" } })).toBe("abc");
    expect(tokenFromRequest({ headers: {}, query: {} })).toBeUndefined();
    // A bare Authorization value without the scheme is not a bearer token.
    expect(tokenFromRequest({ headers: { authorization: "abc" }, query: {} })).toBeUndefined();
  });

  it("adopts a token that already exists rather than replacing it", async () => {
    // A fresh module registry, so loadToken runs again against a seeded file.
    const dir = mkdtempSync(join(tmpdir(), "jarvis-token-existing-"));
    const path = join(dir, "jarvis.token");
    writeFileSync(path, "pre-existing-token-value\n");
    process.env.JARVIS_TOKEN_PATH = path;

    vi.resetModules();
    const { apiToken } = await import("./apiToken.js");
    // Overwriting would invalidate every dashboard tab on an ordinary restart.
    expect(apiToken()).toBe("pre-existing-token-value");
  });
});
