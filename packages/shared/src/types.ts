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

export interface CredentialFieldDefinition {
  key: string;
  label: string;
  help: string;
  placeholder?: string;
  /** Masked in the UI and never returned by the API once saved. */
  secret: boolean;
  optional?: boolean;
  /** Rejected at save time if the value doesn't start with this, to catch mispastes. */
  expectedPrefix?: string;
}

export interface SetupStepDefinition {
  title: string;
  body: string[];
  linkUrl?: string;
  linkLabel?: string;
  /** Called out in the UI as an easy-to-miss gotcha. */
  warning?: string;
}

export interface PlatformDefinition {
  id: string;
  name: string;
  tagline: string;
  category: "social" | "messaging" | "email";
  docsUrl: string;
  steps: SetupStepDefinition[];
  fields: CredentialFieldDefinition[];
}

export type ConnectionStatus = "not_connected" | "connected" | "error";

export interface ConnectionRecord {
  platformId: string;
  status: ConnectionStatus;
  /** Human-readable proof of who we connected as, e.g. "Connected as @acme". */
  detail: string | null;
  errorMessage: string | null;
  /** Masked previews only — real values never leave the orchestrator. */
  fieldHints: Record<string, string>;
  lastTestedAt: string | null;
  updatedAt: string;
}

export interface SaveConnectionRequest {
  values: Record<string, string>;
}

export interface TestConnectionResult {
  ok: boolean;
  detail?: string;
  message?: string;
}

export type NotificationType =
  | "approval_needed"
  | "session_failed"
  | "automation_failed";

export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  sessionId: string | null;
  read: boolean;
  createdAt: string;
}

export interface SettingsRecord {
  /** Durable business context appended to every session's system prompt. */
  businessContext: string;
  /** Global kill switch for all scheduled automations. */
  automationsEnabled: boolean;
  /** Guardrail against burning through subscription rate limits. */
  maxConcurrentSessions: number;
  /** Windows toast when something needs a human. Requires a signed-in desktop. */
  notifyOnDesktop: boolean;
  /** Where to email alerts. Only used once an email platform is connected. */
  notifyEmail: string;
  /** Auto-deny an unanswered approval after this many minutes. 0 waits forever. */
  approvalTimeoutMinutes: number;
  /** Drop session transcripts older than this many days. 0 keeps everything. */
  eventRetentionDays: number;
  /** Max billable actions per platform per day. 0 disables the guardrail. */
  dailyPlatformActionCap: number;
}

export interface PlatformUsage {
  platformId: string;
  usedToday: number;
  cap: number;
  estimatedSpendToday: number;
}

export interface StorageStats {
  dbBytes: number;
  totalEvents: number;
  streamEvents: number;
  compactableEvents: number;
  sessions: number;
}

export interface MaintenanceResult {
  compacted: number;
  pruned: number;
  reclaimedBytes: number;
}

export interface UpdateSettingsRequest {
  businessContext?: string;
  automationsEnabled?: boolean;
  maxConcurrentSessions?: number;
  notifyOnDesktop?: boolean;
  notifyEmail?: string;
  approvalTimeoutMinutes?: number;
  eventRetentionDays?: number;
  dailyPlatformActionCap?: number;
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
