"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  GitBranch,
  History,
  Lightbulb,
  LockKeyhole,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TestTube2,
} from "lucide-react";
import type {
  EvolutionAutonomy,
  EvolutionChangeClass,
  EvolutionProposalRecord,
  EvolutionRisk,
  EvolutionStage,
} from "@jarvis/shared";
import { api } from "@/lib/api";
import { useEvolution } from "@/lib/hooks";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";

const ACTIVE_STAGES: Array<{ stage: EvolutionStage; label: string; description: string; icon: typeof Lightbulb }> = [
  { stage: "observed", label: "Observed", description: "A gap or opportunity Jarvis noticed", icon: Lightbulb },
  { stage: "planned", label: "Planned", description: "Scoped with value and rollback defined", icon: TestTube2 },
  { stage: "building", label: "Building in Lab", description: "An isolated agent is implementing it", icon: FlaskConical },
  { stage: "review", label: "Awaiting review", description: "Verified evidence is ready to inspect", icon: ShieldCheck },
  { stage: "promoting", label: "Promoting", description: "Merging, rebuilding, and restarting — the dashboard will drop and reconnect", icon: Rocket },
];

const RISK_TONE: Record<EvolutionRisk, "neutral" | "accent" | "warning" | "danger"> = {
  low: "neutral",
  medium: "accent",
  high: "warning",
  critical: "danger",
};

const CLASS_LABELS: Record<EvolutionChangeClass, string> = {
  knowledge: "Knowledge",
  behavior: "Behavior",
  capability: "Capability",
  product: "Product",
  security: "Security",
};

const AUTONOMY_LABELS: Record<EvolutionAutonomy, string> = {
  automatic: "Automatic",
  after_checks: "After checks",
  approval_required: "Approval required",
};

