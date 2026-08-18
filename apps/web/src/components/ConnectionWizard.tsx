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
} from "lucide-react";
import type { TestConnectionResult } from "@jarvis/shared";
import { useConnections } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function ConnectionWizard({ platformId }: { platformId: string }) {
  const { platforms, connections, refresh } = useConnections();
  const platform = platforms.find((p) => p.id === platformId);
  const connection = connections.find((c) => c.platformId === platformId);

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
      <div className="px-8 py-8 text-sm text-muted">
        Loading platform…{" "}
        <Link href="/connections" className="underline">
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
        href="/connections"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Connections
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Connect {platform.name}</h1>
        {connection?.status === "connected" && (
          <Badge tone="success" dot>
            Connected
          </Badge>
        )}
        {connection?.status === "error" && (
          <Badge tone="danger" dot>
            Needs attention
          </Badge>
        )}
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
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    current
                      ? "bg-white/[0.06] text-foreground"
                      : "text-muted hover:bg-white/[0.03] hover:text-foreground"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
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

        <Card>
          <CardBody className="pt-5">
            {!isCredentials && !isTest && (
              <InstructionStep step={platform.steps[stepIndex]} />
            )}

            {isCredentials && (
              <div>
                <h2 className="text-sm font-semibold text-foreground">Enter credentials</h2>
                <p className="mt-1 text-xs text-muted">
                  Stored encrypted on this machine. They&apos;re never shown again after saving
                  and never leave the orchestrator.
                </p>
                <div className="mt-4 flex flex-col gap-4">
                  {platform.fields.map((field) => {
                    const saved = connection?.fieldHints[field.key];
                    return (
                      <div key={field.key}>
                        <label className="text-xs font-medium text-foreground">
                          {field.label}
                          {field.optional && (
                            <span className="ml-1 text-muted">(optional)</span>
                          )}
                        </label>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                          {field.help}
                        </p>
                        <Input
                          className="mt-1.5 w-full font-mono text-xs"
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
                {saveError && <div className="mt-3 text-xs text-danger">{saveError}</div>}
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
                <h2 className="text-sm font-semibold text-foreground">Test connection</h2>
                <p className="mt-1 text-xs text-muted">
                  Makes a real call to {platform.name} to confirm the credentials actually work
                  — not just that they were saved.
                </p>

                {!hasSavedCredentials && (
                  <p className="mt-3 text-xs text-warning">
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
                      <div className="text-sm text-foreground">Connected</div>
                      <div className="text-xs text-muted">{testResult.detail}</div>
                    </div>
                  </div>
                )}
                {testResult && !testResult.ok && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/5 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                    <div>
                      <div className="text-sm text-foreground">Couldn&apos;t connect</div>
                      <div className="text-xs text-muted">{testResult.message}</div>
                    </div>
                  </div>
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
}: {
  step: { title: string; body: string[]; linkUrl?: string; linkLabel?: string; warning?: string };
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">{step.title}</h2>
      <div className="mt-2 flex flex-col gap-2">
        {step.body.map((paragraph, i) => (
          <p key={i} className="text-sm leading-relaxed text-muted">
            {paragraph}
          </p>
        ))}
      </div>
      {step.warning && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-warning">{step.warning}</p>
        </div>
      )}
      {step.linkUrl && (
        <a
          href={step.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent-foreground hover:underline"
        >
          {step.linkLabel ?? "Open"}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
