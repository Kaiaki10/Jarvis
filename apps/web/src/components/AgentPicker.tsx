"use client";

import { useEffect, useState } from "react";
import { Archive, Bot, Check, Cpu, FolderOpen, Plus, RotateCcw, Zap, Brain, Sparkles } from "lucide-react";
import type { AgentRecord, ChatModel, LocalModelsStatus, OpenCodeModelsStatus } from "@jarvis/shared";
import { CLAUDE_MODELS } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useAgents } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Stagger } from "@/components/motion/Stagger";

/**
 * Choose which agent the dashboard is showing.
 *
 * Selection lives in the store, which scopes every subsequent request to it and
 * reloads the workspace on a switch. This page only presents the choice.
 */
export function AgentPicker() {
  const { agents, refresh, activeAgent, selectAgent } = useAgents();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localModels, setLocalModels] = useState<LocalModelsStatus>({ reachable: false, models: [] });
  const [opencodeModels, setOpencodeModels] = useState<OpenCodeModelsStatus>({ reachable: false, models: [] });
  const [presetBusy, setPresetBusy] = useState<ChatModel | null>(null);

  const active = agents.filter((agent) => agent.status === "active");
  const archived = agents.filter((agent) => agent.status === "archived");

  const effectiveId = activeAgent?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    api.getLocalModels()
      .then((status) => { if (!cancelled) setLocalModels(status); })
      .catch(() => { if (!cancelled) setLocalModels({ reachable: false, models: [] }); });
    api.getOpencodeModels()
      .then((status) => { if (!cancelled) setOpencodeModels(status); })
      .catch(() => { if (!cancelled) setOpencodeModels({ reachable: false, models: [] }); });
    return () => { cancelled = true; };
  }, []);

  async function setStatus(agent: AgentRecord, status: "active" | "archived") {
    setError(null);
    try {
      if (status === "archived") await api.archiveAgent(agent.id);
      else await api.updateAgent(agent.id, { status: "active" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function applyPreset(lane: ChatModel) {
    setPresetBusy(lane);
    setError(null);
    try {
      await api.setBrainPreset(lane);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPresetBusy(null);
    }
  }

  async function setBrain(agent: AgentRecord, brainLane: ChatModel, brainModel: string | null) {
    setError(null);
    try {
      await api.updateAgent(agent.id, { brainLane, brainModel });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-label text-danger">
            {error}
          </div>
        )}

        {active.length ? (
          <>
            <BrainPresetBar busy={presetBusy} onPreset={applyPreset} />
            <div className="grid gap-4 sm:grid-cols-2">
              {active.map((agent, index) => (
                <Stagger key={agent.id} index={index}>
                  <AgentCard
                    agent={agent}
                    selected={agent.id === effectiveId}
                    onSelect={() => selectAgent(agent.id)}
                    onArchive={() => setStatus(agent, "archived")}
                    localModels={localModels}
                    opencodeModels={opencodeModels}
                    onBrain={(lane, model) => setBrain(agent, lane, model)}
                  />
                </Stagger>
              ))}
            </div>
          </>
        ) : (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
                <Bot className="h-6 w-6 text-muted" strokeWidth={1.75} />
                <div className="mt-3 text-title text-foreground">No agents yet</div>
                <p className="mt-1 max-w-md text-label text-muted">
                  Create one on the right. It gets its own persona, working
                  directory, and ongoing conversation.
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        {archived.length > 0 && (
          <Card elevation={0}>
            <CardHeader
              title="Archived"
              description="Their runs and missions stay attributable"
              icon={<Archive className="h-4 w-4" strokeWidth={1.75} />}
            />
            <CardBody className="space-y-2">
              {archived.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-black/10 px-3 py-2.5"
                >
                  <AgentAvatar agent={agent} muted />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-label font-medium text-foreground">
                      {agent.name}
                    </div>
                    {agent.role && (
                      <div className="truncate text-micro text-muted">{agent.role}</div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setStatus(agent, "active")}>
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Restore
                  </Button>
                </div>
              ))}
            </CardBody>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader
          title="New agent"
          description="A separate persona with its own workspace"
          icon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
        />
        <CardBody>
          <CreateAgentForm
            busy={creating}
            setBusy={setCreating}
            onError={setError}
            onCreated={async (agent) => {
              await refresh();
              selectAgent(agent.id);
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}

function AgentAvatar({ agent, muted = false }: { agent: AgentRecord; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.6rem] text-body font-bold shadow-elev-1 ring-1 ring-inset ring-white/20 ${
        muted
          ? "bg-surface-hover text-muted"
          : "bg-gradient-to-br from-accent-bright to-accent text-white"
      }`}
    >
      {agent.avatar}
    </span>
  );
}

/**
 * Group brains: one lane for every active agent at once. Each agent keeps
 * the specific model it already has for that lane (or the lane default), so
 * flipping the whole fleet never orphans anyone's threads.
 */
function BrainPresetBar({ busy, onPreset }: { busy: ChatModel | null; onPreset: (lane: ChatModel) => void }) {
  const presets: Array<{ lane: ChatModel; label: string; title: string }> = [
    { lane: "claude", label: "All Claude", title: "Every agent answers with Claude" },
    { lane: "gpt-5.6-sol", label: "All GPT", title: "Every agent answers with GPT-5.6 Sol" },
    { lane: "local", label: "All Local", title: "Every agent answers with its Ollama model" },
    { lane: "opencode", label: "All OpenCode", title: "Every agent answers with its OpenCode model" },
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-black/20 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-wider text-muted">
        <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
        Fleet brains
      </span>
      {presets.map(({ lane, label, title }) => (
        <Button
          key={lane}
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 rounded-lg px-2.5 text-micro text-muted"
          title={title}
          disabled={busy !== null}
          onClick={() => onPreset(lane)}
        >
          {busy === lane ? "Applying…" : label}
        </Button>
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  selected,
  onSelect,
  onArchive,
  localModels,
  opencodeModels,
  onBrain,
}: {
  agent: AgentRecord;
  selected: boolean;
  onSelect: () => void;
  onArchive: () => void;
  localModels: LocalModelsStatus;
  opencodeModels: OpenCodeModelsStatus;
  onBrain: (lane: ChatModel, model: string | null) => void;
}) {
  return (
    <Card
      elevation={selected ? 2 : 1}
      className={`h-full ${selected ? "border-accent/50" : ""}`}
    >
      <CardBody className="flex h-full flex-col gap-3">
        <div className="flex items-start gap-3">
          <AgentAvatar agent={agent} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-title text-foreground">{agent.name}</div>
            <div className="truncate text-label text-muted">
              {agent.role || "No role set"}
            </div>
          </div>
          {selected && (
            <Badge tone="accent">
              <Check className="h-3 w-3" strokeWidth={2} />
              Selected
            </Badge>
          )}
        </div>

        {agent.cwd && (
          <div className="flex min-w-0 items-center gap-1.5 text-micro text-muted">
            <FolderOpen className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            <span className="truncate font-mono">{agent.cwd}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-black/20 px-2.5 py-2">
          <span className="text-micro font-medium uppercase tracking-wider text-muted">Brain</span>
          <Select
            aria-label={`${agent.name} brain lane`}
            className="h-7 w-auto rounded-lg py-0 text-micro"
            value={agent.brainLane}
            onChange={(e) => onBrain(e.target.value as ChatModel, agent.brainModel)}
          >
            <option value="claude">Claude</option>
            <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
            <option value="local">Local</option>
            <option value="opencode">OpenCode</option>
          </Select>
          {agent.brainLane === "claude" && (
            <Select
              aria-label={`${agent.name} Claude model`}
              className="h-7 w-auto max-w-40 rounded-lg py-0 text-micro"
              value={agent.brainModel ?? "default"}
              onChange={(e) => onBrain("claude", e.target.value)}
            >
              {CLAUDE_MODELS.map((option) => (
                <option key={option.value} value={option.value} title={option.description}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
          {agent.brainLane === "local" && (
            localModels.reachable && localModels.models.length > 0 ? (
              <Select
                aria-label={`${agent.name} local model`}
                className="h-7 w-auto max-w-40 rounded-lg py-0 text-micro"
                value={agent.brainModel ?? ""}
                onChange={(e) => onBrain("local", e.target.value || null)}
              >
                <option value="" disabled>Pick a model</option>
                {localModels.models.map((option) => (
                  <option key={option.name} value={option.name}>{option.name}</option>
                ))}
              </Select>
            ) : (
              <span className="text-micro text-muted" title="Ollama isn't reachable — start it to choose a model">
                Ollama offline
              </span>
            )
          )}
          {agent.brainLane === "opencode" && (
            opencodeModels.reachable && opencodeModels.models.length > 0 ? (
              <Select
                aria-label={`${agent.name} OpenCode model`}
                className="h-7 w-auto max-w-40 rounded-lg py-0 text-micro"
                value={agent.brainModel ?? ""}
                onChange={(e) => onBrain("opencode", e.target.value || null)}
              >
                <option value="" disabled>Pick a model</option>
                {opencodeModels.models.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </Select>
            ) : (
              <span className="text-micro text-muted" title="OpenCode Inference isn't reachable — check the connection">
                OpenCode offline
              </span>
            )
          )}
          {agent.brainLane === "gpt-5.6-sol" && (
            <span className="flex items-center gap-1 text-micro text-muted">
              <Sparkles className="h-3 w-3" strokeWidth={1.75} />
              GPT-5.6 Sol
            </span>
          )}
          {agent.brainLane === "local" && agent.brainModel && (
            <span className="flex items-center gap-1 text-micro text-muted">
              <Cpu className="h-3 w-3" strokeWidth={1.75} />
              {agent.brainModel}
            </span>
          )}
          {agent.brainLane === "opencode" && agent.brainModel && (
            <span className="flex items-center gap-1 text-micro text-muted">
              <Zap className="h-3 w-3" strokeWidth={1.75} />
              {agent.brainModel}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant={selected ? "secondary" : "primary"}
            onClick={onSelect}
            disabled={selected}
          >
            {selected ? "Current agent" : "Select"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onArchive}
            aria-label={`Archive ${agent.name}`}
          >
            <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function CreateAgentForm({
  busy,
  setBusy,
  onError,
  onCreated,
}: {
  busy: boolean;
  setBusy: (value: boolean) => void;
  onError: (message: string | null) => void;
  onCreated: (agent: AgentRecord) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [cwd, setCwd] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    onError(null);
    try {
      const agent = await api.createAgent({
        name: name.trim(),
        role: role.trim() || undefined,
        cwd: cwd.trim() || undefined,
        systemPrompt: systemPrompt || undefined,
      });
      setName("");
      setRole("");
      setCwd("");
      setSystemPrompt("");
      await onCreated(agent);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-micro font-medium text-muted" htmlFor="agent-name">
          Name
        </label>
        <Input
          id="agent-name"
          className="mt-1 w-full"
          placeholder="Atlas"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="text-micro font-medium text-muted" htmlFor="agent-role">
          Role
        </label>
        <Input
          id="agent-role"
          className="mt-1 w-full"
          placeholder="Research and analysis"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
      </div>
      <div>
        <label className="text-micro font-medium text-muted" htmlFor="agent-cwd">
          Working directory
        </label>
        <Input
          id="agent-cwd"
          className="mt-1 w-full font-mono"
          placeholder="C:\Users\you\projects\research"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
        />
        <p className="mt-1 text-micro text-muted">
          Must already exist. Leave blank to decide later.
        </p>
      </div>
      <div>
        <label className="text-micro font-medium text-muted" htmlFor="agent-prompt">
          Persona
        </label>
        <Textarea
          id="agent-prompt"
          className="mt-1 w-full"
          rows={4}
          placeholder="What this agent is for, how it should behave, and what it should never do."
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>
      <Button className="w-full" onClick={submit} disabled={busy || !name.trim()}>
        <Plus className="h-4 w-4" strokeWidth={1.75} />
        {busy ? "Creating…" : "Create agent"}
      </Button>
    </div>
  );
}
