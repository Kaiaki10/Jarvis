"use client";

import { useEffect, useState } from "react";

export function Header() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="border-b border-cyan-500/15 bg-black/40 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl font-black tracking-[0.15em] text-cyan-300 text-glow">
            JARVIS
          </span>
          <span className="text-[10px] tracking-[0.2em] text-cyan-500/40 uppercase hidden sm:inline">
            personal command center
          </span>
        </div>
        <div className="flex items-center gap-6 text-[11px] tracking-[0.15em] uppercase text-cyan-200/70">
          <div className="flex items-center gap-2">
            <span className="text-cyan-500/40">System Status</span>
            <span className="flex items-center gap-1.5 text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-hud-pulse box-glow" />
              Online
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-cyan-500/40">Local Time</span>
            <span className="text-cyan-300 tabular-nums">{time ?? "--:--:--"}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
