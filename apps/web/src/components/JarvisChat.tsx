"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Brain, Loader2, Sparkles } from "lucide-react";
import type { SessionRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useSessionStream } from "@/lib/hooks";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SessionTranscript } from "@/components/SessionTranscript";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Crossfade } from "@/components/motion";
import { useConnectionStatus, useMemories } from "@/lib/store";

/**
 * The one ongoing conversation with Jarvis.
 *
 * Every message continues the same thread rather than starting a new session, so
 * Jarvis keeps the context of everything said before. Automation runs stay
 * separate — each of those genuinely is its own execution.
 */
export function JarvisChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [activityKey, setActivityKey] = useState(0);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followStreamRef = useRef(true);
  const { memories } = useMemories();
  const connectionStatus = useConnectionStatus();

  useEffect(() => {
    api
      .getChat()
      .then(({ session }: { session: SessionRecord | null }) => {
        setSessionId(session?.id ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const onSent = useCallback((id: string) => setSessionId(id), []);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    try {
      const { sessionId: id } = await api.sendChat(text);
      onSent(id);
      setActivityKey((key) => key + 1);
    } catch (err) {
      // Put the text back rather than losing what was typed.
      setDraft(text);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  useEffect(() => {
    const area = scrollAreaRef.current;
    const transcript = transcriptRef.current;
    if (!area || !transcript) return;
    const observer = new MutationObserver(() => {
      if (followStreamRef.current) area.scrollTop = area.scrollHeight;
    });
    observer.observe(transcript, { childList: true, characterData: true, subtree: true });
    area.scrollTop = area.scrollHeight;
    return () => observer.disconnect();
  }, [sessionId, loading]);

  return (
    <Card elevation={2} className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            {connectionStatus === "connected" && <span className="ping-ring absolute inset-0 rounded-full" />}
            <span className={`relative h-2 w-2 rounded-full ${connectionStatus === "connected" ? "bg-success" : connectionStatus === "connecting" ? "bg-warning" : "bg-danger"}`} />
          </span>
          <div>
            <div className="text-label font-medium text-foreground">
              {connectionStatus === "connected" ? "Jarvis is present" : connectionStatus === "connecting" ? "Reconnecting to Jarvis" : "Jarvis is offline"}
            </div>
            <div className="text-micro text-muted">
              {connectionStatus === "connected" ? "Replies stream live · context continues" : "Messages will not claim to be live until the connection returns"}
            </div>
          </div>
        </div>
        <Link href="/under-the-hood/brain/memory" aria-label="Open Jarvis memory">
          <Badge tone="accent"><Brain className="h-3 w-3" strokeWidth={1.75} />{memories.filter((memory) => memory.status === "active").length} remembered</Badge>
        </Link>
      </div>
      <div
        ref={scrollAreaRef}
        onScroll={(event) => {
          const area = event.currentTarget;
          followStreamRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
        }}
        className="max-h-[calc(100vh-24rem)] min-h-[19rem] overflow-y-auto px-6 py-6"
      >
        <div ref={transcriptRef}>
        <Crossfade viewKey={loading ? "loading" : sessionId ? "chat" : "empty"}>
          {loading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-11 w-3/4 self-start rounded-2xl rounded-tl-md" />
              <Skeleton className="h-8 w-1/2 self-end rounded-2xl rounded-br-md" />
              <Skeleton className="h-14 w-4/5 self-start rounded-2xl rounded-tl-md" />
            </div>
          ) : sessionId ? (
            <ChatBody sessionId={sessionId} activityKey={activityKey} />
          ) : (
            <EmptyState />
          )}
        </Crossfade>
        </div>
      </div>

      {/* The composer is its own plane — darker than the transcript above it, so
          the boundary between reading and typing is unmistakable. */}
      <div className="border-t border-border bg-black/25 p-3">
        <div
          className={`flex items-end gap-2 rounded-xl border px-2 py-1 transition-[border-color,box-shadow] duration-200 ${
            focused
              ? "border-accent/60 shadow-[0_0_0_3px_var(--accent-glow)]"
              : "border-transparent"
          }`}
        >
          <Textarea
            className="min-h-[2.5rem] flex-1 border-0 bg-transparent px-2 text-body shadow-none focus:bg-transparent focus:shadow-none"
            placeholder="Ask Jarvis anything…"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <Button
            size="icon"
            className="mb-1 h-8 w-8 shrink-0"
            aria-label="Send message"
            onClick={send}
            disabled={sending || !draft.trim()}
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
            )}
          </Button>
        </div>
        {error ? (
          <div className="mt-2 px-3 text-label text-danger">{error}</div>
        ) : (
          <div className="mt-1.5 px-3 text-micro text-muted">
            <kbd className="font-mono">Enter</kbd> to send ·{" "}
            <kbd className="font-mono">Shift+Enter</kbd> for a new line
          </div>
        )}
      </div>
    </Card>
  );
}

function ChatBody({ sessionId, activityKey }: { sessionId: string; activityKey: number }) {
  const { session, events, refreshSession, liveTextRef, subscribeStreamDelta, streaming } =
    useSessionStream(sessionId, activityKey);
  return (
    <SessionTranscript
      sessionId={sessionId}
      session={session}
      events={events}
      refreshSession={refreshSession}
      liveTextRef={liveTextRef}
      subscribeStreamDelta={subscribeStreamDelta}
      streaming={streaming}
      compact
    />
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-12 text-center">
      <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-bright to-accent text-white shadow-elev-2 ring-1 ring-inset ring-white/20">
        <Sparkles className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="text-title text-foreground">Nothing said yet</div>
      <p className="mt-2 max-w-sm text-label leading-relaxed text-muted">
        One continuous conversation — Jarvis keeps the context of everything here.
        Scheduled automations run separately, under Automations.
      </p>
    </div>
  );
}
