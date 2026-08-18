import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/db.js";
import { getSettings } from "../db/repo.js";
import { getConnectionCredentials, getConnection } from "../db/connectionsRepo.js";
import { globalBus } from "../events/globalBus.js";
import type {
  NotificationRecord,
  NotificationSeverity,
  NotificationType,
} from "@jarvis/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = join(__dirname, "..", "..", "..", "..", "scripts", "toast.ps1");

interface NotificationRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  session_id: string | null;
  read: number;
  created_at: string;
}

function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    type: row.type as NotificationType,
    severity: row.severity as NotificationSeverity,
    title: row.title,
    body: row.body,
    sessionId: row.session_id,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

export function listNotifications(limit = 100): NotificationRecord[] {
  const rows = db
    .prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as NotificationRow[];
  return rows.map(mapNotification);
}

export function unreadCount(): number {
  const row = db
    .prepare(`SELECT COUNT(*) as n FROM notifications WHERE read = 0`)
    .get() as unknown as { n: number };
  return row.n;
}

export function markRead(id: string): void {
  db.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`).run(id);
  globalBus.emit("notifications_changed");
}

export function markAllRead(): void {
  db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0`).run();
  globalBus.emit("notifications_changed");
}

/**
 * True if an unread notification of this type already exists for this session.
 * Without this, a session that blocks, gets approved, then blocks again would
 * stack up duplicates for the same underlying situation.
 */
function alreadyPending(type: NotificationType, sessionId: string | null): boolean {
  if (!sessionId) return false;
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM notifications WHERE type = ? AND session_id = ? AND read = 0`
    )
    .get(type, sessionId) as unknown as { n: number };
  return row.n > 0;
}

function sendDesktopToast(title: string, body: string): void {
  if (!getSettings().notifyOnDesktop) return;

  // Toasts need an interactive desktop. The orchestrator runs as S4U so it keeps
  // working while signed out — the toast just won't appear, which is not an error.
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      TOAST_SCRIPT,
      "-Title",
      title,
      "-Body",
      body,
    ],
    { windowsHide: true, stdio: "ignore" }
  );
  child.on("error", () => {});
  child.unref();
}

async function sendEmail(title: string, body: string): Promise<void> {
  const { notifyEmail } = getSettings();
  if (!notifyEmail) return;

  const connection = getConnection("resend");
  if (connection?.status !== "connected") return;
  const creds = getConnectionCredentials("resend");
  if (!creds?.apiKey || !creds.fromAddress) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: creds.fromAddress,
        to: [notifyEmail],
        subject: `Jarvis: ${title}`,
        text: `${body}\n\nOpen the dashboard: http://localhost:3000`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // A notification that fails to send must never take down the thing it is
    // reporting on.
  }
}

export interface NotifyInput {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  sessionId?: string | null;
}

/**
 * Records a notification and pushes it out of band. Fire-and-forget by design:
 * callers are in the middle of session handling and must not block on delivery.
 */
export function notify(input: NotifyInput): NotificationRecord | null {
  const sessionId = input.sessionId ?? null;
  if (alreadyPending(input.type, sessionId)) return null;

  const record: NotificationRecord = {
    id: randomUUID(),
    type: input.type,
    severity: input.severity,
    title: input.title,
    body: input.body,
    sessionId,
    read: false,
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO notifications (id, type, severity, title, body, session_id, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    record.id,
    record.type,
    record.severity,
    record.title,
    record.body,
    record.sessionId,
    record.createdAt
  );

  globalBus.emit("notifications_changed");
  sendDesktopToast(record.title, record.body);
  void sendEmail(record.title, record.body);

  return record;
}
