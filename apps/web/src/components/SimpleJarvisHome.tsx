"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, AudioLines, Brain, Loader2, Mic, MicOff, ShieldCheck, ShieldOff, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useSessionStream } from "@/lib/hooks";
import { useAgents, useConnectionStatus, useMemories, useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { SessionTranscript } from "@/components/SessionTranscript";
import { ExperienceModeToggle } from "@/components/ExperienceModeToggle";
import { Select } from "@/components/ui/Input";
import { ClaudeUsageBadge } from "@/components/ClaudeUsageBadge";
import { SimpleConnectChips } from "@/components/SimpleConnectChips";
import { CLAUDE_MODELS, type ChatModel, type ClaudeModel } from "@jarvis/shared";

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
  const [sentSessions, setSentSessions] = useState<Partial<Record<ChatModel, { agentId: string | null; sessionId: string }>>>({});
  const [model, setModel] = useState<ChatModel>("claude");
  const [claudeModel, setClaudeModel] = useState<ClaudeModel>("default");
  const [autoApproveLocalTools, setAutoApproveLocalTools] = useState(false);
  const [loadedConversationKey, setLoadedConversationKey] = useState<string | null>(null);
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

  useEffect(() => {
    const saved = window.localStorage.getItem("jarvis-simple-model");
    if (saved !== "claude" && saved !== "gpt-5.6-sol") return;
    const frame = window.requestAnimationFrame(() => setModel(saved));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("jarvis-simple-claude-model");
    if (saved !== "default" && saved !== "opus" && saved !== "haiku" && saved !== "fable") return;
    const frame = window.requestAnimationFrame(() => setClaudeModel(saved));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("jarvis-simple-auto-approve");
    if (saved !== "true") return;
    const frame = window.requestAnimationFrame(() => setAutoApproveLocalTools(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const conversationKey = `${activeAgent?.id ?? "default"}:${model}`;
    api.getChat(model)
      .then(({ session }) => {
        if (cancelled) return;
        setSentSessions((current) => ({
          ...current,
          [model]: session ? { agentId: activeAgent?.id ?? null, sessionId: session.id } : undefined,
        }));
        if (session && model === "claude") {
          setClaudeModel(session.claudeModel);
          setAutoApproveLocalTools(session.autoApproveLocalTools);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadedConversationKey(conversationKey);
      });
    return () => { cancelled = true; };
  }, [activeAgent?.id, model]);

  const onActivity = useCallback((active: boolean) => setWorking(active), []);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setWorking(true);
    setError(null);
    setDraft("");
    try {
      const { sessionId: id } = await api.sendChat(text, model, claudeModel, autoApproveLocalTools);
      setSentSessions((current) => ({
        ...current,
        [model]: { agentId: activeAgent?.id ?? null, sessionId: id },
      }));
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
  }, [primarySessionId, sentSessions, model]);

  const isActive = sending || working || listening;
  const agentName = activeAgent?.name ?? "Jarvis";
  const selectedSession = sentSessions[model];
  const conversationKey = `${activeAgent?.id ?? "default"}:${model}`;
  const loadingConversation = loadedConversationKey !== conversationKey;
  const sessionId = selectedSession?.agentId === (activeAgent?.id ?? null)
    ? selectedSession.sessionId
    : model === "claude" ? primarySessionId : null;

  function chooseModel(next: ChatModel) {
    setModel(next);
    setWorking(false);
    setError(null);
    window.localStorage.setItem("jarvis-simple-model", next);
  }

  function chooseClaudeModel(next: ClaudeModel) {
    setClaudeModel(next);
    window.localStorage.setItem("jarvis-simple-claude-model", next);
    // Takes effect on the next message in this same conversation — see
    // sendFollowUp's mid-conversation setModel handling in sessionManager.ts.
  }

  function toggleAutoApprove() {
    const next = !autoApproveLocalTools;
    setAutoApproveLocalTools(next);
    window.localStorage.setItem("jarvis-simple-auto-approve", String(next));
    // Also takes effect on the next message — sendFollowUp restarts the
    // underlying query when this changes, same idea as the model switch above.
  }

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
              {model === "gpt-5.6-sol"
                ? `Talk naturally. ${agentName} keeps the context, remembers what matters, and brings GPT-5.6 Sol reasoning to your local workspace.`
                : `Talk naturally. ${agentName} keeps the context, remembers what matters, and can act across your business when you approve it.`}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-micro text-muted lg:justify-start">
              <span className="flex items-center gap-1.5"><Brain className="h-3.5 w-3.5" strokeWidth={1.75} />{memories.filter((memory) => memory.status === "active").length} memories</span>
              <span className="h-1 w-1 rounded-full bg-border-strong" />
              <span>One continuous conversation</span>
            </div>
            {/* Simple mode has no navigation, so this is the only place these
                two capabilities are discoverable from the front door. */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <SimpleConnectChips />
            </div>
          </div>
        </section>

        <section
          className="simple-chat-panel flex min-h-[560px] max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-[1.5rem] border border-border-strong shadow-elev-3"
          // Bound on the whole panel, not just the textarea, so the shortcut
          // still submits after tabbing to a model picker or the voice
          // button — "send" from anywhere in the form, not just the one field.
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <div className="text-heading text-foreground">Conversation</div>
              <div className="mt-0.5 text-micro text-muted">Live, private, and continuous</div>
            </div>
            <div className="flex items-center gap-2">
              <ClaudeUsageBadge />
              <ModelPicker model={model} onChange={chooseModel} />
              {model === "claude" && (
                <>
                  <ClaudeModelPicker model={claudeModel} onChange={chooseClaudeModel} />
                  <AutoApproveToggle enabled={autoApproveLocalTools} onToggle={toggleAutoApprove} />
                </>
              )}
              <div className="hidden items-center gap-2 rounded-full border border-border bg-black/20 px-3 py-1.5 text-micro text-muted sm:flex">
                <AudioLines className={`h-3.5 w-3.5 ${isActive ? "text-accent-bright" : ""}`} strokeWidth={1.75} />
                {listening ? "Listening" : voiceAvailable ? "Voice ready" : "Voice-ready"}
              </div>
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
              {loadingConversation ? (
                <div className="flex min-h-[360px] items-center justify-center text-label text-muted">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-accent-bright" /> Loading conversation…
                </div>
              ) : sessionId ? (
                <SimpleTranscript sessionId={sessionId} activityKey={activityKey} onActivity={onActivity} />
              ) : (
                <SimpleEmptyState agentName={agentName} model={model} onSuggestion={setDraft} />
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
                    // Also stops the panel-level Cmd/Ctrl+Enter handler below
                    // from firing a second send for the same keystroke.
                    event.stopPropagation();
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
              <span className="hidden sm:inline">
                {model === "gpt-5.6-sol"
                  ? "Sol · reasoning and workspace analysis"
                  : `Claude${claudeModel === "default" ? "" : ` (${CLAUDE_MODELS.find((option) => option.value === claudeModel)?.label})`} · full Jarvis tools and approvals`}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ModelPicker({ model, onChange }: { model: ChatModel; onChange: (model: ChatModel) => void }) {
  return (
    <div className="flex items-center rounded-xl border border-border-strong bg-black/25 p-1" role="group" aria-label="Conversation model">
      <Button
        type="button"
        size="sm"
        variant={model === "gpt-5.6-sol" ? "secondary" : "ghost"}
        className={`h-7 rounded-lg px-2.5 text-micro ${model === "gpt-5.6-sol" ? "text-accent-bright" : "text-muted"}`}
        aria-pressed={model === "gpt-5.6-sol"}
        title="GPT-5.6 Sol · reasoning and read-only workspace analysis"
        onClick={() => onChange("gpt-5.6-sol")}
      >
        <Sparkles className="h-3 w-3" strokeWidth={1.75} />
        5.6 Sol
      </Button>
      <Button
        type="button"
        size="sm"
        variant={model === "claude" ? "secondary" : "ghost"}
        className={`h-7 rounded-lg px-2.5 text-micro ${model === "claude" ? "text-accent-bright" : "text-muted"}`}
        aria-pressed={model === "claude"}
        title="Claude · Jarvis tools, approvals, and business actions"
        onClick={() => onChange("claude")}
      >
        <Brain className="h-3 w-3" strokeWidth={1.75} />
        Claude
      </Button>
    </div>
  );
}

function ClaudeModelPicker({ model, onChange }: { model: ClaudeModel; onChange: (model: ClaudeModel) => void }) {
  return (
    <Select
      aria-label="Claude model"
      className="h-7 w-auto rounded-lg py-0 text-micro"
      value={model}
      onChange={(event) => onChange(event.target.value as ClaudeModel)}
    >
      {CLAUDE_MODELS.map((option) => (
        <option key={option.value} value={option.value} title={option.description}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

function AutoApproveToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={enabled ? "secondary" : "ghost"}
      className={`h-7 rounded-xl px-2.5 text-micro ${enabled ? "text-accent-bright" : "text-muted"}`}
      role="switch"
      aria-checked={enabled}
      title={
        enabled
          ? "Local work (commands, file edits, search) runs without asking. Posting, messaging, and spending still always ask."
          : "Turn on to let local work — commands, file edits, search — run without asking each time. Posting, messaging, and spending always still ask, regardless of this setting."
      }
      onClick={onToggle}
    >
      {enabled ? <ShieldOff className="h-3 w-3" strokeWidth={1.75} /> : <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />}
      {enabled ? "Auto-run on" : "Auto-run off"}
    </Button>
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

function SimpleEmptyState({ agentName, model, onSuggestion }: { agentName: string; model: ChatModel; onSuggestion: (value: string) => void }) {
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
      <p className="mt-2 max-w-sm text-label leading-relaxed text-muted">
        {model === "gpt-5.6-sol"
          ? `${agentName} can reason with you and analyze the local workspace. Switch to Claude when you want approval-gated business actions.`
          : `${agentName} can think with you, create work, or operate the systems you have connected.`}
      </p>
      <div className="mt-6 flex max-w-md flex-wrap justify-center gap-2">
        {suggestions.map((suggestion) => (
          <Button key={suggestion} variant="secondary" size="sm" className="h-auto py-2 text-left" onClick={() => onSuggestion(suggestion)}>{suggestion}</Button>
        ))}
      </div>
    </div>
  );
}
