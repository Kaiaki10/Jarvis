"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import type { SessionRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useSessionStream } from "@/lib/hooks";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SessionTranscript } from "@/components/SessionTranscript";

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
  const bottomRef = useRef<HTMLDivElement>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  });

  return (
    <Card elevation={2} className="flex flex-col overflow-hidden">
      <div className="max-h-[calc(100vh-24rem)] min-h-[19rem] overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="text-body text-muted">Loading…</div>
        ) : sessionId ? (
          <ChatBody sessionId={sessionId} />
        ) : (
          <EmptyState />
        )}
        <div ref={bottomRef} />
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

function ChatBody({ sessionId }: { sessionId: string }) {
  const { session, events, refreshSession } = useSessionStream(sessionId);
  return (
    <SessionTranscript
      sessionId={sessionId}
      session={session}
      events={events}
      refreshSession={refreshSession}
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
