"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  Check,
  ChevronRight,
  CircleDashed,
  Clapperboard,
  ImagePlus,
  LoaderCircle,
  Megaphone,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import type {
  BrandRecord,
  BrandStageStatus,
  ContentFormat,
  MarketingChannel,
  VisualPromptKind,
  VisualPromptRecord,
  VisualPromptStatus,
  WorkflowRecord,
} from "@jarvis/shared";
import { brandStages } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useBrands, useConnections, useWorkflows } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Overlay as MotionOverlay } from "@/components/motion";
import { useDialog } from "@/lib/useDialog";

const KINDS: Array<{ id: VisualPromptKind; label: string }> = [
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "voiceover", label: "Voiceover" },
];

const CHANNELS: Array<{ id: MarketingChannel; label: string }> = [
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "email", label: "Email" },
  { id: "blog", label: "Blog" },
];

const STAGES: Array<{ status: VisualPromptStatus; label: string; empty: string }> = [
  { status: "draft", label: "Drafts", empty: "No scripts yet — write one or generate with Jarvis." },
  { status: "approved", label: "Approved", empty: "Nothing approved — approving a script authorizes its generation." },
  { status: "generating", label: "Generating", empty: "Nothing generating right now." },
  { status: "generated", label: "Generated", empty: "No finished visuals yet." },
  { status: "rejected", label: "Rejected", empty: "Nothing rejected." },
];

const STATUS_TONE: Record<VisualPromptStatus, "neutral" | "accent" | "success" | "warning"> = {
  draft: "neutral",
  approved: "accent",
  generating: "warning",
  generated: "success",
  rejected: "neutral",
};

function BrandLogo({ file, name, size = "md" }: { file: string | null; name: string; size?: "sm" | "md" | "lg" }) {
  // Keyed by file at every call site, so a change of logo remounts rather
  // than flashing the previous brand's mark while the new one loads.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    let objectUrl: string | null = null;
    api.fetchImageObjectUrl(file).then((created) => {
      if (!live) {
        URL.revokeObjectURL(created);
        return;
      }
      objectUrl = created;
      setUrl(created);
    }).catch(() => {});
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  const box = size === "lg" ? "h-16 w-16 rounded-2xl text-xl" : size === "sm" ? "h-8 w-8 rounded-lg text-label" : "h-11 w-11 rounded-xl text-title";
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={`${name} logo`} className={`${box} shrink-0 object-cover ring-1 ring-inset ring-border`} />;
  }
  return (
    <span className={`${box} flex shrink-0 items-center justify-center bg-accent/15 font-bold text-accent-bright ring-1 ring-inset ring-accent/25`}>
      {(name.trim()[0] ?? "B").toUpperCase()}
    </span>
  );
}

