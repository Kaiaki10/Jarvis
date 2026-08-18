import {
  Sparkles,
  Hammer,
  FlaskConical,
  Eye,
  Wrench,
  Radar,
  Brain,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";

/**
 * Gives each automation a visual identity so six rows are distinguishable at a
 * glance rather than six lines of near-identical text.
 *
 * Derived from the prompt rather than stored, so an automation written later
 * still gets a sensible identity without a schema change. Falls back to a
 * neutral clock when nothing matches.
 */
export interface AutomationKind {
  label: string;
  icon: LucideIcon;
  /** Tailwind text colour; also drives the glow via currentColor. */
  color: string;
  spine: string;
}

const KINDS: Array<{ match: RegExp; kind: AutomationKind }> = [
  // Ahead of Critique: both are design work, and this one implements rather
  // than files, so it must not be mistaken for the review pass.
  {
    match: /measurably nicer/i,
    kind: { label: "Polish", icon: Sparkles, color: "text-fuchsia-300", spine: "bg-fuchsia-400" },
  },
  {
    match: /implement (exactly )?one improvement/i,
    kind: { label: "Build", icon: Hammer, color: "text-indigo-300", spine: "bg-indigo-400" },
  },
  {
    match: /test coverage|test suite|grow coverage/i,
    kind: {
      label: "Tests",
      icon: FlaskConical,
      color: "text-emerald-300",
      spine: "bg-emerald-400",
    },
  },
  {
    match: /review the dashboard|demanding designer/i,
    kind: { label: "Critique", icon: Eye, color: "text-violet-300", spine: "bg-violet-400" },
  },
  {
    match: /maintenance|dependenc/i,
    kind: { label: "Maintain", icon: Wrench, color: "text-amber-300", spine: "bg-amber-400" },
  },
  {
    match: /what is missing|gap/i,
    kind: { label: "Gaps", icon: Radar, color: "text-rose-300", spine: "bg-rose-400" },
  },
  {
    match: /actually behaved|dogfood|learn from/i,
    kind: { label: "Learn", icon: Brain, color: "text-cyan-300", spine: "bg-cyan-400" },
  },
];

const FALLBACK: AutomationKind = {
  label: "Task",
  icon: CalendarClock,
  color: "text-muted",
  spine: "bg-white/20",
};

export function automationKind(prompt: string): AutomationKind {
  return KINDS.find((k) => k.match.test(prompt))?.kind ?? FALLBACK;
}
