"use client";

import { useState } from "react";
import { FlaskConical, Plus, CheckCircle2, XCircle, Hourglass } from "lucide-react";
import type { CampaignExperimentView, PaidGrowthCampaignView } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useCampaignExperiments, usePaidGrowth } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Overlay as MotionOverlay } from "@/components/motion";
import { useDialog } from "@/lib/useDialog";

function ratio(value: number | null) {
  return value === null ? "—" : `${value.toFixed(2)}×`;
}

export function CampaignExperiments() {
  const { overview, refresh } = useCampaignExperiments();
  const { overview: paidGrowth } = usePaidGrowth();
  const createDialog = useDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jarvis could not complete that experiment action.");
    } finally {
      setBusy(null);
    }
  }

  if (!overview) return null;

  return (
    <Card>
      <CardHeader
        title="Campaign experiments"
        description="A declared, evidence-gated comparison — not a continuous heuristic. Concluding one proposes a bounded reallocation, still approval-gated."
        icon={<FlaskConical className="h-4 w-4" />}
        action={<Button size="sm" onClick={createDialog.show} disabled={(paidGrowth?.campaigns.length ?? 0) < 2}><Plus className="h-3.5 w-3.5" /> New experiment</Button>}
      />
      <div className="flex flex-col gap-3 px-5 pb-5">
        {error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-label text-danger">{error}</div>}
        {overview.experiments.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center">
            <FlaskConical className="h-6 w-6 text-muted" strokeWidth={1.5} />
            <h3 className="mt-3 text-body font-medium text-foreground">No experiments declared yet</h3>
            <p className="mt-1 max-w-md text-label text-muted">Group two or more paid campaigns into a declared comparison to reallocate budget on real evidence, not a hunch.</p>
          </div>
        ) : overview.experiments.map((experiment) => (
          <ExperimentCard
            key={experiment.id}
            experiment={experiment}
            busy={busy}
            onConclude={() => act(`conclude-${experiment.id}`, () => api.concludeCampaignExperiment(experiment.id))}
            onAbandon={() => act(`abandon-${experiment.id}`, () => api.abandonCampaignExperiment(experiment.id, "Stopped early by a human."))}
          />
        ))}
      </div>
      <CreateExperiment key={createDialog.key} open={createDialog.open} campaigns={paidGrowth?.campaigns ?? []} onClose={createDialog.hide} onCreated={async () => { await refresh(); createDialog.hide(); }} />
    </Card>
  );
}

function ExperimentCard({ experiment, busy, onConclude, onAbandon }: { experiment: CampaignExperimentView; busy: string | null; onConclude: () => void; onAbandon: () => void }) {
  const statusTone = experiment.status === "running" ? "accent" : experiment.status === "concluded" ? "success" : "neutral";
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-heading text-foreground">{experiment.name}</h3><Badge tone={statusTone}>{experiment.status}</Badge></div>
          <p className="mt-1.5 line-clamp-2 text-label text-muted">{experiment.hypothesis}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {experiment.variants.map((variant) => (
          <div key={variant.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-label">
            <span className="truncate text-foreground">{variant.name}{experiment.winnerPaidCampaignId === variant.id && <Badge tone="success" className="ml-2">Winner</Badge>}</span>
            <span className="shrink-0 tabular-nums text-muted">{ratio(variant.metrics.roas)} ROAS · {variant.conversions} conversions</span>
          </div>
        ))}
      </div>
      {experiment.status === "running" && experiment.eligibility && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-1.5 text-label text-muted">
            {experiment.eligibility.ready ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Hourglass className="h-3.5 w-3.5" />}
            {experiment.eligibility.reason}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy === `abandon-${experiment.id}`} onClick={onAbandon}><XCircle className="h-3.5 w-3.5" /> Abandon</Button>
            <Button size="sm" disabled={!experiment.eligibility.ready || busy === `conclude-${experiment.id}`} onClick={onConclude}><CheckCircle2 className="h-3.5 w-3.5" /> Conclude</Button>
          </div>
        </div>
      )}
      {experiment.status !== "running" && experiment.conclusionNote && (
        <p className="mt-3 border-t border-border pt-3 text-label text-foreground-secondary">{experiment.conclusionNote}</p>
      )}
    </div>
  );
}

function CreateExperiment({ open, campaigns, onClose, onCreated }: { open: boolean; campaigns: PaidGrowthCampaignView[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [controlId, setControlId] = useState("");
  const [minConversions, setMinConversions] = useState(5);
  const [minDays, setMinDays] = useState(7);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const valid = name.trim() && hypothesis.trim() && selected.length >= 2 && minConversions >= 1 && minDays >= 1;

  return (
    <MotionOverlay open={open} onDismiss={onClose}>
      <Card elevation={2} className="w-full max-w-2xl">
        <CardHeader title="Declare a campaign experiment" description="Pick at least two existing paid campaigns to compare. Nothing reallocates until it clears both thresholds and is concluded and approved." icon={<FlaskConical className="h-4 w-4" />} />
        <CardBody className="space-y-3">
          <Input autoFocus className="w-full" placeholder="Experiment name" value={name} onChange={(event) => setName(event.target.value)} />
          <Textarea rows={2} className="w-full" placeholder="Hypothesis — what are you trying to learn?" value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} />
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-muted">Variant campaigns</span>
            {campaigns.length < 2 ? (
              <p className="text-label text-muted">Create at least two paid campaigns first.</p>
            ) : campaigns.map((campaign) => (
              <label key={campaign.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-label text-foreground">
                <input type="checkbox" checked={selected.includes(campaign.id)} onChange={() => toggle(campaign.id)} />
                {campaign.name}
                <span className="ml-auto text-micro text-muted">{ratio(campaign.metrics.roas)} ROAS</span>
              </label>
            ))}
          </div>
          {selected.length >= 2 && (
            <Select className="w-full" value={controlId} onChange={(event) => setControlId(event.target.value)}>
              <option value="">No designated control</option>
              {selected.map((id) => <option key={id} value={id}>{campaigns.find((c) => c.id === id)?.name} as control</option>)}
            </Select>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-label text-muted">Minimum conversions per variant</span><Input type="number" min={1} value={minConversions} onChange={(event) => setMinConversions(Number(event.target.value))} className="w-full" /></label>
            <label><span className="mb-1.5 block text-label text-muted">Minimum days running</span><Input type="number" min={1} value={minDays} onChange={(event) => setMinDays(Number(event.target.value))} className="w-full" /></label>
          </div>
          {error && <div className="text-label text-danger">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!valid || saving}
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  await api.createCampaignExperiment({
                    name: name.trim(),
                    hypothesis: hypothesis.trim(),
                    variantPaidCampaignIds: selected,
                    controlPaidCampaignId: controlId || undefined,
                    minConversionsPerVariant: minConversions,
                    minDaysRunning: minDays,
                  });
                  await onCreated();
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "Could not create the experiment.");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Creating…" : "Declare experiment"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </MotionOverlay>
  );
}
