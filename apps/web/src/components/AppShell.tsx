"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  Bell,
  WifiOff,
  Flag,
  Megaphone,
  Headphones,
  Orbit,
  BadgeDollarSign,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { StoreProvider, useJarvis, useConnectionStatus, useNotifications } from "@/lib/store";
import { ExperienceModeProvider, useExperienceMode } from "@/lib/experienceMode";
import { AmbientState } from "@/components/motion";
import {
  UNDER_THE_HOOD_ROOT,
  moduleHref,
  visibleModules,
} from "@/lib/underTheHood";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Prefix that counts as "here", when the link points at a child route. */
  match?: string;
}

/**
 * Two layers, deliberately: what you work on with Jarvis, and the machinery
 * that lets him act. See UNDER_THE_HOOD_PLAN.md.
 *
 * The second layer is generated from the module registry, so a module that is
 * still dark never appears and a new one needs no edit here.
 */
const NAV_GROUPS: Array<{ label: string | null; items: NavItem[] }> = [
  {
    label: null,
    items: [{ href: "/", label: "Jarvis", icon: LayoutDashboard }],
  },
  {
    label: "Jarvis",
    items: [
      { href: "/operate", label: "Operate", icon: Orbit },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/paid-growth", label: "Paid growth", icon: BadgeDollarSign },
      { href: "/customers", label: "Customers", icon: Headphones },
      { href: "/missions", label: "Missions", icon: Flag },
      { href: "/tasks", label: "Tasks", icon: ListChecks },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Under the Hood",
    items: visibleModules().map((module) => ({
      href: moduleHref(module),
      label: module.label,
      icon: module.icon,
      // A module's link points at its first feature, so the module's own root
      // is what decides whether the tab is lit.
      match: `${UNDER_THE_HOOD_ROOT}/${module.slug}`,
    })),
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function LiveClock() {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono tabular-nums text-muted">{time ?? "--:--:--"}</span>
  );
}

/** The sidebar wordmark: Jarvis's name and role, from its own record. */
function JarvisIdentity() {
  const { jarvis } = useJarvis();
  return (
    <div className="flex w-full items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem] bg-gradient-to-br from-accent-bright to-accent text-label font-bold text-white shadow-elev-1 ring-1 ring-inset ring-white/20">
        {jarvis?.avatar ?? "J"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-title text-foreground">{jarvis?.name ?? "Jarvis"}</span>
        <span className="block truncate text-micro tracking-wide text-muted">
          {jarvis?.role || "Marketing command center"}
        </span>
      </span>
    </div>
  );
}

/**
 * Below `lg`, the sidebar becomes an off-canvas drawer (a fixed-position
 * overlay sliding in from the left) rather than a permanent column — there is
 * no room for a 240px rail on a phone. `lg` and up render it exactly as
 * before: a static, always-visible column.
 */
function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { unread } = useNotifications();
  const connectionStatus = useConnectionStatus();

  return (
    <>
      {open && (
        // Click-away backdrop — only needed
        // on the off-canvas breakpoint, hidden entirely on lg+.
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}
      {/* The aside stretches the full document height so the surface runs the
          whole side of the page; the nav inside it sticks to the viewport, so
          it stays reachable on long pages like Settings without the panel
          itself ending partway down. See `.sidebar-surface` in globals.css for
          why it's opaque below `lg` and glass again above it. */}
      <aside
        className={`sidebar-surface fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-y-0 border-l-0 border-r-border shadow-elev-2 transition-transform duration-200 ease-out lg:static lg:inset-y-auto lg:translate-x-0 lg:shadow-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
      <div className="sticky top-0 flex h-screen flex-col">
      <div className="px-5 py-6">
        <JarvisIdentity />
      </div>

      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? "home"}>
            {group.label && (
              <div className="mb-1 px-3 text-micro font-semibold uppercase tracking-[0.14em] text-muted/70">
                {group.label}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: Icon, match }) => {
                const active = isActive(pathname, match ?? href);
                const badge = href === "/notifications" && unread > 0 ? unread : null;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-body transition-all duration-150 ${
                      active
                        ? "bg-white/[0.07] font-medium text-foreground"
                        : "text-muted hover:bg-white/[0.04] hover:text-foreground"
                    }`}
                  >
                    {/* The lit spine is what marks the current page — a background
                        tint alone is too easy to miss at this contrast. */}
                    {active && (
                      <span className="absolute top-1.5 bottom-1.5 -left-1 w-0.5 rounded-full bg-accent-bright shadow-[0_0_8px_var(--accent-glow)]" />
                    )}
                    <Icon
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        active ? "text-accent-bright" : "text-muted group-hover:text-foreground"
                      }`}
                      strokeWidth={1.75}
                    />
                    {label}
                    {badge !== null && (
                      <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-micro font-semibold text-white tabular-nums shadow-elev-1">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between border-t border-border px-5 py-4 text-micro">
        <span
          className={`flex items-center gap-1.5 ${
            connectionStatus === "connected" ? "text-success" : "text-warning"
          }`}
        >
          {connectionStatus === "connected" ? (
            <span className="relative flex h-1.5 w-1.5">
              <span className="ping-ring absolute inset-0 rounded-full" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
            </span>
          ) : (
            <WifiOff className="h-3 w-3" strokeWidth={1.75} />
          )}
          {connectionStatus === "connected"
            ? "Online"
            : connectionStatus === "connecting"
              ? "Connecting"
              : "Offline"}
        </span>
        <LiveClock />
        </div>
      </div>
      </aside>
    </>
  );
}

/** Shown only below `lg`, where the sidebar is off-canvas and needs a trigger. */
function MobileTopBar({ unread, onOpenNav }: { unread: number; onOpenNav: () => void }) {
  return (
    <div className="material-glass sticky top-0 z-20 flex items-center justify-between border-b border-border px-4 py-3 lg:hidden">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </button>
      <span className="text-label font-semibold text-foreground">Jarvis</span>
      <Link
        href="/notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground"
      >
        <Bell className="h-4.5 w-4.5" strokeWidth={1.75} />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent" />}
      </Link>
    </div>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { mode } = useExperienceMode();
  const { unread } = useNotifications();
  const simpleHome = pathname === "/" && mode === "simple";
  // The drawer remembers the route it was opened on. A route change means the
  // user just picked a destination, so it closes itself by derivation rather
  // than by an effect that would re-render after every navigation.
  const [navOpenOn, setNavOpenOn] = useState<string | null>(null);
  const navOpen = navOpenOn === pathname;

  return (
    <div className="flex min-h-screen">
      {/* Not in Simple mode: the agent presence orb there already reports the
          same thing, far more directly, and two ambient signals for one state
          is one too many. */}
      {!simpleHome && <AmbientState />}
      {!simpleHome && <Sidebar open={navOpen} onClose={() => setNavOpenOn(null)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {!simpleHome && <MobileTopBar unread={unread} onOpenNav={() => setNavOpenOn(pathname)} />}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // /login has to work before the orchestrator will hand out an API token at
  // all (see app/api/token/route.ts) — it can't sit inside StoreProvider,
  // which needs a token on mount to open its SSE connection.
  if (pathname === "/login") return <>{children}</>;

  return (
    <StoreProvider>
      <ExperienceModeProvider>
        <ShellFrame>{children}</ShellFrame>
      </ExperienceModeProvider>
    </StoreProvider>
  );
}
