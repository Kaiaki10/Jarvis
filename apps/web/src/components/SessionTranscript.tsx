"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Check, Eye, ShieldQuestion, Undo2, Wrench, X } from "lucide-react";
import type { SessionEventRecord, SessionRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
}

interface ApiMessage {
  role: string;
  content: string | ContentBlock[];
}

interface ToolCall {
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

function messageText(message: ApiMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

function toolCalls(message: ApiMessage): ToolCall[] {
  if (typeof message.content === "string") return [];
  return message.content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name ?? "tool", input: b.input ?? {} }));
}

function shortenPath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

function firstLine(value: unknown, max = 60): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const line = value.trim().split("\n")[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Mirrors the phrasing of the live "…" activity line, past tense for history. */
function toolCallLabel(name: string, input: Record<string, unknown>): string {
  if (name.startsWith("mcp__jarvis__")) {
    const bare = name.replace("mcp__jarvis__", "");
    return bare.replace(/_/g, " ");
  }
  switch (name) {
    case "Bash": {
      const command = firstLine(input.command, 60);
      return command ? `Ran ${command}` : "Ran a command";
    }
    case "Read":
      return `Read ${shortenPath(input.file_path) ?? "a file"}`;
    case "Write":
      return `Wrote ${shortenPath(input.file_path) ?? "a file"}`;
    case "Edit":
      return `Edited ${shortenPath(input.file_path) ?? "a file"}`;
    case "Glob":
    case "Grep":
      return "Searched the codebase";
    case "TodoWrite":
      return "Updated the plan";
    case "WebSearch":
    case "WebFetch":
      return "Looked something up";
    default:
      return name;
  }
}

interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  expiresAt?: string | null;
}

