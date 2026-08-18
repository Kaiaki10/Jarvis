import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the key file at a throwaway directory before the module initialises,
// so tests never touch the real jarvis.key.
beforeAll(() => {
  process.env.JARVIS_KEY_PATH = join(mkdtempSync(join(tmpdir(), "jarvis-test-")), "test.key");
});

const load = () => import("./secretStore.js");

describe("secretStore", () => {
  it("round-trips an object through encryption", async () => {
    const { encryptJson, decryptJson } = await load();
    const value = { botToken: "xoxb-abc-123", fromAddress: "hi@example.com" };
    expect(decryptJson(encryptJson(value))).toEqual(value);
  });

  it("does not leak plaintext into the ciphertext", async () => {
    const { encryptJson } = await load();
    const blob = encryptJson({ apiKey: "super-secret-value" });
    expect(blob).not.toContain("super-secret-value");
    expect(blob).not.toContain("apiKey");
  });

  it("produces a different blob each time, so repeats are not recognisable", async () => {
    const { encryptJson } = await load();
    const value = { apiKey: "same-input" };
    expect(encryptJson(value)).not.toBe(encryptJson(value));
  });

  it("rejects a tampered payload rather than returning garbage", async () => {
    const { encryptJson, decryptJson } = await load();
    const [iv, tag, data] = encryptJson({ apiKey: "abc" }).split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptJson(`${iv}:${tag}:${flipped.toString("base64")}`)).toThrow();
  });

  it("masks all but the last four characters", async () => {
    const { maskValue } = await load();
    expect(maskValue("xoxb-1234567890")).toBe("••••7890");
    expect(maskValue("")).toBe("");
  });
});
