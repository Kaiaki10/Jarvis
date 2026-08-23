"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  Gauge,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  XCircle,
  BrainCircuit,
  DatabaseZap,
  Radar,
  SlidersHorizontal,
  AlertTriangle,
  RadioTower,
} from "lucide-react";
import type {
  PaidGrowthCampaignView,
  PaidGrowthDecisionRecord,
  PaidMediaPlatform,
} from "@jarvis/shared";
import { api } from "@/lib/api";
import { useWorkflows, useConnections, usePaidGrowth } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Overlay as MotionOverlay } from "@/components/motion";
import { useDialog } from "@/lib/useDialog";

const PLATFORM_META: Record<PaidMediaPlatform, { label: string; connectionId: string }> = {
  google_ads: { label: "Google Ads", connectionId: "google_ads" },
  meta_ads: { label: "Meta Ads", connectionId: "meta_ads" },
  x_ads: { label: "X Ads", connectionId: "x_ads" },
};

function money(minor: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
}

function ratio(value: number | null) {
  return value === null ? "—" : `${value.toFixed(2)}×`;
}

export function PaidGrowthCenter() {
  const { overview, refresh } = usePaidGrowth();
  const { overview: organic } = useWorkflows();
  const { connections } = useConnections();
  const createDialog = useDialog();
  const metricsDialog = useDialog();
  // Held past the close rather than cleared with it, so the panel can animate
  // out instead of vanishing. `metricsDialog.open` decides visibility now.
  const [metricsCampaign, setMetricsCampaign] = useState<PaidGrowthCampaignView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (overview) return;
    refresh().then(() => setLoadError(null)).catch((reason) => setLoadError(reason instanceof Error ? reason.message : "Paid Growth is unavailable."));
  }, [overview, refresh]);

  const connectedAds = Object.values(PLATFORM_META).filter((platform) =>
    connections.some((connection) => connection.platformId === platform.connectionId && connection.status === "connected")
  ).length;

  async function act(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jarvis could not complete that paid-growth action.");
    } finally {
      setBusy(null);
    }
  }

  if (!overview) {
    return loadError ? <Card className="flex min-h-48 flex-col items-center justify-center px-5 py-8 text-center"><AlertTriangle className="h-6 w-6 text-warning" /><h2 className="mt-3 text-body font-medium text-foreground">Paid Growth could not connect</h2><p className="mt-1 max-w-lg text-label text-muted">{loadError}</p><Button className="mt-4" size="sm" onClick={() => { setLoadError(null); refresh().catch((reason) => setLoadError(reason instanceof Error ? reason.message : "Paid Growth is unavailable.")); }}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button></Card> : <Card className="flex items-center gap-3 px-5 py-5"><RefreshCw className="h-4 w-4 animate-spin text-accent-bright" /><span className="text-body text-muted">Opening paid growth control…</span></Card>;
  }

  const totalRoas = overview.totals.spentMinor > 0 ? overview.totals.revenueMinor / overview.totals.spentMinor : null;
  return (
    <div className="flex flex-col gap-5">
      <GrowthPulse
        approved={overview.totals.approvedBudgetMinor}
        spent={overview.totals.spentMinor}
        revenue={overview.totals.revenueMinor}
        roas={totalRoas}
        currency={overview.totals.currency}
        waiting={overview.totals.waitingApproval}
      />
      <AutonomyRail connected={connectedAds > 0} planned={overview.campaigns.length > 0} synced={overview.campaigns.some((campaign) => campaign.lastSyncedAt)} waiting={overview.totals.waitingApproval > 0} />

      {error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-label text-danger">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Paid campaign portfolio"
            description="Budget envelopes and performance stay separate from content production, but link back to the same campaign."
            action={<Button size="sm" onClick={createDialog.show}><Plus className="h-3.5 w-3.5" /> Add campaign</Button>}
          />
          <div className="flex flex-col gap-3 px-5 pb-5">
            {overview.campaigns.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center">
                <CircleDashed className="h-7 w-7 text-muted" strokeWidth={1.5} />
                <h3 className="mt-3 text-body font-medium text-foreground">No paid campaigns yet</h3>
                <p className="mt-1 max-w-md text-label text-muted">Connect an ad account, link an existing platform campaign, then let Jarvis manage its approved budget envelope.</p>
                <Button className="mt-4" size="sm" onClick={createDialog.show}><Plus className="h-3.5 w-3.5" /> Create control plan</Button>
              </div>
            ) : overview.campaigns.map((campaign) => (
              <PaidCampaignCard
                key={campaign.id}
                campaign={campaign}
                decision={overview.decisions.find((decision) => decision.paidCampaignId === campaign.id && decision.status === "proposed")}
                busy={busy}
                onRequest={() => act(`launch-${campaign.id}`, () => api.requestPaidGrowthLaunch(campaign.id))}
                onSync={() => act(`sync-${campaign.id}`, () => api.syncPaidGrowthCampaign(campaign.id))}
                onMetrics={() => { setMetricsCampaign(campaign); metricsDialog.show(); }}
              />
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <DecisionQueue decisions={overview.decisions.filter((decision) => decision.status === "proposed")} campaigns={overview.campaigns} busy={busy} onReview={(id, decision) => act(`${decision}-${id}`, () => api.reviewPaidGrowthDecision(id, decision))} onRefresh={() => act("recommend", () => api.refreshPaidGrowthRecommendations())} />
          <Readiness connected={connectedAds} connections={connections} />
        </div>
      </div>

      <Card>
        <CardHeader title="Investment policy" description="Jarvis can recommend continuously, but it cannot silently expand the approved envelope." />
        <div className="grid gap-3 px-5 pb-5 md:grid-cols-3">
          <Policy icon={ShieldCheck} title="Launch approval" detail="A tested ad connection and external campaign ID are required; approval applies the budget and activates the platform campaign." />
          <Policy icon={Gauge} title="Budget pacing" detail="Daily pacing is bounded by the approved lifetime envelope and cumulative spend can never move backward." />
          <Policy icon={TrendingUp} title="Reinvestment" detail="Winners may receive a bounded 20% recommendation; underperformers can be proposed for pause or reallocation." />
        </div>
      </Card>

      {/* Mounted whether or not they are showing, so closing is something you
          can see. `key` remounts each form on open, which conditional rendering
          used to do for free — without it a cancelled draft would still be
          sitting there next time. */}
      <CreatePaidCampaign key={createDialog.key} open={createDialog.open} campaigns={organic?.workflows ?? []} connections={connections} onClose={createDialog.hide} onCreated={async () => { await refresh(); createDialog.hide(); }} />
      {metricsCampaign && <PerformanceEditor key={metricsDialog.key} open={metricsDialog.open} campaign={metricsCampaign} onClose={metricsDialog.hide} onSave={async (body) => { await act(`metrics-${metricsCampaign.id}`, () => api.updatePaidGrowthPerformance(metricsCampaign.id, body)); metricsDialog.hide(); }} />}
    </div>
  );
}

function AutonomyRail({ connected, planned, synced, waiting }: { connected: boolean; planned: boolean; synced: boolean; waiting: boolean }) {
  const steps = [
    { label: "Connect", detail: "Verified ad account", icon: RadioTower, ready: connected },
    { label: "Control", detail: "Budget envelope", icon: SlidersHorizontal, ready: planned },
    { label: "Observe", detail: "Live performance", icon: DatabaseZap, ready: synced },
    { label: "Reason", detail: "Evidence-based action", icon: BrainCircuit, ready: synced },
    { label: "Decide", detail: waiting ? "Judgment required" : "Guardrails clear", icon: Radar, ready: !waiting && planned },
  ];
  return <Card className="overflow-hidden"><div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-5">{steps.map((step, index) => <div key={step.label} className="relative flex items-center gap-3 bg-surface px-4 py-3.5"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${step.ready ? "bg-accent/15 text-accent-bright ring-accent/25" : "bg-white/[0.03] text-muted ring-border"}`}><step.icon className="h-4 w-4" /></span><div className="min-w-0"><div className="flex items-center gap-1.5 text-label font-medium text-foreground"><span className="text-micro text-muted">0{index + 1}</span>{step.label}</div><div className="truncate text-micro text-muted">{step.detail}</div></div>{index < steps.length - 1 && <ArrowRight className="absolute -right-2 z-10 hidden h-3.5 w-3.5 rounded-full bg-surface text-muted xl:block" />}</div>)}</div></Card>;
}

function GrowthPulse({ approved, spent, revenue, roas, currency, waiting }: { approved: number; spent: number; revenue: number; roas: number | null; currency: string | null; waiting: number }) {
  const labelCurrency = currency ?? "Mixed currencies";
  return (
    <Card elevation={2} className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-accent/15 via-transparent to-transparent" />
      <div className="relative flex flex-wrap items-center gap-5 px-5 py-4">
        <div className="flex min-w-[280px] flex-1 items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent-bright ring-1 ring-inset ring-accent/25"><BadgeDollarSign className="h-5 w-5" /></span>
          <div><div className="flex items-center gap-2"><h2 className="text-title text-foreground">Paid growth control</h2><Badge tone="accent">Guarded</Badge></div><p className="mt-0.5 text-label text-muted">Spend follows evidence and a human-approved envelope.</p></div>
        </div>
        <Pulse value={currency ? money(approved, currency) : "Mixed"} label={`Approved · ${labelCurrency}`} />
        <Pulse value={currency ? money(spent, currency) : "Mixed"} label="Spent" />
        <Pulse value={currency ? money(revenue, currency) : "Mixed"} label="Attributed revenue" tone="success" />
        <Pulse value={ratio(roas)} label="Blended ROAS" tone={roas && roas >= 1 ? "success" : undefined} />
        <Pulse value={waiting} label="Waiting approval" tone={waiting ? "warning" : undefined} />
      </div>
    </Card>
  );
}

function Pulse({ value, label, tone }: { value: string | number; label: string; tone?: "success" | "warning" }) {
  return <div className="min-w-24 border-l border-border pl-5"><div className={`text-title tabular-nums ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground"}`}>{value}</div><div className="mt-0.5 text-micro text-muted">{label}</div></div>;
}

function PaidCampaignCard({ campaign, decision, busy, onRequest, onSync, onMetrics }: { campaign: PaidGrowthCampaignView; decision?: PaidGrowthDecisionRecord; busy: string | null; onRequest: () => void; onSync: () => void; onMetrics: () => void }) {
  const statusTone = campaign.status === "active" ? "success" : campaign.status === "pending_approval" ? "warning" : campaign.status === "approved" ? "accent" : "neutral";
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-heading text-foreground">{campaign.name}</h3><Badge tone={statusTone}>{campaign.status.replace("_", " ")}</Badge><Badge tone={campaign.connectionReady ? "success" : "warning"} dot>{PLATFORM_META[campaign.platform].label}</Badge></div>
          <p className="mt-1.5 line-clamp-2 text-label text-muted">{campaign.objective}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={!campaign.connectionReady || !campaign.externalCampaignId || busy === `sync-${campaign.id}`} onClick={onSync}><RefreshCw className={`h-3.5 w-3.5 ${busy === `sync-${campaign.id}` ? "animate-spin" : ""}`} /> Sync</Button>
          <Button size="sm" variant="ghost" onClick={onMetrics}><BarChart3 className="h-3.5 w-3.5" /> Manual update</Button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Metric label="Daily budget" value={money(campaign.dailyBudgetMinor, campaign.currency)} />
        <Metric label="Spent" value={money(campaign.spentMinor, campaign.currency)} />
        <Metric label="Revenue" value={money(campaign.revenueMinor, campaign.currency)} />
        <Metric label="ROAS" value={ratio(campaign.metrics.roas)} tone={campaign.metrics.roas && campaign.targetRoas && campaign.metrics.roas >= campaign.targetRoas ? "success" : undefined} />
        <Metric label="Conversions" value={campaign.conversions.toLocaleString()} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Badge tone="neutral">Envelope {money(campaign.lifetimeBudgetMinor, campaign.currency)}</Badge>
        <Badge tone="neutral">Target {ratio(campaign.targetRoas)}</Badge>
        <Badge tone={campaign.externalCampaignId ? "success" : "warning"}>{campaign.externalCampaignId ? "Platform ID linked" : "Platform ID missing"}</Badge>
        {campaign.lastSyncedAt && <Badge tone="neutral">Synced {new Date(campaign.lastSyncedAt).toLocaleString()}</Badge>}
        <div className="ml-auto">
          {decision ? <Badge tone="warning" dot>Decision waiting</Badge> : ["draft", "paused"].includes(campaign.status) ? (
            <Button size="sm" disabled={busy === `launch-${campaign.id}` || !campaign.connectionReady || !campaign.externalCampaignId} onClick={onRequest}>
              <ShieldCheck className="h-3.5 w-3.5" /> Request activation
            </Button>
          ) : campaign.status === "approved" ? <Badge tone="accent" dot>Approved for platform execution</Badge> : null}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return <div><div className="text-micro uppercase tracking-wide text-muted">{label}</div><div className={`mt-1 text-body font-medium tabular-nums ${tone === "success" ? "text-success" : "text-foreground"}`}>{value}</div></div>;
}

function DecisionQueue({ decisions, campaigns, busy, onReview, onRefresh }: { decisions: PaidGrowthDecisionRecord[]; campaigns: PaidGrowthCampaignView[]; busy: string | null; onReview: (id: string, decision: "approve" | "reject") => void; onRefresh: () => void }) {
  return (
    <Card>
      <CardHeader title="Investment decisions" description={decisions.length ? `${decisions.length} waiting for judgment` : "No material change is waiting"} action={<Button size="icon" variant="ghost" aria-label="Refresh recommendations" disabled={busy === "recommend"} onClick={onRefresh}><RefreshCw className={`h-4 w-4 ${busy === "recommend" ? "animate-spin" : ""}`} /></Button>} />
      <div className="flex flex-col gap-2 px-5 pb-5">
        {decisions.length === 0 ? <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-label text-muted"><CheckCircle2 className="h-4 w-4 text-success" /> Recommendation queue is clear.</div> : decisions.map((decision) => {
          const campaign = campaigns.find((item) => item.id === decision.paidCampaignId);
          return <div key={decision.id} className="rounded-lg border border-warning/25 bg-warning/5 p-3"><div className="flex items-center justify-between gap-2"><Badge tone="warning">{decision.kind.replace("_", " ")}</Badge><span className="text-micro text-muted">{campaign?.name}</span></div><p className="mt-2 text-label leading-relaxed text-foreground-secondary">{decision.reason}</p>{decision.proposedDailyBudgetMinor && campaign && <p className="mt-1 text-micro text-muted">Proposed daily budget: {money(decision.proposedDailyBudgetMinor, campaign.currency)}</p>}<div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy === `reject-${decision.id}`} onClick={() => onReview(decision.id, "reject")}><XCircle className="h-3.5 w-3.5" /> Reject</Button><Button size="sm" disabled={busy === `approve-${decision.id}`} onClick={() => onReview(decision.id, "approve")}><CheckCircle2 className="h-3.5 w-3.5" /> Approve &amp; apply</Button></div></div>;
        })}
      </div>
    </Card>
  );
}

