"use client";

import { Eye, Gauge } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useExperienceMode, type ExperienceMode } from "@/lib/experienceMode";

const OPTIONS: Array<{ mode: ExperienceMode; label: string; icon: typeof Eye }> = [
  { mode: "simple", label: "Simple", icon: Eye },
  { mode: "under-the-hood", label: "Under the hood", icon: Gauge },
];

export function ExperienceModeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useExperienceMode();

  return (
    <div
      className="material-glass inline-flex items-center gap-1 rounded-xl p-1 shadow-elev-2"
      role="group"
      aria-label="Jarvis experience mode"
    >
      {OPTIONS.map(({ mode: option, label, icon: Icon }) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={mode === option ? "secondary" : "ghost"}
          className={`whitespace-nowrap ${mode === option ? "border-accent/40 bg-accent/10 text-foreground" : ""}`}
          aria-pressed={mode === option}
          onClick={() => setMode(option)}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          {!compact && label}
          {compact && <span className="sr-only">{label}</span>}
        </Button>
      ))}
    </div>
  );
}
