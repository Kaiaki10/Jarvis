"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSessionsList } from "@/lib/hooks";
import { CoreVisual } from "@/components/hud/CoreVisual";

const PERMISSION_MODES = ["default", "acceptEdits", "plan", "dontAsk"];

export function SessionLauncher() {
  const router = useRouter();
  const { sessions } = useSessionsList();
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [permissionMode, setPermissionMode] = useState("default");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = sessions.some((s) =>
    ["starting", "running", "waiting_permission"].includes(s.status)
  );

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
    <div className="flex flex-col items-center gap-6">
      <CoreVisual active={active} />

      <div className="w-full max-w-xl flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-sm border border-cyan-400/40 bg-black/40 box-glow px-3 py-2.5">
          <span className="text-cyan-400 text-glow">&gt;</span>
          <input
            className="flex-1 bg-transparent outline-none text-sm text-cyan-100 placeholder:tracking-wide"
            placeholder={launching ? "LAUNCHING…" : "AWAITING COMMAND…"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && launch()}
            disabled={launching}
          />
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 rounded-sm border border-cyan-500/20 bg-black/30 px-2 py-1.5 text-xs font-mono text-cyan-200/80 outline-none focus:border-cyan-400/50"
            placeholder="working directory — e.g. C:\Users\you\projects\thing"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
          />
          <select
            className="rounded-sm border border-cyan-500/20 bg-black/30 px-2 py-1.5 text-xs text-cyan-200/80 outline-none focus:border-cyan-400/50"
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode} className="bg-black">
                {mode}
              </option>
            ))}
          </select>
          <button
            onClick={launch}
            disabled={launching}
            className="rounded-sm border border-cyan-400/50 bg-cyan-500/10 px-4 py-1 text-xs tracking-[0.2em] uppercase text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 shrink-0"
          >
            {launching ? "…" : "Launch"}
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </div>
  );
}
