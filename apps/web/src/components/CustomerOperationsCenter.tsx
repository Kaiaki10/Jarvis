"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  AtSign,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Clock3,
  Camera,
  Globe2,
  Inbox,
  MessageCircle,
  Mail,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Settings2,
  UserRound,
  UsersRound,
} from "lucide-react";
import type {
  CreateCustomerConversationRequest,
  CustomerChannel,
  CustomerPriority,
  CustomerReplyDraftRecord,
  CustomerServicePolicyRecord,
} from "@jarvis/shared";
import { api, customerWidgetDemoUrl, customerWidgetEmbedCode } from "@/lib/api";
import { useCustomerOperations } from "@/lib/store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";

const EMPTY_FORM: CreateCustomerConversationRequest = {
  customerName: "",
  customerEmail: "",
  company: "",
  channel: "website",
  subject: "",
  message: "",
  priority: "normal",
};

const CHANNEL_LABELS: Record<CustomerChannel, string> = {
  website: "Website",
  email: "Email",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
};

const PRIORITY_TONE: Record<CustomerPriority, "neutral" | "accent" | "warning" | "danger"> = {
  low: "neutral",
  normal: "accent",
  high: "warning",
  urgent: "danger",
};

function ChannelIcon({ channel, className = "h-4 w-4" }: { channel: CustomerChannel; className?: string }) {
  const props = { className, strokeWidth: 1.75 };
  if (channel === "email") return <Mail {...props} />;
  if (channel === "x") return <AtSign {...props} />;
  if (channel === "instagram") return <Camera {...props} />;
  if (channel === "facebook") return <MessageCircle {...props} />;
  return <Globe2 {...props} />;
}

function relativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function Stat({ icon, value, label, tone = "text-muted" }: {
  icon: ReactNode;
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <Card elevation={0} className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.045] ${tone}`}>{icon}</span>
        <div>
          <div className="text-title tabular-nums text-foreground">{value}</div>
          <div className="text-micro text-muted">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function PolicyToggle({ checked, onChange, label, description }: { checked: boolean; onChange: () => void; label: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-black/10 px-3 py-2.5">
      <div><div className="text-label font-medium text-foreground">{label}</div><div className="text-micro text-muted">{description}</div></div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? "border-accent bg-accent" : "border-border-strong bg-surface-hover"}`}>
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function policyFormFrom(policy: CustomerServicePolicyRecord) {
  return {
    widgetName: policy.widgetName,
    widgetWelcome: policy.widgetWelcome,
    confidenceThreshold: String(policy.confidenceThreshold),
    maxAutoReplies: String(policy.maxAutoRepliesPerConversation),
    hoursStart: policy.businessHoursStart,
    hoursEnd: policy.businessHoursEnd,
    businessDays: policy.businessDays,
    keywords: policy.escalationKeywords.join(", "),
    origins: policy.allowedOrigins.join("\n"),
  };
}

