"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2, Users } from "lucide-react";
import type { ConnectionRecord, PlatformDefinition } from "@jarvis/shared";
import { api } from "@/lib/api";
import { useConnections } from "@/lib/hooks";
import { useAgents } from "@/lib/store";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { AnimatedItem, AnimatedList, Crossfade } from "@/components/motion";

/**
 * Every account connected for one platform.
 *
 * The setup wizard edits "the" account for a platform, which was the only shape
 * that existed when it was written. Running several businesses needs more than
 * one — an X account each — and this is where the extra ones are added, tested
 * and removed. Each account is addressed by its own id, because a platform name
 * stops identifying anything once there are two.
 */
export function PlatformAccounts({ platform }: { platform: PlatformDefinition }) {
  const { connections, refresh } = useConnections();
  const { agents } = useAgents();
  const [adding, setAdding] = useState(false);

  const accounts = useMemo(
    () => connections.filter((connection) => connection.platformId === platform.id),
    [connections, platform.id]
  );

  if (accounts.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader
        title="Accounts"
        description={
          accounts.length === 1
            ? "One account connected. Add another to run a second business on this platform."
            : `${accounts.length} accounts connected. Each has its own credentials and its own daily cap.`
        }
        action={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted"
            onClick={() => setAdding((open) => !open)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Add account
          </Button>
        }
      />

      {/* Removing an account is the moment this matters: the row leaves under
          its own steam and the ones below close the gap, instead of the whole
          list snapping to a new shape. */}
      <AnimatedList className="space-y-2 px-5 pb-5">
        {accounts.map((account) => (
          <AnimatedItem key={account.id}>
            <AccountRow
              account={account}
              agentName={agents.find((a) => a.id === account.agentId)?.name}
              canDelete={accounts.length > 1}
              onChanged={refresh}
            />
          </AnimatedItem>
        ))}

        {adding && (
          <AnimatedItem key="add">
            <AddAccount
              platform={platform}
              onClose={() => setAdding(false)}
              onAdded={async () => {
                await refresh();
                setAdding(false);
              }}
            />
          </AnimatedItem>
        )}
      </AnimatedList>
    </Card>
  );
}

function AccountRow({
  account,
  agentName,
  canDelete,
  onChanged,
}: {
  account: ConnectionRecord;
  agentName?: string;
  canDelete: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"test" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const connected = account.status === "connected";
  const errored = account.status === "error";

  async function act(kind: "test" | "delete", fn: () => Promise<unknown>) {
    setBusy(kind);
    setMessage(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-3">
        {connected ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={1.75} />
        ) : errored ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
        ) : (
          <Users className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium text-foreground">
            {account.label ?? account.detail ?? "Original account"}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted">
            {/* Shared vs owned matters: a shared account is reachable by every
                agent, which is exactly what you do not want for a second business. */}
            <span>{account.agentId ? `Owned by ${agentName ?? "an agent"}` : "Shared with every agent"}</span>
            {account.dailyActionCap !== null && (
              <>
                <span className="h-1 w-1 rounded-full bg-border-strong" />
                <span>{account.dailyActionCap} actions a day</span>
              </>
            )}
          </div>
        </div>

        {/* Testing an account is the one place a badge changes under you.
            Dissolving between the two states shows the change happened; a hard
            swap looks like the row was replaced by a different row. */}
        <Crossfade viewKey={account.status} className="shrink-0">
          <Badge tone={connected ? "success" : errored ? "danger" : "neutral"} dot={connected || errored}>
            {connected ? "Connected" : errored ? "Needs attention" : "Not tested"}
          </Badge>
        </Crossfade>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted"
          disabled={busy !== null}
          onClick={() =>
            void act("test", async () => {
              const { result } = await api.testAccount(account.id);
              setMessage(result.ok ? (result.detail ?? "Working.") : (result.message ?? "Failed."));
            })
          }
        >
          {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
        </Button>

        {canDelete && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-muted hover:text-danger"
            aria-label="Remove this account"
            disabled={busy !== null}
            onClick={() => void act("delete", () => api.deleteAccount(account.id))}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        )}
      </div>

      {message && <p className="mt-2 text-micro text-foreground-secondary">{message}</p>}
    </div>
  );
}

function AddAccount({
  platform,
  onClose,
  onAdded,
}: {
  platform: PlatformDefinition;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = platform.fields
    .filter((field) => !field.optional && !values[field.key]?.trim())
    .map((field) => field.label);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveConnection(platform.id, values, {
        createNew: true,
        label: label.trim() || null,
      });
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/[0.04] p-4">
      <div>
        <div className="text-label font-medium text-foreground">Add another {platform.name} account</div>
        {/* Said explicitly: a new account starts empty rather than inheriting,
            or it would just be a duplicate of the first under a new name. */}
        <p className="mt-1 text-micro leading-relaxed text-muted">
          Its own credentials, its own cap. Nothing is copied from the existing account.
        </p>
      </div>

      <Input
        value={label}
        placeholder="Name it, e.g. @acme"
        aria-label="Account name"
        className="w-full"
        onChange={(event) => setLabel(event.target.value)}
      />

      {platform.fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="text-micro text-muted" htmlFor={`new-${field.key}`}>
            {field.label}
            {field.optional && <span className="text-muted"> (optional)</span>}
          </label>
          <Input
            id={`new-${field.key}`}
            type={field.secret ? "password" : "text"}
            value={values[field.key] ?? ""}
            placeholder={field.placeholder}
            className="w-full"
            onChange={(event) =>
              setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
            }
          />
        </div>
      ))}

      {error && <p className="text-micro text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="text-muted" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || missing.length > 0}
          title={missing.length ? `Still needed: ${missing.join(", ")}` : undefined}
          onClick={() => void save()}
        >
          {busy ? "Adding…" : "Add account"}
        </Button>
      </div>
    </div>
  );
}
