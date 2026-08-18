import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaWebhook, verifyXWebhook, xCrcResponse } from "./webhooks.js";

describe("customer webhook verification", () => {
  const raw = Buffer.from('{"event":"message"}');
  const signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("base64")}`;

  it("verifies X signatures and CRC responses", () => {
    expect(verifyXWebhook("secret", raw, signature)).toBe(true);
    expect(verifyXWebhook("wrong", raw, signature)).toBe(false);
    expect(xCrcResponse("secret", "challenge")).toMatch(/^sha256=/);
  });

  it("verifies Meta signatures without accepting a near match", () => {
    const metaSignature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
    expect(verifyMetaWebhook("secret", raw, metaSignature)).toBe(true);
    expect(verifyMetaWebhook("secret", raw, `${metaSignature}x`)).toBe(false);
  });
});
