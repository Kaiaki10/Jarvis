"use client";

import Link from "next/link";
import { AlertTriangle, BellOff, CheckCheck, ShieldQuestion, XCircle } from "lucide-react";
import type { NotificationRecord } from "@jarvis/shared";
import { useNotifications } from "@/lib/hooks";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

function iconFor(n: NotificationRecord) {
  if (n.type === "approval_needed") return ShieldQuestion;
  if (n.severity === "error") return XCircle;
  return AlertTriangle;
}

function toneClass(n: NotificationRecord) {
  if (n.severity === "error") return "text-danger";
  if (n.severity === "warning") return "text-warning";
  return "text-muted";
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function NotificationsList() {
  const { notifications, unread, refresh } = useNotifications();

  async function markRead(id: string) {
    await api.markNotificationRead(id);
    refresh();
  }

  async function markAll() {
    await api.markAllNotificationsRead();
    refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Attention inbox"
        description={unread ? `${unread} unread` : "Nothing unread"}
        action={
          unread > 0 ? (
            <Button size="sm" variant="ghost" onClick={markAll}>
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col px-2 pb-3">
        {notifications.length === 0 && (
          <div className="flex items-center gap-2.5 px-3 py-4 text-body text-muted">
            <BellOff className="h-4 w-4" strokeWidth={1.75} />
            No notifications yet. Jarvis will alert you here when something needs you.
          </div>
        )}
        {notifications.map((n) => {
          const Icon = iconFor(n);
          const body = (
            <div
              className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${
                n.read ? "opacity-55" : "bg-white/[0.02] pr-16 sm:pr-3"
              } ${n.sessionId ? "hover:bg-white/[0.05]" : ""}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${toneClass(n)}`} strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-body text-foreground">{n.title}</span>
                  {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </div>
                <p className="mt-0.5 text-label leading-relaxed text-muted">{n.body}</p>
              </div>
              <span className="shrink-0 text-micro text-muted">{relative(n.createdAt)}</span>
            </div>
          );

          return (
            <div key={n.id} className="group relative">
              {n.sessionId ? (
                <Link href={`/under-the-hood/brain/runs/${n.sessionId}`} onClick={() => markRead(n.id)}>
                  {body}
                </Link>
              ) : (
                body
              )}
              {!n.read && (
                <button
                  onClick={() => markRead(n.id)}
                  // Hover-reveal only works with a pointer; a touch screen has no
                  // hover state, so below `sm` this stays visible and tappable
                  // rather than becoming unreachable.
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-micro text-muted opacity-100 transition-opacity hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
                >
                  Mark read
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
