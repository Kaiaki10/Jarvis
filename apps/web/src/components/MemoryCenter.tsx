"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, Brain, CheckCircle2, Plus, RotateCcw, Sparkles } from "lucide-react";
import type { MemoryKind, MemoryRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useMemories } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select, Textarea } from "@/components/ui/Input";

const KIND_LABELS: Record<MemoryKind, string> = {
  preference: "Preference",
  business: "Business",
  relationship: "Relationship",
  decision: "Decision",
  fact: "Fact",
};

export function MemoryCenter() {
  const { memories, reflections, refresh } = useMemories();
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = memories.filter((memory) => memory.status === "active");
  const archived = memories.filter((memory) => memory.status === "archived");

  async function addMemory() {
    if (!content.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.createMemory({ kind, content: content.trim() });
      setContent("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(memory: MemoryRecord, status: "active" | "archived") {
    setError(null);
    try {
      await api.updateMemory(memory.id, { status });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card elevation={2}>
        <CardHeader
          title="What Jarvis remembers"
          description="Durable context shared across fresh conversations and Jarvis runs"
          icon={<Brain className="h-4 w-4" strokeWidth={1.75} />}
          action={<Badge tone="success" dot pulse>{active.length} active</Badge>}
        />
        <CardBody className="space-y-3">
          {active.length ? active.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} onStatus={setStatus} />
          )) : (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <Brain className="h-6 w-6 text-muted" strokeWidth={1.75} />
              <div className="mt-3 text-title text-foreground">Memory is ready</div>
              <p className="mt-1 max-w-md text-label text-muted">
                Tell Jarvis “remember that…” in chat, or add a fact here. It will be available to future conversations immediately.
              </p>
            </div>
          )}
          {archived.length > 0 && (
            <details className="pt-2">
              <summary className="cursor-pointer text-label text-muted">Archived memories ({archived.length})</summary>
              <div className="mt-3 space-y-3">
                {archived.map((memory) => <MemoryRow key={memory.id} memory={memory} onStatus={setStatus} />)}
              </div>
            </details>
          )}
        </CardBody>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Automatic reflection" description="Runs after every Jarvis turn" icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />} />
          <CardBody className="space-y-2">
            {reflections.length ? reflections.slice(0, 5).map((reflection) => (
              <Link key={reflection.id} href={`/sessions/${reflection.sessionId}`} className="flex items-start gap-2.5 rounded-lg border border-border bg-black/10 px-3 py-2.5 transition-colors hover:border-border-strong">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${reflection.status === "reviewed" ? "text-success" : "text-muted"}`} strokeWidth={1.75} />
                <div className="min-w-0"><div className="truncate text-label font-medium text-foreground">{reflection.sessionTitle}</div><div className="mt-0.5 text-micro text-muted">{reflection.status === "skipped" ? "Isolated run · memory protected" : reflection.status === "failed" ? "Reflection stopped with the run" : reflection.memoriesAdded ? `${reflection.memoriesAdded} new ${reflection.memoriesAdded === 1 ? "memory" : "memories"}` : reflection.memoriesConfirmed ? `${reflection.memoriesConfirmed} existing ${reflection.memoriesConfirmed === 1 ? "memory" : "memories"} confirmed` : "Reviewed · nothing durable added"} · {new Date(reflection.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></div>
              </Link>
            )) : <p className="text-label text-muted">The next completed Jarvis turn will appear here.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Add memory" description="Keep it short, durable, and useful later" />
          <CardBody>
          <div className="space-y-3">
            <Select className="w-full" value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)}>
              {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Textarea
              className="min-h-28 w-full"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Example: I prefer launch reviews on Tuesdays."
              maxLength={1000}
            />
            <Button className="w-full" onClick={addMemory} disabled={saving || content.trim().length < 3}>
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              {saving ? "Remembering…" : "Remember this"}
            </Button>
            {error && <p className="text-label text-danger">{error}</p>}
            <p className="text-micro leading-relaxed text-muted">
              Jarvis will not save credentials or guesses. You can archive anything here and it stops entering new run context.
            </p>
          </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function MemoryRow({
  memory,
  onStatus,
}: {
  memory: MemoryRecord;
  onStatus: (memory: MemoryRecord, status: "active" | "archived") => void;
}) {
  const active = memory.status === "active";
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-black/15 px-4 py-3">
      <div className="min-w-0">
        <Badge tone={active ? "accent" : "neutral"}>{KIND_LABELS[memory.kind]}</Badge>
        <p className="mt-2 text-body leading-relaxed text-foreground">{memory.content}</p>
        <p className="mt-1 text-micro text-muted">
          Updated {new Date(memory.updatedAt).toLocaleString()}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label={active ? "Archive memory" : "Restore memory"}
        onClick={() => onStatus(memory, active ? "archived" : "active")}
      >
        {active ? <Archive className="h-4 w-4" strokeWidth={1.75} /> : <RotateCcw className="h-4 w-4" strokeWidth={1.75} />}
      </Button>
    </div>
  );
}