export function MarketingCenter() {
  const { overview, refresh } = useBrands();
  const { overview: workflows, refresh: refreshWorkflows } = useWorkflows();
  const { connections } = useConnections();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createDialog = useDialog();
  const scriptsDialog = useDialog();
  const editBrandDialog = useDialog();
  const campaignDialog = useDialog();
  const manualDialog = useDialog();

  if (!overview) {
    return (
      <Card className="flex items-center gap-3 px-5 py-5">
        <RefreshCw className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
        <span className="text-body text-muted">Opening the marketing workspace…</span>
      </Card>
    );
  }

  const brand = overview.brands.find((item) => item.id === selectedId) ?? overview.brands[0] ?? null;
  const prompts = brand ? overview.prompts.filter((item) => item.brandId === brand.id) : [];
  const brandRuns = brand ? overview.runs.filter((run) => run.brandId === brand.id) : [];
  const campaigns = brand && workflows ? workflows.workflows.filter((item) => item.brandId === brand.id) : [];
  const artlist = connections.find((connection) => connection.platformId === "artlist");
  const artlistReady = artlist?.status === "connected";

  const draftCount = prompts.filter((item) => item.status === "draft").length;
  const approvedCount = prompts.filter((item) => item.status === "approved").length;

  async function mutate(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await Promise.all([refresh(), refreshWorkflows()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jarvis could not complete that action.");
      throw reason;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card elevation={2} className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-accent/12 via-transparent to-transparent" />
        <div className="relative flex flex-wrap items-center gap-5 px-5 py-4">
          <div className="flex min-w-[260px] flex-1 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent-bright ring-1 ring-inset ring-accent/25"><Megaphone className="h-5 w-5" strokeWidth={1.75} /></span>
            <div><div className="text-title text-foreground">Marketing</div><div className="mt-0.5 text-label text-muted">One brand at a time. Nothing generates until you approve the script.</div></div>
          </div>
          <PulseStat value={overview.brands.length} label="Brands" />
          <PulseStat value={approvedCount} label="Approved" tone={approvedCount ? "accent" : undefined} />
          <PulseStat value={draftCount} label="To review" tone={draftCount ? "warning" : "success"} />
        </div>
      </Card>

      {error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-label text-danger">{error}</div>}

      {!artlistReady && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-label text-foreground-secondary">
          <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-warning" strokeWidth={1.75} />
          Artlist is {artlist ? "not connected" : "not set up"} — scripts can be written and approved now, but generation stays unavailable until it is. <Link className="text-accent-foreground underline" href="/under-the-hood/connections/artlist">Connect Artlist →</Link>
        </div>
      )}

      <div className="grid min-h-[640px] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div>
              <div className="text-heading text-foreground">Brands</div>
              <div className="mt-0.5 text-micro text-muted">{overview.brands.length} total</div>
            </div>
            <Button size="icon" variant="ghost" aria-label="New brand" onClick={createDialog.show}>
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
          {overview.brands.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <Building2 className="h-6 w-6 text-muted" strokeWidth={1.5} />
              <div className="mt-3 text-body text-foreground">No brands yet</div>
              <p className="mt-1 text-label text-muted">Describe the business, pick a logo, and start scripting.</p>
              <Button className="mt-4" size="sm" onClick={createDialog.show}><Plus className="h-3.5 w-3.5" /> Create brand</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {overview.brands.map((item) => {
                const count = overview.prompts.filter((entry) => entry.brandId === item.id).length;
                const waiting = overview.prompts.filter((entry) => entry.brandId === item.id && entry.status === "draft").length;
                const selected = item.id === brand?.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <BrandLogo key={item.logoFile ?? item.id} file={item.logoFile} name={item.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-body font-medium ${selected ? "text-foreground" : "text-foreground-secondary"}`}>{item.name}</div>
                        <div className="mt-1 line-clamp-2 text-micro text-muted">{item.description || "No description yet"}</div>
                        <div className="mt-2 flex items-center justify-between text-micro text-muted">
                          <span>{count} scripts</span>{waiting > 0 && <span className="text-warning">{waiting} to review</span>}
                        </div>
                      </div>
                      {selected && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-accent-bright" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {brand ? (
          <BrandDetail
            brand={brand}
            prompts={prompts}
            runs={brandRuns}
            campaigns={campaigns}
            publishedContent={workflows ? countPublished(workflows.workflows, workflows.content, brand.id) : 0}
            artlistReady={artlistReady}
            onScripts={scriptsDialog.show}
            onNewScript={manualDialog.show}
            onEditBrand={editBrandDialog.show}
            onNewCampaign={campaignDialog.show}
            onChanged={refresh}
            onError={setError}
          />
        ) : (
          <Card className="flex min-h-[520px] flex-col items-center justify-center px-8 text-center">
            <CircleDashed className="h-8 w-8 text-muted" strokeWidth={1.5} />
            <h2 className="mt-4 text-title text-foreground">Market something real</h2>
            <p className="mt-2 max-w-md text-body text-muted">A brand holds the description and logo Jarvis writes every script against.</p>
            <Button className="mt-5" onClick={createDialog.show}><Plus className="h-4 w-4" /> Create brand</Button>
          </Card>
        )}
      </div>

      <BrandForm
        key={createDialog.key}
        open={createDialog.open}
        onClose={createDialog.hide}
        onCreated={async (created) => { await refresh(); setSelectedId(created.id); createDialog.hide(); }}
      />
      {brand && (
        <BrandForm
          key={editBrandDialog.key}
          open={editBrandDialog.open}
          brand={brand}
          onClose={editBrandDialog.hide}
          onCreated={async () => { await refresh(); editBrandDialog.hide(); }}
        />
      )}
      {brand && (
        <ScriptsForm
          key={scriptsDialog.key}
          open={scriptsDialog.open}
          brand={brand}
          onClose={scriptsDialog.hide}
          onStarted={async (brandId, body) => { await mutate(() => api.generateVisualPrompts(brandId, body)); scriptsDialog.hide(); }}
        />
      )}
      {brand && (
        <PromptCreateForm
          key={manualDialog.key}
          open={manualDialog.open}
          onClose={manualDialog.hide}
          onCreated={async (body) => { await mutate(() => api.createVisualPrompt(brand.id, body)); manualDialog.hide(); }}
        />
      )}
      {brand && (
        <CampaignForm
          key={campaignDialog.key}
          open={campaignDialog.open}
          brand={brand}
          onClose={campaignDialog.hide}
          onCreated={async (body) => { await mutate(() => api.createWorkflow({ ...body, brandId: brand.id })); campaignDialog.hide(); }}
        />
      )}
    </div>
  );
}

function countPublished(
  allWorkflows: WorkflowRecord[],
  content: { workflowId: string; status: string }[],
  brandId: string
): number {
  const ids = new Set(allWorkflows.filter((item) => item.brandId === brandId).map((item) => item.id));
  return content.filter((item) => ids.has(item.workflowId) && ["published", "measured"].includes(item.status)).length;
}

function PulseStat({ value, label, tone }: { value: number; label: string; tone?: "success" | "warning" | "accent" }) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "accent" ? "text-accent-foreground" : "text-foreground";
  return <div className="min-w-20 border-l border-border pl-5"><div className={`text-title text-xl tabular-nums ${color}`}>{value}</div><div className="text-micro text-muted">{label}</div></div>;
}

function BrandDetail({ brand, prompts, runs, campaigns, publishedContent, artlistReady, onScripts, onNewScript, onEditBrand, onNewCampaign, onChanged, onError }: {
  brand: BrandRecord;
  prompts: VisualPromptRecord[];
  runs: { sessionId: string; status: string; kind: string }[];
  campaigns: WorkflowRecord[];
  publishedContent: number;
  artlistReady: boolean;
  onScripts: () => void;
  onNewScript: () => void;
  onEditBrand: () => void;
  onNewCampaign: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [confirmGenerateId, setConfirmGenerateId] = useState<string | null>(null);
  const [confirmDeleteBrand, setConfirmDeleteBrand] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<VisualPromptRecord | null>(null);
  const [sending, setSending] = useState<VisualPromptRecord | null>(null);
  const editDialog = useDialog();
  const sendDialog = useDialog();
  const running = runs.find((run) => run.status === "running");

  const stages: BrandStageStatus[] = brandStages({
    hasDescription: brand.description.trim().length > 0,
    hasLogo: !!brand.logoFile,
    artlistConnected: artlistReady,
    draftCount: prompts.filter((item) => item.status === "draft").length,
    approvedCount: prompts.filter((item) => ["approved", "generating"].includes(item.status)).length,
    generatedCount: prompts.filter((item) => item.status === "generated").length,
    publishedContent,
    campaignCount: campaigns.length,
  });

  async function mutate(action: () => Promise<unknown>) {
    onError(null);
    try {
      await action();
      await onChanged();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Jarvis could not complete that action.");
    }
  }

  async function generate(prompt: VisualPromptRecord) {
    if (confirmGenerateId !== prompt.id) {
      setConfirmGenerateId(prompt.id);
      return;
    }
    setConfirmGenerateId(null);
    setBusyId(prompt.id);
    try {
      await mutate(() => api.executeVisualPrompt(prompt.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      <Card elevation={2} className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 p-5">
          <BrandLogo key={brand.logoFile ?? brand.id} file={brand.logoFile} name={brand.name} size="lg" />
          <div className="min-w-[240px] flex-1">
            <h2 className="text-title text-xl text-foreground">{brand.name}</h2>
            <p className="mt-1 max-w-3xl text-body text-foreground-secondary">{brand.description || "No description yet — add one so scripts have something to stand on."}</p>
            {brand.website && <div className="mt-1 text-label text-muted">{brand.website}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onEditBrand}><PenLine className="h-4 w-4" /> Edit brand</Button>
            <Button variant="secondary" onClick={onNewScript}><Plus className="h-4 w-4" /> New script</Button>
            <Button onClick={onScripts}><Sparkles className="h-4 w-4" /> Generate with Jarvis</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-5">
          {stages.map((stage) => (
            <div key={stage.key} className="bg-card px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${stage.state === "done" ? "bg-success" : stage.state === "ready" ? "bg-warning" : "bg-muted"}`} />
                <span className="text-micro font-medium uppercase tracking-wide text-muted">{stage.number}. {stage.label}</span>
              </div>
              <div className="mt-1 text-label leading-snug text-foreground-secondary">{stage.detail}</div>
            </div>
          ))}
        </div>
      </Card>

      <NextAction
        stages={stages}
        approvedCount={prompts.filter((item) => item.status === "approved").length}
        campaignCount={campaigns.length}
        onEditBrand={onEditBrand}
        onScripts={onScripts}
        onNewCampaign={onNewCampaign}
      />

      {running && (
        <Card elevation={2} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <LoaderCircle className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="text-body text-foreground">{running.kind === "scripts" ? "Jarvis is writing scripts" : "Jarvis is generating on Artlist"}</div>
            <div className="text-micro text-muted">{running.kind === "scripts" ? "Drafts will appear below for review — nothing generates yet." : "The spend approval fires inside the run."}</div>
          </div>
          <Link href={`/under-the-hood/brain/runs/${running.sessionId}`} className="text-label text-accent-foreground hover:text-white">Watch the run →</Link>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="Campaigns" description="One brand, many pushes — each campaign publishes from this brand's visuals" icon={<Megaphone className="h-4 w-4" strokeWidth={1.75} />} />
        <div className="flex flex-col gap-2 px-5 pb-5">
          {campaigns.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-label text-muted">
              No campaigns yet — create the first push for {brand.name}.
            </div>
          )}
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white/[0.02] px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body font-medium text-foreground">{campaign.name}</span>
                  <Badge tone={campaign.status === "active" ? "success" : "neutral"}>{campaign.status}</Badge>
                </div>
                <div className="mt-0.5 line-clamp-1 text-label text-muted">{campaign.objective}</div>
              </div>
              <Link href="/under-the-hood/workflows" className="text-label text-accent-foreground hover:text-white">Open campaign →</Link>
            </div>
          ))}
          <div><Button variant="secondary" size="sm" onClick={onNewCampaign}><Plus className="h-3.5 w-3.5" /> New campaign</Button></div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Script pipeline" description="Draft → approve → generate. Approval is the money gate." icon={<Clapperboard className="h-4 w-4" strokeWidth={1.75} />} />
        <div className="grid gap-2.5 px-4 pb-5 md:grid-cols-2 2xl:grid-cols-5">
          {STAGES.map((stage) => {
            const items = prompts.filter((item) => item.status === stage.status);
            return (
              <section key={stage.status}>
                <div className="mb-2 px-1"><div className="text-heading text-foreground">{stage.label} <span className="ml-1 text-micro text-muted">{items.length}</span></div></div>
                <div className="flex min-h-[220px] flex-col gap-2 rounded-xl border border-border bg-black/10 p-2">
                  {items.map((item) => (
                    <PromptCard
                      key={item.id}
                      item={item}
                      artlistReady={artlistReady}
                      confirming={confirmGenerateId === item.id}
                      busy={busyId === item.id}
                      onApprove={() => void mutate(() => api.updateVisualPrompt(item.id, { status: "approved" }))}
                      onReject={() => void mutate(() => api.updateVisualPrompt(item.id, { status: "rejected" }))}
                      onDraft={() => { setConfirmGenerateId(null); void mutate(() => api.updateVisualPrompt(item.id, { status: "draft" })); }}
                      onDelete={() => void mutate(() => api.deleteVisualPrompt(item.id))}
                      onEdit={() => { setEditing(item); editDialog.show(); }}
                      onFork={() => void mutate(() => api.createVisualPrompt(brand.id, {
                        title: `Next: ${item.title}`.slice(0, 200),
                        body: item.body,
                        kind: item.kind,
                        model: item.model ?? undefined,
                        referenceImageIds: item.referenceImageIds,
                        parentId: item.id,
                      }))}
                      onRate={(rating) => void mutate(() => api.updateVisualPrompt(item.id, { rating }))}
                      onGenerate={() => void generate(item)}
                      onSend={() => { setSending(item); sendDialog.show(); }}
                    />
                  ))}
                  {items.length === 0 && <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 px-3 text-center text-micro text-muted">{stage.empty}</div>}
                </div>
              </section>
            );
          })}
        </div>
      </Card>

      <div className="flex justify-end">
        <button
          className="text-micro text-muted hover:text-danger"
          onClick={() => {
            if (!confirmDeleteBrand) {
              setConfirmDeleteBrand(true);
              return;
            }
            setConfirmDeleteBrand(false);
            void mutate(() => api.deleteBrand(brand.id));
          }}
        >
          {confirmDeleteBrand ? `Confirm — delete ${brand.name} and its scripts?` : `Delete ${brand.name}`}
        </button>
      </div>

      {editing && (
        <PromptEditor
          key={editDialog.key}
          open={editDialog.open}
          item={editing}
          onClose={editDialog.hide}
          onSave={async (patch) => { await mutate(() => api.updateVisualPrompt(editing.id, patch)); editDialog.hide(); }}
        />
      )}
      {sending && sending.resultFile && (
        <SendToCampaign
          key={sendDialog.key}
          open={sendDialog.open}
          prompt={sending}
          campaigns={campaigns}
          onClose={sendDialog.hide}
          onSent={async (workflowId, body) => { await mutate(() => api.sendVisualToCampaign(sending.id, { workflowId, ...body })); sendDialog.hide(); }}
        />
      )}
    </div>
  );
}

/**
 * One guided step: the first rail stage that is not done yet, with the single
 * action that moves it. Stages without a single action (approve, generate)
 * get a hint pointing at the pipeline below instead of a dead button.
 */
function NextAction({ stages, approvedCount, campaignCount, onEditBrand, onScripts, onNewCampaign }: {
  stages: BrandStageStatus[];
  approvedCount: number;
  campaignCount: number;
  onEditBrand: () => void;
  onScripts: () => void;
  onNewCampaign: () => void;
}) {
  const next = stages.find((stage) => stage.state !== "done");
  if (!next) {
    return (
      <Card elevation={2} className="flex flex-wrap items-center gap-3 px-5 py-4">
        <BadgeCheck className="h-5 w-5 text-success" strokeWidth={1.75} />
        <div>
          <div className="text-body font-medium text-foreground">This brand is fully live</div>
          <div className="text-label text-muted">Keep rating finished visuals — that is what teaches the next batch.</div>
        </div>
      </Card>
    );
  }
  const action =
    next.key === "setup" ? { label: "Complete brand setup", run: onEditBrand } :
    next.key === "artlist" ? null :
    next.key === "scripts" ? { label: "Generate scripts", run: onScripts } :
    next.key === "publish" && campaignCount === 0 ? { label: "Create first campaign", run: onNewCampaign } :
    null;
  const hint =
    next.key === "visuals"
      ? approvedCount > 0
        ? "Press Generate on an approved card below — the spend tap fires inside the run."
        : "Approve a script below. Generation starts only from approved."
      : next.key === "publish"
        ? "Send a generated visual to a campaign, then publish from the campaign studio."
        : null;
  return (
    <Card elevation={2} className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-accent/10 via-transparent to-transparent" />
      <div className="relative flex flex-wrap items-center gap-4 px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent-bright ring-1 ring-inset ring-accent/25"><Sparkles className="h-5 w-5" strokeWidth={1.75} /></span>
        <div className="min-w-[240px] flex-1">
          <div className="text-micro font-medium uppercase tracking-wide text-muted">Next: {next.label}</div>
          <div className="mt-0.5 text-body text-foreground">{hint ?? next.detail}</div>
        </div>
        {action && <Button onClick={action.run}>{action.label}</Button>}
        {next.key === "artlist" && (
          <Link href="/under-the-hood/connections/artlist"><Button>Connect Artlist</Button></Link>
        )}
      </div>
    </Card>
  );
}

function PromptCard({ item, artlistReady, confirming, busy, onApprove, onReject, onDraft, onDelete, onEdit, onFork, onRate, onGenerate, onSend }: {
  item: VisualPromptRecord;
  artlistReady: boolean;
  confirming: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDraft: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onFork: () => void;
  onRate: (rating: "keep" | "needs_work" | null) => void;
  onGenerate: () => void;
  onSend: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-2.5 shadow-elev-1">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
        <span className="text-micro capitalize text-muted">{item.kind}{item.model ? ` · ${item.model}` : ""}</span>
      </div>
      <div className="mt-2 line-clamp-2 text-heading text-foreground">{item.title}</div>
      <div className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-micro text-muted">{item.body}</div>
      {item.resultFile && <ResultThumb file={item.resultFile} title={item.title} />}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5 border-t border-border pt-2">
        {(item.status === "draft" || item.status === "generated") && (
          <button className="flex items-center gap-1 text-micro text-muted hover:text-foreground" onClick={onEdit}><PenLine className="h-3 w-3" /> Edit</button>
        )}
        <button className="flex items-center gap-1 text-micro text-muted hover:text-foreground" title="Fork this script into a new draft iteration" onClick={onFork}><Plus className="h-3 w-3" /> Fork</button>
        {item.status === "draft" && (
          <>
            <button className="flex items-center gap-1 text-micro text-muted hover:text-foreground" onClick={onReject}><XCircle className="h-3 w-3" /> Reject</button>
            <button className="flex items-center gap-1 text-micro text-accent-foreground hover:text-white" onClick={onApprove}><BadgeCheck className="h-3 w-3" /> Approve</button>
          </>
        )}
        {item.status === "approved" && (
          <>
            <button className="flex items-center gap-1 text-micro text-muted hover:text-foreground" onClick={onDraft}><Undo2 className="h-3 w-3" /> Draft</button>
            <button
              disabled={!artlistReady || busy}
              title={!artlistReady ? "Connect Artlist first" : "Starts the Artlist run — spends credits after your tap"}
              className="flex items-center gap-1 text-micro text-accent-foreground hover:text-white disabled:text-muted"
              onClick={onGenerate}
            >
              {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {busy ? "Starting…" : confirming ? "Confirm — spends credits" : "Generate"}
            </button>
          </>
        )}
        {item.status === "generated" && item.resultFile && (
          <button className="flex items-center gap-1 text-micro text-accent-foreground hover:text-white" onClick={onSend}><Send className="h-3 w-3" /> To campaign</button>
        )}
        {item.status === "generated" && (
          <>
            <button
              className={`flex items-center gap-1 text-micro ${item.rating === "keep" ? "text-success" : "text-muted hover:text-foreground"}`}
              title="This style works — future scripts will match it"
              onClick={() => onRate(item.rating === "keep" ? null : "keep")}
            ><ThumbsUp className="h-3 w-3" /> Keep</button>
            <button
              className={`flex items-center gap-1 text-micro ${item.rating === "needs_work" ? "text-warning" : "text-muted hover:text-foreground"}`}
              title="Exclude from the style signal"
              onClick={() => onRate(item.rating === "needs_work" ? null : "needs_work")}
            ><ThumbsDown className="h-3 w-3" /></button>
          </>
        )}
        {item.status === "rejected" && (
          <button className="flex items-center gap-1 text-micro text-muted hover:text-foreground" onClick={onDraft}><Undo2 className="h-3 w-3" /> Back to draft</button>
        )}
        {(item.status === "draft" || item.status === "rejected") && (
          <button className="flex items-center gap-1 text-micro text-muted hover:text-danger" onClick={onDelete}><Trash2 className="h-3 w-3" /></button>
        )}
      </div>
    </div>
  );
}

function ResultThumb({ file, title }: { file: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    api.fetchImageObjectUrl(file).then((created) => {
      if (!live) {
        URL.revokeObjectURL(created);
        return;
      }
      objectUrl = created;
      setUrl(created);
    }).catch(() => {});
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  if (!url) return <div className="mt-2 text-micro text-muted">Result: {file}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={title} className="mt-2 w-full rounded-lg object-cover ring-1 ring-inset ring-border" />;
}

function Overlay({ open, children, onDismiss }: { open: boolean; children: React.ReactNode; onDismiss: () => void }) {
  return (
    <MotionOverlay open={open} onDismiss={onDismiss}>
      <div className="max-h-[90vh] overflow-y-auto">{children}</div>
    </MotionOverlay>
  );
}

function useImages(open: boolean) {
  const [images, setImages] = useState<Array<{ fileName: string }>>([]);
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    api.getImages().then((result) => {
      setImages(result.images);
      setFolder(result.folder);
    }).catch(() => {});
  }, [open]);
  return { images, folder };
}

function BrandForm({ open, brand, onClose, onCreated }: {
  open: boolean;
  brand?: BrandRecord;
  onClose: () => void;
  onCreated: (brand: BrandRecord) => Promise<void>;
}) {
  const [name, setName] = useState(brand?.name ?? "");
  const [description, setDescription] = useState(brand?.description ?? "");
  const [website, setWebsite] = useState(brand?.website ?? "");
  const [logoFile, setLogoFile] = useState(brand?.logoFile ?? "");
  const [saving, setSaving] = useState(false);
  const { images, folder } = useImages(open);
  const valid = name.trim() && description.trim();
  return (
    <Overlay open={open} onDismiss={onClose}>
      <Card elevation={2}>
        <CardHeader
          title={brand ? `Edit ${brand.name}` : "Create a brand"}
          description="The description seeds every script. The logo appears across the UI."
          icon={<Building2 className="h-4 w-4" />}
        />
        <CardBody className="space-y-3">
          <Input autoFocus placeholder="Brand name — e.g. HussleSol" value={name} onChange={(event) => setName(event.target.value)} className="w-full" />
          <Textarea rows={4} placeholder="What does this business do, who is it for, and how should it sound?" value={description} onChange={(event) => setDescription(event.target.value)} className="w-full" />
          <Input placeholder="Website (optional)" value={website} onChange={(event) => setWebsite(event.target.value)} className="w-full" />
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-label text-muted"><ImagePlus className="h-3.5 w-3.5" /> Logo — drop the file here first, then pick it{folder ? `: ${folder}` : ""}</span>
            <Select value={logoFile} onChange={(event) => setLogoFile(event.target.value)} className="w-full">
              <option value="">No logo yet</option>
              {images.map((image) => <option key={image.fileName} value={image.fileName}>{image.fileName}</option>)}
            </Select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!valid || saving} onClick={async () => {
              setSaving(true);
              try {
                if (brand) {
                  await onCreated(await api.updateBrand(brand.id, { name: name.trim(), description: description.trim(), website: website.trim() || null, logoFile: logoFile || null }));
                } else {
                  await onCreated(await api.createBrand({ name: name.trim(), description: description.trim(), website: website.trim() || undefined, logoFile: logoFile || null }));
                }
              } finally {
                setSaving(false);
              }
            }}>{saving ? "Saving…" : brand ? "Save changes" : "Create brand"}</Button>
          </div>
        </CardBody>
      </Card>
    </Overlay>
  );
}

function ScriptsForm({ open, brand, onClose, onStarted }: {
  open: boolean;
  brand: BrandRecord;
  onClose: () => void;
  onStarted: (brandId: string, body: { count: number; kinds: VisualPromptKind[]; direction?: string }) => Promise<void>;
}) {
  const [count, setCount] = useState(4);
  const [kinds, setKinds] = useState<VisualPromptKind[]>(["image"]);
  const [direction, setDirection] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Overlay open={open} onDismiss={onClose}>
      <Card elevation={2}>
        <CardHeader title="Generate scripts" description={`Jarvis writes Artlist-ready scripts for ${brand.name}. Nothing generates — each one waits for approval.`} icon={<Sparkles className="h-4 w-4" />} />
        <CardBody className="space-y-4">
          <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5 text-label text-foreground-secondary">
            <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-accent-bright" />
            Script-writing spends no Artlist credits. Generation starts only from an approved script.
          </div>
          <label className="block"><span className="mb-1.5 block text-label text-muted">Number of scripts</span><Input type="number" min={1} max={12} value={count} onChange={(event) => setCount(Number(event.target.value))} className="w-full" /></label>
          <div><div className="mb-2 text-label text-muted">Kinds</div><div className="flex flex-wrap gap-2">{KINDS.map((kind) => {
            const active = kinds.includes(kind.id);
            return <button key={kind.id} onClick={() => setKinds(active ? kinds.filter((id) => id !== kind.id) : [...kinds, kind.id])} className={`rounded-lg border px-3 py-2 text-label ${active ? "border-accent/40 bg-accent/15 text-accent-foreground" : "border-border text-muted hover:border-border-strong"}`}>{active && <Check className="mr-1 inline h-3 w-3" />}{kind.label}</button>;
          })}</div></div>
          <Textarea rows={4} className="w-full" placeholder="Optional direction — theme, campaign, or angle" value={direction} onChange={(event) => setDirection(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={saving || count < 1 || count > 12 || !kinds.length} onClick={async () => {
              setSaving(true);
              try {
                await onStarted(brand.id, { count, kinds, direction: direction.trim() || undefined });
              } finally {
                setSaving(false);
              }
            }}><Sparkles className="h-4 w-4" /> {saving ? "Starting…" : "Write scripts"}</Button>
          </div>
        </CardBody>
      </Card>
    </Overlay>
  );
}

function PromptCreateForm({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (body: { title: string; body: string; kind: VisualPromptKind; model?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<VisualPromptKind>("image");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Overlay open={open} onDismiss={onClose}>
      <Card elevation={2}>
        <CardHeader title="New script" description="Hand-written scripts enter as drafts and go through the same approval gate." icon={<PenLine className="h-4 w-4" />} />
        <CardBody className="space-y-3">
          <Input autoFocus className="w-full" placeholder="Internal title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={kind} onChange={(event) => setKind(event.target.value as VisualPromptKind)} aria-label="Kind">
              {KINDS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </Select>
            <Input className="w-full" placeholder="Model (optional)" value={model} onChange={(event) => setModel(event.target.value)} aria-label="Model" />
          </div>
          <Textarea rows={8} className="w-full" placeholder="The full Artlist-ready prompt" value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={saving || !title.trim() || !body.trim()} onClick={async () => {
              setSaving(true);
              try {
                await onCreated({ title: title.trim(), body: body.trim(), kind, model: model.trim() || undefined });
              } finally {
                setSaving(false);
              }
            }}>{saving ? "Saving…" : "Add draft"}</Button>
          </div>
        </CardBody>
      </Card>
    </Overlay>
  );
}

function PromptEditor({ open, item, onClose, onSave }: {
  open: boolean;
  item: VisualPromptRecord;
  onClose: () => void;
  onSave: (patch: { title: string; body: string; kind: VisualPromptKind; model?: string | null; resultFile?: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [kind, setKind] = useState<VisualPromptKind>(item.kind);
  const [model, setModel] = useState(item.model ?? "");
  const [resultFile, setResultFile] = useState(item.resultFile ?? "");
  const [saving, setSaving] = useState(false);
  const { images } = useImages(open);
  return (
    <Overlay open={open} onDismiss={onClose}>
      <Card elevation={2}>
        <CardHeader title="Edit script" description="Refining the script never spends anything — only generation does." icon={<PenLine className="h-4 w-4" />} />
        <CardBody className="space-y-3">
          <Input className="w-full" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Script title" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={kind} onChange={(event) => setKind(event.target.value as VisualPromptKind)} aria-label="Kind">
              {KINDS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </Select>
            <Input className="w-full" placeholder="Model (optional — Artlist default otherwise)" value={model} onChange={(event) => setModel(event.target.value)} aria-label="Model" />
          </div>
          <Textarea rows={10} className="w-full" value={body} onChange={(event) => setBody(event.target.value)} aria-label="Script body" />
          <label className="block">
            <span className="mb-1.5 block text-label text-muted">Linked result file (optional)</span>
            <Select value={resultFile} onChange={(event) => setResultFile(event.target.value)} className="w-full">
              <option value="">No result linked</option>
              {images.map((image) => <option key={image.fileName} value={image.fileName}>{image.fileName}</option>)}
            </Select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={saving || !title.trim() || !body.trim()} onClick={async () => {
              setSaving(true);
              try {
                await onSave({ title: title.trim(), body: body.trim(), kind, model: model.trim() || null, resultFile: resultFile || null });
              } finally {
                setSaving(false);
              }
            }}>{saving ? "Saving…" : "Save script"}</Button>
          </div>
        </CardBody>
      </Card>
    </Overlay>
  );
}

function SendToCampaign({ open, prompt, campaigns, onClose, onSent }: {
  open: boolean;
  prompt: VisualPromptRecord;
  campaigns: WorkflowRecord[];
  onClose: () => void;
  onSent: (workflowId: string, body: { title?: string; body?: string; format: ContentFormat; channel: MarketingChannel }) => Promise<void>;
}) {
  const [workflowId, setWorkflowId] = useState(campaigns[0]?.id ?? "");
  const campaign = campaigns.find((item) => item.id === workflowId) ?? campaigns[0];
  const [channel, setChannel] = useState<MarketingChannel>(campaign?.channels[0] ?? "x");
  const [format, setFormat] = useState<ContentFormat>("social_post");
  const [title, setTitle] = useState(prompt.title);
  const [body, setBody] = useState(prompt.title);
  const [saving, setSaving] = useState(false);
  function pickCampaign(id: string) {
    setWorkflowId(id);
    const next = campaigns.find((item) => item.id === id);
    if (next) setChannel(next.channels[0]);
  }
  return (
    <Overlay open={open} onDismiss={onClose}>
      <Card elevation={2}>
        <CardHeader title="Send to campaign" description={`"${prompt.title}" enters the campaign pipeline as a draft with its visual attached. It still needs review and approval to publish.`} icon={<Send className="h-4 w-4" />} />
        <CardBody className="space-y-3">
          {campaigns.length === 0 ? (
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-label text-foreground-secondary">
              This brand has no campaigns yet — create one first, then send the visual over.
            </div>
          ) : (
            <>
              <label className="block"><span className="mb-1.5 block text-label text-muted">Campaign (this brand only)</span>
                <Select value={workflowId} onChange={(event) => pickCampaign(event.target.value)} className="w-full">
                  {campaigns.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}
                </Select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="mb-1.5 block text-label text-muted">Channel</span>
                  <Select value={channel} onChange={(event) => setChannel(event.target.value as MarketingChannel)} className="w-full">
                    {(campaign?.channels ?? []).map((id) => <option key={id} value={id}>{CHANNELS.find((entry) => entry.id === id)?.label}</option>)}
                  </Select>
                </label>
                <label className="block"><span className="mb-1.5 block text-label text-muted">Format</span>
                  <Select value={format} onChange={(event) => setFormat(event.target.value as ContentFormat)} className="w-full">
                    <option value="social_post">Social post</option><option value="email">Email</option><option value="article">Article</option><option value="ad">Ad</option>
                  </Select>
                </label>
              </div>
              <Input className="w-full" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Content title" />
              <Textarea rows={4} className="w-full" value={body} onChange={(event) => setBody(event.target.value)} aria-label="Post copy" />
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={saving || !campaign || !title.trim() || !body.trim()} onClick={async () => {
              if (!campaign) return;
              setSaving(true);
              try {
                await onSent(campaign.id, { title: title.trim(), body: body.trim(), format, channel });
              } finally {
                setSaving(false);
              }
            }}>{saving ? "Sending…" : "Send as draft"}</Button>
          </div>
        </CardBody>
      </Card>
    </Overlay>
  );
}

function CampaignForm({ open, brand, onClose, onCreated }: {
  open: boolean;
  brand: BrandRecord;
  onClose: () => void;
  onCreated: (body: { name: string; objective: string; audience: string; offer: string; channels: MarketingChannel[]; primaryMetric: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [metric, setMetric] = useState("");
  const [channels, setChannels] = useState<MarketingChannel[]>(["x"]);
  const [saving, setSaving] = useState(false);
  const valid = name.trim() && objective.trim() && audience.trim() && offer.trim() && metric.trim() && channels.length;
  return (
    <Overlay open={open} onDismiss={onClose}>
      <Card elevation={2}>
        <CardHeader title={`New campaign for ${brand.name}`} description="A push with its own pipeline — it inherits the brand, not a copy of it." icon={<Megaphone className="h-4 w-4" />} />
        <CardBody className="space-y-3">
          <Input autoFocus placeholder="Campaign name — e.g. Summer launch" value={name} onChange={(event) => setName(event.target.value)} className="w-full" />
          <Textarea rows={3} placeholder="Objective — what should this push produce?" value={objective} onChange={(event) => setObjective(event.target.value)} className="w-full" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Textarea rows={3} placeholder="Audience" value={audience} onChange={(event) => setAudience(event.target.value)} />
            <Textarea rows={3} placeholder="Offer — what should they act on?" value={offer} onChange={(event) => setOffer(event.target.value)} />
          </div>
          <Input placeholder="Primary success metric" value={metric} onChange={(event) => setMetric(event.target.value)} className="w-full" />
          <div><div className="mb-2 text-label text-muted">Channels</div><div className="flex flex-wrap gap-2">{CHANNELS.map((channel) => {
            const active = channels.includes(channel.id);
            return <button key={channel.id} onClick={() => setChannels(active ? channels.filter((id) => id !== channel.id) : [...channels, channel.id])} className={`rounded-lg border px-3 py-2 text-label ${active ? "border-accent/40 bg-accent/15 text-accent-foreground" : "border-border text-muted hover:border-border-strong"}`}>{active && <Check className="mr-1 inline h-3 w-3" />}{channel.label}</button>;
          })}</div></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!valid || saving} onClick={async () => {
              setSaving(true);
              try {
                await onCreated({ name: name.trim(), objective: objective.trim(), audience: audience.trim(), offer: offer.trim(), channels, primaryMetric: metric.trim() });
              } finally {
                setSaving(false);
              }
            }}>{saving ? "Creating…" : "Create campaign"}</Button>
          </div>
        </CardBody>
      </Card>
    </Overlay>
  );
}
