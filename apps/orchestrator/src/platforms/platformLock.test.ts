import { describe, expect, it } from "vitest";
import { withPlatformLock } from "./platformLock.js";

describe("withPlatformLock", () => {
  it("serializes actions for the same platform", async () => {
    let active = 0;
    let maximum = 0;
    const action = () =>
      withPlatformLock("x", async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
      });

    await Promise.all([action(), action(), action()]);
    expect(maximum).toBe(1);
  });

  it("does not block unrelated platforms", async () => {
    let release!: () => void;
    const blocked = withPlatformLock("x", () => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const slack = withPlatformLock("slack", async () => "sent");

    await expect(slack).resolves.toBe("sent");
    release();
    await blocked;
  });
});
