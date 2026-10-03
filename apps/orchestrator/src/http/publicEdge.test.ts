import { describe, expect, it } from "vitest";
import { clientKey, isPublicPath, requestOrigin, viaTunnel } from "./publicEdge.js";

const tunnelled = { "cf-connecting-ip": "203.0.113.7", "x-forwarded-proto": "https" };

describe("public edge", () => {
  it("exposes only the widget and webhook routes", () => {
    expect(isPublicPath("/widget/customer-chat.js")).toBe(true);
    expect(isPublicPath("/widget")).toBe(true);
    expect(isPublicPath("/webhooks/stripe")).toBe(true);
    for (const path of ["/shutdown", "/health", "/auth/session", "/customers/1", "/widgets", "/webhooksx", "//shutdown", "/SHUTDOWN", "/"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("recognises tunnelled requests by Cloudflare's client IP header", () => {
    expect(viaTunnel(tunnelled)).toBe(true);
    expect(viaTunnel({})).toBe(false);
    expect(viaTunnel({ "cf-connecting-ip": "" })).toBe(false);
  });

  it("rate-limits by the visitor's IP when tunnelled, the socket otherwise", () => {
    expect(clientKey(tunnelled, "127.0.0.1")).toBe("203.0.113.7");
    expect(clientKey({}, "127.0.0.1")).toBe("127.0.0.1");
    // A forwarded-for header alone is not trusted: anyone can send one.
    expect(clientKey({ "x-forwarded-for": "198.51.100.1" }, "127.0.0.1")).toBe("127.0.0.1");
  });

  it("reports the HTTPS origin a tunnelled visitor used", () => {
    expect(requestOrigin(tunnelled, "http", "jarvis.husslesol.com")).toBe("https://jarvis.husslesol.com");
    expect(requestOrigin({ "x-forwarded-proto": "https" }, "http", "127.0.0.1:4317")).toBe("http://127.0.0.1:4317");
    expect(requestOrigin({ ...tunnelled, "x-forwarded-proto": "gopher" }, "http", "h")).toBe("http://h");
  });
});
