"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useSettings } from "@/lib/hooks";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Textarea, Select, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BackupPanel } from "@/components/BackupPanel";
import { StoragePanel } from "@/components/StoragePanel";

export function SettingsPanel() {
  const { settings, saveSettings } = useSettings();

  if (!settings) {
    return <div className="text-body text-muted">Loading settings…</div>;
  }

  return <LoadedSettingsPanel key={settings.businessContext} settings={settings} saveSettings={saveSettings} />;
}

function LoadedSettingsPanel({
  settings,
  saveSettings,
}: ReturnType<typeof useSettings> & { settings: NonNullable<ReturnType<typeof useSettings>["settings"]> }) {
  const [context, setContext] = useState(settings.businessContext);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Business context"
          description="Added to every session's instructions, so Jarvis doesn't start from scratch each time. Brand voice, products, pricing, policies, tone."
        />
        <CardBody>
          <Textarea
            className="w-full min-h-[220px] font-mono text-label leading-relaxed"
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
              <span className="flex items-center gap-1.5 text-label text-success">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
            {dirty && !saving && (
              <span className="text-label text-muted">Unsaved changes</span>
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-body text-foreground">Automations enabled</div>
              <div className="text-label text-muted">
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

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-body text-foreground">Max concurrent sessions</div>
              <div className="text-label text-muted">
                Caps how many sessions run at once, so a burst of automations can&apos;t chew
                through your plan&apos;s rate limits. Scheduled runs wait rather than being
                skipped.
              </div>
            </div>
            <Select
              className="h-8 w-auto shrink-0 text-label"
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

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-body text-foreground">Daily platform action limit</div>
              <div className="text-label text-muted">
                Caps posts and emails per platform per day. Some platform actions are
                billable, and automations run unattended, so this stops a looping job
                from repeatedly publishing. The platform&apos;s own cap remains a backstop.
              </div>
            </div>
            <Select
              className="h-8 w-auto shrink-0 text-label"
              value={String(settings.dailyPlatformActionCap)}
              onChange={(e) =>
                saveSettings({ dailyPlatformActionCap: Number(e.target.value) })
              }
            >
              {[
                [5, "5 per day"],
                [10, "10 per day"],
                [25, "25 per day"],
                [50, "50 per day"],
                [100, "100 per day"],
                [0, "No limit"],
              ].map(([value, label]) => (
                <option key={value} value={value} className="bg-surface">
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-body text-foreground">Approval timeout</div>
              <div className="text-label text-muted">
                How long an unattended run waits for you before denying itself and
                stopping. Without a limit it holds a session slot indefinitely. Denying
                is recoverable; sending something unreviewed isn&apos;t.
              </div>
            </div>
            <Select
              className="h-8 w-auto shrink-0 text-label"
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-body text-foreground">Desktop notifications</div>
              <div className="text-label text-muted">
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
            <div className="text-body text-foreground">Email alerts</div>
            <div className="text-label text-muted">
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

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-body text-foreground">Push notifications</div>
              <div className="text-label text-muted">
                Reaches your phone, with a link straight back to the approval. Requires Push
                connected on the Connections page; until then this is stored but unused.
              </div>
            </div>
            <button
              onClick={() => saveSettings({ notifyPush: !settings.notifyPush })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                settings.notifyPush ? "bg-accent" : "bg-white/15"
              }`}
              role="switch"
              aria-checked={settings.notifyPush}
              aria-label="Push notifications"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  settings.notifyPush ? "translate-x-[22px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Images"
          description="Drop images here and Jarvis can attach them to posts"
        />
        <CardBody>
          <p className="text-label leading-relaxed text-muted">
            Generate images however you like — including in ChatGPT under a subscription
            you already pay for — then save them to this folder. Jarvis lists what&apos;s
            there and attaches one when you ask it to. Nothing outside this folder is
            readable, and you still approve every post before it goes out.
          </p>
          <Input
            className="mt-2 w-full font-mono text-label"
            placeholder="Leave blank to use the default folder in your home directory"
            defaultValue={settings.imagesFolder}
            onBlur={(e) => {
              if (e.target.value !== settings.imagesFolder) {
                saveSettings({ imagesFolder: e.target.value });
              }
            }}
          />
        </CardBody>
      </Card>

      <StoragePanel />

      <BackupPanel />

      <Card>
        <CardHeader title="Billing" description="How this connects to your Claude account" />
        <CardBody>
          <p className="text-body text-muted leading-relaxed">
            Jarvis runs through your existing Claude Code login, so sessions draw on your
            Claude subscription&apos;s included usage — not metered per-token API billing.
            Heavy use can hit your plan&apos;s rate limits (sessions get throttled until the
            window resets), but it does not create a separate bill.
          </p>
          <p className="mt-2 text-body text-muted leading-relaxed">
            The one thing that would change this: setting an{" "}
            <code className="font-mono text-label text-foreground">ANTHROPIC_API_KEY</code> in the
            orchestrator&apos;s environment. That takes precedence over subscription auth and
            switches you to pay-per-token. Leave it unset.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
