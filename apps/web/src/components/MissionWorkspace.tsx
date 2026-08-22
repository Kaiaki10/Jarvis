"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  Flag,
  ListPlus,
  Plus,
  Sparkles,
  AlertTriangle,
  Clock3,
  X,
} from "lucide-react";
import type { MissionRecord, MissionStatus, TaskStatus } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useMissionsList, useTasksList } from "@/lib/hooks";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";

const STATUS_META: Record<MissionStatus, { label: string; tone: "neutral" | "accent" | "success" | "warning" }> = {
  planned: { label: "Planned", tone: "neutral" },
  active: { label: "Active", tone: "accent" },
  blocked: { label: "Blocked", tone: "warning" },
  completed: { label: "Complete", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

function dateLabel(value: string | null) {
  if (!value) return "No target date";
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: new Date(value).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function MissionWorkspace() {
  const { missions, deliverables, updates, refresh: refreshMissions } = useMissionsList();
  const { tasks, refresh: refreshTasks } = useTasksList();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => missions.filter((mission) => mission.status !== "archived"), [missions]);

  async function create() {
    if (!title.trim() || !outcome.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createMission({
        title: title.trim(),
        outcome: outcome.trim(),
        targetDate: targetDate || undefined,
      });
      setTitle("");
      setOutcome("");
      setTargetDate("");
      setCreating(false);
      await refreshMissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the mission.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {creating ? (
        <Card elevation={2}>
          <CardHeader
            title="New mission"
            description="Define success first. Jarvis can help work out the steps afterward."
            icon={<Flag className="h-4 w-4" strokeWidth={1.75} />}
          />
          <CardBody className="flex flex-col gap-3">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Mission name" autoFocus />
            <Textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What must be true when this is finished?" rows={3} />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-label text-muted">
                Target
                <Input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
              </label>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
                <Button disabled={busy || !title.trim() || !outcome.trim()} onClick={create}>
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                  Create mission
                </Button>
              </div>
            </div>
            {error && <p className="text-label text-danger">{error}</p>}
          </CardBody>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            New mission
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <Flag className="mb-3 h-6 w-6 text-muted" strokeWidth={1.5} />
          <div className="text-body font-medium text-foreground">No missions yet</div>
          <p className="mt-1 max-w-md text-label text-muted">
            Turn an important outcome into a mission. Tasks, runs, decisions, and deliverables will stay connected to it.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>Create the first mission</Button>
        </Card>
      ) : (
        visible.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            tasks={tasks.filter((task) => task.missionId === mission.id)}
            deliverables={deliverables.filter((item) => item.missionId === mission.id)}
            updates={updates.filter((item) => item.missionId === mission.id)}
            refresh={async () => Promise.all([refreshMissions(), refreshTasks()]).then(() => undefined)}
          />
        ))
      )}
    </div>
  );
}

function MissionCard({ mission, tasks, deliverables, updates, refresh }: {
  mission: MissionRecord;
  tasks: ReturnType<typeof useTasksList>["tasks"];
  deliverables: ReturnType<typeof useMissionsList>["deliverables"];
  updates: ReturnType<typeof useMissionsList>["updates"];
  refresh: () => Promise<void>;
}) {
  const [taskTitle, setTaskTitle] = useState("");
  const [deliverableTitle, setDeliverableTitle] = useState("");
  const [nextAction, setNextAction] = useState(mission.nextAction ?? "");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const completed = tasks.filter((task) => task.status === "done").length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const meta = STATUS_META[mission.status];
  const pendingUpdates = updates.filter((update) => update.status === "proposed");
  const latestApplied = updates.find((update) => update.status === "applied");

  async function updateStatus(status: MissionStatus) {
    await api.updateMission(mission.id, { status });
    await refresh();
  }

  async function addTask() {
    if (!taskTitle.trim()) return;
    await api.createTask(taskTitle.trim(), undefined, mission.id);
    setTaskTitle("");
    await refresh();
  }

  async function moveTask(id: string, status: TaskStatus) {
    await api.updateTask(id, { status });
    await refresh();
  }

  async function addDeliverable() {
    if (!deliverableTitle.trim()) return;
    await api.createDeliverable(mission.id, { title: deliverableTitle.trim() });
    setDeliverableTitle("");
    await refresh();
  }

  async function advanceMission() {
    setLaunching(true);
    setLaunchError(null);
    try {
      await api.advanceMission(mission.id);
      await refresh();
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Could not launch Jarvis.");
    } finally {
      setLaunching(false);
    }
  }

  async function reviewUpdate(id: string, decision: "apply" | "dismiss") {
    const result = await api.reviewMissionUpdate(id, decision);
    if (decision === "apply") setNextAction(result.mission.nextAction ?? "");
    await refresh();
  }

  return (
    <Card elevation={mission.status === "active" || mission.status === "blocked" ? 2 : 1}>
      <div className="px-5 pt-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={meta.tone} dot pulse={mission.status === "active"}>{meta.label}</Badge>
              <span className="flex items-center gap-1 text-micro text-muted">
                <Calendar className="h-3 w-3" strokeWidth={1.75} />
                {dateLabel(mission.targetDate)}
              </span>
            </div>
            <h2 className="text-title text-foreground">{mission.title}</h2>
            <p className="mt-1 max-w-3xl text-body text-foreground-secondary">{mission.outcome}</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={mission.status} onChange={(event) => void updateStatus(event.target.value as MissionStatus)} className="h-8 py-1 text-label">
              {Object.entries(STATUS_META).map(([status, value]) => <option key={status} value={status}>{value.label}</option>)}
            </Select>
            <Button size="sm" disabled={launching} onClick={() => void advanceMission()}>
              <Sparkles className="h-3.5 w-3.5" />
              {launching ? "Launching…" : "Advance with Jarvis"}
            </Button>
          </div>
        </div>
        {launchError && <p className="mt-2 text-label text-danger">{launchError}</p>}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-bright transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-micro text-muted">
          <span>{completed} of {tasks.length} steps complete</span>
          <span>{progress}%</span>
        </div>
      </div>

      {pendingUpdates.length > 0 && (
        <div className="mx-5 mt-4 flex flex-col gap-2">
          {pendingUpdates.map((update) => (
            <div key={update.id} className="rounded-xl border border-accent/30 bg-accent/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-bright" strokeWidth={1.75} />
                <span className="text-heading text-foreground">Jarvis proposes a mission update</span>
                <Badge tone="accent">Review</Badge>
                <Link href={`/under-the-hood/brain/runs/${update.sessionId}`} className="ml-auto flex items-center gap-1 text-micro text-muted hover:text-foreground">
                  <Clock3 className="h-3 w-3" /> View run
                </Link>
              </div>
              <p className="mt-2 text-body text-foreground-secondary">{update.summary}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {update.proposedNextAction && (
                  <div className="rounded-lg border border-border bg-black/15 px-3 py-2">
                    <div className="text-micro font-medium uppercase text-muted">Proposed next action</div>
                    <div className="mt-1 text-label text-foreground">{update.proposedNextAction}</div>
                  </div>
                )}
                {update.blocker && (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-micro font-medium uppercase text-warning"><AlertTriangle className="h-3 w-3" /> Blocker</div>
                    <div className="mt-1 text-label text-foreground">{update.blocker}</div>
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void reviewUpdate(update.id, "apply")}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Apply update
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void reviewUpdate(update.id, "dismiss")}>
                  <X className="h-3.5 w-3.5" /> Dismiss
                </Button>
                <span className="text-micro text-muted">
                  Step completed{update.artifactCount ? ` · ${update.artifactCount} artifact${update.artifactCount === 1 ? "" : "s"} captured` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingUpdates.length === 0 && latestApplied && (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-border bg-white/[0.02] px-3 py-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="text-micro font-medium uppercase text-muted">Latest accepted progress</div>
            <div className="mt-0.5 text-label text-foreground-secondary">{latestApplied.summary}</div>
          </div>
          <Link href={`/under-the-hood/brain/runs/${latestApplied.sessionId}`} className="shrink-0 text-micro text-muted hover:text-foreground">View run →</Link>
        </div>
      )}

      <div className="mt-4 grid border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-border">
        <section className="p-5">
          <div className="mb-3 flex items-center gap-2 text-heading text-foreground">
            <CircleDot className="h-4 w-4 text-accent-bright" strokeWidth={1.75} />
            Plan
          </div>
          <div className="mb-3 flex gap-2">
            <Input className="min-w-0 flex-1" placeholder="Add the next step…" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void addTask()} />
            <Button size="icon" variant="secondary" aria-label="Add step" onClick={() => void addTask()}><ListPlus className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {tasks.length === 0 && <p className="py-3 text-center text-label text-muted">Add a step or let Jarvis propose the plan.</p>}
            {tasks.map((task) => (
              <button key={task.id} className="group flex items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04]" onClick={() => void moveTask(task.id, task.status === "done" ? "todo" : "done")}>
                <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${task.status === "done" ? "text-success" : "text-muted"}`} strokeWidth={1.75} />
                <span className={`text-body ${task.status === "done" ? "text-muted line-through" : "text-foreground"}`}>{task.title}</span>
              </button>
            ))}
          </div>
          <label className="mt-4 block text-micro font-medium text-muted">NEXT ACTION</label>
          <div className="mt-1 flex gap-2">
            <Input className="min-w-0 flex-1" value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="The single most useful next move" />
            <Button size="sm" variant="secondary" onClick={async () => { await api.updateMission(mission.id, { nextAction: nextAction.trim() || null }); await refresh(); }}>Save</Button>
          </div>
        </section>

        <section className="border-t border-border p-5 lg:border-t-0">
          <div className="mb-3 flex items-center gap-2 text-heading text-foreground">
            <FileCheck2 className="h-4 w-4 text-success" strokeWidth={1.75} />
            Deliverables
          </div>
          <div className="mb-3 flex gap-2">
            <Input className="min-w-0 flex-1" placeholder="Document, report, build, decision…" value={deliverableTitle} onChange={(event) => setDeliverableTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void addDeliverable()} />
            <Button size="icon" variant="secondary" aria-label="Add deliverable" onClick={() => void addDeliverable()}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-col gap-2">
            {deliverables.length === 0 && <p className="py-3 text-center text-label text-muted">Nothing promised yet. Define what completion should produce.</p>}
            {deliverables.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-white/[0.02] px-3 py-2.5">
                <FileCheck2 className={`h-4 w-4 ${item.status === "approved" ? "text-success" : "text-muted"}`} strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-foreground">{item.title}</span>
                  {item.uri && !item.uri.startsWith("http") && <span className="block truncate font-mono text-micro text-muted" title={item.uri}>{item.uri}</span>}
                </span>
                {item.uri && item.uri.startsWith("http") && <a href={item.uri} target="_blank" rel="noreferrer" className="text-muted hover:text-foreground"><ArrowUpRight className="h-3.5 w-3.5" /></a>}
                <Select className="h-7 py-0 text-micro" value={item.status} onChange={async (event) => { await api.updateDeliverable(item.id, { status: event.target.value as "draft" | "ready" | "approved" }); await refresh(); }}>
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="approved">Approved</option>
                </Select>
              </div>
            ))}
          </div>
          <button className="mt-5 flex items-center gap-1.5 text-micro text-muted hover:text-foreground" onClick={() => void updateStatus("archived")}>
            <Archive className="h-3.5 w-3.5" /> Archive mission
          </button>
        </section>
      </div>
    </Card>
  );
}
