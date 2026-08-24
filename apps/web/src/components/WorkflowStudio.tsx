"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDashed,
  FileText,
  Gift,
  LoaderCircle,
  Megaphone,
  MessageSquareText,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import type {
  WorkflowApprovalPolicy,
  WorkflowRecord,
  WorkflowStatus,
  ContentFormat,
  ContentItemRecord,
  ContentStatus,
  ContentPublicationRunRecord,
  MarketingChannel,
} from "@jarvis/shared";
import { api } from "@/lib/api";
import { useWorkflows, useConnections, useMissionsList } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { WorkflowStageRail } from "@/components/WorkflowStageRail";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Overlay as MotionOverlay, Pressable } from "@/components/motion";
import { useDialog } from "@/lib/useDialog";

const CHANNELS: Array<{ id: MarketingChannel; label: string }> = [
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "email", label: "Email" },
  { id: "blog", label: "Blog" },
];

const FORMAT_LABELS: Record<ContentFormat, string> = {
  social_post: "Social post",
  email: "Email",
  article: "Article",
  ad: "Ad",
};

const PIPELINE: Array<{ status: ContentStatus; label: string; detail: string; empty: string }> = [
  { status: "idea", label: "Ideas", detail: "Angles worth exploring", empty: "No angles yet — add content or generate with Jarvis above." },
  { status: "draft", label: "Drafts", detail: "Copy taking shape", empty: "Nothing drafting — an idea moves here once copy starts." },
  { status: "review", label: "Review", detail: "Waiting for judgment", empty: "Nothing to review — drafts land here when ready for judgment." },
  { status: "scheduled", label: "Scheduled", detail: "Ready on the calendar", empty: "Nothing scheduled — approved content lands here with a publish date." },
  { status: "published", label: "Published", detail: "Live in market", empty: "Nothing published yet — scheduled content goes live here." },
  { status: "measured", label: "Measured", detail: "Learning captured", empty: "Nothing measured yet — results land here once published content has data." },
];

const STATUS_TONE: Record<WorkflowStatus, "neutral" | "accent" | "success" | "warning"> = {
  draft: "neutral",
  active: "success",
  paused: "warning",
  completed: "accent",
  archived: "neutral",
};

