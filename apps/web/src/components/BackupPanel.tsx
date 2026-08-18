"use client";

import { useRef, useState } from "react";
import { Download, Upload, ShieldAlert, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useConnections } from "@/lib/hooks";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function BackupPanel() {
  const { connections, refresh } = useConnections();
  const [exportPass, setExportPass] = useState("");
  const [importPass, setImportPass] = useState("");
  const [busy, setBusy] = useState<"export" | "import" | "data" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasCredentials = connections.length > 0;

  async function downloadData() {
    setBusy("data");
    setError(null);
    setNotice(null);
    try {
      const blob = await api.downloadDataBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jarvis-data-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice("Jarvis data backup downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function doExport() {
    setBusy("export");
    setError(null);
    setNotice(null);
    try {
      const bundle = await api.exportBackup(exportPass);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jarvis-credentials-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportPass("");
      setNotice("Backup downloaded. Store it somewhere the passphrase isn't.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function doImport(file: File) {
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      const bundle = JSON.parse(await file.text());
      const result = await api.importBackup(importPass, bundle);
      await refresh();
      setImportPass("");
      const parts = [`Restored ${result.restored.length} connection(s)`];
      if (result.skipped.length) parts.push(`skipped unknown: ${result.skipped.join(", ")}`);
      setNotice(`${parts.join(" · ")}. Re-test each one to confirm the tokens still work.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader
        title="Backup & recovery"
        description="Platform credentials are encrypted with a key that exists only on this machine"
      />
      <CardBody className="flex flex-col gap-5">
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-label leading-relaxed text-warning">
            If <code className="font-mono">jarvis.key</code> is lost — disk failure, a
            reinstall, an accidental delete — every stored credential becomes permanently
            unrecoverable. A backup re-encrypts them under a passphrase you choose, so the
            file is safe to keep anywhere the passphrase isn&apos;t.
          </p>
        </div>

        <div>
          <div className="text-body font-medium text-foreground">Back up Jarvis data</div>
          <p className="mt-0.5 text-label text-muted">
            Downloads a consistent SQLite snapshot containing tasks, schedules, settings,
            notifications, sessions, and transcripts. Keep the encrypted credential backup
            below as well; credentials in this database still require this machine&apos;s key.
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="secondary"
            onClick={downloadData}
            disabled={busy !== null}
          >
            {busy === "data" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download data backup
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          <div className="text-body font-medium text-foreground">Create a backup</div>
          <p className="mt-0.5 text-label text-muted">
            Downloads an encrypted file containing every saved credential. Choose a
            passphrase you can recover — losing it makes the backup useless.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              type="password"
              className="min-w-[260px] flex-1"
              placeholder="Backup passphrase (12+ characters)"
              value={exportPass}
              onChange={(e) => setExportPass(e.target.value)}
              autoComplete="new-password"
            />
            <Button
              size="sm"
              onClick={doExport}
              disabled={busy !== null || exportPass.length < 12 || !hasCredentials}
            >
              {busy === "export" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Download backup
            </Button>
          </div>
          {!hasCredentials && (
            <p className="mt-1.5 text-label text-muted">
              Nothing to back up yet — connect a platform first.
            </p>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <div className="text-body font-medium text-foreground">Restore from a backup</div>
          <p className="mt-0.5 text-label text-muted">
            Recovers credentials onto this machine. Each restored connection is marked
            untested until you re-run its connection test.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              type="password"
              className="min-w-[260px] flex-1"
              placeholder="Passphrase used for that backup"
              value={importPass}
              onChange={(e) => setImportPass(e.target.value)}
              autoComplete="off"
            />
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) doImport(file);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null || importPass.length < 12}
            >
              {busy === "import" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Choose backup file
            </Button>
          </div>
        </div>

        {error && <div className="text-label text-danger">{error}</div>}
        {notice && (
          <div className="flex items-start gap-1.5 text-label text-success">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {notice}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
