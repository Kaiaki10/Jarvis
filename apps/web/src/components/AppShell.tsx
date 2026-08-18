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
  return <span className="tabular-nums text-muted">{time ?? "--:--:--"}</span>;
}

/** Inside the provider, so it can show the live unread count. */
function Sidebar() {
  const pathname = usePathname();
  const { unread } = useNotifications();

  return (
    <aside className="w-60 shrink-0 border-r border-border flex flex-col">
      <div className="px-5 py-5">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-accent flex items-center justify-center text-xs font-bold text-white">
            J
          </div>
          <span className="text-sm font-semibold tracking-tight">Jarvis</span>
        </div>
        <p className="mt-1 text-[11px] text-muted">Personal command center</p>
      </div>
      <nav className="flex-1 px-3 flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const badge = href === "/notifications" && unread > 0 ? unread : null;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-white/[0.06] text-foreground"
                  : "text-muted hover:text-foreground hover:bg-white/[0.03]"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {label}
              {badge !== null && (
                <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-border flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
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
