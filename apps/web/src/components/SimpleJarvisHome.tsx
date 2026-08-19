"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, AudioLines, Brain, Loader2, Mic, MicOff, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useSessionStream } from "@/lib/hooks";
import { useAgents, useConnectionStatus, useMemories, useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { SessionTranscript } from "@/components/SessionTranscript";
import { ExperienceModeToggle } from "@/components/ExperienceModeToggle";

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function SimpleJarvisHome() {
  const { activeAgent } = useAgents();
  const { memories } = useMemories();
  const { primarySessionId } = useStore();
  const connectionStatus = useConnectionStatus();
  const [sentSession, setSentSession] = useState<{ agentId: string | null; sessionId: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityKey, setActivityKey] = useState(0);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followStreamRef = useRef(true);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVoiceAvailable(Boolean(speechRecognitionConstructor())));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const onActivity = useCallback((active: boolean) => setWorking(active), []);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setWorking(true);
    setError(null);
    setDraft("");
    try {
      const { sessionId: id } = await api.sendChat(text);
      setSentSession({ agentId: activeAgent?.id ?? null, sessionId: id });
      setActivityKey((key) => key + 1);
    } catch (err) {
      setDraft(text);
      setWorking(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      setDraft(transcript);
    };
    recognition.onerror = () => {
      setListening(false);
      setError("Voice input could not start. You can keep typing here.");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    recognition.start();
  }

  useEffect(() => () => recognitionRef.current?.stop(), []);

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
  }, [primarySessionId, sentSession]);

  const isActive = sending || working || listening;
  const agentName = activeAgent?.name ?? "Jarvis";
  const sessionId = sentSession?.agentId === (activeAgent?.id ?? null)
    ? sentSession.sessionId
    : primarySessionId;

  return (
    <div className="simple-jarvis-shell min-h-screen overflow-hidden">
      <header className="relative z-20 flex items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-label font-semibold text-accent-bright ring-1 ring-inset ring-accent/30">
            {activeAgent?.avatar ?? "J"}
          </span>
          <div>
            <div className="text-label font-semibold text-foreground">{agentName}</div>
            <div className="flex items-center gap-1.5 text-micro text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${connectionStatus === "connected" ? "bg-success" : connectionStatus === "connecting" ? "bg-warning" : "bg-danger"}`} />
              {connectionStatus === "connected" ? "Present" : connectionStatus === "connecting" ? "Connecting" : "Offline"}
            </div>
          </div>
        </div>
        <ExperienceModeToggle />
      </header>

      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-5rem)] max-w-[1440px] grid-cols-1 items-center gap-8 px-5 pb-10 sm:px-8 lg:grid-cols-[minmax(340px,0.82fr)_minmax(520px,1.18fr)] lg:gap-14 lg:px-12">
        <section className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <AgentPresence active={isActive} listening={listening} name={agentName} />
          <div className="mt-7 max-w-xl">
            <div className="mb-3 flex items-center justify-center gap-2 text-micro font-semibold uppercase tracking-[0.2em] text-accent-bright lg:justify-start">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
              Personal intelligence
            </div>
            <h1 className="text-[clamp(2.25rem,5vw,4.75rem)] font-semibold leading-[0.96] tracking-[-0.055em] text-foreground">
              What can we<br />accomplish today?
            </h1>
            <p className="mt-5 max-w-md text-body leading-relaxed text-foreground-secondary">
              Talk naturally. {agentName} keeps the context, remembers what matters, and can act across your business when you approve it.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-micro text-muted lg:justify-start">
              <span className="flex items-center gap-1.5"><Brain className="h-3.5 w-3.5" strokeWidth={1.75} />{memories.filter((memory) => memory.status === "active").length} memories</span>
              <span className="h-1 w-1 rounded-full bg-border-strong" />
              <span>One continuous conversation</span>
            </div>
          </div>
        </section>

        <section className="simple-chat-panel flex min-h-[560px] max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-[1.5rem] border border-border-strong shadow-elev-3">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <div className="text-heading text-foreground">Conversation</div>
              <div className="mt-0.5 text-micro text-muted">Live, private, and continuous</div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border bg-black/20 px-3 py-1.5 text-micro text-muted">
              <AudioLines className={`h-3.5 w-3.5 ${isActive ? "text-accent-bright" : ""}`} strokeWidth={1.75} />
              {listening ? "Listening" : voiceAvailable ? "Voice input ready" : "Voice-ready interface"}
            </div>
          </div>

          <div
            ref={scrollAreaRef}
            onScroll={(event) => {
              const area = event.currentTarget;
              followStreamRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
            }}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7"
          >
            <div ref={transcriptRef}>
              {sessionId ? (
                <SimpleTranscript sessionId={sessionId} activityKey={activityKey} onActivity={onActivity} />
              ) : (
                <SimpleEmptyState agentName={agentName} onSuggestion={setDraft} />
              )}
            </div>
          </div>

          <div className="border-t border-border bg-black/20 p-3 sm:p-4">
            <div className={`flex items-end gap-2 rounded-2xl border bg-black/20 p-2 transition-[border-color,box-shadow] ${listening ? "border-accent/60 shadow-[0_0_0_3px_var(--accent-glow)]" : "border-border-strong focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--accent-glow)]"}`}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={listening ? "text-accent-bright" : ""}
                aria-label={listening ? "Stop listening" : voiceAvailable ? "Start voice input" : "Voice input unavailable in this browser"}
                title={voiceAvailable ? "Voice input" : "Voice provider can be connected here later"}
                disabled={!voiceAvailable}
                onClick={toggleListening}
              >
                {listening ? <MicOff className="h-4 w-4" strokeWidth={1.75} /> : <Mic className="h-4 w-4" strokeWidth={1.75} />}
              </Button>
              <Textarea
                value={draft}
                rows={1}
                className="max-h-36 min-h-10 flex-1 border-0 bg-transparent px-2 py-2.5 text-body shadow-none focus:bg-transparent focus:shadow-none"
                placeholder={listening ? "Listening…" : `Message ${agentName}…`}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <Button type="button" size="icon" className="shrink-0 rounded-xl" aria-label="Send message" disabled={sending || !draft.trim()} onClick={() => void send()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />}
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 px-2 text-micro text-muted">
              <span>{error ?? "Enter to send · Shift+Enter for a new line"}</span>
              <span className="hidden sm:inline">Voice output can be connected later</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function AgentPresence({ active, listening, name }: { active: boolean; listening: boolean; name: string }) {
  return (
    <div className="jarvis-presence" data-active={active} data-listening={listening} role="img" aria-label={`${name} visual presence${active ? ", active" : ""}`}>
      <div className="jarvis-orbit jarvis-orbit-outer"><span /><span /><span /></div>
      <div className="jarvis-orbit jarvis-orbit-inner"><span /><span /></div>
      <div className="jarvis-core">
        <div className="jarvis-core-light" />
        <div className="jarvis-core-mark">{name.slice(0, 1).toUpperCase()}</div>
      </div>
      <div className="jarvis-wave jarvis-wave-one" />
      <div className="jarvis-wave jarvis-wave-two" />
    </div>
  );
}

