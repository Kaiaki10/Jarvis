import { describe, expect, it } from "vitest";
import { isAllowedOrigin, isUnauthenticatedPath } from "./authGuard.js";

const ALLOWED = ["http://localhost:3000", "http://localhost:3100"];

describe("isUnauthenticatedPath", () => {
  it("exempts exactly the routes that cannot carry a token", () => {
    expect(isUnauthenticatedPath("/health")).toBe(true);
    expect(isUnauthenticatedPath("/shutdown")).toBe(true);
    expect(isUnauthenticatedPath("/widget/config")).toBe(true);
    expect(isUnauthenticatedPath("/webhooks/resend")).toBe(true);
  });

  it("protects everything else, including the routes that spend money", () => {
    for (const path of [
      "/sessions",
      "/chat",
      "/agents",
      "/memories",
      "/connections",
      "/settings",
      "/events",
      "/campaigns",
      "/paid-growth",
    ]) {
      expect(isUnauthenticatedPath(path)).toBe(false);
    }
  });

  it("does not exempt a path that merely starts with an exempt word", () => {
    // The prefix match is on path segments. Without that, `/healthcheck-export`
    // or `/widgets-admin` would slip past the token check by name alone.
    expect(isUnauthenticatedPath("/healthcheck")).toBe(false);
    expect(isUnauthenticatedPath("/widgets")).toBe(false);
    expect(isUnauthenticatedPath("/shutdown-all")).toBe(false);
    expect(isUnauthenticatedPath("/webhooksecret")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("allows the dashboard and the preview build", () => {
    expect(isAllowedOrigin("http://localhost:3000", ALLOWED)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3100", ALLOWED)).toBe(true);
  });

  it("rejects a drive-by page on any other origin", () => {
    // The attack this exists for: a site the user is browsing POSTs to the
    // loopback port. CORS would hide the response but not stop the effect.
    expect(isAllowedOrigin("https://evil.example", ALLOWED)).toBe(false);
    expect(isAllowedOrigin("null", ALLOWED)).toBe(false);
    // A different port on the same host is still a different origin.
    expect(isAllowedOrigin("http://localhost:9999", ALLOWED)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000.evil.example", ALLOWED)).toBe(false);
  });

  it("allows a request with no Origin at all", () => {
    // curl, the restart script, and provider webhooks arrive this way. They are
    // covered by the token check or by their own payload signatures instead.
    expect(isAllowedOrigin(undefined, ALLOWED)).toBe(true);
  });
});
