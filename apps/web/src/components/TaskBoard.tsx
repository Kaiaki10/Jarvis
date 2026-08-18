"use client";

import { useState } from "react";
import { Plus, ArrowRight, Trash2 } from "lucide-react";
import type { TaskRecord, TaskStatus } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useMissionsList, useTasksList } from "@/lib/hooks";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

export function TaskBoard() {
  const { tasks, refresh } = useTasksList();
  const { missions } = useMissionsList();
  const missionById = new Map(missions.map((mission) => [mission.id, mission]));
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
    <Card>
      <CardHeader title="Human work queue" description="Deliberate tasks that stay under your control" />
      <div className="px-5 pb-4 flex gap-2">
        <Input
          className="flex-1"
          placeholder="Add a task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
        />
        <Button size="sm" onClick={addTask}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.status}>
            <div className="mb-2 flex items-center gap-1.5 text-label font-medium text-muted">
              {col.label}
              <span className="text-muted/60">
                {tasks.filter((t) => t.status === col.status).length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {tasks
                .filter((t) => t.status === col.status)
                .map((task) => (
                  <div
                    key={task.id}
                    className="group rounded-lg border border-border bg-white/[0.02] p-2.5 text-body"
                  >
                    <div className="text-foreground">{task.title}</div>
                    {task.missionId && missionById.get(task.missionId) && (
                      <Badge tone="accent" className="mt-1.5">
                        {missionById.get(task.missionId)!.title}
                      </Badge>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {COLUMNS.filter((c) => c.status !== col.status).map((c) => (
                        <button
                          key={c.status}
                          onClick={() => move(task, c.status)}
                          className="flex items-center gap-1 text-micro text-muted hover:text-accent-foreground"
                        >
                          <ArrowRight className="h-3 w-3" />
                          {c.label}
                        </button>
                      ))}
                      <button
                        onClick={() => remove(task)}
                        className="ml-auto text-muted hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              {tasks.filter((t) => t.status === col.status).length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-2.5 py-4 text-center text-label text-muted">
                  Empty
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
