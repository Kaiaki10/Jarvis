import type {
  CreateSessionRequest,
  PermissionResponseRequest,
  SessionEventRecord,
  SessionRecord,
  TaskRecord,
  TaskStatus,
} from "@jarvis/shared";

const BASE_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4317";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listSessions: () => request<SessionRecord[]>("/sessions"),
  getSession: (id: string) => request<SessionRecord>(`/sessions/${id}`),
  createSession: (body: CreateSessionRequest) =>
    request<SessionRecord>("/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSessionEvents: (id: string, since = 0) =>
    request<SessionEventRecord[]>(`/sessions/${id}/events?since=${since}`),
  sendMessage: (id: string, text: string) =>
    request<{ ok: boolean }>(`/sessions/${id}/messages`, {
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
};

export function sessionStreamUrl(sessionId: string, since = 0) {
  return `${BASE_URL}/sessions/${sessionId}/stream?since=${since}`;
}

export function globalEventsUrl() {
  return `${BASE_URL}/events`;
}
