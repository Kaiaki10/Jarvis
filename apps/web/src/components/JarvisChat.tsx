"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
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
    <Card className="surface-raised flex flex-col overflow-hidden">
      <div className="max-h-[calc(100vh-22rem)] min-h-[18rem] overflow-y-auto px-5 py-5">
        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : sessionId ? (
          <ChatBody sessionId={sessionId} />
        ) : (
          <EmptyState />
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            className="min-h-[2.5rem] flex-1 border-0 bg-transparent text-sm focus:bg-transparent"
            placeholder="Ask Jarvis anything…"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button size="sm" onClick={send} disabled={sending || !draft.trim()}>
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
            )}
          </Button>
        </div>
        {error && <div className="mt-2 px-1 text-xs text-danger">{error}</div>}
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
    <div className="flex h-full flex-col items-center justify-center py-10 text-center">
      <div className="text-sm text-foreground">Nothing said yet.</div>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">
        This is one continuous conversation — Jarvis keeps the context of everything
        here. Scheduled automations run separately and appear under Automations.
      </p>
    </div>
  );
}