export function CustomerOperationsCenter() {
  const { overview, refresh } = useCustomerOperations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all" | "resolved">("active");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newConversation, setNewConversation] = useState(EMPTY_FORM);
  const [reply, setReply] = useState("");
  const [draftId, setDraftId] = useState<string | undefined>();
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);
  const [policyForm, setPolicyForm] = useState({ widgetName: "", widgetWelcome: "", confidenceThreshold: "0.9", maxAutoReplies: "3", hoursStart: "08:00", hoursEnd: "18:00", businessDays: [1, 2, 3, 4, 5], keywords: "", origins: "" });

  const conversations = useMemo(() => overview?.conversations ?? [], [overview?.conversations]);
  const customers = useMemo(() => overview?.customers ?? [], [overview?.customers]);
  const customerById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0] ?? null;
  const customer = selected ? customerById.get(selected.customerId) ?? null : null;
  const notes = customer ? noteDrafts[customer.id] ?? customer.notes ?? "" : "";
  const messages = selected ? (overview?.messages ?? []).filter((message) => message.conversationId === selected.id) : [];
  const drafts = selected ? (overview?.drafts ?? []).filter((draft) => draft.conversationId === selected.id) : [];
  const latestDraft = drafts[0] ?? null;
  const deliveryByMessage = useMemo(() => new Map((overview?.deliveries ?? []).map((delivery) => [delivery.messageId, delivery])), [overview?.deliveries]);

  useEffect(() => {
    if (selected?.unreadCount) {
      void api.updateCustomerConversation(selected.id, { unreadCount: 0 }).catch(() => {});
    }
  }, [selected?.id, selected?.unreadCount]);

  const visibleConversations = conversations.filter((conversation) => {
    if (filter === "active" && conversation.status === "resolved") return false;
    if (filter === "resolved" && conversation.status !== "resolved") return false;
    const person = customerById.get(conversation.customerId);
    const haystack = `${conversation.subject} ${person?.name ?? ""} ${person?.email ?? ""}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  const openCount = conversations.filter((item) => item.status === "open").length;
  const waitingCount = conversations.filter((item) => item.status === "waiting").length;
  const attentionCount = conversations.filter((item) => item.priority === "urgent" || item.priority === "high" || item.sentiment === "negative").length;
  const jarvisCount = conversations.filter((item) => item.assignedTo === "jarvis" && item.status !== "resolved").length;

  async function act(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function createConversation(event: FormEvent) {
    event.preventDefault();
    await act("create", async () => {
      const created = await api.createCustomerConversation(newConversation);
      setSelectedId(created.conversation.id);
      setNewConversation(EMPTY_FORM);
      setShowNew(false);
    }, "Conversation added to the live queue.");
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    await act("reply", async () => {
      await api.sendCustomerMessage(selected.id, {
        body: reply,
        sender: draftId ? "jarvis" : "operator",
        draftId,
      });
      setReply("");
      setDraftId(undefined);
    }, "Reply recorded and the conversation is waiting on the customer.");
  }

  function applyDraft(draft: CustomerReplyDraftRecord) {
    if (!draft.body) return;
    setReply(draft.body);
    setDraftId(draft.id);
    setNotice("Jarvis draft loaded for your review.");
  }

  function togglePolicy(key: keyof Pick<CustomerServicePolicyRecord, "enabled" | "autoReplyWebsite" | "autoReplyEmail" | "autoReplySocial">) {
    const current = overview?.policy[key] ?? false;
    void act(`policy-${key}`, () => api.updateCustomerServicePolicy({ [key]: !current }), `${key === "enabled" ? "Customer-service autonomy" : "Channel automation"} ${!current ? "enabled" : "paused"}.`);
  }

  function savePolicy() {
    void act("policy-save", () => api.updateCustomerServicePolicy({
      widgetName: policyForm.widgetName,
      widgetWelcome: policyForm.widgetWelcome,
      confidenceThreshold: Number(policyForm.confidenceThreshold),
      maxAutoRepliesPerConversation: Number(policyForm.maxAutoReplies),
      businessHoursStart: policyForm.hoursStart,
      businessHoursEnd: policyForm.hoursEnd,
      businessDays: policyForm.businessDays,
      escalationKeywords: policyForm.keywords.split(",").map((value) => value.trim()).filter(Boolean),
      allowedOrigins: policyForm.origins.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
    }), "Customer-service policy saved.");
  }

  if (!overview) {
    return (
      <Card elevation={1} className="py-16 text-center">
        <Inbox className="mx-auto h-6 w-6 text-muted" strokeWidth={1.75} />
        <p className="mt-3 text-body text-muted">Loading the customer queue…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Inbox className="h-4 w-4" strokeWidth={1.75} />} value={openCount} label="Open conversations" tone="text-accent-bright" />
        <Stat icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />} value={waitingCount} label="Waiting on customer" />
        <Stat icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />} value={attentionCount} label="Need attention" tone="text-warning" />
        <Stat icon={<Bot className="h-4 w-4" strokeWidth={1.75} />} value={jarvisCount} label="Owned by Jarvis" tone="text-success" />
      </div>

      <Card elevation={1} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${overview.policy.enabled ? "bg-success/10 text-success" : "bg-white/[0.045] text-muted"}`}><ShieldCheck className="h-5 w-5" strokeWidth={1.75} /></span>
            <div><div className="flex items-center gap-2"><h2 className="text-title text-foreground">Customer service autonomy</h2><Badge tone={overview.policy.enabled ? "success" : "neutral"} dot>{overview.policy.enabled ? "Active" : "Review only"}</Badge></div><p className="mt-0.5 text-label text-muted">Guarded replies across website, email, and social channels</p></div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => window.open(customerWidgetDemoUrl, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" strokeWidth={1.75} />Preview chat</Button>
            <Button size="sm" variant="ghost" onClick={() => { if (!showPolicy) setPolicyForm(policyFormFrom(overview.policy)); setShowPolicy((value) => !value); }}><Settings2 className="h-4 w-4" strokeWidth={1.75} />{showPolicy ? "Close controls" : "Controls"}</Button>
          </div>
        </div>
        {showPolicy && <CardBody className="border-t border-border bg-black/10">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="space-y-2">
              <div className="mb-2 text-label font-semibold text-foreground">Autonomy</div>
              <PolicyToggle checked={overview.policy.enabled} onChange={() => togglePolicy("enabled")} label="Let Jarvis reply" description="Master switch for automatic customer replies" />
              <PolicyToggle checked={overview.policy.autoReplyWebsite} onChange={() => togglePolicy("autoReplyWebsite")} label="Website chat" description="Safest channel for immediate answers" />
              <PolicyToggle checked={overview.policy.autoReplyEmail} onChange={() => togglePolicy("autoReplyEmail")} label="Email" description="Requires a verified Resend connection" />
              <PolicyToggle checked={overview.policy.autoReplySocial} onChange={() => togglePolicy("autoReplySocial")} label="Social messages" description="X, Facebook, and Instagram inboxes" />
            </div>
            <div className="space-y-3">
              <div className="text-label font-semibold text-foreground">Safety limits</div>
              <div className="grid grid-cols-2 gap-3"><label className="text-micro text-muted">Minimum confidence<Select className="mt-1 w-full" value={policyForm.confidenceThreshold} onChange={(event) => setPolicyForm((current) => ({ ...current, confidenceThreshold: event.target.value }))}><option value="0.8">80%</option><option value="0.85">85%</option><option value="0.9">90%</option><option value="0.95">95%</option><option value="1">100%</option></Select></label><label className="text-micro text-muted">Auto replies per thread<Input className="mt-1 w-full" type="number" min="0" max="20" value={policyForm.maxAutoReplies} onChange={(event) => setPolicyForm((current) => ({ ...current, maxAutoReplies: event.target.value }))} /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-micro text-muted">From<Input className="mt-1 w-full" type="time" value={policyForm.hoursStart} onChange={(event) => setPolicyForm((current) => ({ ...current, hoursStart: event.target.value }))} /></label><label className="text-micro text-muted">Until<Input className="mt-1 w-full" type="time" value={policyForm.hoursEnd} onChange={(event) => setPolicyForm((current) => ({ ...current, hoursEnd: event.target.value }))} /></label></div>
              <div><div className="mb-1.5 text-micro text-muted">Active days</div><div className="flex gap-1">{["S", "M", "T", "W", "T", "F", "S"].map((label, day) => <button type="button" key={`${label}-${day}`} aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]} onClick={() => setPolicyForm((current) => ({ ...current, businessDays: current.businessDays.includes(day) ? (current.businessDays.length === 1 ? current.businessDays : current.businessDays.filter((value) => value !== day)) : [...current.businessDays, day].sort() }))} className={`flex h-7 w-7 items-center justify-center rounded-md border text-micro ${policyForm.businessDays.includes(day) ? "border-accent/60 bg-accent/15 text-accent-foreground" : "border-border text-muted"}`}>{label}</button>)}</div></div>
              <label className="block text-micro text-muted">Always escalate when messages contain<Input className="mt-1 w-full" value={policyForm.keywords} onChange={(event) => setPolicyForm((current) => ({ ...current, keywords: event.target.value }))} /></label>
            </div>
            <div className="space-y-3">
              <div className="text-label font-semibold text-foreground">Website chat</div>
              <label className="block text-micro text-muted">Assistant name<Input className="mt-1 w-full" value={policyForm.widgetName} onChange={(event) => setPolicyForm((current) => ({ ...current, widgetName: event.target.value }))} /></label>
              <label className="block text-micro text-muted">Welcome message<Input className="mt-1 w-full" value={policyForm.widgetWelcome} onChange={(event) => setPolicyForm((current) => ({ ...current, widgetWelcome: event.target.value }))} /></label>
              <label className="block text-micro text-muted">Allowed website origins<Textarea className="mt-1 min-h-16 w-full" placeholder="https://yourdomain.com" value={policyForm.origins} onChange={(event) => setPolicyForm((current) => ({ ...current, origins: event.target.value }))} /></label>
              <div className="flex gap-2"><Button size="sm" disabled={busy === "policy-save"} onClick={savePolicy}>Save controls</Button><Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard.writeText(customerWidgetEmbedCode); setNotice("Embed code copied."); }}><Copy className="h-4 w-4" strokeWidth={1.75} />Copy embed</Button></div>
            </div>
          </div>
        </CardBody>}
      </Card>

      {showNew && (
        <Card elevation={2} className="animate-rise-in">
          <CardHeader title="Add an incoming conversation" description="Capture a customer message from any channel in the unified queue" />
          <CardBody>
            <form onSubmit={createConversation} className="grid gap-3 lg:grid-cols-2">
              <Input required aria-label="Customer name" placeholder="Customer name" value={newConversation.customerName} onChange={(event) => setNewConversation((current) => ({ ...current, customerName: event.target.value }))} />
              <Input aria-label="Customer email" type="email" placeholder="Email (optional)" value={newConversation.customerEmail} onChange={(event) => setNewConversation((current) => ({ ...current, customerEmail: event.target.value }))} />
              <Input aria-label="Company" placeholder="Company (optional)" value={newConversation.company} onChange={(event) => setNewConversation((current) => ({ ...current, company: event.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <Select aria-label="Channel" value={newConversation.channel} onChange={(event) => setNewConversation((current) => ({ ...current, channel: event.target.value as CustomerChannel }))}>
                  {Object.entries(CHANNEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
                <Select aria-label="Priority" value={newConversation.priority} onChange={(event) => setNewConversation((current) => ({ ...current, priority: event.target.value as CustomerPriority }))}>
                  <option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option><option value="urgent">Urgent</option>
                </Select>
              </div>
              <Input required aria-label="Subject" className="lg:col-span-2" placeholder="Conversation subject" value={newConversation.subject} onChange={(event) => setNewConversation((current) => ({ ...current, subject: event.target.value }))} />
              <Textarea required aria-label="Incoming message" className="min-h-24 lg:col-span-2" placeholder="What did the customer say?" value={newConversation.message} onChange={(event) => setNewConversation((current) => ({ ...current, message: event.target.value }))} />
              <div className="flex justify-end gap-2 lg:col-span-2">
                <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
                <Button type="submit" disabled={busy === "create"}>{busy === "create" ? "Adding…" : "Add conversation"}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {(notice || error) && (
        <div className={`rounded-lg border px-3 py-2 text-label ${error ? "border-danger/30 bg-danger/10 text-danger" : "border-success/25 bg-success/10 text-success"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,0.72fr)_minmax(430px,1.4fr)] xl:grid-cols-[minmax(250px,0.78fr)_minmax(430px,1.45fr)_minmax(250px,0.8fr)]">
        <Card elevation={1} className="min-w-0 overflow-hidden">
          <CardHeader
            title="Unified queue"
            description={`${visibleConversations.length} conversations`}
            action={<Button size="icon" aria-label="Add conversation" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" strokeWidth={1.75} /></Button>}
          />
          <div className="border-y border-border px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" strokeWidth={1.75} />
              <Input aria-label="Search conversations" className="w-full pl-9" placeholder="Search customers" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="mt-2 flex gap-1">
              {(["active", "all", "resolved"] as const).map((value) => (
                <button key={value} onClick={() => setFilter(value)} className={`rounded-md px-2.5 py-1.5 text-micro capitalize transition-colors ${filter === value ? "bg-accent/15 text-accent-foreground" : "text-muted hover:bg-white/[0.04] hover:text-foreground"}`}>{value}</button>
              ))}
            </div>
          </div>
          <div className="max-h-[670px] overflow-y-auto p-2">
            {visibleConversations.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <MessageSquareText className="mx-auto h-5 w-5 text-muted" strokeWidth={1.75} />
                <p className="mt-2 text-label text-muted">No conversations in this view</p>
              </div>
            ) : visibleConversations.map((conversation) => {
              const person = customerById.get(conversation.customerId);
              const active = conversation.id === selected?.id;
              return (
                <button key={conversation.id} onClick={() => { setSelectedId(conversation.id); setReply(""); setDraftId(undefined); }} className={`group relative mb-1 w-full rounded-lg border px-3 py-3 text-left transition-colors ${active ? "border-border-accent bg-accent/10" : "border-transparent hover:border-border hover:bg-white/[0.035]"}`}>
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-accent/20 text-accent-foreground" : "bg-white/[0.05] text-muted"}`}><ChannelIcon channel={conversation.channel} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-label font-semibold text-foreground">{person?.name ?? "Customer"}</span>
                        <span className="ml-auto shrink-0 text-micro text-muted">{relativeTime(conversation.lastMessageAt)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-label text-foreground-secondary">{conversation.subject}</p>
                      <div className="mt-2 flex items-center gap-1.5">
                        {conversation.unreadCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-accent-bright" />}
                        <span className="text-micro capitalize text-muted">{conversation.status}</span>
                        {(conversation.priority === "high" || conversation.priority === "urgent") && <Badge tone={PRIORITY_TONE[conversation.priority]}>{conversation.priority}</Badge>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {selected && customer ? (
          <Card elevation={2} className="min-w-0 overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-title text-foreground">{selected.subject}</h2>
                  <Badge tone={selected.status === "resolved" ? "success" : selected.status === "waiting" ? "neutral" : "accent"} dot>{selected.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-label text-muted">
                  <span>{customer.name}</span><span>·</span><span className="flex items-center gap-1"><ChannelIcon channel={selected.channel} className="h-3 w-3" />{CHANNEL_LABELS[selected.channel]}</span>
                </div>
              </div>
              <Button size="sm" variant={selected.status === "resolved" ? "secondary" : "ghost"} onClick={() => act("resolve", () => api.updateCustomerConversation(selected.id, { status: selected.status === "resolved" ? "open" : "resolved" }), selected.status === "resolved" ? "Conversation reopened." : "Conversation resolved.")}>
                <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />{selected.status === "resolved" ? "Reopen" : "Resolve"}
              </Button>
            </div>

            <div className="min-h-[360px] max-h-[520px] space-y-4 overflow-y-auto px-5 py-5">
              {messages.map((message) => {
                if (message.direction === "internal") {
                  return <div key={message.id} className="flex items-center justify-center gap-2 text-micro text-muted"><span className="h-px w-8 bg-border" />{message.body}<span className="h-px w-8 bg-border" /></div>;
                }
                const outbound = message.direction === "outbound";
                const delivery = deliveryByMessage.get(message.id);
                return (
                  <div key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${outbound ? "rounded-br-md bg-accent text-white" : "rounded-bl-md border border-border bg-surface-hover text-foreground"}`}>
                      <p className="whitespace-pre-wrap text-body">{message.body}</p>
                      <div className={`mt-1.5 flex items-center gap-1 text-micro ${outbound ? "text-white/65" : "text-muted"}`}>
                        {message.sender === "jarvis" && <Sparkles className="h-3 w-3" strokeWidth={1.75} />}
                        <span className="capitalize">{message.sender}</span><span>·</span><span>{relativeTime(message.createdAt)}</span>
                        {delivery && <><span>·</span><span className="capitalize">{delivery.status === "recorded" ? "Delivered in chat" : delivery.status}</span></>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {latestDraft && latestDraft.status !== "used" && (
              <div className="mx-5 mb-3 rounded-xl border border-accent/25 bg-accent/[0.07] px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-label font-medium text-accent-foreground"><Sparkles className="h-4 w-4" strokeWidth={1.75} />Jarvis reply draft</div>
                  <Badge tone={latestDraft.status === "ready" ? "success" : latestDraft.status === "failed" ? "danger" : "accent"} dot pulse={latestDraft.status === "running"}>{latestDraft.status}</Badge>
                </div>
                {latestDraft.body && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-label text-foreground-secondary">{latestDraft.body}</p>}
                {latestDraft.confidence !== null && <p className="mt-2 text-micro text-muted">Confidence {Math.round(latestDraft.confidence * 100)}%{latestDraft.requiresApproval ? " · Review required" : " · Cleared by policy"}</p>}
                {latestDraft.escalationReason && <p className="mt-1 text-micro text-warning">{latestDraft.escalationReason}</p>}
                {latestDraft.errorMessage && <p className="mt-2 text-label text-danger">{latestDraft.errorMessage}</p>}
                <div className="mt-3 flex items-center gap-2">
                  {latestDraft.status === "ready" && <Button size="sm" onClick={() => applyDraft(latestDraft)}><Check className="h-4 w-4" strokeWidth={1.75} />Use draft</Button>}
                  <Link href={`/sessions/${latestDraft.sessionId}`} className="text-micro text-muted hover:text-foreground">View drafting run</Link>
                </div>
              </div>
            )}

            <form onSubmit={sendReply} className="border-t border-border px-5 py-4">
              <Textarea aria-label="Reply to customer" className="min-h-24 w-full" placeholder="Write a reply or ask Jarvis for a draft…" value={reply} onChange={(event) => { setReply(event.target.value); if (draftId) setDraftId(undefined); }} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={busy === "draft" || latestDraft?.status === "running"} onClick={() => act("draft", () => api.draftCustomerReply(selected.id), "Jarvis is drafting a response using the conversation and business context.")}>
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />{latestDraft?.status === "running" ? "Drafting…" : "Draft with Jarvis"}
                </Button>
                <Button type="submit" size="sm" disabled={!reply.trim() || busy === "reply"}><Send className="h-4 w-4" strokeWidth={1.75} />{busy === "reply" ? "Sending…" : "Send reply"}</Button>
              </div>
            </form>
          </Card>
        ) : (
          <Card elevation={1} className="flex min-h-[520px] items-center justify-center text-center">
            <div className="max-w-xs px-6"><UsersRound className="mx-auto h-6 w-6 text-muted" strokeWidth={1.75} /><h2 className="mt-3 text-title text-foreground">Your customer queue is ready</h2><p className="mt-2 text-label text-muted">Add the first incoming conversation to start building durable customer context.</p><Button className="mt-4" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" strokeWidth={1.75} />Add conversation</Button></div>
          </Card>
        )}

        <div className="space-y-4 lg:col-span-2 xl:col-span-1">
          <Card elevation={1}>
            <CardHeader title="Customer context" icon={<UserRound className="h-4 w-4" strokeWidth={1.75} />} />
            <CardBody className="space-y-4">
              {customer && selected ? (
                <>
                  <div><div className="text-title text-foreground">{customer.name}</div><div className="mt-1 text-label text-muted">{customer.company || "No company"}</div>{customer.email && <div className="mt-1 truncate text-label text-foreground-secondary">{customer.email}</div>}</div>
                  <div className="rule-fade" />
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-micro text-muted">Priority<Select className="mt-1 w-full" value={selected.priority} onChange={(event) => act("priority", () => api.updateCustomerConversation(selected.id, { priority: event.target.value as CustomerPriority }), "Priority updated.")}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></label>
                    <label className="text-micro text-muted">Sentiment<Select className="mt-1 w-full" value={selected.sentiment} onChange={(event) => act("sentiment", () => api.updateCustomerConversation(selected.id, { sentiment: event.target.value as "positive" | "neutral" | "negative" }), "Sentiment updated.")}><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></Select></label>
                  </div>
                  <label className="block text-micro text-muted">Owner<Select className="mt-1 w-full" value={selected.assignedTo} onChange={(event) => act("owner", () => api.updateCustomerConversation(selected.id, { assignedTo: event.target.value as "jarvis" | "human" }), "Conversation owner updated.")}><option value="jarvis">Jarvis</option><option value="human">Human review</option></Select></label>
                  <label className="block text-micro text-muted">Relationship notes<Textarea className="mt-1 min-h-24 w-full" placeholder="Preferences, context, promises…" value={notes} onChange={(event) => setNoteDrafts((current) => ({ ...current, [customer.id]: event.target.value }))} /></label>
                  <Button size="sm" variant="secondary" disabled={busy === "notes" || notes === (customer.notes ?? "")} onClick={() => act("notes", () => api.updateCustomer(customer.id, { notes }), "Customer notes saved.")}>Save notes</Button>
                </>
              ) : <p className="text-label text-muted">Select a conversation to see customer context.</p>}
            </CardBody>
          </Card>

          {selected && (
            <Card elevation={1}>
              <CardHeader title="Next actions" description="Move the relationship forward" />
              <CardBody className="space-y-2">
                <Button className="w-full justify-start" variant="secondary" disabled={busy === "followup"} onClick={() => act("followup", () => api.createCustomerFollowUp(selected.id), "Follow-up added to Tasks.")}><Clock3 className="h-4 w-4" strokeWidth={1.75} />Create follow-up task</Button>
                <Button className="w-full justify-start" variant="secondary" disabled={busy === "escalate"} onClick={() => act("escalate", () => api.escalateCustomerConversation(selected.id), "Escalated with a notification and human task.")}><AlertTriangle className="h-4 w-4" strokeWidth={1.75} />Escalate to human</Button>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
