"use client";

import { useMemo, useState } from "react";
import { Check, CircleDashed, Lock, MessageSquareQuote, Plus, Timer, X } from "lucide-react";
import {
  workflowStages,
  type ConnectionRecord,
  type WorkflowOverview,
  type WorkflowRecord,
  type WorkflowStageStatus,
} from "@jarvis/shared";
import { api } from "@/lib/api";
import { useConnections } from "@/lib/hooks";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { CharacterSheetEditor } from "@/components/CharacterSheetEditor";

/** Platforms whose spend belongs to stage 4. */
const AD_CATEGORY = "advertising";

const STATE_ICON = {
  done: Check,
  ready: CircleDashed,
  blocked: Lock,
} as const;

const STATE_STYLE = {
  done: "bg-success/12 text-success ring-success/25",
  ready: "bg-accent/12 text-accent-bright ring-accent/30",
  blocked: "bg-white/[0.04] text-muted ring-white/10",
} as const;

/**
 * The five stages, as the workflow's permanent view.
 *
 * Not a wizard: stages 3–5 cannot be completed on the day a workflow is
 * created, so a linear flow would march through impossible steps. Each stage
 * states what is true or why it cannot proceed, and keeps doing so once the
 * workflow is running — see WORKFLOW_PLAN.md.
 */
