import { basename, extname, isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  createDeliverable,
  createMissionUpdate,
  getMission,
  getSession,
  getTask,
  updateMission,
  updateTask,
} from "../db/repo.js";
import { extractSummary } from "../sessions/describeActivity.js";

const DELIVERABLE_EXTENSIONS = new Set([
  ".csv", ".docx", ".html", ".jpeg", ".jpg", ".pdf", ".png", ".pptx",
  ".svg", ".tsv", ".webp", ".xlsx", ".zip",
]);
const CONTEXTUAL_EXTENSIONS = new Set([".json", ".md"]);

export interface MissionSignals {
  summary: string;
  nextAction: string | null;
  blocker: string | null;
}

function labeledLine(text: string, labels: string[]): string | null {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const expression = new RegExp(`^(?:[-*]\\s*)?(?:${escaped.join("|")})\\s*:\\s*(.+)$`, "i");
  for (const raw of text.split("\n")) {
    const match = raw.trim().replace(/^#+\s*/, "").match(expression);
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 2_000);
  }
  return null;
}

export function extractMissionSignals(result: unknown): MissionSignals {
  const text = typeof result === "string" ? result.trim() : "";
  return {
    summary: extractSummary(text) ?? "Mission run completed successfully.",
    nextAction: labeledLine(text, ["recommended next action", "next action", "recommended next step", "next step"]),
    blocker: labeledLine(text, ["blocked by", "blocker", "blocking issue"]),
  };
}

function artifactPath(value: unknown, cwd: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const fullPath = isAbsolute(value) ? value : resolve(cwd, value);
  const extension = extname(fullPath).toLowerCase();
  if (DELIVERABLE_EXTENSIONS.has(extension)) return fullPath;
  if (CONTEXTUAL_EXTENSIONS.has(extension) && /[\\/](?:artifacts?|deliverables?|exports?|outputs?|reports?)[\\/]/i.test(fullPath)) return fullPath;
  return null;
}

export function collectArtifactsFromMessage(message: unknown, cwd: string): string[] {
  const msg = message as { type?: string; message?: { content?: unknown } };
  if (msg.type !== "assistant" || !Array.isArray(msg.message?.content)) return [];
  const paths = new Set<string>();
  for (const block of msg.message.content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>) {
    if (block.type !== "tool_use" || !["Write", "Edit", "NotebookEdit"].includes(block.name ?? "")) continue;
    const path = artifactPath(block.input?.file_path ?? block.input?.notebook_path, cwd);
    if (path) paths.add(path);
  }
  return [...paths];
}

export function collectArtifactsFromResult(result: unknown, cwd: string): string[] {
  if (typeof result !== "string") return [];
  const paths = new Set<string>();
  // Conservative path-like tokens only. Source files are excluded by the extension allowlist.
  const matches = result.match(/(?:[A-Za-z]:[\\/]|\.?\.?[\\/])[^\s`"'<>|]+\.[A-Za-z0-9]{2,5}/g) ?? [];
  for (const candidate of matches) {
    const path = artifactPath(candidate.replace(/[),.;:]+$/, ""), cwd);
    if (path) paths.add(path);
  }
  return [...paths];
}

export function reconcileMissionTurn(input: {
  sessionId: string;
  result: unknown;
  ok: boolean;
  artifactPaths: Iterable<string>;
}): boolean {
  if (!input.ok) return false;
  const session = getSession(input.sessionId);
  if (!session?.taskId) return false;
  const task = getTask(session.taskId);
  if (!task?.missionId) return false;
  const mission = getMission(task.missionId);
  if (!mission) return false;

  updateTask(task.id, { status: "done" });
  if (mission.status === "planned") updateMission(mission.id, { status: "active" });

  let artifactCount = 0;
  for (const uri of new Set(input.artifactPaths)) {
    if (!existsSync(uri)) continue;
    createDeliverable({
      missionId: mission.id,
      title: basename(uri),
      description: `Captured automatically from the run “${session.title}”.`,
      uri,
      sessionId: session.id,
    });
    artifactCount += 1;
  }

  const signals = extractMissionSignals(input.result);
  createMissionUpdate({
    missionId: mission.id,
    sessionId: session.id,
    taskId: task.id,
    summary: signals.summary,
    proposedNextAction: signals.nextAction ?? undefined,
    blocker: signals.blocker ?? undefined,
    artifactCount,
  });
  return true;
}
