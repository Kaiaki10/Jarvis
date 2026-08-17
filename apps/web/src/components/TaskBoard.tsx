"use client";

import { useState } from "react";
import type { TaskRecord, TaskStatus } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useTasksList } from "@/lib/hooks";
import { Panel } from "@/components/hud/Panel";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

export function TaskBoard() {
  const { tasks, refresh } = useTasksList();
  const [newTitle, setNewTitle] = useState("");

  async function addTask() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    await api.createTask(title);
    refresh();
  }

  async function move(task: TaskRecord, status: TaskStatus) {
    await api.updateTask(task.id, { status });
    refresh();
  }

  async function remove(task: TaskRecord) {
    await api.deleteTask(task.id);
    refresh();
  }

  return (
    <Panel title="TASK-LOG">
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 rounded-sm border border-cyan-500/25 bg-black/30 px-2 py-1.5 text-sm text-cyan-100 outline-none focus:border-cyan-400/60"
          placeholder="Add a task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
        />
        <button
          onClick={addTask}
          className="rounded-sm border border-cyan-400/50 bg-cyan-500/10 px-3 py-1 text-xs tracking-widest uppercase text-cyan-200 hover:bg-cyan-500/20"
        >
          Add
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {COLUMNS.map((col) => (
          <div key={col.status} className="min-h-[100px]">
            <div className="text-[10px] font-medium text-cyan-400/60 uppercase tracking-[0.2em] mb-2 pb-1 border-b border-cyan-500/10">
              {col.label}
              <span className="ml-1 text-cyan-500/30">
                [{tasks.filter((t) => t.status === col.status).length}]
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {tasks
                .filter((t) => t.status === col.status)
                .map((task) => (
                  <div
                    key={task.id}
                    className="rounded-sm border border-cyan-500/15 bg-black/20 p-2 text-sm text-cyan-100"
                  >
                    <div>{task.title}</div>
                    <div className="flex gap-2 mt-2 text-[10px] uppercase tracking-wider text-cyan-500/50">
                      {COLUMNS.filter((c) => c.status !== col.status).map((c) => (
                        <button
                          key={c.status}
                          onClick={() => move(task, c.status)}
                          className="hover:text-cyan-300"
                        >
                          → {c.label}
                        </button>
                      ))}
                      <button onClick={() => remove(task)} className="ml-auto hover:text-red-400">
                        delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
