import {
  Bot,
  Brain,
  CalendarClock,
  Coins,
  CreditCard,
  Receipt,
  FlaskConical,
  Megaphone,
  Plug,
  Settings,
  Terminal,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface UnderTheHoodFeature {
  slug: string;
  label: string;
  icon: LucideIcon;
}

export interface UnderTheHoodModule {
  slug: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /**
   * Modules ship dark and light up when they have something to show. An empty
   * module in the sidebar reads as a broken app rather than a promise — see the
   * feature-flag decision in UNDER_THE_HOOD_PLAN.md.
   */
  enabled: boolean;
  /** Empty means the module is a single page at /under-the-hood/<slug>. */
  features: UnderTheHoodFeature[];
}

/**
 * The machinery layer: everything Jarvis needs to connect, act, and be held to
 * a limit. One registry so the sidebar, the module sub-nav, and future
 * generated surfaces cannot disagree about what exists.
 */
export const UNDER_THE_HOOD_MODULES: UnderTheHoodModule[] = [
  {
    slug: "workflows",
    label: "Workflows",
    icon: Workflow,
    description: "One operation per business, from accounts to what it learned",
    enabled: true,
    // Single page until onboarding lands; the five stages are surfaces of a
    // workflow, not siblings of it — see WORKFLOW_PLAN.md.
    features: [],
  },
  {
    slug: "social",
    label: "Social",
    icon: Megaphone,
    description: "What Jarvis published and where it went",
    enabled: true,
    // Analytics is deliberately absent until something ingests real engagement
    // metrics. A tab that can only ever render an empty chart is worse than no
    // tab — see the Social increment in UNDER_THE_HOOD_PLAN.md.
    features: [
      { slug: "posts", label: "Posts", icon: Megaphone },
      { slug: "platforms", label: "Platforms", icon: Plug },
    ],
  },
  {
    slug: "crypto",
    label: "Crypto",
    icon: Coins,
    description: "Jarvis's wallet, holdings, and launches",
    enabled: false,
    features: [
      { slug: "wallet", label: "Wallet", icon: Wallet },
      { slug: "spending", label: "Spending", icon: Coins },
      { slug: "investments", label: "Investments", icon: Coins },
      { slug: "launch", label: "Launch", icon: Coins },
    ],
  },
  {
    slug: "money",
    label: "Money",
    icon: Wallet,
    description: "What Jarvis may spend, and what it has spent",
    enabled: true,
    // Budgets first: a rail with no limit does not spend, so this is the switch
    // that turns paid capability on rather than a report on it.
    features: [
      { slug: "budgets", label: "Budgets", icon: Wallet },
      { slug: "transactions", label: "Transactions", icon: Receipt },
      { slug: "cards", label: "Cards", icon: CreditCard },
    ],
  },
  {
    slug: "automations",
    label: "Automations",
    icon: CalendarClock,
    description: "Schedules and unattended work",
    enabled: true,
    features: [],
  },
  {
    slug: "connections",
    label: "Connections",
    icon: Plug,
    description: "Every platform Jarvis can reach",
    enabled: true,
    features: [],
  },
  {
    slug: "brain",
    label: "Brain",
    icon: Brain,
    description: "Memory, agents, runs, and self-improvement",
    enabled: true,
    features: [
      { slug: "memory", label: "Memory", icon: Brain },
      { slug: "agents", label: "Agents", icon: Bot },
      { slug: "runs", label: "Runs", icon: Terminal },
      { slug: "evolution", label: "Evolution", icon: FlaskConical },
    ],
  },
  {
    slug: "settings",
    label: "Settings",
    icon: Settings,
    description: "Context, safety rails, storage, and limits",
    enabled: true,
    features: [],
  },
];

export const UNDER_THE_HOOD_ROOT = "/under-the-hood";

/** A module's landing route — its first feature, or the module page itself. */
export function moduleHref(module: UnderTheHoodModule): string {
  const first = module.features[0];
  return first
    ? `${UNDER_THE_HOOD_ROOT}/${module.slug}/${first.slug}`
    : `${UNDER_THE_HOOD_ROOT}/${module.slug}`;
}

export function featureHref(module: UnderTheHoodModule, feature: UnderTheHoodFeature): string {
  return `${UNDER_THE_HOOD_ROOT}/${module.slug}/${feature.slug}`;
}

export function visibleModules(): UnderTheHoodModule[] {
  return UNDER_THE_HOOD_MODULES.filter((m) => m.enabled);
}

/** Which module a pathname sits in, for highlighting the active tab. */
export function moduleForPath(pathname: string): UnderTheHoodModule | null {
  const slug = pathname.split("/")[2];
  return UNDER_THE_HOOD_MODULES.find((m) => m.slug === slug) ?? null;
}