function SimpleTranscript({ sessionId, activityKey, onActivity }: { sessionId: string; activityKey: number; onActivity: (active: boolean) => void }) {
  const { session, events, refreshSession } = useSessionStream(sessionId, activityKey);
  const active = session ? ["starting", "running", "waiting_permission"].includes(session.status) : false;
  useEffect(() => onActivity(active), [active, onActivity]);
  return <SessionTranscript sessionId={sessionId} session={session} events={events} refreshSession={refreshSession} compact />;
}

function SimpleEmptyState({ agentName, onSuggestion }: { agentName: string; onSuggestion: (value: string) => void }) {
  const suggestions = [
    "Give me my priorities for today",
    "Create a marketing plan for this week",
    "What needs my attention right now?",
  ];
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent-bright ring-1 ring-inset ring-accent/30">
        <Sparkles className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="text-title text-foreground">Start with anything</div>
      <p className="mt-2 max-w-sm text-label leading-relaxed text-muted">{agentName} can think with you, create work, or operate the systems you have connected.</p>
      <div className="mt-6 flex max-w-md flex-wrap justify-center gap-2">
        {suggestions.map((suggestion) => (
          <Button key={suggestion} variant="secondary" size="sm" className="h-auto py-2 text-left" onClick={() => onSuggestion(suggestion)}>{suggestion}</Button>
        ))}
      </div>
    </div>
  );
}
