"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, MessagesSquare, Play, Plus, Square, Trash2, Users } from "lucide-react";
import type {
  AgentConversationDetail,
  AgentConversationRecord,
} from "@jarvis/shared";
import { api } from "@/lib/api";
import { useAgents, useConversations } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  idle: "neutral",
  running: "accent",
  completed: "success",
  stopped: "warning",
  error: "danger",
};

export function ConversationRoom() {
  const { conversations, refresh } = useConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0] ?? null;

  return (
    <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-label text-danger">
            {error}
          </div>
        )}
        <NewConversation onError={setError} onCreated={async (room) => {
          await refresh();
          setSelectedId(room.id);
        }} />

        <Card>
          <CardHeader
            title="Conversations"
            description="Rooms where your agents talk to each other"
            icon={<MessagesSquare className="h-4 w-4" strokeWidth={1.75} />}
          />
          <CardBody className="space-y-2">
            {conversations.length ? (
              conversations.map((room) => (
                <button
                  key={room.id}
                  onClick={() => setSelectedId(room.id)}
                  className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    room.id === selected?.id
                      ? "border-accent/50 bg-white/[0.05]"
                      : "border-border bg-black/10 hover:border-border-strong"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground">
                      {room.title}
                    </span>
                    <Badge tone={STATUS_TONE[room.status] ?? "neutral"} dot pulse={room.status === "running"}>
                      {room.status}
                    </Badge>
                  </span>
                  <span className="text-micro text-muted">
                    {room.turnsUsed} of {room.turnCap} turns
                  </span>
                </button>
              ))
            ) : (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
                <Users className="h-6 w-6 text-muted" strokeWidth={1.75} />
                <div className="mt-3 text-title text-foreground">No conversations yet</div>
                <p className="mt-1 max-w-xs text-label text-muted">
                  Pick two agents and a topic above, and they will talk it through.
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {selected ? (
        <RoomTranscript key={selected.id} room={selected} onError={setError} onChanged={refresh} />
      ) : (
        <Card elevation={2}>
          <CardBody>
            <div className="flex flex-col items-center py-20 text-center">
              <MessagesSquare className="h-6 w-6 text-muted" strokeWidth={1.75} />
              <div className="mt-3 text-title text-foreground">Nothing selected</div>
              <p className="mt-1 max-w-sm text-label text-muted">
                Create a conversation to watch two agents work a question out between them.
              </p>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function NewConversation({
  onCreated,
  onError,
}: {
  onCreated: (room: AgentConversationRecord) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { agents } = useAgents();
  const active = agents.filter((a) => a.status === "active");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [turnCap, setTurnCap] = useState(8);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function create() {
    if (busy || picked.length < 2 || !title.trim() || !topic.trim()) return;
    setBusy(true);
    onError(null);
    try {
      const room = await api.createConversation({
        title: title.trim(),
        topic: topic.trim(),
        agentIds: picked,
        turnCap,
      });
      setTitle("");
      setTopic("");
      setPicked([]);
      await onCreated(room);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="New conversation"
        description="Two or more agents, one topic"
        icon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
      />
      <CardBody className="space-y-3">
        <Input
          className="w-full"
          placeholder="Title, e.g. Pricing for the launch"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          className="w-full"
          rows={3}
          placeholder="What should they discuss? Be specific about what a good answer looks like."
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <div>
          <div className="mb-1.5 text-micro font-medium text-muted">
            Participants ({picked.length} chosen, 2 minimum)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {active.map((agent) => (
              <button
                key={agent.id}
                onClick={() => toggle(agent.id)}
                aria-pressed={picked.includes(agent.id)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label transition-colors ${
                  picked.includes(agent.id)
                    ? "border-accent/50 bg-accent/15 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                <span className="text-micro font-bold">{agent.avatar}</span>
                {agent.name}
              </button>
            ))}
          </div>
          {active.length < 2 && (
            <p className="mt-2 text-micro text-warning">
              You need at least two agents. Create another on the Agents page.
            </p>
          )}
        </div>
        <div>
          <label className="text-micro font-medium text-muted" htmlFor="turn-cap">
            Turn limit
          </label>
          <Input
            id="turn-cap"
            type="number"
            min={2}
            max={40}
            className="mt-1 w-full tabular-nums"
            value={turnCap}
            onChange={(e) => setTurnCap(Number(e.target.value))}
          />
          {/* Two agents talking is an infinite generator, so the limit is shown
              as a decision rather than buried as a default. */}
          <p className="mt-1 text-micro text-muted">
            The conversation stops here no matter what. You can also stop it at any time.
          </p>
        </div>
        <Button
          className="w-full"
          onClick={create}
          disabled={busy || picked.length < 2 || !title.trim() || !topic.trim()}
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          {busy ? "Creating…" : "Create conversation"}
        </Button>
      </CardBody>
    </Card>
  );
}

function RoomTranscript({
  room,
  onError,
  onChanged,
}: {
  room: AgentConversationRecord;
  onError: (message: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<AgentConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.getConversation(room.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [room.id, onError]);

  // Reloads whenever the room's summary row changes, which the shared event
  // stream updates on every turn.
  //
  // The cancelled flag is not ceremony: turns land while a reply is in flight,
  // and without it a slow response for the previous turn can overwrite a newer
  // transcript, making the room appear to lose its last message.
  useEffect(() => {
    let cancelled = false;
    api
      .getConversation(room.id)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) onError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [room.id, room.turnsUsed, room.status, onError]);

  useEffect(() => {
    const area = scrollRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [detail?.messages.length]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    onError(null);
    try {
      await fn();
      await onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const running = room.status === "running";

  return (
    <Card elevation={2} className="flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-title text-foreground">{room.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-micro text-muted">
            {detail?.participants.map((p) => (
              <span key={p.agentId} className="flex items-center gap-1">
                <span className="font-bold">{p.avatar}</span>
                {p.name}
              </span>
            ))}
            <span className="tabular-nums">
              · {room.turnsUsed}/{room.turnCap} turns
            </span>
          </div>
        </div>
        <Badge tone={STATUS_TONE[room.status] ?? "neutral"} dot pulse={running}>
          {room.status}
        </Badge>
        {running ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => act(() => api.stopConversation(room.id))}>
            <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy || room.turnsUsed >= room.turnCap}
            onClick={() => act(() => api.startConversation(room.id))}
          >
            <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
            {room.turnsUsed ? "Continue" : "Start"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete conversation"
          disabled={busy}
          onClick={() => act(() => api.deleteConversation(room.id))}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Button>
      </div>

      {room.stopReason && (
        <div className="border-b border-border bg-black/20 px-5 py-2 text-label text-muted">
          {room.stopReason}
        </div>
      )}

      <div ref={scrollRef} className="max-h-[calc(100vh-26rem)] min-h-[20rem] overflow-y-auto px-5 py-5">
        <div className="mb-4 rounded-lg border border-border bg-black/15 px-4 py-3">
          <div className="text-micro font-medium tracking-wide text-muted uppercase">Topic</div>
          <p className="mt-1 text-body text-foreground-secondary">{room.topic}</p>
        </div>

        {detail?.messages.length ? (
          <div className="flex flex-col gap-3">
            {detail.messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.speakerAgentId === null
                    ? "animate-message-in max-w-[80%] self-end rounded-2xl rounded-br-md bg-gradient-to-br from-accent-bright to-accent px-4 py-2.5 text-body whitespace-pre-wrap text-white shadow-elev-1 ring-1 ring-inset ring-white/15"
                    : "animate-message-in max-w-[92%] self-start rounded-2xl rounded-tl-md border border-border bg-white/[0.03] px-4 py-2.5 shadow-elev-1"
                }
              >
                {message.speakerAgentId !== null && (
                  <div className="mb-1 text-micro font-semibold text-accent-bright">
                    {message.speakerName}
                  </div>
                )}
                <div className="text-body whitespace-pre-wrap text-foreground">{message.body}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-body text-muted">
            Nothing said yet. Press Start and the first agent will open.
          </p>
        )}

        {running && (
          <div className="mt-3 flex items-center gap-2 px-1 text-label">
            <span className="relative flex h-1.5 w-1.5 text-accent">
              <span className="ping-ring absolute inset-0 rounded-full" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            <span className="text-shimmer font-medium">Thinking…</span>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-black/25 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            className="min-h-[2.5rem] flex-1"
            rows={1}
            placeholder="Say something to the room…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            size="icon"
            className="mb-1 h-8 w-8 shrink-0"
            aria-label="Send to the room"
            disabled={busy || !draft.trim()}
            onClick={() =>
              act(async () => {
                await api.sendConversationMessage(room.id, draft.trim());
                setDraft("");
              })
            }
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-micro text-muted">
          Your message joins the transcript and the agents see it on their next turn.
        </p>
      </div>
    </Card>
  );
}
