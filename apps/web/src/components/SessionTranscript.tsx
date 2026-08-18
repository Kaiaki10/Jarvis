"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Send, X } from "lucide-react";
import type { SessionEventRecord, SessionRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ContentBlock {
  type: string;
  text?: string;
}

interface ApiMessage {
  role: string;
  content: string | ContentBlock[];
}

function messageText(message: ApiMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  expiresAt?: string | null;
  estimatedCostUsd?: number;
}

/** Real money, unlike Claude session costs — so it belongs in front of the decision. */
function CostNotice({ cost, text }: { cost: number; text: unknown }) {
  const hasUrl = typeof text === "string" && /https?:\/\/\S+/i.test(text);
  return (
    <span className={hasUrl ? "text-warning" : "text-muted"}>
      ~${cost.toFixed(3)}
      {hasUrl && " — the link is what makes it $0.20 instead of $0.015"}
    </span>
  );
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
  compact = false,
}: {
  sessionId: string;
  session: SessionRecord | null;
  events: SessionEventRecord[];
  refreshSession: () => void;
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

  const liveText = useMemo(() => {
    let lastFinalIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "assistant" || events[i].type === "result") {
        lastFinalIdx = i;
        break;
      }
    }
    let text = "";
    for (let i = lastFinalIdx + 1; i < events.length; i++) {
      const e = events[i];
      if (e.type !== "stream_event") continue;
      const payload = e.payload as {
        event?: { type?: string; delta?: { type?: string; text?: string } };
      };
      const delta = payload.event?.delta;
      if (payload.event?.type === "content_block_delta" && delta?.type === "text_delta") {
        text += delta.text ?? "";
      }
    }
    return text;
  }, [events]);

  // While a turn is in flight but nothing has streamed back yet, say so — otherwise
  // the UI looks identical to "nothing happened".
  const thinking =
    !liveText &&
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

      {liveText && (
        <div className="rounded-xl border border-border bg-white/[0.02] px-4 py-3 text-sm whitespace-pre-wrap text-foreground">
          {liveText}
          <span className="animate-pulse-soft">▍</span>
        </div>
      )}

      {thinking && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
          {session?.currentActivity ?? "Working…"}
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
        <div className="px-4 pt-3.5 pb-1 text-sm font-medium text-warning">
          Permission requested
        </div>
        <div className="px-4 pb-4">
          <div className="mb-2 text-sm text-foreground">
            Tool <code className="font-mono text-xs">{request.toolName}</code>
          </div>
          <pre className="mb-3 overflow-x-auto rounded-lg bg-black/30 p-2.5 text-xs text-foreground/70">
            {JSON.stringify(request.input, null, 2)}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRespond("allow")}>
              <Check className="h-3.5 w-3.5 text-success" />
              Allow
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
        <Send className="h-3.5 w-3.5 text-warning" />
        <span className="text-sm font-medium text-warning">{action}</span>
        {request.expiresAt && (
          <span className="ml-auto text-[11px]">
            <TimeRemaining expiresAt={request.expiresAt} />
          </span>
        )}
      </div>
      <div className="px-4 pb-4">
        <p className="mb-3 text-xs text-muted">
          Nothing has been sent yet. Review it, edit if you want, then approve.
          {request.estimatedCostUsd ? (
            <>
              {" "}
              <CostNotice cost={request.estimatedCostUsd} text={draft.text} />
            </>
          ) : null}
        </p>
        <div className="flex flex-col gap-3">
          {Object.entries(draft).map(([key, value]) => {
            const multiline = key === "text" || key === "body";
            return (
              <div key={key}>
                <label className="text-[11px] font-medium text-muted">
                  {FIELD_LABELS[key] ?? key}
                </label>
                {multiline ? (
                  <Textarea
                    className="mt-1 w-full text-sm"
                    rows={Math.min(8, Math.max(3, value.split("\n").length + 1))}
                    value={value}
                    onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                  />
                ) : (
                  <Input
                    className="mt-1 w-full text-sm"
                    value={value}
                    onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                  />
                )}
                {key === "text" && (
                  <div className="mt-1 text-right text-[11px] text-muted">
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
            {edited ? "Approve edited" : "Approve and send"}
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
          {edited && <span className="text-[11px] text-muted">Edited</span>}
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
      <div className="max-w-[80%] self-end rounded-xl bg-accent px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
        {text}
      </div>
    );
  }
  if (event.type === "assistant") {
    const payload = event.payload as { message: ApiMessage };
    const text = messageText(payload.message);
    if (!text) return null;
    return (
      <div className="rounded-xl border border-border bg-white/[0.02] px-4 py-2.5 text-sm whitespace-pre-wrap text-foreground">
        {text}
      </div>
    );
  }
  if (event.type === "result") {
    const payload = event.payload as { is_error: boolean; duration_ms: number };
    // In chat, a clean turn ending is not news — but a failed one still is.
    if (compact && !payload.is_error) return null;
    return (
      <div className={`px-1 text-xs ${payload.is_error ? "text-danger" : "text-muted"}`}>
        {payload.is_error ? "Turn ended with an error" : "Turn complete"} ·{" "}
        {(payload.duration_ms / 1000).toFixed(1)}s
      </div>
    );
  }
  if (event.type === "system") {
    const payload = event.payload as { subtype?: string; model?: string };
    if (payload.subtype === "init" && !compact) {
      return (
        <div className="px-1 text-xs text-muted">Session started · {payload.model}</div>
      );
    }
    return null;
  }
  if (event.type === "permission_response") {
    const payload = event.payload as { decision: string; reason?: string };
    if (payload.reason === "timeout") {
      return (
        <div className="px-1 text-xs text-warning">
          Auto-denied — no response within the approval window
        </div>
      );
    }
    return <div className="px-1 text-xs text-muted">Permission {payload.decision}</div>;
  }
  return null;
}
