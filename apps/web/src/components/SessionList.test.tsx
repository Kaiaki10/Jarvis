import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "@jarvis/shared";

const state = vi.hoisted(() => ({
  sessions: [] as SessionRecord[],
  loading: false,
  primarySessionId: null as string | null,
  removeSession: vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useSessionsList: () => ({
    sessions: state.sessions,
    loading: state.loading,
    primarySessionId: state.primarySessionId,
    removeSession: state.removeSession,
  }),
}));

import { SessionList } from "./SessionList";

function session(patch: Partial<SessionRecord> & { id: string; createdAt: string }): SessionRecord {
  return {
    agentId: null,
    claudeSessionId: null,
    codexThreadId: null,
    model: "claude",
    claudeModel: "default",
    autoApproveLocalTools: false,
    title: `Run ${patch.id}`,
    status: "idle",
    cwd: ".",
    permissionMode: "default",
    allowedTools: null,
    taskId: null,
    costUsd: null,
    turns: null,
    summary: null,
    currentActivity: null,
    errorMessage: null,
    updatedAt: patch.createdAt,
    ...patch,
  } as SessionRecord;
}

beforeEach(() => {
  state.sessions = [];
  state.loading = false;
  state.primarySessionId = null;
  state.removeSession = vi.fn();
});

describe("SessionList", () => {
  it("shows how long ago each run started", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    state.sessions = [session({ id: "a", createdAt: fiveMinutesAgo })];

    render(<SessionList />);

    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  it("excludes the primary conversation from the run list entirely", () => {
    const now = new Date().toISOString();
    state.sessions = [session({ id: "primary", createdAt: now })];
    state.primarySessionId = "primary";

    render(<SessionList />);

    expect(screen.queryByText("just now")).not.toBeInTheDocument();
  });
});