function Readiness({ connected, connections }: { connected: number; connections: ReturnType<typeof useConnections>["connections"] }) {
  return <Card><CardHeader title="Ad account readiness" description={`${connected}/3 platforms tested`} /><div className="flex flex-col gap-2 px-5 pb-5">{(Object.entries(PLATFORM_META) as Array<[PaidMediaPlatform, typeof PLATFORM_META[PaidMediaPlatform]]>).map(([id, platform]) => { const ready = connections.some((connection) => connection.platformId === id && connection.status === "connected"); return <Link key={id} href={`/under-the-hood/connections/${platform.connectionId}`} className="group flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:border-border-strong"><span className={`h-2 w-2 rounded-full ${ready ? "bg-success" : "bg-muted"}`} /><span className="flex-1 text-label text-foreground">{platform.label}</span><span className="text-micro text-muted">{ready ? "Ready" : "Set up"}</span><ArrowRight className="h-3.5 w-3.5 text-muted group-hover:text-foreground" /></Link>; })}</div></Card>;
}

function Policy({ icon: Icon, title, detail }: { icon: typeof ShieldCheck; title: string; detail: string }) {
  return <Card elevation={0} className="p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-accent-bright ring-1 ring-inset ring-border"><Icon className="h-4 w-4" /></span><h3 className="mt-3 text-body font-medium text-foreground">{title}</h3><p className="mt-1 text-label leading-relaxed text-muted">{detail}</p></Card>;
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
      {children}
    </MotionOverlay>
  );
}

