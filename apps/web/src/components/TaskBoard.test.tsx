import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "@jarvis/shared";

const state = vi.hoisted(() => ({
  tasks: [] as TaskRecord[],
  refresh: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useTasksList: () => ({ tasks: state.tasks, refresh: state.refresh }),
  useMissionsList: () => ({ missions: [] }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    updateTask: (...args: unknown[]) => state.updateTask(...args),
    createTask: vi.fn(),
    deleteTask: vi.fn(),
  },
}));

import { TaskBoard } from "./TaskBoard";

function task(patch: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    title: `Task ${patch.id}`,
    status: "todo",
    missionId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  } as TaskRecord;
}

/** The column heading and its cards share a parent; this reads that group. */
function columnOf(title: string): string | null {
  const card = screen.getByText(title);
  const column = card.closest("div.grid > div");
  return column?.querySelector(".text-label")?.textContent ?? null;
}

beforeEach(() => {
  state.tasks = [task({ id: "a", title: "Write the thing" })];
  state.refresh = vi.fn();
  state.updateTask = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

describe("TaskBoard", () => {
  it("keeps a keyboard path to every column", () => {
    render(<TaskBoard />);
    expect(screen.getByRole("button", { name: /In progress/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Done/ })).toBeInTheDocument();
  });

  it("says what will fill each empty column instead of just 'Empty'", () => {
    render(<TaskBoard />);
    // "To do" holds the one seeded task, so only the other two are empty here.
    expect(screen.getByText("Nothing in progress — drag a task here to start it.")).toBeInTheDocument();
    expect(screen.getByText("Nothing done yet — finished tasks land here.")).toBeInTheDocument();
    expect(screen.queryByText("Empty")).not.toBeInTheDocument();
  });

  it("moves the card before the server confirms", async () => {
    // Never resolves, so the card is only where it is because of the
    // optimistic overlay — not because the round trip finished.
    state.updateTask = vi.fn(() => new Promise<void>(() => {}));
    render(<TaskBoard />);
    expect(columnOf("Write the thing")).toContain("To do");

    fireEvent.click(screen.getByRole("button", { name: /In progress/ }));
    await waitFor(() => expect(columnOf("Write the thing")).toContain("In progress"));
  });

  it("puts the card back when the write fails", async () => {
    let reject: (reason: Error) => void = () => {};
    state.updateTask = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    render(<TaskBoard />);

    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    // It has to actually get there first, or this would pass on a click that
    // did nothing at all.
    await waitFor(() => expect(columnOf("Write the thing")).toContain("Done"));

    reject(new Error("offline"));
    // A card left in the new column would be claiming something the server
    // never accepted.
    await waitFor(() => expect(columnOf("Write the thing")).toContain("To do"));
    expect(state.updateTask).toHaveBeenCalledWith("a", { status: "done" });
  });

  it("does not write when the card is already in that column", () => {
    render(<TaskBoard />);
    // "To do" is not offered for a card already in To do.
    expect(screen.queryByRole("button", { name: /To do/ })).not.toBeInTheDocument();
    expect(state.updateTask).not.toHaveBeenCalled();
  });
});
