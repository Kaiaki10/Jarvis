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
} from "lucide-react";
import { StoreProvider, useNotifications } from "@/lib/store";

const NAV_ITEMS = [
  { href: "/", label: "Jarvis", icon: LayoutDashboard },
  { href: "/sessions", label: "Runs", icon: Terminal },
  { href: "/automations", label: "Automations", icon: CalendarClock },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
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

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface/30 backdrop-blur-xl">
      <div className="px-5 py-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-gradient-to-br from-accent-bright to-accent text-label font-bold text-white shadow-elev-1 ring-1 ring-inset ring-white/20">
            J
          </div>
          <span className="text-title text-foreground">Jarvis</span>
        </div>
        <p className="mt-1.5 text-micro tracking-wide text-muted">
          Personal command center
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
      </nav>

      <div className="flex items-center justify-between border-t border-border px-5 py-4 text-micro">
        <span className="flex items-center gap-1.5 text-success">
          <span className="relative flex h-1.5 w-1.5">
            <span className="ping-ring absolute inset-0 rounded-full" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Online
        </span>
        <LiveClock />
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