export function WorkflowStudio() {
  const { overview, refresh } = useWorkflows();
  const { missions } = useMissionsList();
  const { connections } = useConnections();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const createDialog = useDialog();
  const generateDialog = useDialog();
  const addDialog = useDialog();
  const editDialog = useDialog();
  // Held past the close rather than cleared with it: clearing this is what used
  // to close the editor, and rendering nothing at that moment would make the
  // panel vanish instead of leave. `editDialog.open` decides visibility now.
  const [editing, setEditing] = useState<ContentItemRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!overview) {
    return (
      <Card className="flex items-center gap-3 px-5 py-5">
        <RefreshCw className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
        <span className="text-body text-muted">Opening the workflow workspace…</span>
      </Card>
    );
  }

  const workflow = overview.workflows.find((item) => item.id === selectedId) ?? overview.workflows[0] ?? null;
  const content = workflow ? overview.content.filter((item) => item.workflowId === workflow.id) : [];
  const runs = workflow ? overview.generationRuns.filter((run) => run.workflowId === workflow.id) : [];
  const activeCount = overview.workflows.filter((item) => item.status === "active").length;
  const reviewCount = overview.content.filter((item) => item.status === "review").length;
  const scheduledCount = overview.content.filter((item) => item.status === "scheduled").length;

  async function mutate(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jarvis could not complete that action.");
      throw reason;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <WorkflowPulse workflows={overview.workflows.length} active={activeCount} review={reviewCount} scheduled={scheduledCount} />

      {error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-label text-danger">{error}</div>}

      <div className="grid min-h-[680px] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div>
              <div className="text-heading text-foreground">Workflow portfolio</div>
              <div className="mt-0.5 text-micro text-muted">{overview.workflows.length} total</div>
            </div>
            <Button size="icon" variant="ghost" aria-label="New workflow" onClick={createDialog.show}>
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
          {overview.workflows.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <Megaphone className="h-6 w-6 text-muted" strokeWidth={1.5} />
              <div className="mt-3 text-body text-foreground">No workflows yet</div>
              <p className="mt-1 text-label text-muted">Give Jarvis an objective and an audience to begin.</p>
              <Button className="mt-4" size="sm" onClick={createDialog.show}><Plus className="h-3.5 w-3.5" /> Create workflow</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {overview.workflows.map((item) => {
                const count = overview.content.filter((entry) => entry.workflowId === item.id).length;
                const selected = item.id === workflow?.id;
                return (
                  <Pressable key={item.id} lift={1}>
                  <button
                    onClick={() => setSelectedId(item.id)}
                    className={`group w-full rounded-lg px-3 py-3 text-left transition-colors ${selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.status === "active" ? "bg-success" : item.status === "paused" ? "bg-warning" : "bg-muted"}`} />
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-body font-medium ${selected ? "text-foreground" : "text-foreground-secondary"}`}>{item.name}</div>
                        <div className="mt-1 line-clamp-2 text-micro text-muted">{item.objective}</div>
                        <div className="mt-2 flex items-center justify-between text-micro text-muted">
                          <span className="capitalize">{item.status}</span><span>{count} assets</span>
                        </div>
                      </div>
                      {selected && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-accent-bright" />}
                    </div>
                  </button>
                  </Pressable>
                );
              })}
            </div>
          )}
        </Card>

        {workflow ? (
          <div className="min-w-0 space-y-5">
            <WorkflowHeader
              workflow={workflow}
              contentCount={content.length}
              onStatus={(status) => mutate(() => api.updateWorkflow(workflow.id, { status }))}
              onGenerate={generateDialog.show}
              onAdd={addDialog.show}
            />

            <WorkflowStageRail workflow={workflow} overview={overview} onChanged={refresh} />

            <StrategyStrip workflow={workflow} missionName={missions.find((mission) => mission.id === workflow.missionId)?.title} />

            {runs[0]?.status === "running" && (
              <Card elevation={2} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <LoaderCircle className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="text-body text-foreground">Jarvis is creating {runs[0].requestedCount} assets</div>
                  <div className="text-micro text-muted">Drafts will enter the review pipeline automatically.</div>
                </div>
                <Link href={`/under-the-hood/brain/runs/${runs[0].sessionId}`} className="text-label text-accent-foreground hover:text-white">Watch the run →</Link>
              </Card>
            )}
            {runs[0]?.status === "failed" && (
              <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-label text-danger">
                The latest generation run needs attention: {runs[0].errorMessage || "No valid drafts were returned."} <Link className="underline" href={`/under-the-hood/brain/runs/${runs[0].sessionId}`}>Open run</Link>
              </div>
            )}

            <ContentPipeline content={content} publicationRuns={overview.publicationRuns} xConnected={connections.some((connection) => connection.platformId === "x" && connection.status === "connected")} onEdit={(item) => { setEditing(item); editDialog.show(); }} onPublish={async (item) => {
              await mutate(() => api.publishContentItem(item.id));
            }} onAdvance={async (item) => {
              const index = PIPELINE.findIndex((stage) => stage.status === item.status);
              const next = PIPELINE[index + 1]?.status;
              if (!next) return;
              if (next === "scheduled" && !item.scheduledFor) {
                setEditing(item);
                editDialog.show();
                return;
              }
              await mutate(() => api.updateContentItem(item.id, { status: next }));
            }} />
          </div>
        ) : (
          <Card className="flex min-h-[520px] flex-col items-center justify-center px-8 text-center">
            <CircleDashed className="h-8 w-8 text-muted" strokeWidth={1.5} />
            <h2 className="mt-4 text-title text-foreground">Build a workflow operating plan</h2>
            <p className="mt-2 max-w-md text-body text-muted">Jarvis will use the objective, audience, offer, channels, and success metric as guardrails for every generated asset.</p>
            <Button className="mt-5" onClick={createDialog.show}><Plus className="h-4 w-4" /> Create workflow</Button>
          </Card>
        )}
      </div>

      {/* Mounted whether or not they are showing, so closing is something you
          can see. `key` remounts each form on open, which conditional rendering
          used to do for free — without it a cancelled draft would still be
          sitting there next time. */}
      <WorkflowForm key={createDialog.key} open={createDialog.open} missions={missions} onClose={createDialog.hide} onCreated={async (created) => { await refresh(); setSelectedId(created.id); createDialog.hide(); }} />
      {workflow && <GenerationForm key={generateDialog.key} open={generateDialog.open} workflow={workflow} onClose={generateDialog.hide} onGenerate={async (body) => { await mutate(() => api.generateWorkflowContent(workflow.id, body)); generateDialog.hide(); }} />}
      {workflow && <ContentForm key={addDialog.key} open={addDialog.open} workflow={workflow} onClose={addDialog.hide} onSave={async (body) => { await mutate(() => api.createContentItem(workflow.id, body)); addDialog.hide(); }} />}
      {editing && workflow && <ContentEditor key={editDialog.key} open={editDialog.open} item={editing} workflow={workflow} onClose={editDialog.hide} onSave={async (patch) => { await mutate(() => api.updateContentItem(editing.id, patch)); editDialog.hide(); }} onDelete={async () => { await mutate(() => api.deleteContentItem(editing.id)); editDialog.hide(); }} />}
    </div>
  );
}

function WorkflowPulse({ workflows, active, review, scheduled }: { workflows: number; active: number; review: number; scheduled: number }) {
  return (
    <Card elevation={2} className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-accent/12 via-transparent to-transparent" />
      <div className="relative flex flex-wrap items-center gap-5 px-5 py-4">
        <div className="flex min-w-[260px] flex-1 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent-bright ring-1 ring-inset ring-accent/25"><Megaphone className="h-5 w-5" strokeWidth={1.75} /></span>
          <div><div className="text-title text-foreground">Workflow command</div><div className="mt-0.5 text-label text-muted">Create once. Coordinate every channel. Learn from the result.</div></div>
        </div>
        <PulseStat value={workflows} label="Workflows" />
        <PulseStat value={active} label="Active" tone="success" />
        <PulseStat value={review} label="To review" tone={review ? "warning" : undefined} />
        <PulseStat value={scheduled} label="Scheduled" tone="accent" />
      </div>
    </Card>
  );
}

function PulseStat({ value, label, tone }: { value: number; label: string; tone?: "success" | "warning" | "accent" }) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "accent" ? "text-accent-foreground" : "text-foreground";
  return <div className="min-w-20 border-l border-border pl-5"><div className={`text-title text-xl tabular-nums ${color}`}>{value}</div><div className="text-micro text-muted">{label}</div></div>;
}

function WorkflowHeader({ workflow, contentCount, onStatus, onGenerate, onAdd }: {
  workflow: WorkflowRecord;
  contentCount: number;
  onStatus: (status: WorkflowStatus) => Promise<unknown>;
  onGenerate: () => void;
  onAdd: () => void;
}) {
  return (
    <Card elevation={2} className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="min-w-[260px] flex-1">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[workflow.status]} dot>{workflow.status}</Badge><Badge>{contentCount} assets</Badge></div>
          <h2 className="mt-3 text-title text-xl text-foreground">{workflow.name}</h2>
          <p className="mt-1 max-w-3xl text-body text-foreground-secondary">{workflow.objective}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Workflow status" className="h-9 py-1.5 capitalize" value={workflow.status} onChange={(event) => void onStatus(event.target.value as WorkflowStatus)}>
            <option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="archived">Archived</option>
          </Select>
          <Button variant="secondary" onClick={onAdd}><PenLine className="h-4 w-4" /> Add content</Button>
          <Button onClick={onGenerate}><Sparkles className="h-4 w-4" /> Generate with Jarvis</Button>
        </div>
      </div>
    </Card>
  );
}

function StrategyStrip({ workflow, missionName }: { workflow: WorkflowRecord; missionName?: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      <StrategyCell icon={Users} label="Audience" value={workflow.audience} />
      <StrategyCell icon={Gift} label="Offer" value={workflow.offer} />
      <StrategyCell icon={BarChart3} label="Success metric" value={workflow.primaryMetric} />
      <StrategyCell icon={ShieldCheck} label="Execution boundary" value={`${workflow.approvalPolicy === "each_item" ? "Approve every asset" : "Approve workflow batches"}${missionName ? ` · ${missionName}` : ""}`} />
    </div>
  );
}

function StrategyCell({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return <Card className="flex min-w-0 gap-3 p-3.5"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} /><div className="min-w-0"><div className="text-micro font-medium uppercase tracking-wide text-muted">{label}</div><div className="mt-1 line-clamp-2 text-label text-foreground-secondary" title={value}>{value}</div></div></Card>;
}

function ContentPipeline({ content, publicationRuns, xConnected, onEdit, onAdvance, onPublish }: { content: ContentItemRecord[]; publicationRuns: ContentPublicationRunRecord[]; xConnected: boolean; onEdit: (item: ContentItemRecord) => void; onAdvance: (item: ContentItemRecord) => Promise<void>; onPublish: (item: ContentItemRecord) => Promise<void> }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Content pipeline" description="Every asset moves from an angle to a measurable result" icon={<FileText className="h-4 w-4" strokeWidth={1.75} />} />
      <div className="overflow-x-auto px-4 pb-5">
        <div className="grid min-w-[1140px] grid-cols-6 gap-2.5">
          {PIPELINE.map((stage, index) => {
            const items = content.filter((item) => item.status === stage.status);
            return (
              <section key={stage.status}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${stage.status === "review" && items.length ? "bg-warning" : stage.status === "published" || stage.status === "measured" ? "bg-success" : "bg-muted"}`} />
                  <div className="min-w-0 flex-1"><div className="text-heading text-foreground">{stage.label} <span className="ml-1 text-micro text-muted">{items.length}</span></div><div className="truncate text-micro text-muted">{stage.detail}</div></div>
                  {index < PIPELINE.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted/40" />}
                </div>
                <div className="flex min-h-[260px] flex-col gap-2 rounded-xl border border-border bg-black/10 p-2">
                  {items.map((item) => <ContentCard key={item.id} item={item} publicationRun={publicationRuns.find((run) => run.contentItemId === item.id)} xConnected={xConnected} onEdit={() => onEdit(item)} onAdvance={() => void onAdvance(item).catch(() => {})} onPublish={() => void onPublish(item).catch(() => {})} />)}
                  {items.length === 0 && <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 px-3 text-center text-micro text-muted">{stage.empty}</div>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function ContentCard({ item, publicationRun, xConnected, onEdit, onAdvance, onPublish }: { item: ContentItemRecord; publicationRun?: ContentPublicationRunRecord; xConnected: boolean; onEdit: () => void; onAdvance: () => void; onPublish: () => void }) {
  const terminal = item.status === "measured";
  const publishableToX = item.channel === "x" && ["review", "scheduled"].includes(item.status);
  return (
    <div className="group rounded-lg border border-border bg-surface-raised p-2.5 shadow-elev-1">
      <button className="w-full text-left" onClick={onEdit}>
        <div className="flex items-center justify-between gap-2"><Badge>{CHANNELS.find((channel) => channel.id === item.channel)?.label}</Badge><span className="text-micro text-muted">{FORMAT_LABELS[item.format]}</span></div>
        <div className="mt-2 line-clamp-2 text-heading text-foreground">{item.title}</div>
        <div className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-micro text-muted">{item.body}</div>
        {item.scheduledFor && <div className="mt-2 flex items-center gap-1 text-micro text-accent-foreground"><CalendarClock className="h-3 w-3" /> {new Date(item.scheduledFor).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
      </button>
      {publicationRun?.status === "running" && <Link href={`/under-the-hood/brain/runs/${publicationRun.sessionId}`} className="mt-2 flex items-center justify-end gap-1 border-t border-border pt-2 text-micro text-warning"><LoaderCircle className="h-3 w-3 animate-spin" /> Awaiting approval</Link>}
      {publicationRun?.status === "failed" && <Link href={`/under-the-hood/brain/runs/${publicationRun.sessionId}`} className="mt-2 flex items-center justify-end gap-1 border-t border-border pt-2 text-micro text-danger">Publishing blocked · inspect run</Link>}
      {publicationRun?.status !== "running" && publishableToX && <button disabled={!xConnected} title={!xConnected ? "Connect and test X first" : "Starts an approval-gated publishing run"} className="mt-2 flex w-full items-center justify-end gap-1 border-t border-border pt-2 text-micro text-accent-foreground hover:text-white disabled:text-muted" onClick={onPublish}><Send className="h-3 w-3" /> Publish with Jarvis</button>}
      {!terminal && !publishableToX && publicationRun?.status !== "running" && <button className="mt-2 flex w-full items-center justify-end gap-1 border-t border-border pt-2 text-micro text-muted hover:text-foreground" onClick={onAdvance}>{item.status === "review" ? "Approve" : item.status === "scheduled" ? "Mark published" : "Advance"}<ArrowRight className="h-3 w-3" /></button>}
    </div>
  );
}

/**
 * Delegates to the shared overlay, which brings the escape key and the
 * click-away this dialog never had, plus the entrance.
 *
 * Entrance only for now: these dialogs are still rendered conditionally by
 * their parent, which unmounts them before an exit could play. The ladder in
 * DESIGN_SYSTEM.md records what that would take.
 */
function Overlay({ open, children, onDismiss }: { open: boolean; children: React.ReactNode; onDismiss: () => void }) {
  return (
    <MotionOverlay open={open} onDismiss={onDismiss}>
      <div className="max-h-[90vh] overflow-y-auto">{children}</div>
    </MotionOverlay>
  );
}

function WorkflowForm({ open, missions, onClose, onCreated }: { open: boolean; missions: ReturnType<typeof useMissionsList>["missions"]; onClose: () => void; onCreated: (workflow: WorkflowRecord) => Promise<void> }) {
  const [name, setName] = useState(""); const [objective, setObjective] = useState(""); const [audience, setAudience] = useState(""); const [offer, setOffer] = useState(""); const [metric, setMetric] = useState("");
  const [channels, setChannels] = useState<MarketingChannel[]>(["linkedin"]); const [policy, setPolicy] = useState<WorkflowApprovalPolicy>("each_item"); const [missionId, setMissionId] = useState(""); const [saving, setSaving] = useState(false);
  const valid = name.trim() && objective.trim() && audience.trim() && offer.trim() && metric.trim() && channels.length;
  return <Overlay open={open} onDismiss={onClose}><Card elevation={2}><CardHeader title="Create a workflow" description="Define the strategy Jarvis must preserve across every asset" icon={<Target className="h-4 w-4" />} /><CardBody className="space-y-3">
    <Input autoFocus placeholder="Workflow name" value={name} onChange={(event) => setName(event.target.value)} className="w-full" />
    <Textarea rows={3} placeholder="Objective — what business result should this produce?" value={objective} onChange={(event) => setObjective(event.target.value)} className="w-full" />
    <div className="grid gap-3 sm:grid-cols-2"><Textarea rows={3} placeholder="Audience — who are we speaking to?" value={audience} onChange={(event) => setAudience(event.target.value)} /><Textarea rows={3} placeholder="Offer — what should they act on?" value={offer} onChange={(event) => setOffer(event.target.value)} /></div>
    <Input placeholder="Primary success metric" value={metric} onChange={(event) => setMetric(event.target.value)} className="w-full" />
    <div><div className="mb-2 text-label text-muted">Approved channels</div><div className="flex flex-wrap gap-2">{CHANNELS.map((channel) => { const active = channels.includes(channel.id); return <button key={channel.id} onClick={() => setChannels(active ? channels.filter((id) => id !== channel.id) : [...channels, channel.id])} className={`rounded-lg border px-3 py-2 text-label transition-colors ${active ? "border-accent/40 bg-accent/15 text-accent-foreground" : "border-border text-muted hover:border-border-strong"}`}>{active && <Check className="mr-1 inline h-3 w-3" />}{channel.label}</button>; })}</div></div>
    <div className="grid gap-3 sm:grid-cols-2"><Select value={policy} onChange={(event) => setPolicy(event.target.value as WorkflowApprovalPolicy)}><option value="each_item">Approve every asset</option><option value="workflow">Approve workflow batches</option></Select><Select value={missionId} onChange={(event) => setMissionId(event.target.value)}><option value="">No linked mission</option>{missions.filter((mission) => !["archived", "completed"].includes(mission.status)).map((mission) => <option value={mission.id} key={mission.id}>{mission.title}</option>)}</Select></div>
    <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!valid || saving} onClick={async () => { setSaving(true); try { await onCreated(await api.createWorkflow({ name: name.trim(), objective: objective.trim(), audience: audience.trim(), offer: offer.trim(), channels, primaryMetric: metric.trim(), approvalPolicy: policy, missionId: missionId || undefined })); } finally { setSaving(false); } }}>{saving ? "Creating…" : "Create workflow"}</Button></div>
  </CardBody></Card></Overlay>;
}

function GenerationForm({ open, workflow, onClose, onGenerate }: { open: boolean; workflow: WorkflowRecord; onClose: () => void; onGenerate: (body: { count: number; formats: ContentFormat[]; channels: MarketingChannel[]; direction?: string }) => Promise<void> }) {
  const defaults = useMemo<ContentFormat[]>(() => workflow.channels.includes("email") ? ["social_post", "email"] : workflow.channels.includes("blog") ? ["social_post", "article"] : ["social_post"], [workflow.channels]);
  const [count, setCount] = useState(4); const [formats, setFormats] = useState<ContentFormat[]>(defaults); const [channels, setChannels] = useState<MarketingChannel[]>(workflow.channels); const [direction, setDirection] = useState(""); const [saving, setSaving] = useState(false);
  return <Overlay open={open} onDismiss={onClose}><Card elevation={2}><CardHeader title="Generate with Jarvis" description="Create a coordinated batch without publishing anything" icon={<Sparkles className="h-4 w-4" />} /><CardBody className="space-y-4">
    <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5 text-label text-foreground-secondary"><ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-accent-bright" />Draft generation is non-publishing. Every asset enters the pipeline for review.</div>
    <label className="block"><span className="mb-1.5 block text-label text-muted">Number of assets</span><Input type="number" min={1} max={12} value={count} onChange={(event) => setCount(Number(event.target.value))} className="w-full" /></label>
    <ToggleSet label="Formats" options={(Object.entries(FORMAT_LABELS) as Array<[ContentFormat, string]>)} selected={formats} onChange={setFormats} />
    <ToggleSet label="Channels" options={CHANNELS.filter((channel) => workflow.channels.includes(channel.id)).map((channel) => [channel.id, channel.label])} selected={channels} onChange={setChannels} />
    <Textarea rows={4} className="w-full" placeholder="Optional creative direction, theme, promotion, or angle" value={direction} onChange={(event) => setDirection(event.target.value)} />
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={saving || count < 1 || count > 12 || !formats.length || !channels.length} onClick={async () => { setSaving(true); try { await onGenerate({ count, formats, channels, direction: direction.trim() || undefined }); } finally { setSaving(false); } }}><Sparkles className="h-4 w-4" /> {saving ? "Starting…" : "Create drafts"}</Button></div>
  </CardBody></Card></Overlay>;
}

function ToggleSet<T extends string>({ label, options, selected, onChange }: { label: string; options: Array<[T, string]>; selected: T[]; onChange: (next: T[]) => void }) {
  return <div><div className="mb-2 text-label text-muted">{label}</div><div className="flex flex-wrap gap-2">{options.map(([id, name]) => { const active = selected.includes(id); return <button key={id} onClick={() => onChange(active ? selected.filter((item) => item !== id) : [...selected, id])} className={`rounded-lg border px-3 py-2 text-label ${active ? "border-accent/40 bg-accent/15 text-accent-foreground" : "border-border text-muted hover:border-border-strong"}`}>{active && <Check className="mr-1 inline h-3 w-3" />}{name}</button>; })}</div></div>;
}

function ContentForm({ open, workflow, onClose, onSave }: { open: boolean; workflow: WorkflowRecord; onClose: () => void; onSave: (body: { title: string; body: string; format: ContentFormat; channel: MarketingChannel }) => Promise<void> }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [channel, setChannel] = useState(workflow.channels[0]); const [format, setFormat] = useState<ContentFormat>(workflow.channels[0] === "email" ? "email" : workflow.channels[0] === "blog" ? "article" : "social_post"); const [saving, setSaving] = useState(false);
  return <Overlay open={open} onDismiss={onClose}><Card elevation={2}><CardHeader title="Add content" description="Capture an idea or write a draft directly" icon={<PenLine className="h-4 w-4" />} /><CardBody className="space-y-3"><Input autoFocus className="w-full" placeholder="Internal title" value={title} onChange={(event) => setTitle(event.target.value)} /><div className="grid gap-3 sm:grid-cols-2"><Select value={channel} onChange={(event) => setChannel(event.target.value as MarketingChannel)}>{workflow.channels.map((id) => <option key={id} value={id}>{CHANNELS.find((item) => item.id === id)?.label}</option>)}</Select><Select value={format} onChange={(event) => setFormat(event.target.value as ContentFormat)}>{Object.entries(FORMAT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select></div><Textarea rows={9} className="w-full" placeholder="Write the full content draft" value={body} onChange={(event) => setBody(event.target.value)} /><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={saving || !title.trim() || !body.trim()} onClick={async () => { setSaving(true); try { await onSave({ title: title.trim(), body: body.trim(), format, channel }); } finally { setSaving(false); } }}>{saving ? "Saving…" : "Add draft"}</Button></div></CardBody></Card></Overlay>;
}

function ContentEditor({ open, item, workflow, onClose, onSave, onDelete }: { open: boolean; item: ContentItemRecord; workflow: WorkflowRecord; onClose: () => void; onSave: (patch: { title: string; body: string; format: ContentFormat; channel: MarketingChannel; status: ContentStatus; scheduledFor?: string | null; performanceSummary?: string | null }) => Promise<void>; onDelete: () => Promise<void> }) {
  const [title, setTitle] = useState(item.title); const [body, setBody] = useState(item.body); const [channel, setChannel] = useState(item.channel); const [format, setFormat] = useState(item.format); const [status, setStatus] = useState(item.status); const [scheduledFor, setScheduledFor] = useState(item.scheduledFor ? new Date(item.scheduledFor).toISOString().slice(0, 16) : ""); const [performance, setPerformance] = useState(item.performanceSummary ?? ""); const [saving, setSaving] = useState(false);
  const needsTime = status === "scheduled" && !scheduledFor;
  return <Overlay open={open} onDismiss={onClose}><Card elevation={2}><CardHeader title="Edit content" description="Refine the copy, approval state, schedule, and learning" icon={<MessageSquareText className="h-4 w-4" />} /><CardBody className="space-y-3"><Input className="w-full" value={title} onChange={(event) => setTitle(event.target.value)} /><div className="grid gap-3 sm:grid-cols-3"><Select value={channel} onChange={(event) => setChannel(event.target.value as MarketingChannel)}>{workflow.channels.map((id) => <option key={id} value={id}>{CHANNELS.find((entry) => entry.id === id)?.label}</option>)}</Select><Select value={format} onChange={(event) => setFormat(event.target.value as ContentFormat)}>{Object.entries(FORMAT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select><Select value={status} onChange={(event) => setStatus(event.target.value as ContentStatus)}>{PIPELINE.map((stage) => <option key={stage.status} value={stage.status} disabled={(stage.status === "published" && channel === "x" && !["published", "measured"].includes(item.status)) || (stage.status === "measured" && !["published", "measured"].includes(item.status))}>{stage.status === "published" && channel === "x" ? "Published via Jarvis" : stage.label}</option>)}</Select></div><Textarea rows={10} className="w-full" value={body} onChange={(event) => setBody(event.target.value)} />
    {(status === "scheduled" || scheduledFor) && <label className="block"><span className="mb-1.5 block text-label text-muted">Publishing time</span><Input type="datetime-local" className="w-full" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />{needsTime && <span className="mt-1 block text-micro text-warning">A scheduled asset needs a publishing time.</span>}</label>}
    {(status === "published" || status === "measured" || performance) && <Textarea rows={3} className="w-full" placeholder="Performance summary — result, signal, and what Jarvis should learn" value={performance} onChange={(event) => setPerformance(event.target.value)} />}
    <div className="flex items-center justify-between pt-2"><Button variant="destructive" size="sm" onClick={() => void onDelete()}><Trash2 className="h-3.5 w-3.5" /> Delete</Button><div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={saving || needsTime || !title.trim() || !body.trim()} onClick={async () => { setSaving(true); try { await onSave({ title: title.trim(), body: body.trim(), format, channel, status, scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null, performanceSummary: performance.trim() || null }); } finally { setSaving(false); } }}>{saving ? "Saving…" : "Save changes"}</Button></div></div>
  </CardBody></Card></Overlay>;
}
