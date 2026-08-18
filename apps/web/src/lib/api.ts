import type {
  ConnectionRecord,
  CreateScheduledTaskRequest,
  CreateSessionRequest,
  MaintenanceResult,
  NotificationRecord,
  PlatformDefinition,
  StorageStats,
  TestConnectionResult,
  PermissionResponseRequest,
  ScheduledTaskRecord,
  SessionEventRecord,
  SessionRecord,
  SettingsRecord,
  TaskRecord,
  TaskStatus,
  UpdateScheduledTaskRequest,
  UpdateSettingsRequest,
} from "@jarvis/shared";

const BASE_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4317";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    // The orchestrator returns { error } with a message written for a person;
    // prefer that over dumping status codes and raw bodies into the UI.
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Not JSON — fall back to the raw body.
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listSessions: () => request<SessionRecord[]>("/sessions"),
  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, { method: "DELETE" }),

  getChat: () => request<{ session: SessionRecord | null }>("/chat"),
  sendChat: (text: string) =>
    request<{ sessionId: string; resumed: boolean }>("/chat", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  getSession: (id: string) => request<SessionRecord>(`/sessions/${id}`),
  createSession: (body: CreateSessionRequest) =>
    request<SessionRecord>("/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSessionEvents: (id: string, since = 0) =>
    request<SessionEventRecord[]>(`/sessions/${id}/events?since=${since}`),
  sendMessage: (id: string, text: string) =>
    request<{ ok: boolean; resumed: boolean }>(`/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  respondToPermission: (id: string, body: PermissionResponseRequest) =>
    request<{ ok: boolean }>(`/sessions/${id}/permission-response`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  interruptSession: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${id}/interrupt`, { method: "POST" }),

  listTasks: () => request<TaskRecord[]>("/tasks"),
  createTask: (title: string, description?: string) =>
    request<TaskRecord>("/tasks", {
      method: "POST",
      body: JSON.stringify({ title, description }),
    }),
  updateTask: (
    id: string,
    patch: Partial<{ title: string; description: string; status: TaskStatus; position: number }>
  ) =>
    request<TaskRecord>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  listScheduledTasks: () => request<ScheduledTaskRecord[]>("/scheduled-tasks"),
  createScheduledTask: (body: CreateScheduledTaskRequest) =>
    request<ScheduledTaskRecord>("/scheduled-tasks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateScheduledTask: (id: string, patch: UpdateScheduledTaskRequest) =>
    request<ScheduledTaskRecord>(`/scheduled-tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteScheduledTask: (id: string) =>
    request<void>(`/scheduled-tasks/${id}`, { method: "DELETE" }),

  listPlatforms: () => request<PlatformDefinition[]>("/platforms"),
  listConnections: () => request<ConnectionRecord[]>("/connections"),
  saveConnection: (platformId: string, values: Record<string, string>) =>
    request<ConnectionRecord>(`/connections/${platformId}`, {
      method: "PUT",
      body: JSON.stringify({ values }),
    }),
  testConnection: (platformId: string) =>
    request<{ result: TestConnectionResult; connection: ConnectionRecord }>(
      `/connections/${platformId}/test`,
      { method: "POST" }
    ),
  deleteConnection: (platformId: string) =>
    request<void>(`/connections/${platformId}`, { method: "DELETE" }),

  getStorage: () => request<StorageStats>("/storage"),
  compactStorage: () =>
    request<{ result: MaintenanceResult; stats: StorageStats }>("/storage/compact", {
      method: "POST",
    }),

  listNotifications: () =>
    request<{ items: NotificationRecord[]; unread: number }>("/notifications"),
  markNotificationRead: (id: string) =>
    request<{ ok: boolean }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () =>
    request<{ ok: boolean }>("/notifications/read-all", { method: "POST" }),

  exportBackup: (passphrase: string) =>
    request<Record<string, unknown>>("/backup/export", {
      method: "POST",
      body: JSON.stringify({ passphrase }),
    }),
  importBackup: (passphrase: string, bundle: unknown) =>
    request<{ restored: string[]; skipped: string[] }>("/backup/import", {
      method: "POST",
      body: JSON.stringify({ passphrase, bundle }),
    }),

  getSettings: () => request<SettingsRecord>("/settings"),
  updateSettings: (patch: UpdateSettingsRequest) =>
    request<SettingsRecord>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

export function sessionStreamUrl(sessionId: string, since = 0) {
  return `${BASE_URL}/sessions/${sessionId}/stream?since=${since}`;
}

export function globalEventsUrl() {
  return `${BASE_URL}/events`;
}
