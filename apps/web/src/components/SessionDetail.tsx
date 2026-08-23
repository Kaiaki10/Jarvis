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
import { SharedElement } from "@/components/motion";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/sessionStatus";

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
    // Below `lg` this sits under AppShell's mobile top bar, which is a real
    // sibling taking real height (not an overlay) — `h-screen` here would run
    // 100vh from below that bar and push the footer input off the bottom of
    // the actual viewport. Subtract the bar's height there; at `lg`+ there is
    // no top bar and the old fixed math applies again.
    <div className="flex h-[calc(100dvh-3.75rem)] flex-col lg:h-screen">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-8">
        <Link
          href="/under-the-hood/brain/runs"
          className="flex shrink-0 items-center gap-1.5 text-body text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Runs
        </Link>

        {/* The header never said which run this was — you had to read the
            transcript to find out. It does now, and naming it is also what
            gives the title from the list something to morph into. */}
        {session && (
          <>
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            <SharedElement name={`run-title-${sessionId}`}>
              <h1 className="min-w-0 flex-1 truncate text-body text-foreground">
                {session.title}
              </h1>
            </SharedElement>
            <div className="flex shrink-0 items-center gap-3 text-label text-muted">
              {session.turns != null && <span>{session.turns} turn(s)</span>}
              <SharedElement name={`run-status-${sessionId}`}>
                <span className="shrink-0">
                  <Badge tone={STATUS_TONE[session.status]} dot>
                    {STATUS_LABEL[session.status]}
                  </Badge>
                </span>
              </SharedElement>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-2xl">
          <SessionTranscript
            sessionId={sessionId}
            session={session}
            events={events}
            refreshSession={refreshSession}
          />
        </div>
      </div>

      <div className="border-t border-border px-4 py-4 sm:px-8">
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
