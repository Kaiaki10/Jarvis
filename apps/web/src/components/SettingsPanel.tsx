"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useSettings } from "@/lib/hooks";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Textarea, Select, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BackupPanel } from "@/components/BackupPanel";
import { StoragePanel } from "@/components/StoragePanel";

export function SettingsPanel() {
  const { settings, saveSettings } = useSettings();
  const [context, setContext] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings && !dirty) setContext(settings.businessContext);
  }, [settings, dirty]);

  async function saveContext() {
    setSaving(true);
    try {
      await saveSettings({ businessContext: context });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <div className="text-sm text-muted">Loading settings…</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Business context"
          description="Added to every session's instructions, so Jarvis doesn't start from scratch each time. Brand voice, products, pricing, policies, tone."
        />
        <CardBody>
          <Textarea
            className="w-full min-h-[220px] font-mono text-xs leading-relaxed"
            placeholder={
              "e.g.\n\n## Business\nWe sell handmade leather goods, direct to consumer.\n\n## Voice\nWarm, plainspoken, never salesy. No exclamation marks.\n\n## Policies\n30-day returns, no questions asked. Never promise delivery dates."
            }
            value={context}
            onChange={(e) => {
              setContext(e.target.value);
              setDirty(true);
            }}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={saveContext} disabled={saving || !dirty}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save context
            </Button>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs text-success">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
            {dirty && !saving && (
              <span className="text-xs text-muted">Unsaved changes</span>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Safety rails"
          description="Guardrails for unattended operation"
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-foreground">Automations enabled</div>
              <div className="text-xs text-muted">
                Master switch. Turn off to stop every scheduled automation from firing,
                without deleting any of them.
              </div>
            </div>
            <button
              onClick={() => saveSettings({ automationsEnabled: !settings.automationsEnabled })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                settings.automationsEnabled ? "bg-accent" : "bg-white/15"
              }`}
              role="switch"
              aria-checked={settings.automationsEnabled}
              aria-label="Automations enabled"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  settings.automationsEnabled ? "translate-x-[22px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              <div className="text-sm text-foreground">Max concurrent sessions</div>
              <div className="text-xs text-muted">
                Caps how many sessions run at once, so a burst of automations can&apos;t chew
                through your plan&apos;s rate limits. Scheduled runs wait rather than being
                skipped.
              </div>
            </div>
            <Select
              className="h-8 w-auto shrink-0 text-xs"
              value={String(settings.maxConcurrentSessions)}
              onChange={(e) =>
                saveSettings({ maxConcurrentSessions: Number(e.target.value) })
              }
            >
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n} className="bg-surface">
                  {n}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              <div className="text-sm text-foreground">Approval timeout</div>
              <div className="text-xs text-muted">
                How long an unattended run waits for you before denying itself and
                stopping. Without a limit it holds a session slot indefinitely. Denying
                is recoverable; sending something unreviewed isn&apos;t.
              </div>
            </div>
            <Select
              className="h-8 w-auto shrink-0 text-xs"
              value={String(settings.approvalTimeoutMinutes)}
              onChange={(e) =>
                saveSettings({ approvalTimeoutMinutes: Number(e.target.value) })
              }
            >
              {[
                [30, "30 minutes"],
                [60, "1 hour"],
                [240, "4 hours"],
                [720, "12 hours"],
                [1440, "24 hours"],
                [0, "Never time out"],
              ].map(([value, label]) => (
                <option key={value} value={value} className="bg-surface">
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Notifications"
          description="How Jarvis reaches you when an unattended run needs a decision"
        />
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-foreground">Desktop notifications</div>
              <div className="text-xs text-muted">
                Windows toast when something needs approval or a run fails. Only appears
                while you&apos;re signed in — Jarvis keeps running either way.
              </div>
            </div>
            <button
              onClick={() => saveSettings({ notifyOnDesktop: !settings.notifyOnDesktop })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                settings.notifyOnDesktop ? "bg-accent" : "bg-white/15"
              }`}
              role="switch"
              aria-checked={settings.notifyOnDesktop}
              aria-label="Desktop notifications"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  settings.notifyOnDesktop ? "translate-x-[22px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-sm text-foreground">Email alerts</div>
            <div className="text-xs text-muted">
              Reaches you away from this machine. Requires an email platform connected on
              the Connections page; until then this is stored but unused.
            </div>
            <Input
              className="mt-2 w-full max-w-sm"
              type="email"
              placeholder="you@example.com"
              defaultValue={settings.notifyEmail}
              onBlur={(e) => {
                if (e.target.value !== settings.notifyEmail) {
                  saveSettings({ notifyEmail: e.target.value });
                }
              }}
            />
          </div>
        </CardBody>
      </Card>

      <StoragePanel />

      <BackupPanel />

      <Card>
        <CardHeader title="Billing" description="How this connects to your Claude account" />
        <CardBody>
          <p className="text-sm text-muted leading-relaxed">
            Jarvis runs through your existing Claude Code login, so sessions draw on your
            Claude subscription&apos;s included usage — not metered per-token API billing.
            Heavy use can hit your plan&apos;s rate limits (sessions get throttled until the
            window resets), but it does not create a separate bill.
          </p>
          <p className="mt-2 text-sm text-muted leading-relaxed">
            The one thing that would change this: setting an{" "}
            <code className="font-mono text-xs text-foreground">ANTHROPIC_API_KEY</code> in the
            orchestrator&apos;s environment. That takes precedence over subscription auth and
            switches you to pay-per-token. Leave it unset.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
