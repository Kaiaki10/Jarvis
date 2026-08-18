"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  Headphones,
  Orbit,
  Plug,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  WalletCards,
} from "lucide-react";
import type {
  CampaignApprovalPolicy,
  ContentFormat,
  MarketingChannel,
} from "@jarvis/shared";
import { api } from "@/lib/api";
import {
  useCampaigns,
  useConnections,
  useCustomerOperations,
  useEvolution,
  useMemories,
  useMissionsList,
  useSettings,
  usePaidGrowth,
} from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";

const CHANNELS: Array<{ id: MarketingChannel; label: string }> = [
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "email", label: "Email" },
  { id: "blog", label: "Blog" },
];

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

function formatsFor(channels: MarketingChannel[]): ContentFormat[] {
  const formats = new Set<ContentFormat>();
  if (channels.some((channel) => !["email", "blog"].includes(channel))) formats.add("social_post");
  if (channels.includes("email")) formats.add("email");
  if (channels.includes("blog")) formats.add("article");
  return [...formats];
}

export function AutonomousBusinessLoop() {
  const { missions, refresh: refreshMissions } = useMissionsList();
  const { overview: campaigns, refresh: refreshCampaigns } = useCampaigns();
  const { overview: customers, refresh: refreshCustomers } = useCustomerOperations();
  const { memories, reflections } = useMemories();
  const { evolution } = useEvolution();
  const { connections } = useConnections();
  const { settings, saveSettings } = useSettings();
  const { overview: paidGrowth } = usePaidGrowth();

  const activeMissions = missions.filter((mission) => mission.status === "active");
  const activeCampaigns = campaigns?.campaigns.filter((campaign) => campaign.status === "active") ?? [];
  const reviewCount = campaigns?.content.filter((item) => item.status === "review").length ?? 0;
  const scheduledCount = campaigns?.content.filter((item) => item.status === "scheduled").length ?? 0;
  const publishedCount = campaigns?.content.filter((item) => ["published", "measured"].includes(item.status)).length ?? 0;
  const measuredCount = campaigns?.content.filter((item) => item.status === "measured").length ?? 0;
  const openCustomers = customers?.conversations.filter((conversation) => conversation.status === "open").length ?? 0;
  const activeMemories = memories.filter((memory) => memory.status === "active").length;
  const pendingEvolution = evolution?.proposals.filter((proposal) => !["promoted", "rolled_back"].includes(proposal.stage)).length ?? 0;
  const runningGeneration = campaigns?.generationRuns.filter((run) => run.status === "running").length ?? 0;
  const connectedPlatforms = connections.filter((connection) => connection.status === "connected").length;

  const phases = [
    { href: "/missions", label: "Plan", detail: `${activeMissions.length} active mission${activeMissions.length === 1 ? "" : "s"}`, icon: Target, tone: activeMissions.length ? "accent" : "neutral" },
    { href: "/campaigns", label: "Create", detail: runningGeneration ? `${runningGeneration} generation run${runningGeneration === 1 ? "" : "s"} live` : `${activeCampaigns.length} active campaign${activeCampaigns.length === 1 ? "" : "s"}`, icon: Sparkles, tone: runningGeneration ? "accent" : activeCampaigns.length ? "success" : "neutral" },
    { href: "/paid-growth", label: "Invest", detail: paidGrowth?.totals.waitingApproval ? `${paidGrowth.totals.waitingApproval} decision${paidGrowth.totals.waitingApproval === 1 ? "" : "s"} waiting` : `${paidGrowth?.campaigns.length ?? 0} paid campaign${paidGrowth?.campaigns.length === 1 ? "" : "s"}`, icon: WalletCards, tone: paidGrowth?.totals.waitingApproval ? "warning" : paidGrowth?.campaigns.length ? "accent" : "neutral" },
    { href: "/campaigns", label: "Approve", detail: reviewCount ? `${reviewCount} asset${reviewCount === 1 ? "" : "s"} waiting` : "Queue clear", icon: ShieldCheck, tone: reviewCount ? "warning" : "success" },
    { href: "/campaigns", label: "Distribute", detail: `${scheduledCount} scheduled · ${publishedCount} live`, icon: Send, tone: scheduledCount || publishedCount ? "accent" : "neutral" },
    { href: "/customers", label: "Serve", detail: customers?.policy.enabled ? `${openCustomers} open · autonomy on` : `${openCustomers} open · review only`, icon: Headphones, tone: customers?.policy.enabled ? "success" : openCustomers ? "warning" : "neutral" },
    { href: "/memory", label: "Learn", detail: `${measuredCount} measured · ${activeMemories} memories`, icon: Brain, tone: reflections[0]?.status === "failed" ? "warning" : activeMemories ? "success" : "neutral" },
    { href: "/evolution", label: "Improve", detail: `${pendingEvolution} proposal${pendingEvolution === 1 ? "" : "s"} in motion`, icon: FlaskConical, tone: pendingEvolution ? "accent" : "neutral" },
  ] satisfies Array<{ href: string; label: string; detail: string; icon: typeof Target; tone: Tone }>;

  return (
    <div className="flex flex-col gap-5">
      <LoopPulse
        activeLoops={activeCampaigns.filter((campaign) => campaign.missionId).length}
        waiting={reviewCount}
        connected={connectedPlatforms}
        customerAutonomy={customers?.policy.enabled ?? false}
      />

      <Card>
        <CardHeader
          title="The operating loop"
          description="Live state across the complete business cycle. Open any phase to work at that layer."
        />
        <div className="grid grid-cols-1 gap-2 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-7">
          {phases.map((phase, index) => {
            const Icon = phase.icon;
            return (
              <div key={phase.label} className="flex min-w-0 items-stretch gap-2">
                <Link href={phase.href} className="group min-w-0 flex-1">
                  <Card elevation={0} interactive className="h-full px-3 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-accent-bright ring-1 ring-inset ring-border">
                        <Icon className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <Badge tone={phase.tone} dot>{phase.label}</Badge>
                    </div>
                    <p className="mt-3 text-micro leading-relaxed text-muted">{phase.detail}</p>
                  </Card>
                </Link>
                {index < phases.length - 1 && (
                  <ArrowRight className="hidden h-3.5 w-3.5 self-center text-muted/50 xl:block" strokeWidth={1.75} />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)]">
        <ActiveLoops missions={missions} campaigns={campaigns} />
        <LaunchLoop
          settings={settings}
          customerAutonomy={customers?.policy.enabled ?? false}
          onRefresh={async () => {
            await Promise.all([refreshMissions(), refreshCampaigns(), refreshCustomers()]);
          }}
          onSaveSettings={saveSettings}
        />
      </div>

      <Card>
        <CardHeader
          title="Autonomy envelope"
          description="Jarvis can move quickly inside these boundaries; consequential actions still stop at the gate."
        />
        <div className="grid gap-3 px-5 pb-5 md:grid-cols-3">
          <Guardrail
            icon={ShieldCheck}
            title="Publishing"
            value={reviewCount ? `${reviewCount} approvals waiting` : "Approval gate clear"}
            detail="Generated assets stay in the pipeline. Publishing uses the campaign approval policy and platform gate."
            href="/campaigns"
          />
          <Guardrail
            icon={Headphones}
            title="Customer service"
            value={customers?.policy.enabled ? "Guarded autonomy enabled" : "Human review mode"}
            detail="Confidence, business hours, reply limits, and escalation keywords control automatic responses."
            href="/customers"
          />
          <Guardrail
            icon={Plug}
            title="Distribution"
            value={`${connectedPlatforms} tested connection${connectedPlatforms === 1 ? "" : "s"}`}
            detail={`Outbound actions are capped at ${settings?.dailyPlatformActionCap || "no fixed"} per platform each day.`}
            href="/connections"
          />
        </div>
      </Card>
    </div>
  );
}

function LoopPulse({ activeLoops, waiting, connected, customerAutonomy }: { activeLoops: number; waiting: number; connected: number; customerAutonomy: boolean }) {
  return (
    <Card elevation={2} className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-accent/15 via-transparent to-transparent" />
      <div className="relative flex flex-wrap items-center gap-5 px-5 py-4">
        <div className="flex min-w-[280px] flex-1 items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent-bright ring-1 ring-inset ring-accent/25">
            <Orbit className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-title text-foreground">Jarvis is operating</h2>
              <Badge tone="success" dot pulse>Live</Badge>
            </div>
            <p className="mt-0.5 text-label text-muted">One objective can now drive every connected workspace.</p>
          </div>
        </div>
        <PulseStat value={activeLoops} label="Active loops" />
        <PulseStat value={waiting} label="Waiting on you" tone={waiting ? "warning" : "success"} />
        <PulseStat value={connected} label="Connections" />
        <PulseStat value={customerAutonomy ? "On" : "Review"} label="Customer autonomy" tone={customerAutonomy ? "success" : undefined} />
      </div>
    </Card>
  );
}

function PulseStat({ value, label, tone }: { value: string | number; label: string; tone?: "success" | "warning" }) {
  return (
    <div className="min-w-24 border-l border-border pl-5">
      <div className={`text-title tabular-nums ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground"}`}>{value}</div>
      <div className="mt-0.5 text-micro text-muted">{label}</div>
    </div>
  );
}

function ActiveLoops({ missions, campaigns }: {
  missions: ReturnType<typeof useMissionsList>["missions"];
  campaigns: ReturnType<typeof useCampaigns>["overview"];
}) {
  const loops = useMemo(() => (campaigns?.campaigns ?? []).flatMap((campaign) => {
    const mission = missions.find((item) => item.id === campaign.missionId);
    return mission ? [{ mission, campaign }] : [];
  }).filter(({ mission, campaign }) => mission.status !== "archived" && campaign.status !== "archived"), [campaigns, missions]);

  return (
    <Card>
      <CardHeader
        title="Active operating loops"
        description="Mission and campaign stay linked while each specialist workspace keeps its full controls."
        icon={<Orbit className="h-4 w-4" strokeWidth={1.75} />}
      />
      <div className="flex flex-col gap-2 px-5 pb-5">
        {loops.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center">
            <CircleDashed className="h-7 w-7 text-muted" strokeWidth={1.5} />
            <h3 className="mt-3 text-body font-medium text-foreground">No connected loop yet</h3>
            <p className="mt-1 max-w-sm text-label text-muted">Launch one here and Jarvis will connect the mission, campaign strategy, first draft run, and autonomy envelope.</p>
          </div>
        ) : loops.map(({ mission, campaign }) => {
          const content = campaigns?.content.filter((item) => item.campaignId === campaign.id) ?? [];
          const review = content.filter((item) => item.status === "review").length;
          const live = content.filter((item) => ["published", "measured"].includes(item.status)).length;
          return (
            <div key={campaign.id} className="rounded-xl border border-border bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-heading text-foreground">{mission.title}</h3>
                    <Badge tone={mission.status === "active" ? "accent" : "neutral"}>{mission.status}</Badge>
                    <Badge tone={campaign.status === "active" ? "success" : "neutral"}>{campaign.status} campaign</Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-label leading-relaxed text-muted">{mission.outcome}</p>
                </div>
                <div className="flex gap-2">
                  <Link href="/missions" className="text-label text-muted hover:text-foreground">Mission →</Link>
                  <Link href="/campaigns" className="text-label text-accent-foreground hover:text-white">Campaign →</Link>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="neutral">{content.length} assets</Badge>
                <Badge tone={review ? "warning" : "neutral"}>{review} to approve</Badge>
                <Badge tone={live ? "success" : "neutral"}>{live} live</Badge>
                <Badge tone="neutral">{campaign.channels.length} channels</Badge>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function LaunchLoop({ settings, customerAutonomy, onRefresh, onSaveSettings }: {
  settings: ReturnType<typeof useSettings>["settings"];
  customerAutonomy: boolean;
  onRefresh: () => Promise<void>;
  onSaveSettings: ReturnType<typeof useSettings>["saveSettings"];
}) {
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [metric, setMetric] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [channels, setChannels] = useState<MarketingChannel[]>(["linkedin", "email"]);
  const [approvalPolicy, setApprovalPolicy] = useState<CampaignApprovalPolicy>("each_item");
  const [draftCount, setDraftCount] = useState(4);
  const [generateDrafts, setGenerateDrafts] = useState(true);
  const [customerAutonomyOverride, setCustomerAutonomyOverride] = useState<boolean | null>(null);
  const [actionCapOverride, setActionCapOverride] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ missionId: string; campaignId: string; sessionId?: string } | null>(null);

  const enableCustomerAutonomy = customerAutonomyOverride ?? customerAutonomy;
  const actionCap = actionCapOverride ?? settings?.dailyPlatformActionCap ?? 25;
  const valid = name.trim() && outcome.trim() && audience.trim() && offer.trim() && metric.trim() && channels.length;

  async function launch() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setResult(null);
    let missionId: string | null = null;
    let campaignId: string | null = null;
    try {
      const mission = await api.createMission({ title: name.trim(), outcome: outcome.trim(), targetDate: targetDate || undefined });
      missionId = mission.id;
      await api.updateMission(mission.id, { status: "active", nextAction: generateDrafts ? "Review and approve the first campaign content batch" : "Create the first campaign content batch" });

      const campaign = await api.createCampaign({
        name: `${name.trim()} campaign`,
        objective: outcome.trim(),
        audience: audience.trim(),
        offer: offer.trim(),
        channels,
        primaryMetric: metric.trim(),
        approvalPolicy,
        missionId: mission.id,
      });
      campaignId = campaign.id;
      await api.updateCampaign(campaign.id, { status: "active" });

      if (settings && actionCap !== settings.dailyPlatformActionCap) {
        await onSaveSettings({ dailyPlatformActionCap: actionCap });
      }
      if (enableCustomerAutonomy !== customerAutonomy) {
        await api.updateCustomerServicePolicy({ enabled: enableCustomerAutonomy });
      }

      let sessionId: string | undefined;
      if (generateDrafts) {
        const generated = await api.generateCampaignContent(campaign.id, {
          count: draftCount,
          channels,
          formats: formatsFor(channels),
          direction: `Build the first coordinated batch for this operating loop. Preserve the outcome, audience, offer, and success metric exactly.`,
        });
        sessionId = generated.session.id;
      }

      setResult({ missionId: mission.id, campaignId: campaign.id, sessionId });
      setName("");
      setOutcome("");
      setAudience("");
      setOffer("");
      setMetric("");
      setTargetDate("");
      await onRefresh();
      setCustomerAutonomyOverride(null);
      setActionCapOverride(null);
    } catch (reason) {
      await onRefresh();
      const suffix = missionId || campaignId ? " The completed parts of the loop were preserved and are linked below." : "";
      setError(`${reason instanceof Error ? reason.message : "Jarvis could not launch the loop."}${suffix}`);
      if (missionId && campaignId) setResult({ missionId, campaignId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card elevation={2} className="overflow-hidden">
      <div className="border-b border-border bg-gradient-to-r from-accent/12 to-transparent px-5 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-bright" strokeWidth={1.75} />
          <h2 className="text-heading text-foreground">Launch a connected loop</h2>
        </div>
        <p className="mt-1 text-label text-muted">Define the outcome once. Jarvis creates the operating structure around it.</p>
      </div>
      <CardBody className="space-y-3 pt-5">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Outcome name" className="w-full" />
        <Textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} rows={3} placeholder="What must be true when this succeeds?" className="w-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Textarea value={audience} onChange={(event) => setAudience(event.target.value)} rows={3} placeholder="Who should Jarvis reach?" />
          <Textarea value={offer} onChange={(event) => setOffer(event.target.value)} rows={3} placeholder="What should they act on?" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input value={metric} onChange={(event) => setMetric(event.target.value)} placeholder="Primary success metric" />
          <Input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} aria-label="Target date" />
        </div>
        <div>
          <div className="mb-2 text-label text-muted">Approved channels</div>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((channel) => {
              const active = channels.includes(channel.id);
              return (
                <button
                  type="button"
                  key={channel.id}
                  onClick={() => setChannels(active ? channels.filter((item) => item !== channel.id) : [...channels, channel.id])}
                  className={`rounded-lg border px-3 py-2 text-label transition-colors ${active ? "border-accent/40 bg-accent/15 text-accent-foreground" : "border-border text-muted hover:border-border-strong"}`}
                >
                  {active && <Check className="mr-1 inline h-3 w-3" strokeWidth={2} />}
                  {channel.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            <span className="mb-1.5 block text-label text-muted">Approval policy</span>
            <Select value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as CampaignApprovalPolicy)} className="w-full">
              <option value="each_item">Every asset</option>
              <option value="campaign">Campaign batch</option>
            </Select>
          </label>
          <label>
            <span className="mb-1.5 block text-label text-muted">First batch</span>
            <Input type="number" min={1} max={12} value={draftCount} onChange={(event) => setDraftCount(Number(event.target.value))} className="w-full" />
          </label>
          <label>
            <span className="mb-1.5 block text-label text-muted">Daily action ceiling</span>
            <Select value={actionCap} onChange={(event) => setActionCapOverride(Number(event.target.value))} className="w-full">
              <option value={5}>5 per platform</option>
              <option value={10}>10 per platform</option>
              <option value={25}>25 per platform</option>
              <option value={50}>50 per platform</option>
              <option value={0}>No fixed ceiling</option>
            </Select>
          </label>
        </div>
        <Choice
          checked={generateDrafts}
          onClick={() => setGenerateDrafts((current) => !current)}
          title="Generate the first coordinated batch"
          detail="Starts a Jarvis run. Drafts enter review; nothing publishes automatically."
        />
        <Choice
          checked={enableCustomerAutonomy}
          onClick={() => setCustomerAutonomyOverride(!enableCustomerAutonomy)}
          title="Enable guarded customer replies"
          detail="Existing confidence, hours, reply limits, and escalation rules still apply."
        />

        {error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-label text-danger">{error}</div>}
        {result && (
          <div className="rounded-lg border border-success/25 bg-success/5 px-3 py-3 text-label">
            <div className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="h-4 w-4" /> Connected loop created</div>
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href="/missions" className="text-foreground hover:text-white">Open mission →</Link>
              <Link href="/campaigns" className="text-foreground hover:text-white">Open campaign →</Link>
              {result.sessionId && <Link href={`/sessions/${result.sessionId}`} className="text-accent-foreground hover:text-white">Watch Jarvis create →</Link>}
            </div>
          </div>
        )}
        <Button className="w-full" disabled={!valid || busy || draftCount < 1 || draftCount > 12} onClick={() => void launch()}>
          <Orbit className="h-4 w-4" strokeWidth={1.75} />
          {busy ? "Launching the loop…" : "Launch operating loop"}
        </Button>
        <p className="text-center text-micro leading-relaxed text-muted">Mission and campaign activate immediately. Publishing and external actions remain approval-gated.</p>
      </CardBody>
    </Card>
  );
}

function Choice({ checked, onClick, title, detail }: { checked: boolean; onClick: () => void; title: string; detail: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${checked ? "border-accent/35 bg-accent/8" : "border-border bg-white/[0.02] hover:border-border-strong"}`}>
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-accent bg-accent text-white" : "border-border-strong"}`}>
        {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
      </span>
      <span>
        <span className="block text-label font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-micro leading-relaxed text-muted">{detail}</span>
      </span>
    </button>
  );
}

function Guardrail({ icon: Icon, title, value, detail, href }: { icon: typeof ShieldCheck; title: string; value: string; detail: string; href: string }) {
  return (
    <Link href={href} className="group">
      <Card elevation={0} interactive className="h-full p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-accent-bright ring-1 ring-inset ring-border"><Icon className="h-4 w-4" strokeWidth={1.75} /></span>
          <ArrowRight className="h-4 w-4 text-muted transition-colors group-hover:text-foreground" strokeWidth={1.75} />
        </div>
        <div className="mt-3 text-micro font-semibold uppercase tracking-[0.12em] text-muted">{title}</div>
        <div className="mt-1 text-body font-medium text-foreground">{value}</div>
        <p className="mt-1.5 text-label leading-relaxed text-muted">{detail}</p>
      </Card>
    </Link>
  );
}
