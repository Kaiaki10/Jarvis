import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTaskRecord } from "@jarvis/shared";

const apiMocks = vi.hoisted(() => ({
  updateScheduledTask: vi.fn(),
  deleteScheduledTask: vi.fn(),
  rehearseScheduledTask: vi.fn(),
  createScheduledTask: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));

const state = vi.hoisted(() => ({
  tasks: [] as ScheduledTaskRecord[],
}));

vi.mock("@/lib/hooks", () => ({
  useScheduledTasksList: () => ({ tasks: state.tasks, refresh: vi.fn() }),
  useSettings: () => ({ settings: { automationsEnabled: true } }),
  useSessionsList: () => ({ sessionById: new Map() }),
}));

import { ScheduledTasksPanel } from "./ScheduledTasksPanel";

function task(patch: Partial<ScheduledTaskRecord> = {}): ScheduledTaskRecord {
  return {
    id: "task-1",
    agentId: null,
    prompt: "Follow AUTOMATION_RULES.md\n\nToday's job: grow test coverage.",
    cwd: "C:/jarvis-lab",
    permissionMode: "default",
    allowedTools: null,
    timeOfDay: "08:00",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
    lastRunAt: null,
    lastSessionId: null,
    nextRunAt: "2026-08-25T15:00:00.000Z",
    retryCount: 0,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...patch,
  };
}

beforeEach(() => {
  state.tasks = [task()];
  apiMocks.updateScheduledTask.mockReset().mockResolvedValue(undefined);
  apiMocks.deleteScheduledTask.mockReset().mockResolvedValue(undefined);
  apiMocks.rehearseScheduledTask.mockReset().mockResolvedValue({ checks: [], nextRuns: [], approvalRequired: false });
});

describe("ScheduledTasksPanel row disclosure", () => {
  it("is a real button carrying aria-expanded, not a <summary> with nested controls", () => {
    render(<ScheduledTasksPanel />);
    const toggle = screen.getByRole("button", { name: /expand details/i });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls");
  });

  it("expands on click and shows the run detail panel", () => {
    render(<ScheduledTasksPanel />);
    const toggle = screen.getByRole("button", { name: /expand details/i });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /collapse details/i })).toBe(toggle);
    expect(screen.getByText(/Runs 08:00/)).toBeVisible();
  });

  it("clicking anywhere else on the row also toggles it, same as the old <summary>", () => {
    render(<ScheduledTasksPanel />);
    const toggle = screen.getByRole("button", { name: /expand details/i });
    // The kind label sits in the row but is not itself a control.
    fireEvent.click(screen.getByText("Tests"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("the Pause button acts independently and does not also toggle the row", () => {
    render(<ScheduledTasksPanel />);
    const toggle = screen.getByRole("button", { name: /expand details/i });
    const pause = screen.getByRole("button", { name: "Pause" });

    fireEvent.click(pause);

    expect(apiMocks.updateScheduledTask).toHaveBeenCalledWith("task-1", { enabled: false });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("the Delete button acts independently and does not also toggle the row", () => {
    render(<ScheduledTasksPanel />);
    const toggle = screen.getByRole("button", { name: /expand details/i });
    const del = screen.getByRole("button", { name: "Delete" });

    fireEvent.click(del);

    expect(apiMocks.deleteScheduledTask).toHaveBeenCalledWith("task-1");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("the Pause and Delete buttons are not descendants of the toggle button", () => {
    render(<ScheduledTasksPanel />);
    const toggle = screen.getByRole("button", { name: /expand details/i });
    const pause = screen.getByRole("button", { name: "Pause" });
    // The exact defect axe's nested-interactive rule flags: an interactive
    // control that is a DOM descendant of another interactive control.
    expect(toggle.contains(pause)).toBe(false);
    expect(within(toggle).queryByRole("button", { name: "Pause" })).toBeNull();
  });
});
