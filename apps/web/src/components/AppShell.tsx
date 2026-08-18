"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Terminal,
  CalendarClock,
  ListChecks,
  Plug,
  Bell,
  Settings,
  WifiOff,
  Flag,
  FlaskConical,
  Megaphone,
  Brain,
  Headphones,
  Orbit,
  BadgeDollarSign,
  Bot,
} from "lucide-react";
import { StoreProvider, useConnectionStatus, useNotifications } from "@/lib/store";

const NAV_GROUPS = [
  {
    label: null,
    items: [{ href: "/", label: "Jarvis", icon: LayoutDashboard }],
  },
  {
    label: "Work",
    items: [
      { href: "/operate", label: "Operate", icon: Orbit },
      { href: "/missions", label: "Missions", icon: Flag },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/paid-growth", label: "Paid growth", icon: BadgeDollarSign },
      { href: "/customers", label: "Customers", icon: Headphones },
      { href: "/tasks", label: "Tasks", icon: ListChecks },
    ],
  },
  {
    label: "Jarvis",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/memory", label: "Memory", icon: Brain },
      { href: "/sessions", label: "Runs", icon: Terminal },
      { href: "/automations", label: "Automations", icon: CalendarClock },
      { href: "/evolution", label: "Evolution", icon: FlaskConical },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/connections", label: "Connections", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
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

/** Inside the provider, so it can show the live unread count. */
function Sidebar() {
  const pathname = usePathname();
  const { unread } = useNotifications();
  const connectionStatus = useConnectionStatus();

  return (
    // The aside stretches the full document height so the glass runs the whole
    // side of the page; the nav inside it sticks to the viewport, so it stays
    // reachable on long pages like Settings without the panel itself ending
    // partway down.
    <aside className="material-glass w-60 shrink-0 border-y-0 border-l-0 border-r-border">
      <div className="sticky top-0 flex h-screen flex-col">
      <div className="px-5 py-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-gradient-to-br from-accent-bright to-accent text-label font-bold text-white shadow-elev-1 ring-1 ring-inset ring-white/20">
            J
          </div>
          <span className="text-title text-foreground">Jarvis</span>
        </div>
        <p className="mt-1.5 text-micro tracking-wide text-muted">
          Autonomous business system
        </p>
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
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
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
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </StoreProvider>
  );
}
