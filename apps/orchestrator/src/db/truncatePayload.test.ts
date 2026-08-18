import { describe, it, expect } from "vitest";
import { truncatePayload } from "./repo.js";

const big = (bytes: number) => "x".repeat(bytes);

describe("truncatePayload", () => {
  it("leaves normal payloads untouched", () => {
    const payload = JSON.stringify({ type: "assistant", message: { content: "hi" } });
    expect(truncatePayload("assistant", payload)).toBe(payload);
  });

  it("truncates a payload past the cap", () => {
    const payload = JSON.stringify({ type: "user", data: big(200 * 1024) });
    const result = truncatePayload("user", payload);
    expect(result.length).toBeLessThan(payload.length);
    expect(JSON.parse(result)._truncated).toBe(true);
  });

  it("keeps the shape the transcript renders for user and assistant", () => {
    // The UI reads payload.message.content; losing it would break rendering
    // rather than merely shortening it.
    for (const type of ["user", "assistant"] as const) {
      const payload = JSON.stringify({ type, data: big(200 * 1024) });
      const parsed = JSON.parse(truncatePayload(type, payload));
      expect(parsed.type).toBe(type);
      expect(typeof parsed.message.content).toBe("string");
      expect(parsed.message.content).toContain("truncated");
    }
  });

  it("records the original size so the loss is visible", () => {
    const payload = JSON.stringify({ type: "user", data: big(200 * 1024) });
    expect(JSON.parse(truncatePayload("user", payload))._originalBytes).toBe(
      payload.length
    );
  });

  it("always produces valid JSON", () => {
    for (const type of ["user", "assistant", "stream_event", "result", "system"] as const) {
      const payload = JSON.stringify({ type, data: big(200 * 1024) });
      expect(() => JSON.parse(truncatePayload(type, payload))).not.toThrow();
    }
  });

  it("keeps the type discriminator on non-message events", () => {
    const payload = JSON.stringify({ type: "stream_event", data: big(200 * 1024) });
    expect(JSON.parse(truncatePayload("stream_event", payload)).type).toBe("stream_event");
  });

  it("does not truncate right at the boundary", () => {
    const justUnder = JSON.stringify({ t: big(64 * 1024 - 100) });
    expect(truncatePayload("system", justUnder)).toBe(justUnder);
  });
});