/** Live countdown, so it's obvious how long is left before an auto-deny. */
function TimeRemaining({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const msLeft = new Date(expiresAt).getTime() - now;
  if (msLeft <= 0) return <span className="text-danger">expired</span>;

  const mins = Math.round(msLeft / 60000);
  const label = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return (
    <span className={mins <= 15 ? "text-danger" : "text-muted"}>
      auto-denies in {label}
    </span>
  );
}

const OUTBOUND_TOOL_LABELS: Record<string, string> = {
  post_to_x: "Post to X",
  post_to_slack: "Send a Slack message",
  post_to_discord: "Send a Discord message",
  send_email: "Send an email",
};

const FIELD_LABELS: Record<string, string> = {
  text: "Message",
  body: "Body",
  subject: "Subject",
  to: "To",
  channel: "Channel",
  channelId: "Channel ID",
};

/** Outbound actions get a readable, editable review instead of raw JSON. */
function outboundAction(toolName: string): string | null {
  const bare = toolName.replace(/^mcp__jarvis__/, "");
  return bare === toolName ? null : (OUTBOUND_TOOL_LABELS[bare] ?? bare);
}

function decisionContext(request: PermissionRequestPayload) {
  const name = request.toolName.replace(/^mcp__[^_]+__/, "");
  const input = request.input;
  if (/bash|shell|exec|command/i.test(name)) {
    return {
      proposal: `Run a command${typeof input.command === "string" ? `: ${input.command.slice(0, 120)}` : " on this computer"}`,
      consequence: "This can change files or local system state depending on the command.",
      reversible: "Depends on the command",
    };
  }
  if (/write|edit|patch/i.test(name)) {
    const target = String(input.file_path ?? input.path ?? input.file ?? "a local file");
    return {
      proposal: `Change ${target}`,
      consequence: "The requested file contents will be modified.",
      reversible: "Usually reversible with version history",
    };
  }
  if (/delete|remove/i.test(name)) {
    return {
      proposal: `Remove ${String(input.path ?? input.file ?? "an item")}`,
      consequence: "The target may no longer be available after approval.",
      reversible: "May not be reversible",
    };
  }
  return {
    proposal: `Use ${name}`,
    consequence: "Jarvis needs authority beyond the permissions already granted to this run.",
    reversible: "Review the exact scope below",
  };
}

/**
 * The rendered conversation: transcript, the text streaming in right now, and any
 * approval waiting on a human. Shared by the ongoing chat with Jarvis and by the
 * read-back of a single automation run.
 */
export function SessionTranscript({
  sessionId,
  session,
  events,
  refreshSession,
  liveTextRef,
  subscribeStreamDelta,
  streaming,
  compact = false,
}: {
  sessionId: string;
  session: SessionRecord | null;
  events: SessionEventRecord[];
  refreshSession: () => void;
  /** Current in-progress reply text. Written by useSessionStream directly, on
   *  every token — read here only to seed the DOM node, never as a render
   *  dependency (see the effect below). */
  liveTextRef: RefObject<string>;
  /** Registers a callback fired synchronously on every streamed token. */
  subscribeStreamDelta: (listener: () => void) => () => void;
  /** True for the whole span of a reply streaming in. Flips at most twice per
   *  turn (start, end) — safe to use as a normal render dependency, unlike
   *  the token text itself. */
  streaming: boolean;
  /**
   * Chat mode. One long-running conversation restarts the underlying process
   * whenever it goes idle, so per-run bookkeeping ("Session started", turn
   * timings) would repeat endlessly and read like a new conversation each time.
   */
  compact?: boolean;
}) {
  const resolvedRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) {
      if (e.type === "permission_response") {
        ids.add((e.payload as { requestId: string }).requestId);
      }
    }
    return ids;
  }, [events]);

  const pendingPermission = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "permission_request") {
        const payload = e.payload as PermissionRequestPayload;
        if (!resolvedRequestIds.has(payload.requestId)) return payload;
      }
    }
    return null;
  }, [events, resolvedRequestIds]);

  // Writes straight into the DOM on every token rather than through React
  // state/render — see liveTextRef's doc comment and DESIGN_SYSTEM.md's
  // Conversation and memory section. Re-subscribing on session switches is
  // what clears stale text left over from a previous session's node.
  const liveTextNodeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = liveTextNodeRef.current;
    if (node) node.textContent = liveTextRef.current;
    return subscribeStreamDelta(() => {
      if (liveTextNodeRef.current) liveTextNodeRef.current.textContent = liveTextRef.current;
    });
  }, [subscribeStreamDelta, liveTextRef, sessionId]);

  // While a turn is in flight but nothing has streamed back yet, say so — otherwise
  // the UI looks identical to "nothing happened".
  const thinking =
    !streaming &&
    !pendingPermission &&
    (session?.status === "running" || session?.status === "starting");

  async function respond(decision: "allow" | "deny", updatedInput?: Record<string, unknown>) {
    if (!pendingPermission) return;
    await api.respondToPermission(sessionId, {
      requestId: pendingPermission.requestId,
      decision,
      updatedInput,
    });
    refreshSession();
  }

  return (
    <div className="flex flex-col gap-3">
      {events.map((event) => (
        <TranscriptEntry key={event.id} event={event} compact={compact} />
      ))}

      {streaming && (
        <div className="animate-message-in rounded-2xl rounded-tl-md border border-border bg-white/[0.03] px-4 py-3 text-body whitespace-pre-wrap text-foreground shadow-elev-1">
          <span ref={liveTextNodeRef} />
          <span className="animate-pulse-soft text-accent-bright">▍</span>
        </div>
      )}

      {thinking && (
        <div className="flex items-center gap-2 px-1 text-label">
          <span className="relative flex h-1.5 w-1.5 text-accent">
            <span className="ping-ring absolute inset-0 rounded-full" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          <span className="text-shimmer font-medium">
            {session?.currentActivity ?? "Working…"}
          </span>
        </div>
      )}

      {pendingPermission && (
        <PermissionCard
          key={pendingPermission.requestId}
          request={pendingPermission}
          onRespond={respond}
        />
      )}
    </div>
  );
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: PermissionRequestPayload;
  onRespond: (
    decision: "allow" | "deny",
    updatedInput?: Record<string, unknown>
  ) => Promise<void>;
}) {
  const action = outboundAction(request.toolName);
  const context = decisionContext(request);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.input)) {
      if (typeof v === "string") initial[k] = v;
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);

  const edited = Object.entries(draft).some(([k, v]) => request.input[k] !== v);

  async function approve() {
    setBusy(true);
    // Only override when the user actually changed something; otherwise let the
    // orchestrator fall back to the original input.
    await onRespond("allow", edited ? { ...request.input, ...draft } : undefined);
  }

  if (!action) {
    return (
      <Card className="border-warning/30 bg-warning/5">
        <div className="flex items-center gap-2 px-4 pt-4 text-body font-medium text-warning">
          <ShieldQuestion className="h-4 w-4" strokeWidth={1.75} />
          Decision needed
          {request.expiresAt && <span className="ml-auto text-micro"><TimeRemaining expiresAt={request.expiresAt} /></span>}
        </div>
        <div className="px-4 pt-2 pb-4">
          <div className="text-title text-foreground">{context.proposal}</div>
          <p className="mt-1 text-label text-muted">{context.consequence}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-black/15 px-3 py-2">
              <div className="flex items-center gap-1.5 text-micro font-medium text-muted uppercase"><Eye className="h-3 w-3" /> Scope</div>
              <div className="mt-1 break-all text-label text-foreground">One use of {request.toolName}</div>
            </div>
            <div className="rounded-lg border border-border bg-black/15 px-3 py-2">
              <div className="flex items-center gap-1.5 text-micro font-medium text-muted uppercase"><Undo2 className="h-3 w-3" /> Recovery</div>
              <div className="mt-1 text-label text-foreground">{context.reversible}</div>
            </div>
          </div>
          <details className="my-3 rounded-lg border border-border bg-black/20 px-3 py-2">
            <summary className="cursor-pointer text-label text-muted">Review exact input</summary>
            <pre className="mt-2 overflow-x-auto text-label text-foreground/70">{JSON.stringify(request.input, null, 2)}</pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRespond("allow")}>
              <Check className="h-3.5 w-3.5 text-success" />
              Allow once
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => onRespond("deny")}>
              <X className="h-3.5 w-3.5" />
              Deny
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-warning/40 bg-warning/5">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <ShieldQuestion className="h-3.5 w-3.5 text-warning" />
        <span className="text-body font-medium text-warning">Decision needed</span>
        {request.expiresAt && (
          <span className="ml-auto text-micro">
            <TimeRemaining expiresAt={request.expiresAt} />
          </span>
        )}
      </div>
      <div className="px-4 pb-4">
        <div className="mb-1 text-title text-foreground">{action}</div>
        <p className="mb-3 text-label text-muted">
          Nothing has been sent. Approval applies to this message only; you can edit it first.
        </p>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-black/15 px-3 py-2 text-label">
            <span className="text-muted">Impact</span>
            <div className="mt-0.5 text-foreground">External recipients may see it immediately.</div>
          </div>
          <div className="rounded-lg border border-border bg-black/15 px-3 py-2 text-label">
            <span className="text-muted">Recovery</span>
            <div className="mt-0.5 text-foreground">Editing or removal depends on the destination.</div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {Object.entries(draft).map(([key, value]) => {
            const multiline = key === "text" || key === "body";
            return (
              <div key={key}>
                <label className="text-micro font-medium text-muted">
                  {FIELD_LABELS[key] ?? key}
                </label>
                {multiline ? (
                  <Textarea
                    className="mt-1 w-full text-body"
                    rows={Math.min(8, Math.max(3, value.split("\n").length + 1))}
                    value={value}
                    onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                  />
                ) : (
                  <Input
                    className="mt-1 w-full text-body"
                    value={value}
                    onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                  />
                )}
                {key === "text" && (
                  <div className="mt-1 text-right text-micro text-muted">
                    {value.length} characters
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={approve}>
            <Check className="h-3.5 w-3.5" />
            {edited ? "Approve edited once" : "Approve once and send"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onRespond("deny");
            }}
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </Button>
          {edited && <span className="text-micro text-muted">Edited</span>}
        </div>
      </div>
    </Card>
  );
}

function TranscriptEntry({
  event,
  compact,
}: {
  event: SessionEventRecord;
  compact: boolean;
}) {
  if (event.type === "user") {
    const payload = event.payload as { message: ApiMessage };
    const text = messageText(payload.message);
    // Tool results come back as "user" messages with no text — rendering those
    // would put empty bubbles through the conversation.
    if (!text.trim()) return null;
    return (
      // Asymmetric corner points back at the sender — the small visual cue that
      // makes a thread readable at a glance without avatars or name labels.
      <div className="animate-message-in max-w-[80%] self-end rounded-2xl rounded-br-md bg-gradient-to-br from-accent-bright to-accent px-4 py-2.5 text-body whitespace-pre-wrap text-white shadow-elev-1 ring-1 ring-inset ring-white/15">
        {text}
      </div>
    );
  }
  if (event.type === "assistant") {
    const payload = event.payload as { message: ApiMessage };
    const text = messageText(payload.message);
    const calls = toolCalls(payload.message);
    if (!text && calls.length === 0) return null;
    return (
      <>
        {text && (
          <div className="animate-message-in max-w-[92%] self-start rounded-2xl rounded-tl-md border border-border bg-white/[0.03] px-4 py-2.5 text-body whitespace-pre-wrap text-foreground shadow-elev-1">
            {text}
          </div>
        )}
        {calls.map((call, i) => (
          <ToolCallRow key={call.id ?? i} call={call} />
        ))}
      </>
    );
  }
  if (event.type === "result") {
    const payload = event.payload as { is_error: boolean; duration_ms: number };
    // In chat, a clean turn ending is not news — but a failed one still is.
    if (compact && !payload.is_error) return null;
    return (
      <div className={`px-1 text-label ${payload.is_error ? "text-danger" : "text-muted"}`}>
        {payload.is_error ? "Turn ended with an error" : "Turn complete"} ·{" "}
        {(payload.duration_ms / 1000).toFixed(1)}s
      </div>
    );
  }
  if (event.type === "system") {
    const payload = event.payload as { subtype?: string; model?: string };
    if (payload.subtype === "init" && !compact) {
      return (
        <div className="px-1 text-label text-muted">Session started · {payload.model}</div>
      );
    }
    return null;
  }
  if (event.type === "permission_response") {
    const payload = event.payload as { decision: string; reason?: string };
    if (payload.reason === "timeout") {
      return (
        <div className="px-1 text-label text-warning">
          Auto-denied — no response within the approval window
        </div>
      );
    }
    return <div className="px-1 text-label text-muted">Permission {payload.decision}</div>;
  }
  return null;
}

/** A single tool call the agent made, collapsed to its label with the raw input on demand. */
function ToolCallRow({ call }: { call: ToolCall }) {
  const bare = call.name.replace(/^mcp__[^_]+__/, "");
  return (
    <details className="animate-message-in max-w-[92%] self-start rounded-lg border border-border bg-black/15 px-3 py-2 text-label text-muted">
      <summary className="cursor-pointer truncate text-foreground-secondary">
        <Wrench className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={1.75} aria-hidden />
        {toolCallLabel(bare, call.input)}
      </summary>
      <pre className="mt-2 overflow-x-auto text-label text-foreground/70">
        {JSON.stringify(call.input, null, 2)}
      </pre>
    </details>
  );
}
