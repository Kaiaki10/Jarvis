import { createHash } from "node:crypto";
import { db } from "../db/db.js";
import { getSettings } from "../db/repo.js";
import { connectionCap } from "../db/connectionsRepo.js";

/**
 * A ceiling on how many billable actions Jarvis can take per platform per day.
 *
 * Platforms charge real money per action — X is $0.015 a post, $0.20 if it contains
 * a URL — and Jarvis posts unattended on a schedule. The approval gate only protects
 * you while someone is watching; a looping automation at 3am has nothing else
 * stopping it. The vendor's own spending cap is a backstop, but it fails at the
 * billing layer after the money is gone. This fails first, and locally.
 */

/** Per-action cost estimates in USD, used only to show what has been spent. */
const ACTION_COST_USD: Record<string, { base: number; withUrl?: number }> = {
  post_to_x: { base: 0.015, withUrl: 0.2 },
};

const URL_PATTERN = /https?:\/\/\S+/i;

export function estimateActionCost(toolName: string, input: Record<string, unknown>): number {
  const rate = ACTION_COST_USD[toolName];
  if (!rate) return 0;
  const text = typeof input.text === "string" ? input.text : "";
  return rate.withUrl && URL_PATTERN.test(text) ? rate.withUrl : rate.base;
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Actions today, per account when one is known.
 *
 * Keyed on the connection rather than the platform: two businesses posting
 * through separate X accounts should not share one budget, or either can
 * starve the other. Rows predating multi-account carry connection_id equal to
 * their platform_id, so they still count against the account they belong to.
 */
export function countActionsToday(platformId: string, connectionId?: string | null): number {
  const row = (connectionId
    ? db.prepare(
        `SELECT COUNT(*) AS n FROM platform_actions
         WHERE connection_id = ? AND created_at >= ?`
      ).get(connectionId, startOfTodayIso())
    : db.prepare(
        `SELECT COUNT(*) AS n FROM platform_actions
         WHERE platform_id = ? AND created_at >= ?`
      ).get(platformId, startOfTodayIso())) as unknown as { n: number };
  return row.n;
}

export function recordAction(
  platformId: string,
  toolName: string,
  sessionId?: string | null,
  contentHash?: string | null,
  /** The platform's own id for what was posted, when it returns one. */
  externalPostId?: string | null,
  connectionId?: string | null
): void {
  db.prepare(
    `INSERT INTO platform_actions (platform_id, tool_name, session_id, created_at, content_hash, external_post_id, connection_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    platformId,
    toolName,
    sessionId ?? null,
    new Date().toISOString(),
    contentHash ?? null,
    externalPostId ?? null,
    connectionId ?? null
  );
}

/** The post id recorded for a session, for the publication reconciler. */
export function externalPostIdForSession(sessionId: string, platformId: string): string | null {
  const row = db
    .prepare(
      `SELECT external_post_id FROM platform_actions
       WHERE session_id = ? AND platform_id = ? AND external_post_id IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(sessionId, platformId) as unknown as { external_post_id: string } | undefined;
  return row?.external_post_id ?? null;
}

export function hasSuccessfulActionForSession(sessionId: string, platformId: string): boolean {
  const row = db.prepare(
    `SELECT 1 AS found FROM platform_actions WHERE session_id = ? AND platform_id = ? LIMIT 1`
  ).get(sessionId, platformId) as unknown as { found: number } | undefined;
  return Boolean(row);
}

/** Whitespace and case are not meaningful differences for "did we post this already". */
export function contentHash(text: string): string {
  return createHash("sha256")
    .update(text.trim().replace(/\s+/g, " ").toLowerCase())
    .digest("hex");
}

const DUPLICATE_WINDOW_DAYS = 30;

/**
 * X rejects a duplicate post — but the attempt is still a billed request, and for
 * an unattended automation the rejection is invisible. Catching it locally costs
 * nothing and stops the same content going out twice.
 */
export function isDuplicate(platformId: string, text: string): boolean {
  const since = new Date(
    Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM platform_actions
       WHERE platform_id = ? AND content_hash = ? AND created_at >= ?`
    )
    .get(platformId, contentHash(text), since) as unknown as { n: number };
  return row.n > 0;
}

export interface CapCheck {
  allowed: boolean;
  used: number;
  cap: number;
  message?: string;
}

/**
 * Checked before the outbound call, so a blocked action costs nothing. A cap of 0
 * means unlimited, for someone who would rather rely on the platform's own limit.
 */
export function checkDailyCap(platformId: string, connectionId?: string | null): CapCheck {
  // An account's own cap wins; otherwise the global default applies. Falling
  // back rather than treating "unset" as unlimited means a newly connected
  // account is never unbounded by default.
  const override = connectionId ? connectionCap(connectionId) : null;
  const cap = override ?? getSettings().dailyPlatformActionCap;
  const used = countActionsToday(platformId, connectionId);

  if (cap <= 0) return { allowed: true, used, cap };
  if (used < cap) return { allowed: true, used, cap };

  return {
    allowed: false,
    used,
    cap,
    message:
      `Daily limit reached for ${platformId}: ${used} of ${cap} actions already taken today. ` +
      `This is Jarvis's own guardrail against unattended overspending, not the platform's. ` +
      `Raise or disable it in Settings if this was intended.`,
  };
}

export interface PlatformUsage {
  platformId: string;
  connectionId: string | null;
  usedToday: number;
  cap: number;
  estimatedSpendToday: number;
}

/**
 * Today's usage, one row per account rather than per platform.
 *
 * Grouping by platform would total two businesses together and report them
 * against a cap neither of them is actually held to, which is the opposite of
 * what per-account caps are for.
 */
export function getUsageToday(): PlatformUsage[] {
  const fallback = getSettings().dailyPlatformActionCap;
  const rows = db
    .prepare(
      `SELECT platform_id, connection_id, COUNT(*) AS n FROM platform_actions
       WHERE created_at >= ? GROUP BY platform_id, connection_id`
    )
    .all(startOfTodayIso()) as unknown as Array<{
      platform_id: string;
      connection_id: string | null;
      n: number;
    }>;

  return rows.map((row) => ({
    platformId: row.platform_id,
    connectionId: row.connection_id,
    usedToday: row.n,
    cap: (row.connection_id ? connectionCap(row.connection_id) : null) ?? fallback,
    // Approximate: the ledger records that an action happened, not its exact
    // billed shape, so this is a floor rather than an invoice.
    estimatedSpendToday: row.n * (ACTION_COST_USD[`post_to_${row.platform_id}`]?.base ?? 0),
  }));
}
