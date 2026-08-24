import { describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: sdkMocks.query }));

/** A fake SDK query stream: yields `messages` in order, then optionally throws. */
function fakeQuery(messages: unknown[], thenThrow?: Error) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
      if (thenThrow) throw thenThrow;
    },
  };
}

/**
 * The Claude Agent SDK can crash during its own teardown right after a turn
 * already completed — observed either as a second `result` message (subtype
 * `error_during_execution`, num_turns 0, cost $0) or as the process exit
 * throwing past the for-await loop entirely. Either way, `handle.working` is
 * already false because the real result set it, and nothing has since
 * started a follow-up to flip it back — the signal sessionManager.ts uses to
 * tell "stray teardown artifact" apart from "a genuinely new turn failed".
 */
describe("startSession — teardown crash after a session already finished", () => {
  it("ignores a stray error result that arrives after a successful one", async () => {
    const { createSession, getSession } = await import("../db/repo.js");
    const { listNotifications } = await import("../notifications/notifier.js");
    const { startSession } = await import("./sessionManager.js");

    const session = createSession({ title: "Test run", cwd: ".", permissionMode: "default" });

    sdkMocks.query.mockReturnValue(
      fakeQuery([
        {
          type: "result",
          subtype: "success",
          is_error: false,
          num_turns: 3,
          total_cost_usd: 0.05,
          result: "Did the real work and committed it.",
          session_id: "sdk-session-1",
        },
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          num_turns: 0,
          total_cost_usd: 0,
          errors: ["Claude Code process exited with code 1"],
          session_id: "sdk-session-1",
        },
      ])
    );

    await startSession({ id: session.id, prompt: "do the thing", cwd: ".", permissionMode: "default", isolated: true });

    const after = getSession(session.id)!;
    expect(after.status).toBe("idle");
    expect(after.turns).toBe(3);
    expect(after.costUsd).toBe(0.05);

    expect(
      listNotifications().find((n) => n.sessionId === session.id && n.title === "Session failed")
    ).toBeUndefined();
  });

  it("ignores a crash that happens after a successful result, outside any result message", async () => {
    const { createSession, getSession } = await import("../db/repo.js");
    const { listNotifications } = await import("../notifications/notifier.js");
    const { startSession } = await import("./sessionManager.js");

    const session = createSession({ title: "Test run 2", cwd: ".", permissionMode: "default" });

    sdkMocks.query.mockReturnValue(
      fakeQuery(
        [
          {
            type: "result",
            subtype: "success",
            is_error: false,
            num_turns: 2,
            total_cost_usd: 0.02,
            result: "Committed the change.",
            session_id: "sdk-session-2",
          },
        ],
        new Error("Claude Code process exited with code 1")
      )
    );

    await startSession({ id: session.id, prompt: "do another thing", cwd: ".", permissionMode: "default", isolated: true });

    const after = getSession(session.id)!;
    expect(after.status).toBe("idle");
    expect(after.turns).toBe(2);
    expect(after.costUsd).toBe(0.02);

    expect(
      listNotifications().find((n) => n.sessionId === session.id && n.title === "Session failed to run")
    ).toBeUndefined();
  });

  it("still records a genuine first-turn failure", async () => {
    const { createSession, getSession } = await import("../db/repo.js");
    const { listNotifications } = await import("../notifications/notifier.js");
    const { startSession } = await import("./sessionManager.js");

    const session = createSession({ title: "Test run 3", cwd: ".", permissionMode: "default" });

    sdkMocks.query.mockReturnValue(
      fakeQuery([
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          num_turns: 0,
          total_cost_usd: 0,
          errors: ["Never got going."],
          session_id: "sdk-session-3",
        },
      ])
    );

    await startSession({ id: session.id, prompt: "do a third thing", cwd: ".", permissionMode: "default", isolated: true });

    const after = getSession(session.id)!;
    expect(after.status).toBe("error");

    expect(
      listNotifications().find((n) => n.sessionId === session.id && n.title === "Session failed")
    ).toBeDefined();
  });

  it("still records a genuine crash on a run that never produced a result", async () => {
    const { createSession, getSession } = await import("../db/repo.js");
    const { listNotifications } = await import("../notifications/notifier.js");
    const { startSession } = await import("./sessionManager.js");

    const session = createSession({ title: "Test run 4", cwd: ".", permissionMode: "default" });

    sdkMocks.query.mockReturnValue(fakeQuery([], new Error("Could not start the process.")));

    await startSession({ id: session.id, prompt: "do a fourth thing", cwd: ".", permissionMode: "default", isolated: true });

    const after = getSession(session.id)!;
    expect(after.status).toBe("error");
    expect(after.errorMessage).toBe("Could not start the process.");

    expect(
      listNotifications().find((n) => n.sessionId === session.id && n.title === "Session failed to run")
    ).toBeDefined();
  });
});
