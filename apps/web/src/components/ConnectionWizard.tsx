"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Trash2,
  RadioTower,
  ShieldCheck,
  Waves,
  Plug,
  KeyRound,
  Mail,
  MailCheck,
} from "lucide-react";
import type { SetupStepDefinition, TestConnectionResult } from "@jarvis/shared";
import { useConnections } from "@/lib/hooks";
import { usePlatformSignup } from "@/lib/store";
import { api } from "@/lib/api";
import dynamic from "next/dynamic";
import { StripeFundingPanel } from "@/components/StripeFundingPanel";

// @base-org/account's Node-side export pulls in an unrelated, broken Solana/X402
// dependency chain through @coinbase/cdp-sdk (a package this panel never actually
// calls server-side) — ssr: false keeps that resolution out of the server bundle
// entirely, since this panel only ever needs the SDK in the browser anyway.
const WalletFundingPanel = dynamic(
  () => import("@/components/WalletFundingPanel").then((m) => m.WalletFundingPanel),
  { ssr: false }
);
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function ConnectionWizard({ platformId }: { platformId: string }) {
  const { platforms, connections, refresh } = useConnections();
  const platform = platforms.find((p) => p.id === platformId);
  const connection = connections.find((c) => c.platformId === platformId);
  const signup = usePlatformSignup(platformId);

  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const stepTitles = useMemo(() => {
    if (!platform) return [];
    return [...platform.steps.map((s) => s.title), "Enter credentials", "Test connection"];
  }, [platform]);

  if (!platform) {
    return (
      <div className="px-8 py-8 text-body text-muted">
        Loading platform…{" "}
        <Link href="/under-the-hood/connections" className="underline">
          Back to connections
        </Link>
      </div>
    );
  }

  const credentialsIndex = platform.steps.length;
  const testIndex = credentialsIndex + 1;
  const isCredentials = stepIndex === credentialsIndex;
  const isTest = stepIndex === testIndex;

  async function saveAndContinue() {
    setBusy(true);
    setSaveError(null);
    try {
      await api.saveConnection(platform!.id, values);
      await refresh();
      setValues({});
      setStepIndex(testIndex);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setTestResult(null);
    try {
      const { result } = await api.testConnection(platform!.id);
      setTestResult(result);
      await refresh();
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.deleteConnection(platform!.id);
      await refresh();
      setStepIndex(0);
      setTestResult(null);
    } finally {
      setBusy(false);
    }
  }

  const hasSavedCredentials = Boolean(
    connection && Object.keys(connection.fieldHints).length > 0
  );

  return (
    <div className="px-8 pb-12">
      <Link
        href="/under-the-hood/connections"
        className="mb-6 inline-flex items-center gap-1.5 text-body text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Connections
      </Link>

      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-gradient-to-r from-accent/12 via-white/[0.02] to-transparent p-5">
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-bright ring-1 ring-inset ring-accent/25">{platform.category === "advertising" ? <RadioTower className="h-5 w-5" /> : <Plug className="h-5 w-5" />}</span>
            <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold">Connect {platform.name}</h1>{connection?.status === "connected" && <Badge tone="success" dot>Connected</Badge>}{connection?.status === "error" && <Badge tone="danger" dot>Needs attention</Badge>}</div><p className="mt-1 max-w-2xl text-label text-muted">{platform.tagline}</p>{platform.capabilities?.length ? <div className="mt-3 flex flex-wrap gap-1.5">{platform.capabilities.map((capability) => <Badge key={capability} tone="neutral">{capability}</Badge>)}</div> : null}</div>
          </div>
          {platform.dataFreshness && <div className="flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2 text-micro text-muted"><Waves className="h-3.5 w-3.5 text-accent-bright" /> {platform.dataFreshness}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr] items-start">
        <ol className="flex flex-col gap-1">
          {stepTitles.map((title, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            return (
              <li key={title}>
                <button
                  onClick={() => setStepIndex(i)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-body transition-colors ${
                    current
                      ? "bg-white/[0.06] text-foreground"
                      : "text-muted hover:bg-white/[0.03] hover:text-foreground"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-micro ${
                      done
                        ? "border-success/40 bg-success/15 text-success"
                        : current
                          ? "border-accent/50 bg-accent/20 text-accent-foreground"
                          : "border-border text-muted"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="min-w-0 truncate">{title}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <Card elevation={1}>
          <CardBody className="pt-5">
            {!isCredentials && !isTest && (
              <InstructionStep step={platform.steps[stepIndex]} platformId={platform.id} signup={signup} />
            )}

            {isCredentials && (
              <div>
                <h2 className="text-body font-semibold text-foreground">Enter credentials</h2>
                <p className="mt-1 text-label text-muted">
                  Stored encrypted on this machine. They&apos;re never shown again after saving
                  and never leave the orchestrator.
                </p>
                {platform.category === "advertising" && <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 p-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-bright" /><p className="text-label leading-relaxed text-foreground-secondary">Testing proves account access before Paid Growth can request activation or sync performance. Saving credentials alone never authorizes spend.</p></div>}
                <div className="mt-4 flex flex-col gap-4">
                  {platform.fields.map((field) => {
                    const saved = connection?.fieldHints[field.key];
                    return (
                      <div key={field.key}>
                        <label className="text-label font-medium text-foreground">
                          {field.label}
                          {field.optional && (
                            <span className="ml-1 text-muted">(optional)</span>
                          )}
                        </label>
                        <p className="mt-0.5 text-micro leading-relaxed text-muted">
                          {field.help}
                        </p>
                        <Input
                          className="mt-1.5 w-full font-mono text-label"
                          type={field.secret ? "password" : "text"}
                          placeholder={
                            saved ? `${saved} — leave blank to keep` : (field.placeholder ?? "")
                          }
                          value={values[field.key] ?? ""}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                {saveError && <div className="mt-3 text-label text-danger">{saveError}</div>}
                <div className="mt-5 flex items-center gap-2">
                  <Button onClick={saveAndContinue} disabled={busy} size="sm">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save and continue
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStepIndex(stepIndex - 1)}
                    disabled={busy}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}

            {isTest && (
              <div>
                <h2 className="text-body font-semibold text-foreground">Test connection</h2>
                <p className="mt-1 text-label text-muted">
                  Makes a real call to {platform.name} to confirm the credentials actually work
                  — not just that they were saved.
                </p>

                {!hasSavedCredentials && (
                  <p className="mt-3 text-label text-warning">
                    No credentials saved yet. Go back a step and enter them first.
                  </p>
                )}

                <div className="mt-4 flex items-center gap-2">
                  <Button onClick={runTest} disabled={busy || !hasSavedCredentials} size="sm">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Test connection
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStepIndex(credentialsIndex)}
                    disabled={busy}
                  >
                    Edit credentials
                  </Button>
                </div>

                {testResult?.ok && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/5 p-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <div>
                      <div className="text-body text-foreground">Connected</div>
                      <div className="text-label text-muted">{testResult.detail}</div>
                    </div>
                  </div>
                )}
                {testResult && !testResult.ok && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/5 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                    <div>
                      <div className="text-body text-foreground">Couldn&apos;t connect</div>
                      <div className="text-label text-muted">{testResult.message}</div>
                    </div>
                  </div>
                )}

                {platform.id === "stripe" &&
                  connection?.status === "connected" &&
                  connection.fieldHints.publishableKey && (
                    <StripeFundingPanel publishableKey={connection.fieldHints.publishableKey} />
                  )}

                {platform.id === "coinbase" &&
                  connection?.status === "connected" &&
                  connection.fieldHints.operatorAddress && (
                    <WalletFundingPanel operatorAddress={connection.fieldHints.operatorAddress} />
                  )}

                {hasSavedCredentials && (
                  <div className="mt-6 border-t border-border pt-4">
                    <Button variant="destructive" size="sm" onClick={disconnect} disabled={busy}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove credentials
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!isCredentials && !isTest && (
              <div className="mt-5 flex items-center gap-2">
                <Button size="sm" onClick={() => setStepIndex(stepIndex + 1)}>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
                {stepIndex > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setStepIndex(stepIndex - 1)}>
                    Back
                  </Button>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function InstructionStep({
  step,
  platformId,
  signup,
}: {
  step: SetupStepDefinition;
  platformId: string;
  signup: ReturnType<typeof usePlatformSignup>;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-body font-semibold text-foreground">{step.title}</h2>
        <HumanActionBadge action={step.humanAction} />
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {step.body.map((paragraph, i) => (
          <p key={i} className="text-body leading-relaxed text-muted">
            {paragraph}
          </p>
        ))}
      </div>
      {step.warning && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-label leading-relaxed text-warning">{step.warning}</p>
        </div>
      )}
      {step.linkUrl && (
        <a
          href={step.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-label font-medium text-accent-foreground hover:underline"
        >
          {step.linkLabel ?? "Open"}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {step.humanAction === "email_confirm" && (
        <EmailConfirmPanel platformId={platformId} signup={signup} />
      )}
    </div>
  );
}

/**
 * Makes the automation boundary visible on the step itself, not just in body
 * copy — captcha/SMS steps are tagged so it's obvious at a glance that Jarvis
 * does nothing there by design, not by omission.
 */
function HumanActionBadge({ action }: { action?: SetupStepDefinition["humanAction"] }) {
  if (action === "captcha" || action === "sms_otp") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-warning/30 bg-warning/5 px-2.5 py-1 text-micro font-medium text-warning">
        <ShieldCheck className="h-3 w-3" />
        {action === "captcha" ? "Needs you — verification" : "Needs you — SMS code"}
      </span>
    );
  }
  if (action === "email_confirm") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/5 px-2.5 py-1 text-micro font-medium text-accent-foreground">
        <MailCheck className="h-3 w-3" />
        Jarvis can detect this
      </span>
    );
  }
  return null;
}

function EmailConfirmPanel({
  platformId,
  signup,
}: {
  platformId: string;
  signup: ReturnType<typeof usePlatformSignup>;
}) {
  const { progress, events, refresh } = signup;
  const [email, setEmail] = useState("");
  const [autoFollow, setAutoFollow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api.startPlatformSignup(platformId, { signupEmail: email, autoFollow });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.cancelPlatformSignup(platformId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!progress) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-surface/60 p-4">
        <div className="flex items-center gap-2 text-label font-medium text-foreground">
          <Mail className="h-4 w-4 text-accent-bright" />
          Watch for the confirmation email
        </div>
        <p className="mt-1 text-label text-muted">
          Enter the email address you signed up with — ideally one on your Resend-connected
          domain — and Jarvis will detect the confirmation email as soon as it arrives.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            className="font-mono text-label sm:flex-1"
            type="email"
            placeholder="you@yourdomain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button size="sm" onClick={start} disabled={busy || !email.trim()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Start watching
          </Button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-micro text-muted">
          <input
            type="checkbox"
            checked={autoFollow}
            onChange={(e) => setAutoFollow(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Auto-follow the confirmation link the moment it&apos;s detected, instead of clicking it
          myself. Off by default.
        </label>
        {error && <div className="mt-2 text-label text-danger">{error}</div>}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-accent/25 bg-accent/5 p-4">
      <div className="flex items-center gap-2 text-label font-medium text-foreground">
        <MailCheck className="h-4 w-4 text-accent-bright" />
        Watching {progress.signupEmail} for a confirmation email
      </div>
      {progress.autoFollow && (
        <p className="mt-1 text-micro text-muted">
          Auto-follow is on — Jarvis will fetch the link itself as soon as it arrives.
        </p>
      )}
      {events.length === 0 ? (
        <p className="mt-2 text-label text-muted">Nothing detected yet — this can take a few minutes.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-md border border-border bg-surface/70 p-2.5">
              <div className="text-label text-foreground">{event.subject || "Confirmation email"}</div>
              <div className="text-micro text-muted">from {event.sender}</div>
              {event.matchedLink ? (
                <a
                  href={event.matchedLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-label font-medium text-accent-foreground hover:underline"
                >
                  {event.action === "auto_followed" ? "Already followed" : "Open confirmation link"}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <p className="mt-1 text-micro text-warning">
                  Couldn&apos;t pick out a link automatically — check this email in your inbox directly.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" className="mt-3" onClick={cancel} disabled={busy}>
        <KeyRound className="h-3.5 w-3.5" />
        Start over with a different address
      </Button>
    </div>
  );
}
