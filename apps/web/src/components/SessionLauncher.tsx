"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const PERMISSION_MODES = ["default", "acceptEdits", "plan", "dontAsk"];

export function SessionLauncher() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [permissionMode, setPermissionMode] = useState("default");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    if (!prompt.trim() || !cwd.trim()) {
      setError("Prompt and working directory are both required.");
      return;
    }
    setError(null);
    setLaunching(true);
    try {
      const session = await api.createSession({ prompt, cwd, permissionMode });
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLaunching(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      launch();
    }
  }

  return (
    <Card className="p-1.5">
      <Textarea
        className="border-0 bg-transparent px-3.5 py-3 text-[15px] focus:bg-transparent"
        placeholder="What should Jarvis do?"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={launching}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
        <Input
          className="h-8 min-w-[220px] flex-1 font-mono text-xs"
          placeholder="Working directory — e.g. C:\Users\you\projects\thing"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
        />
        <Select
          className="h-8 w-auto text-xs"
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value)}
        >
          {PERMISSION_MODES.map((mode) => (
            <option key={mode} value={mode} className="bg-surface">
              {mode}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          onClick={launch}
          disabled={launching}
          className="ml-auto"
        >
          {launching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          Launch
        </Button>
      </div>
      {error && <div className="px-3.5 pb-2 text-xs text-danger">{error}</div>}
    </Card>
  );
}