function CreatePaidCampaign({ open, campaigns, connections, onClose, onCreated }: { open: boolean; campaigns: NonNullable<ReturnType<typeof useWorkflows>["overview"]>["workflows"]; connections: ReturnType<typeof useConnections>["connections"]; onClose: () => void; onCreated: () => Promise<void> }) {
  const readyPlatforms = (Object.keys(PLATFORM_META) as PaidMediaPlatform[]).filter((id) => connections.some((connection) => connection.platformId === id && connection.status === "connected"));
  const [name, setName] = useState(""); const [objective, setObjective] = useState(""); const [platform, setPlatform] = useState<PaidMediaPlatform>(readyPlatforms[0] ?? "google_ads"); const [workflowId, setCampaignId] = useState(""); const [externalId, setExternalId] = useState(""); const [externalBudgetId, setExternalBudgetId] = useState(""); const [currency, setCurrency] = useState("USD"); const [daily, setDaily] = useState(25); const [lifetime, setLifetime] = useState(500); const [targetRoas, setTargetRoas] = useState(2); const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10)); const [endDate, setEndDate] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const valid = name.trim() && objective.trim() && /^[A-Z]{3}$/.test(currency) && daily >= 1 && lifetime >= daily && targetRoas > 0;
  return <Overlay open={open} onDismiss={onClose}><Card elevation={2} className="w-full max-w-2xl"><CardHeader title="Create a paid campaign control plan" description="Link an existing platform campaign; Jarvis will not create or spend until the connection and budget are reviewed." icon={<BadgeDollarSign className="h-4 w-4" />} /><CardBody className="space-y-3"><Input autoFocus className="w-full" placeholder="Paid campaign name" value={name} onChange={(event) => setName(event.target.value)} /><Textarea rows={3} className="w-full" placeholder="Objective — what should this investment produce?" value={objective} onChange={(event) => setObjective(event.target.value)} /><div className="grid gap-3 sm:grid-cols-2"><Select value={platform} onChange={(event) => setPlatform(event.target.value as PaidMediaPlatform)}>{(Object.entries(PLATFORM_META) as Array<[PaidMediaPlatform, typeof PLATFORM_META[PaidMediaPlatform]]>).map(([id, meta]) => <option key={id} value={id}>{meta.label}{readyPlatforms.includes(id) ? " · ready" : " · not connected"}</option>)}</Select><Input placeholder="Existing platform campaign ID" value={externalId} onChange={(event) => setExternalId(event.target.value)} /></div>{platform === "meta_ads" && <Input className="w-full" placeholder="Budget entity ID (optional Meta ad set ID)" value={externalBudgetId} onChange={(event) => setExternalBudgetId(event.target.value)} />}<div className="grid gap-3 sm:grid-cols-[1fr_110px]"><Select className="w-full" value={workflowId} onChange={(event) => setCampaignId(event.target.value)}><option value="">No linked content campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select><Input aria-label="Account currency" className="w-full uppercase" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} /></div><div className="grid gap-3 sm:grid-cols-3"><label><span className="mb-1.5 block text-label text-muted">Daily budget · {currency}</span><Input type="number" min={1} step={1} value={daily} onChange={(event) => setDaily(Number(event.target.value))} className="w-full" /></label><label><span className="mb-1.5 block text-label text-muted">Lifetime envelope</span><Input type="number" min={1} step={1} value={lifetime} onChange={(event) => setLifetime(Number(event.target.value))} className="w-full" /></label><label><span className="mb-1.5 block text-label text-muted">Target ROAS</span><Input type="number" min={0.1} step={0.1} value={targetRoas} onChange={(event) => setTargetRoas(Number(event.target.value))} className="w-full" /></label></div><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-label text-muted">Start</span><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full" /></label><label><span className="mb-1.5 block text-label text-muted">End (optional)</span><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full" /></label></div><div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5 text-label text-foreground-secondary"><ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-accent-bright" />Approving activation applies the daily budget and status at the connected platform. Later material changes require another approval.</div>{error && <div className="text-label text-danger">{error}</div>}<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!valid || saving} onClick={async () => { setSaving(true); setError(null); try { await api.createPaidGrowthCampaign({ workflowId: workflowId || undefined, name: name.trim(), objective: objective.trim(), platform, externalCampaignId: externalId.trim() || undefined, externalBudgetEntityId: externalBudgetId.trim() || undefined, currency, dailyBudgetMinor: Math.round(daily * 100), lifetimeBudgetMinor: Math.round(lifetime * 100), targetRoas, startDate, endDate: endDate || undefined }); await onCreated(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create paid campaign."); } finally { setSaving(false); } }}><Sparkles className="h-4 w-4" /> {saving ? "Creating…" : "Create control plan"}</Button></div></CardBody></Card></Overlay>;
}

