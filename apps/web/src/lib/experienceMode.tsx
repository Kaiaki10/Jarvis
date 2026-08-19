"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ExperienceMode = "simple" | "under-the-hood";

const STORAGE_KEY = "jarvis-experience-mode";

const ExperienceModeContext = createContext<{
  mode: ExperienceMode;
  setMode: (mode: ExperienceMode) => void;
} | null>(null);

export function ExperienceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ExperienceMode>("simple");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const frame = window.requestAnimationFrame(() => {
      if (saved === "simple" || saved === "under-the-hood") setModeState(saved);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const value = useMemo(() => ({
    mode,
    setMode(next: ExperienceMode) {
      setModeState(next);
      window.localStorage.setItem(STORAGE_KEY, next);
    },
  }), [mode]);

  return <ExperienceModeContext.Provider value={value}>{children}</ExperienceModeContext.Provider>;
}

export function useExperienceMode() {
  const value = useContext(ExperienceModeContext);
  if (!value) throw new Error("useExperienceMode must be used within ExperienceModeProvider");
  return value;
}
