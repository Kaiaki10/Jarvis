export type SessionStatus =
  | "starting"
  | "running"
  | "waiting_permission"
  | "idle"
  | "completed"
  | "error"
  | "stopped"
  | "interrupted";

export interface SessionRecord {
  id: string;
  claudeSessionId: string | null;
  title: string;
  status: SessionStatus;
  cwd: string;
  permissionMode: string;
  allowedTools: string[] | null;
  taskId: string | null;
  costUsd: number | null;
  turns: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SessionEventType =
  | "assistant"
  | "user"
  | "stream_event"
  | "result"
  | "system"
  | "tool_progress"
  | "auth_status"
  | "permission_request"
  | "permission_response";

export interface SessionEventRecord {
  id: number;
  sessionId: string;
  seq: number;
  type: SessionEventType;
  payload: unknown;
  createdAt: string;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateSessionRequest {
  prompt: string;
  cwd: string;
  permissionMode?: string;
  allowedTools?: string[];
  taskId?: string;
}

export interface PermissionResponseRequest {
  requestId: string;
  decision: "allow" | "deny";
  updatedInput?: unknown;
}

export interface ScheduledTaskRecord {
  id: string;
  prompt: string;
  cwd: string;
  permissionMode: string;
  allowedTools: string[] | null;
  /** 24h local time, "HH:MM" */
  timeOfDay: string;
  /** 0=Sunday..6=Saturday */
  daysOfWeek: number[];
  enabled: boolean;
  lastRunAt: string | null;
  lastSessionId: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTaskRequest {
  prompt: string;
  cwd: string;
  permissionMode?: string;
  allowedTools?: string[];
  timeOfDay: string;
  daysOfWeek: number[];
}

export interface UpdateScheduledTaskRequest {
  prompt?: string;
  cwd?: string;
  permissionMode?: string;
  allowedTools?: string[];
  timeOfDay?: string;
  daysOfWeek?: number[];
  enabled?: boolean;
}