export function WorkflowStageRail({
  workflow,
  overview,
  onChanged,
}: {
  workflow: WorkflowRecord;
  overview: WorkflowOverview | null;
  onChanged: () => Promise<void>;
}) {
  const { platforms, connections } = useConnections();
  const [attaching, setAttaching] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachedIds = useMemo(
    () =>
      (overview?.accounts ?? [])
        .filter((link) => link.workflowId === workflow.id)
        .map((link) => link.connectionId),
    [overview, workflow.id]
  );

  const attached = useMemo(
    () => connections.filter((connection) => attachedIds.includes(connection.id)),
    [connections, attachedIds]
  );

  const adPlatformIds = useMemo(
    () => platforms.filter((p) => p.category === AD_CATEGORY).map((p) => p.id),
    [platforms]
  );

  const stages = useMemo(() => {
    const content = (overview?.content ?? []).filter((item) => item.workflowId === workflow.id);
    const contentIds = new Set(content.map((item) => item.id));
    return workflowStages({
      accounts: attached,
      content,
      publicationRuns: (overview?.publicationRuns ?? []).filter((run) =>
        contentIds.has(run.contentItemId)
      ),
      metricCount: overview?.metricCounts?.[workflow.id] ?? 0,
      adCampaigns: overview?.adCampaignCounts?.[workflow.id] ?? 0,
      adPlatformConnected: connections.some(
        (c) => adPlatformIds.includes(c.platformId) && c.status === "connected"
      ),
      insightCount: overview?.insightCounts?.[workflow.id] ?? 0,
    });
  }, [overview, workflow.id, attached, connections, adPlatformIds]);

  /** Accounts this agent may attach: not already attached, and reachable by it. */
  const character =
    (overview?.characters ?? []).find((c) => c.workflowId === workflow.id) ?? null;

  const attachable = connections.filter(
    (connection) =>
      !attachedIds.includes(connection.id) &&
      (!connection.agentId || !workflow.agentId || connection.agentId === workflow.agentId)
  );

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-heading text-foreground">Stages</div>
        <div className="text-micro text-muted">
          {stages.filter((s) => s.state === "done").length} of {stages.length} complete
        </div>
      </div>

      <ol className="space-y-1">
        {stages.map((stage) => (
          <StageRow
            key={stage.key}
            stage={stage}
            action={
              stage.key === "accounts" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-micro text-muted"
                  disabled={busy || attachable.length === 0}
                  onClick={() => setAttaching((open) => !open)}
                >
                  <Plus className="h-3 w-3" strokeWidth={1.75} />
                  Attach
                </Button>
              ) : null
            }
          />
        ))}
      </ol>

      {attaching && (
        <AttachAccount
          options={attachable}
          busy={busy}
          onCancel={() => setAttaching(false)}
          onAttach={async (connectionId) => {
            await act(() => api.attachWorkflowAccount(workflow.id, connectionId));
            setAttaching(false);
          }}
        />
      )}

      {attached.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {attached.map((connection) => (
            <span
              key={connection.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/20 px-2.5 py-1 text-micro text-foreground-secondary"
            >
              {connection.label ?? connection.platformId}
              <button
                type="button"
                aria-label={`Detach ${connection.label ?? connection.platformId}`}
                className="text-muted transition-colors hover:text-danger"
                disabled={busy}
                onClick={() => void act(() => api.detachWorkflowAccount(workflow.id, connection.id))}
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-label font-medium text-foreground">
            <MessageSquareQuote className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
            Voice
          </div>
          <p className="mt-0.5 truncate text-micro text-muted">
            {character
              ? `${character.name} — ${character.exemplars.length} example${character.exemplars.length === 1 ? "" : "s"}`
              : "No character set. Drafts use the business context alone."}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-micro text-muted" disabled={busy} onClick={() => setEditingCharacter(true)}>
          {character ? "Edit" : "Create"}
        </Button>
      </div>

      {editingCharacter && (
        <CharacterSheetEditor
          workflow={workflow}
          character={character}
          onClose={() => setEditingCharacter(false)}
          onSaved={onChanged}
        />
      )}

      <div className="mt-4 border-t border-border pt-4">
        <AutopilotControl workflow={workflow} busy={busy} onChange={(patch) => act(() => api.updateWorkflow(workflow.id, patch))} />
      </div>

      {error && <p className="mt-3 text-label text-danger">{error}</p>}
    </Card>
  );
}

/**
 * Automates *when* approved content goes out, never whether it goes out.
 * Publishing still hits the outbound approval gate, and a paused workflow
 * schedules nothing — so this is a convenience switch, not an autonomy switch.
 */
function AutopilotControl({
  workflow,
  busy,
  onChange,
}: {
  workflow: WorkflowRecord;
  busy: boolean;
  onChange: (patch: { autopilot?: boolean; autopilotIntervalHours?: number }) => void;
}) {
  const paused = workflow.status !== "active";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-label font-medium text-foreground">
          <Timer className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
          Autopilot
        </div>
        <p className="mt-0.5 text-micro text-muted">
          {workflow.autopilot
            ? paused
              ? `On, but this workflow is ${workflow.status} — nothing will be scheduled.`
              : `Approved content is scheduled every ${workflow.autopilotIntervalHours}h. Publishing still asks.`
            : "Off. You pick a time for each post."}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {workflow.autopilot && (
          <Select
            aria-label="Autopilot interval"
            className="h-7 w-auto py-0 text-micro"
            value={String(workflow.autopilotIntervalHours)}
            disabled={busy}
            onChange={(event) => onChange({ autopilotIntervalHours: Number(event.target.value) })}
          >
            {[6, 12, 24, 48, 72, 168].map((hours) => (
              <option key={hours} value={hours}>
                every {hours}h
              </option>
            ))}
          </Select>
        )}
        <Button
          type="button"
          size="sm"
          variant={workflow.autopilot ? "secondary" : "ghost"}
          className={`h-7 rounded-xl px-2.5 text-micro ${workflow.autopilot ? "text-accent-bright" : "text-muted"}`}
          role="switch"
          aria-checked={workflow.autopilot}
          disabled={busy}
          onClick={() => onChange({ autopilot: !workflow.autopilot })}
        >
          {workflow.autopilot ? "On" : "Off"}
        </Button>
      </div>
    </div>
  );
}

function StageRow({ stage, action }: { stage: WorkflowStageStatus; action?: React.ReactNode }) {
  const Icon = STATE_ICON[stage.state];
  return (
    <li className="flex items-center gap-3 rounded-lg px-1 py-2">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-semibold ring-1 ring-inset ${STATE_STYLE[stage.state]}`}
        aria-hidden="true"
      >
        <Icon className="h-3 w-3" strokeWidth={2} />
      </span>
      <span className="w-4 shrink-0 text-micro tabular-nums text-muted">{stage.number}</span>
      <span className="w-24 shrink-0 text-label font-medium text-foreground">{stage.label}</span>
      <span
        className={`min-w-0 flex-1 truncate text-label ${stage.state === "blocked" ? "text-muted" : "text-foreground-secondary"}`}
      >
        {stage.detail}
      </span>
      {action}
    </li>
  );
}

function AttachAccount({
  options,
  busy,
  onAttach,
  onCancel,
}: {
  options: ConnectionRecord[];
  busy: boolean;
  onAttach: (connectionId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState(options[0]?.id ?? "");
  if (options.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-black/20 p-3">
      <Select
        aria-label="Account to attach"
        className="h-8 flex-1 py-0 text-label"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        {options.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.label ?? connection.platformId}
            {connection.status === "connected" ? "" : " — not connected"}
          </option>
        ))}
      </Select>
      <Button type="button" size="sm" disabled={busy || !selected} onClick={() => void onAttach(selected)}>
        Attach
      </Button>
      <Button type="button" size="sm" variant="ghost" className="text-muted" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