function PerformanceEditor({ open, campaign, onClose, onSave }: { open: boolean; campaign: PaidGrowthCampaignView; onClose: () => void; onSave: (body: { spentMinor: number; revenueMinor: number; impressions: number; clicks: number; conversions: number }) => Promise<void> }) {
  const [spent, setSpent] = useState(campaign.spentMinor / 100); const [revenue, setRevenue] = useState(campaign.revenueMinor / 100); const [impressions, setImpressions] = useState(campaign.impressions); const [clicks, setClicks] = useState(campaign.clicks); const [conversions, setConversions] = useState(campaign.conversions); const [saving, setSaving] = useState(false);
  const valid = spent >= campaign.spentMinor / 100 && revenue >= 0 && impressions >= clicks && clicks >= conversions;
  return <Overlay open={open} onDismiss={onClose}><Card elevation={2} className="w-full max-w-xl"><CardHeader title="Update cumulative performance" description={`${campaign.name} · use the latest platform totals`} icon={<BarChart3 className="h-4 w-4" />} /><CardBody className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-label text-muted">Spend</span><Input type="number" min={campaign.spentMinor / 100} step={0.01} value={spent} onChange={(event) => setSpent(Number(event.target.value))} className="w-full" /></label><label><span className="mb-1.5 block text-label text-muted">Attributed revenue</span><Input type="number" min={0} step={0.01} value={revenue} onChange={(event) => setRevenue(Number(event.target.value))} className="w-full" /></label></div><div className="grid gap-3 sm:grid-cols-3"><label><span className="mb-1.5 block text-label text-muted">Impressions</span><Input type="number" min={0} value={impressions} onChange={(event) => setImpressions(Number(event.target.value))} className="w-full" /></label><label><span className="mb-1.5 block text-label text-muted">Clicks</span><Input type="number" min={0} value={clicks} onChange={(event) => setClicks(Number(event.target.value))} className="w-full" /></label><label><span className="mb-1.5 block text-label text-muted">Conversions</span><Input type="number" min={0} value={conversions} onChange={(event) => setConversions(Number(event.target.value))} className="w-full" /></label></div><p className="text-label text-muted">This is a cumulative ledger. Spend cannot decrease, clicks cannot exceed impressions, and conversions cannot exceed clicks.</p><div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!valid || saving} onClick={async () => { setSaving(true); try { await onSave({ spentMinor: Math.round(spent * 100), revenueMinor: Math.round(revenue * 100), impressions, clicks, conversions }); } finally { setSaving(false); } }}>{saving ? "Saving…" : "Save performance"}</Button></div></CardBody></Card></Overlay>;
}
