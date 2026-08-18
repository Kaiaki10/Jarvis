"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUp, Check, X } from "lucide-react";
import type { SessionEventRecord } from "@jarvis/shared";
import { useSessionStream } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

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
}

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const { session, events, refreshSession } = useSessionStream(sessionId);
  const [followUp, setFollowUp] = useState("");
  const [sending, setSending] = useState(false);

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

  async function sendFollowUp() {
    const text = followUp.trim();
    if (!text) return;
    setSending(true);
    setFollowUp("");
    try {
      await api.sendMessage(sessionId, text);
    } finally {
      setSending(false);
    }
  }

  async function respond(decision: "allow" | "deny") {
    if (!pendingPermission) return;
    await api.respondToPermission(sessionId, {
      requestId: pendingPermission.requestId,
      decision,
    });
    refreshSession();
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-border px-8 py-4">
        <Link
          href="/sessions"
          className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Sessions
        </Link>
        {session && (
          <div className="ml-auto flex items-center gap-3 text-xs text-muted">
            {session.turns != null && <span>{session.turns} turn(s)</span>}
            <Badge tone="neutral">{session.status}</Badge>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {events.map((event) => (
            <TranscriptEntry key={event.id} event={event} />
          ))}
          {liveText && (
            <div className="rounded-xl border border-border bg-white/[0.02] px-4 py-3 text-sm text-foreground whitespace-pre-wrap">
              {liveText}
              <span className="animate-pulse-soft">▍</span>
            </div>
          )}

          {pendingPermission && (
            <Card className="border-warning/30 bg-warning/5">
              <div className="px-4 pt-3.5 pb-1 text-sm font-medium text-warning">
                Permission requested
              </div>
              <div className="px-4 pb-4">
                <div className="mb-2 text-sm text-foreground">
                  Tool <code className="font-mono text-xs">{pendingPermission.toolName}</code>
                </div>
                <pre className="mb-3 overflow-x-auto rounded-lg bg-black/30 p-2.5 text-xs text-foreground/70">
                  {JSON.stringify(pendingPermission.input, null, 2)}
                </pre>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => respond("allow")}>
                    <Check className="h-3.5 w-3.5 text-success" />
                    Allow
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => respond("deny")}>
                    <X className="h-3.5 w-3.5" />
                    Deny
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <div className="border-t border-border px-8 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <Input
            className="flex-1"
            placeholder="Send a follow-up…"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendFollowUp()}
          />
          <Button size="sm" onClick={sendFollowUp} disabled={sending}>
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function TranscriptEntry({ event }: { event: SessionEventRecord }) {
  if (event.type === "user") {
    const payload = event.payload as { message: ApiMessage };
    return (
      <div className="self-end max-w-[80%] rounded-xl bg-accent px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
        {messageText(payload.message)}
      </div>
    );
  }
  if (event.type === "assistant") {
    const payload = event.payload as { message: ApiMessage };
    const text = messageText(payload.message);
    if (!text) return null;
    return (
      <div className="rounded-xl border border-border bg-white/[0.02] px-4 py-2.5 text-sm text-foreground whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  if (event.type === "result") {
    const payload = event.payload as { is_error: boolean; duration_ms: number };
    return (
      <div className="px-1 text-xs text-muted">
        {payload.is_error ? "Turn ended with an error" : "Turn complete"} ·{" "}
        {(payload.duration_ms / 1000).toFixed(1)}s
      </div>
    );
  }
  if (event.type === "system") {
    const payload = event.payload as { subtype?: string; model?: string };
    if (payload.subtype === "init") {
      return (
        <div className="px-1 text-xs text-muted">Session started · {payload.model}</div>
      );
    }
    return null;
  }
  if (event.type === "permission_response") {
    const payload = event.payload as { decision: string };
    return <div className="px-1 text-xs text-muted">Permission {payload.decision}</div>;
  }
  return null;
}
