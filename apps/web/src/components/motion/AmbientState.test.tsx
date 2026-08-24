import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "@jarvis/shared";

const state = vi.hoisted(() => ({ sessions: [] as Array<{ status: SessionStatus }> }));

vi.mock("@/lib/hooks", () => ({
  useSessionsList: () => state,
}));

import { AmbientState } from "./AmbientState";

function ambient(): string | null {
  const { container } = render(<AmbientState />);
  return container.firstElementChild?.getAttribute("data-state") ?? null;
}

beforeEach(() => {
  state.sessions = [];
});

describe("AmbientState", () => {
  it("stays out of the way when nothing is running", () => {
    state.sessions = [{ status: "completed" }, { status: "idle" }];
    expect(ambient()).toBe("idle");
  });

  it("warms while work is running", () => {
    state.sessions = [{ status: "completed" }, { status: "running" }];
    expect(ambient()).toBe("working");
  });

  it("counts a session that is still starting as work", () => {
    state.sessions = [{ status: "starting" }];
    expect(ambient()).toBe("working");
  });

  it("puts a run waiting on you ahead of one merely running", () => {
    // A busy system must not bury the one thing that is blocked on a decision.
    state.sessions = [{ status: "running" }, { status: "waiting_permission" }];
    expect(ambient()).toBe("attention");
  });

  it("is hidden from screen readers, which already have the badge", () => {
    state.sessions = [{ status: "running" }];
    const { container } = render(<AmbientState />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("does not treat a failed run as ongoing work", () => {
    state.sessions = [{ status: "error" }, { status: "interrupted" }, { status: "stopped" }];
    expect(ambient()).toBe("idle");
  });
});
