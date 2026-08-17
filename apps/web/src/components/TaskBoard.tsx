"use client";

import { useEffect, useState } from "react";
import type { TaskRecord, TaskStatus } from "@jarvis/shared";
import { api } from "@/lib/api";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

export function TaskBoard() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const refresh = () => api.listTasks().then(setTasks);

  useEffect(() => {
    refresh();
  }, []);

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
    <div className="rounded-lg border border-black/10 dark:border-white/15 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Tasks</h2>
      </div>
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          placeholder="Add a task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
        />
        <button
          onClick={addTask}
          className="rounded bg-foreground text-background px-3 py-1 text-sm"
        >
          Add
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {COLUMNS.map((col) => (
          <div key={col.status} className="min-h-[120px]">
            <div className="text-xs font-medium text-black/60 dark:text-white/60 mb-2">
              {col.label}
            </div>
            <div className="flex flex-col gap-2">
              {tasks
                .filter((t) => t.status === col.status)
                .map((task) => (
                  <div
                    key={task.id}
                    className="rounded border border-black/10 dark:border-white/15 p-2 text-sm"
                  >
                    <div>{task.title}</div>
                    <div className="flex gap-2 mt-2 text-xs text-black/50 dark:text-white/50">
                      {COLUMNS.filter((c) => c.status !== col.status).map((c) => (
                        <button
                          key={c.status}
                          onClick={() => move(task, c.status)}
                          className="underline"
                        >
                          → {c.label}
                        </button>
                      ))}
                      <button onClick={() => remove(task)} className="underline ml-auto">
                        delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
