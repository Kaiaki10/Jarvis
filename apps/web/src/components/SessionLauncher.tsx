"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

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

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15 p-4">
      <h2 className="font-semibold mb-3">Launch a session</h2>
      <div className="flex flex-col gap-2">
        <textarea
          className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          placeholder="What should Claude do?"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm font-mono"
            placeholder="Working directory (e.g. C:\Users\you\projects\thing)"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
          />
          <select
            className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          onClick={launch}
          disabled={launching}
          className="self-start rounded bg-foreground text-background px-4 py-1.5 text-sm disabled:opacity-50"
        >
          {launching ? "Launching…" : "Launch"}
        </button>
      </div>
    </div>
  );
}
