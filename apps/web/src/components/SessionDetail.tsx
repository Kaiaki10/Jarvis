"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { SessionEventRecord } from "@jarvis/shared";
import { useSessionStream } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Panel } from "@/components/hud/Panel";

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
    <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-xs uppercase tracking-widest text-cyan-400/70 hover:text-cyan-300"
        >
          ← Dashboard
        </Link>
        {session && (
          <span className="text-[10px] uppercase tracking-widest text-cyan-500/40">
            {session.status}
            {session.costUsd != null && ` · $${session.costUsd.toFixed(4)}`}
            {session.turns != null && ` · ${session.turns} turn(s)`}
          </span>
        )}
      </div>

      <Panel title="SESSION-LOG" bodyClassName="flex flex-col gap-3 min-h-[320px]">
        {events.map((event) => (
          <TranscriptEntry key={event.id} event={event} />
        ))}
        {liveText && (
          <div className="rounded-sm border border-cyan-500/10 bg-cyan-500/5 p-2.5 text-sm text-cyan-100 whitespace-pre-wrap">
            {liveText}
            <span className="animate-hud-pulse text-cyan-300">▍</span>
          </div>
        )}
      </Panel>

      {pendingPermission && (
        <Panel eyebrow="ALERT //" title="PERMISSION REQUIRED" className="border-orange-500/50">
          <div className="text-sm mb-2 text-orange-200">
            Tool <code className="font-mono">{pendingPermission.toolName}</code>
          </div>
          <pre className="text-xs bg-black/30 border border-orange-500/15 rounded-sm p-2 mb-3 overflow-x-auto text-orange-100/80">
            {JSON.stringify(pendingPermission.input, null, 2)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={() => respond("allow")}
              className="rounded-sm border border-emerald-400/50 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/20"
            >
              Allow
            </button>
            <button
              onClick={() => respond("deny")}
              className="rounded-sm border border-red-400/50 bg-red-500/10 px-3 py-1 text-xs uppercase tracking-widest text-red-300 hover:bg-red-500/20"
            >
              Deny
            </button>
          </div>
        </Panel>
      )}

      <div className="flex items-center gap-2 rounded-sm border border-cyan-400/40 bg-black/40 box-glow px-3 py-2.5">
        <span className="text-cyan-400 text-glow">&gt;</span>
        <input
          className="flex-1 bg-transparent outline-none text-sm text-cyan-100"
          placeholder="Send a follow-up…"
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendFollowUp()}
        />
        <button
          onClick={sendFollowUp}
          disabled={sending}
          className="rounded-sm border border-cyan-400/50 bg-cyan-500/10 px-3 py-1 text-xs uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function TranscriptEntry({ event }: { event: SessionEventRecord }) {
  if (event.type === "user") {
    const payload = event.payload as { message: ApiMessage };
    return (
      <div className="self-end max-w-[80%] rounded-sm border border-cyan-400/30 bg-cyan-500/15 p-2.5 text-sm text-cyan-50 whitespace-pre-wrap">
        {messageText(payload.message)}
      </div>
    );
  }
  if (event.type === "assistant") {
    const payload = event.payload as { message: ApiMessage };
    const text = messageText(payload.message);
    if (!text) return null;
    return (
      <div className="rounded-sm border border-cyan-500/10 bg-black/20 p-2.5 text-sm text-cyan-100 whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  if (event.type === "result") {
    const payload = event.payload as {
      is_error: boolean;
      duration_ms: number;
      total_cost_usd: number;
    };
    return (
      <div className="text-[10px] uppercase tracking-wider text-cyan-500/40">
        {payload.is_error ? "Turn ended with an error" : "Turn complete"} ·{" "}
        {(payload.duration_ms / 1000).toFixed(1)}s · ${payload.total_cost_usd.toFixed(4)}
      </div>
    );
  }
  if (event.type === "system") {
    const payload = event.payload as { subtype?: string; model?: string };
    if (payload.subtype === "init") {
      return (
        <div className="text-[10px] uppercase tracking-wider text-cyan-500/40">
          Session started · {payload.model}
        </div>
      );
    }
    return null;
  }
  if (event.type === "permission_response") {
    const payload = event.payload as { decision: string };
    return (
      <div className="text-[10px] uppercase tracking-wider text-cyan-500/40">
        Permission {payload.decision}
      </div>
    );
  }
  return null;
}
