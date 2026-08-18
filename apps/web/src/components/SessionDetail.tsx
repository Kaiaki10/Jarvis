"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { useSessionStream } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SessionTranscript } from "@/components/SessionTranscript";

/**
 * One run, read back in full. This is where automation runs are inspected; the
 * ongoing conversation with Jarvis lives on the Overview instead.
 */
export function SessionDetail({ sessionId }: { sessionId: string }) {
  const [activityKey, setActivityKey] = useState(0);
  const { session, events, refreshSession } = useSessionStream(sessionId, activityKey);
  const [followUp, setFollowUp] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendFollowUp() {
    const text = followUp.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    setFollowUp("");
    try {
      const { resumed } = await api.sendMessage(sessionId, text);
      setActivityKey((key) => key + 1);
      if (resumed) setNotice("Session had gone idle — resuming it.");
    } catch (err) {
      // Put the text back rather than losing what they typed.
      setFollowUp(text);
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-border px-8 py-4">
        <Link
          href="/sessions"
          className="flex items-center gap-1.5 text-body text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Runs
        </Link>
        {session && (
          <div className="ml-auto flex items-center gap-3 text-label text-muted">
            {session.turns != null && <span>{session.turns} turn(s)</span>}
            <Badge tone="neutral">{session.status}</Badge>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl">
          <SessionTranscript
            sessionId={sessionId}
            session={session}
            events={events}
            refreshSession={refreshSession}
          />
        </div>
      </div>

      <div className="border-t border-border px-8 py-4">
        {(sendError || notice) && (
          <div className="mx-auto mb-2 max-w-2xl text-label">
            {sendError ? (
              <span className="text-danger">{sendError}</span>
            ) : (
              <span className="text-muted">{notice}</span>
            )}
          </div>
        )}
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