export function EvolutionCenter() {
  const { evolution, refresh } = useEvolution();
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!evolution) {
    return (
      <Card className="flex items-center gap-3 px-5 py-5">
        <RefreshCw className="h-4 w-4 animate-spin text-accent-bright" strokeWidth={1.75} />
        <span className="text-body text-muted">Connecting to Jarvis Lab…</span>
      </Card>
    );
  }

  async function updateStage(id: string, stage: "observed" | "planned") {
    setBusyId(id);
    setError(null);
    try {
      await api.updateEvolutionProposal(id, { stage });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the proposal.");
    } finally {
      setBusyId(null);
    }
  }

  async function startBuild(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.startEvolutionBuild(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the Lab build.");
    } finally {
      setBusyId(null);
    }
  }

  async function promote(id: string) {
    setBusyId(id);
    setError(null);
    try {
      // The service restarts partway through this — refresh moves the card to
      // "Promoting" immediately; the dashboard's own EventSource reconnects on
      // its own once the new build is up, same as any other restart.
      await api.promoteEvolutionProposal(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start promotion.");
    } finally {
      setBusyId(null);
    }
  }

  const promoted = evolution.proposals.filter((proposal) => ["promoted", "rolled_back"].includes(proposal.stage));

  return (
    <div className="flex flex-col gap-6">
      <EvolutionStatus evolution={evolution} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title text-foreground">Improvement pipeline</h2>
          <p className="mt-1 text-label text-muted">Every change carries its reason, evidence, risk, and way back.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" strokeWidth={1.75} /> New proposal
        </Button>
      </div>

      {creating && <ProposalForm onClose={() => setCreating(false)} onCreated={refresh} />}
      {error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-label text-danger">{error}</div>}

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
        {ACTIVE_STAGES.map(({ stage, label, description, icon: Icon }, index) => {
          const proposals = evolution.proposals.filter((proposal) => proposal.stage === stage);
          return (
            <section key={stage} className="min-w-0">
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-muted">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-heading text-foreground">
                    {label}<span className="text-micro text-muted">{proposals.length}</span>
                  </div>
                  <div className="truncate text-micro text-muted" title={description}>{description}</div>
                </div>
                {index < ACTIVE_STAGES.length - 1 && <ChevronRight className="hidden h-4 w-4 text-muted/40 xl:block" />}
              </div>
              <div className="flex flex-col gap-2">
                {proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    labAvailable={evolution.readiness.labAvailable}
                    promotionReady={evolution.readiness.promotionEngineReady}
                    busy={busyId === proposal.id}
                    onPlan={() => void updateStage(proposal.id, "planned")}
                    onReturn={() => void updateStage(proposal.id, "planned")}
                    onBuild={() => void startBuild(proposal.id)}
                    onPromote={() => void promote(proposal.id)}
                  />
                ))}
                {proposals.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-micro text-muted">Nothing here</div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <AutonomyPolicies />
        <Card>
          <CardHeader title="Promotion boundary" description="Why Lab cannot silently replace production" icon={<LockKeyhole className="h-4 w-4" strokeWidth={1.75} />} />
          <CardBody>
            <div className="flex flex-col gap-2">
              <SafetyCheck ok label="Changes are built in an isolated worktree" />
              <SafetyCheck ok label="Required tests and type checks run before commit" />
              <SafetyCheck ok={evolution.readiness.promotionEngineReady} label="Version switch is atomic, with a rollback attempt built in" />
              <SafetyCheck ok={evolution.readiness.automaticRollbackReady} label="That rollback path has been proven against a real failure" />
            </div>
            <p className="mt-4 text-label text-muted">
              {evolution.readiness.promotionEngineReady
                ? "Promote is available once a proposal is reviewed — it always requires you to click it. The last check stays off until a real promotion has actually failed and recovered, not just been read and trusted."
                : "Production promotion stays unavailable until the promotion engine exists on this machine."}
            </p>
          </CardBody>
        </Card>
      </div>

      {promoted.length > 0 && (
        <Card>
          <CardHeader title="Release history" description="Promoted versions and rollbacks" icon={<History className="h-4 w-4" strokeWidth={1.75} />} />
          <CardBody className="flex flex-col gap-2">
            {promoted.map((proposal) => (
              <div key={proposal.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                {proposal.stage === "rolled_back" ? <RotateCcw className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                <span className="min-w-0 flex-1 truncate text-body text-foreground">{proposal.title}</span>
                <Badge tone={proposal.stage === "rolled_back" ? "warning" : "success"}>{proposal.stage === "rolled_back" ? "Rolled back" : "Promoted"}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function EvolutionStatus({ evolution }: { evolution: NonNullable<ReturnType<typeof useEvolution>["evolution"]> }) {
  const active = evolution.proposals.filter((proposal) => ["planned", "building", "review", "promoting"].includes(proposal.stage)).length;
  const review = evolution.proposals.filter((proposal) => proposal.stage === "review").length;
  return (
    <Card elevation={2} className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/12 via-transparent to-transparent" />
      <div className="relative grid gap-5 p-5 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.14em] text-accent-foreground">
            <Bot className="h-4 w-4 text-accent-bright" strokeWidth={1.75} /> Self-evolution system
          </div>
          <h2 className="mt-2 text-title text-foreground">Jarvis improves in Lab. Production remains protected.</h2>
          <p className="mt-1 max-w-2xl text-body text-foreground-secondary">
            Observe gaps, build one focused improvement, verify it, then review the evidence before promotion.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone={evolution.readiness.labAvailable ? "success" : "danger"} dot>{evolution.readiness.labAvailable ? "Lab available" : "Lab unavailable"}</Badge>
            {evolution.readiness.labBranch && <Badge tone="neutral"><GitBranch className="h-3 w-3" /> {evolution.readiness.labBranch}</Badge>}
            <Badge tone="warning">Promotion gated</Badge>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatusNumber value={evolution.proposals.length} label="Proposals" />
          <StatusNumber value={active} label="In motion" />
          <StatusNumber value={review} label="To review" tone={review ? "warning" : undefined} />
        </div>
      </div>
    </Card>
  );
}

function StatusNumber({ value, label, tone }: { value: number; label: string; tone?: "warning" }) {
  return (
    <div className="min-w-20 rounded-lg border border-border bg-black/15 px-3 py-3 text-center">
      <div className={`text-title text-2xl ${tone ? "text-warning" : "text-foreground"}`}>{value}</div>
      <div className="mt-1 text-micro text-muted">{label}</div>
    </div>
  );
}

function ProposalCard({ proposal, labAvailable, promotionReady, busy, onPlan, onReturn, onBuild, onPromote }: {
  proposal: EvolutionProposalRecord;
  labAvailable: boolean;
  promotionReady: boolean;
  busy: boolean;
  onPlan: () => void;
  onReturn: () => void;
  onBuild: () => void;
  onPromote: () => void;
}) {
  return (
    <Card className="p-3.5" elevation={proposal.stage === "review" ? 2 : 1}>
      <div className="flex items-start gap-2">
        <Badge tone={RISK_TONE[proposal.risk]}>{proposal.risk} risk</Badge>
        <Badge tone="neutral">{CLASS_LABELS[proposal.changeClass]}</Badge>
      </div>
      <h3 className="mt-3 text-heading text-foreground">{proposal.title}</h3>
      <p className="mt-1 line-clamp-3 text-label text-muted">{proposal.problem}</p>
      <details className="mt-3 rounded-lg border border-border bg-black/15 px-2.5 py-2">
        <summary className="cursor-pointer text-micro font-medium text-muted">Value, evidence, and rollback</summary>
        <div className="mt-2 flex flex-col gap-2 text-label">
          <Detail label="Expected value" value={proposal.expectedValue} />
          <Detail label="Evidence" value={proposal.evidence || "No evidence recorded yet."} />
          <Detail label="Rollback" value={proposal.rollbackPlan || "Must be defined before promotion."} />
        </div>
      </details>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {proposal.stage === "observed" && <Button size="sm" variant="secondary" disabled={busy} onClick={onPlan}>Plan <ArrowRight className="h-3.5 w-3.5" /></Button>}
        {proposal.stage === "planned" && <Button size="sm" disabled={busy || !labAvailable} onClick={onBuild}><FlaskConical className="h-3.5 w-3.5" /> {busy ? "Starting…" : "Build in Lab"}</Button>}
        {proposal.stage === "building" && proposal.labSessionId && <Link href={`/sessions/${proposal.labSessionId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-hover px-3 text-label text-foreground hover:bg-white/10">View live run <ArrowRight className="h-3.5 w-3.5" /></Link>}
        {proposal.stage === "review" && (
          <>
            {proposal.labSessionId && <Link href={`/sessions/${proposal.labSessionId}`} className="text-label text-accent-foreground hover:text-white">Review run →</Link>}
            <Button size="sm" variant="secondary" disabled={busy} onClick={onReturn}>Send back</Button>
            <Button
              size="sm"
              disabled={busy || !promotionReady}
              title={!promotionReady ? "The promotion engine isn't available on this machine" : "Merges, rebuilds, and restarts Jarvis — the dashboard will drop and reconnect"}
              onClick={onPromote}
            >
              <Rocket className="h-3.5 w-3.5" strokeWidth={1.75} /> {busy ? "Starting…" : "Promote"}
            </Button>
          </>
        )}
        {proposal.stage === "promoting" && (
          <div className="flex items-center gap-1.5 text-label text-accent-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            Merging, rebuilding, and restarting…
          </div>
        )}
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-micro font-medium uppercase text-muted">{label}</div><div className="mt-0.5 text-foreground-secondary">{value}</div></div>;
}

function ProposalForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [expectedValue, setExpectedValue] = useState("");
  const [changeClass, setChangeClass] = useState<EvolutionChangeClass>("product");
  const [risk, setRisk] = useState<EvolutionRisk>("medium");
  const [evidence, setEvidence] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!title.trim() || !problem.trim() || !expectedValue.trim()) return;
    setSaving(true);
    try {
      await api.createEvolutionProposal({ title: title.trim(), problem: problem.trim(), expectedValue: expectedValue.trim(), changeClass, risk, evidence: evidence.trim() || undefined, rollbackPlan: rollbackPlan.trim() || undefined });
      await onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card elevation={2}>
      <CardHeader title="New evolution proposal" description="Describe the user value before asking Lab to change code." icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />} />
      <CardBody className="grid gap-3 lg:grid-cols-2">
        <Input className="lg:col-span-2" placeholder="Improvement title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        <Textarea rows={4} placeholder="What is weak, failing, or missing?" value={problem} onChange={(event) => setProblem(event.target.value)} />
        <Textarea rows={4} placeholder="What becomes meaningfully better for the user?" value={expectedValue} onChange={(event) => setExpectedValue(event.target.value)} />
        <Select value={changeClass} onChange={(event) => setChangeClass(event.target.value as EvolutionChangeClass)}>{Object.entries(CLASS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
        <Select value={risk} onChange={(event) => setRisk(event.target.value as EvolutionRisk)}><option value="low">Low risk</option><option value="medium">Medium risk</option><option value="high">High risk</option><option value="critical">Critical risk</option></Select>
        <Textarea rows={3} placeholder="Evidence or observed behavior (optional)" value={evidence} onChange={(event) => setEvidence(event.target.value)} />
        <Textarea rows={3} placeholder="How can Jarvis undo this safely?" value={rollbackPlan} onChange={(event) => setRollbackPlan(event.target.value)} />
        <div className="flex justify-end gap-2 lg:col-span-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !title.trim() || !problem.trim() || !expectedValue.trim()} onClick={() => void create()}>{saving ? "Saving…" : "Create proposal"}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function AutonomyPolicies() {
  const { evolution, refresh } = useEvolution();
  const policies = useMemo(() => evolution?.policies ?? [], [evolution]);
  return (
    <Card>
      <CardHeader title="Autonomy policy" description="How far each type of improvement may advance" icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />} />
      <CardBody>
        <div className="mb-3 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-label text-muted">
          These policies govern promotion once the atomic promotion engine is ready. Lab experiments remain isolated.
        </div>
        <div className="flex flex-col divide-y divide-border">
          {policies.map((policy) => {
            const locked = policy.changeClass === "security";
            return (
              <div key={policy.changeClass} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-body text-foreground">{CLASS_LABELS[policy.changeClass]}</div>
                  <div className="text-micro text-muted">{policy.changeClass === "security" ? "Credentials, permissions, and trust boundaries" : `Changes to Jarvis ${policy.changeClass}`}</div>
                </div>
                <Select
                  className="h-8 py-1 text-label"
                  value={policy.autonomy}
                  disabled={locked}
                  onChange={async (event) => {
                    await api.updateEvolutionPolicy(policy.changeClass, event.target.value as EvolutionAutonomy);
                    await refresh();
                  }}
                >
                  <option value="automatic">{AUTONOMY_LABELS.automatic}</option>
                  <option value="after_checks">{AUTONOMY_LABELS.after_checks}</option>
                  <option value="approval_required">{AUTONOMY_LABELS.approval_required}</option>
                </Select>
                {locked && <LockKeyhole className="h-3.5 w-3.5 text-warning" />}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function SafetyCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-label">
      {ok ? <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.75} /> : <AlertTriangle className="h-4 w-4 text-warning" strokeWidth={1.75} />}
      <span className={ok ? "text-foreground-secondary" : "text-warning"}>{label}</span>
    </div>
  );
}
