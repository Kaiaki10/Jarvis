"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Plus, ArrowRight, Trash2 } from "lucide-react";
import type { TaskRecord, TaskStatus } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useMissionsList, useTasksList } from "@/lib/hooks";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { spring } from "@/components/motion";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

/**
 * Viewport coordinates for a drag that just ended.
 *
 * Motion's `info.point` is in page coordinates, which stop agreeing with
 * `getBoundingClientRect` the moment the page is scrolled — and this board sits
 * below a page header, so it always is. Reading the originating event keeps
 * both sides in the same coordinate space.
 */
function viewportPoint(
  event: MouseEvent | TouchEvent | PointerEvent
): { x: number; y: number } | null {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

export function TaskBoard() {
  const { tasks, refresh } = useTasksList();
  const { missions } = useMissionsList();
  const missionById = new Map(missions.map((mission) => [mission.id, mission]));
  const [newTitle, setNewTitle] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);

  /**
   * Moves the server has not confirmed yet.
   *
   * Without this a dropped card springs back to the column it came from, sits
   * there for the length of the round trip, then jumps to its new column — the
   * exact "the page redrew" feeling that direct manipulation is meant to
   * remove. The card lands where you put it, and only moves back if the write
   * actually fails.
   */
  const [pending, setPending] = useState<Record<string, TaskStatus>>({});

  // Drop the optimistic entry once the store agrees with it, so a task that is
  // later moved elsewhere — by another tab, or by Jarvis — is not pinned here.
  useEffect(() => {
    setPending((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const task of tasks) {
        if (next[task.id] === task.status) {
          delete next[task.id];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [tasks]);

  /**
   * Dragging is an addition, never the only way through.
   *
   * On a coarse pointer a 2D drag needs `touch-action: none`, which would take
   * vertical page scrolling away from anyone whose thumb happens to land on a
   * card. The move buttons do the same job on every device, so the drag simply
   * does not arm where it would cost more than it gives. Starts off, so the
   * server render and the first client render agree.
   */
  const [canDrag, setCanDrag] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    const update = () => setCanDrag(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const columnRefs = useRef<Partial<Record<TaskStatus, HTMLDivElement | null>>>({});

  const columnAt = useCallback((x: number, y: number): TaskStatus | null => {
    for (const column of COLUMNS) {
      const el = columnRefs.current[column.status];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return column.status;
      }
    }
    return null;
  }, []);

  async function addTask() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    await api.createTask(title);
    refresh();
  }

  async function move(task: TaskRecord, status: TaskStatus) {
    if (task.status === status) return;
    setPending((previous) => ({ ...previous, [task.id]: status }));
    try {
      await api.updateTask(task.id, { status });
      refresh();
    } catch {
      // Put it back. A card that stays where you dropped it after the write
      // failed is a lie about what the server holds.
      setPending((previous) => {
        const next = { ...previous };
        delete next[task.id];
        return next;
      });
    }
  }

  async function remove(task: TaskRecord) {
    await api.deleteTask(task.id);
    refresh();
  }

  const view = tasks.map((task) =>
    pending[task.id] ? { ...task, status: pending[task.id] } : task
  );

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
        {COLUMNS.map((col) => {
          const items = view.filter((t) => t.status === col.status);
          return (
            <div key={col.status}>
              <div className="mb-2 flex items-center gap-1.5 text-label font-medium text-muted">
                {col.label}
                <span className="text-muted/60">{items.length}</span>
              </div>
              {/* Every column lights up for the whole drag rather than only the
                  one under the pointer. Tracking the pointer would mean state
                  on every frame of the drag; saying "these are the places this
                  can go" answers the same question once. */}
              <div
                ref={(el) => {
                  columnRefs.current[col.status] = el;
                }}
                className={`flex min-h-24 flex-col gap-2 rounded-lg transition-colors ${
                  dragging
                    ? "bg-accent/[0.04] outline-1 outline-offset-4 outline-dashed outline-accent/30"
                    : ""
                }`}
              >
                {items.map((task) => (
                  <motion.div
                    key={task.id}
                    layout
                    layoutId={task.id}
                    transition={spring.gentle}
                    drag={canDrag}
                    dragSnapToOrigin
                    dragElastic={0.14}
                    // Overshoot and settle rather than stopping dead, so a card
                    // released mid-air behaves like an object with weight.
                    dragTransition={{ bounceStiffness: 420, bounceDamping: 30 }}
                    whileDrag={{ scale: 1.03, zIndex: 30 }}
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={(event) => {
                      setDragging(null);
                      const point = viewportPoint(event as PointerEvent);
                      if (!point) return;
                      const target = columnAt(point.x, point.y);
                      if (target) void move(task, target);
                    }}
                    className={`group rounded-lg border border-border bg-white/[0.02] p-2.5 text-body ${
                      canDrag ? "cursor-grab active:cursor-grabbing" : ""
                    }`}
                  >
                    <div className="text-foreground">{task.title}</div>
                    {task.missionId && missionById.get(task.missionId) && (
                      <Badge tone="accent" className="mt-1.5">
                        {missionById.get(task.missionId)!.title}
                      </Badge>
                    )}
                    {/* Revealed on hover alone, these were unreachable by
                        keyboard and invisible on touch — which is exactly where
                        dragging is switched off. Focus reveals them, and below
                        `sm` they stay put. */}
                    <div className="mt-1.5 flex items-center gap-2 opacity-100 transition-opacity group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
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
                        aria-label={`Delete task: ${task.title}`}
                        className="ml-auto text-muted hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
                {items.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border px-2.5 py-4 text-center text-label text-muted">
                    {dragging ? "Drop here" : "Empty"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
