import { randomUUID } from "node:crypto";
import type { PlatformDefinition, PlatformSignupProgress, SignupEmailEvent } from "@jarvis/shared";
import { db } from "../db/db.js";
import { getPlatform } from "./definitions.js";
import type { ResendInboundEmail } from "../customers/webhooks.js";

interface ProgressRow {
  platform_id: string;
  current_step: number;
  signup_email: string | null;
  auto_follow: number;
  started_at: string;
  updated_at: string;
}

function mapProgress(row: ProgressRow): PlatformSignupProgress {
  return {
    platformId: row.platform_id,
    currentStep: row.current_step,
    signupEmail: row.signup_email,
    autoFollow: row.auto_follow === 1,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

export function getSignupProgress(platformId: string): PlatformSignupProgress | undefined {
  const row = db
    .prepare("SELECT * FROM platform_signup_progress WHERE platform_id = ?")
    .get(platformId) as unknown as ProgressRow | undefined;
  return row ? mapProgress(row) : undefined;
}

/**
 * Tells Jarvis which address a signup-in-progress is using, so an inbound
 * confirmation email can be matched to it. Upsert: starting again (e.g. after
 * a typo'd address) just replaces the previous attempt for this platform.
 */
export function startPlatformSignup(
  platformId: string,
  input: { signupEmail: string; autoFollow?: boolean }
): PlatformSignupProgress {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO platform_signup_progress (platform_id, current_step, signup_email, auto_follow, started_at, updated_at)
     VALUES (?, 0, ?, ?, ?, ?)
     ON CONFLICT(platform_id) DO UPDATE SET
       current_step = 0, signup_email = excluded.signup_email, auto_follow = excluded.auto_follow, updated_at = excluded.updated_at`
  ).run(platformId, input.signupEmail.trim().toLowerCase(), input.autoFollow ? 1 : 0, now, now);
  return getSignupProgress(platformId)!;
}

export function advanceSignupStep(platformId: string, step: number): PlatformSignupProgress | undefined {
  if (!getSignupProgress(platformId)) return undefined;
  db.prepare("UPDATE platform_signup_progress SET current_step = ?, updated_at = ? WHERE platform_id = ?").run(
    step,
    new Date().toISOString(),
    platformId
  );
  return getSignupProgress(platformId);
}

/** Called once the platform is actually connected — the signup attempt this was tracking is over. */
export function clearSignupProgress(platformId: string): void {
  db.prepare("DELETE FROM platform_signup_progress WHERE platform_id = ?").run(platformId);
}

interface EventRow {
  id: string;
  platform_id: string;
  sender: string;
  subject: string;
  received_at: string;
  matched_link: string | null;
  action: string;
}

function mapEvent(row: EventRow): SignupEmailEvent {
  return {
    id: row.id,
    platformId: row.platform_id,
    sender: row.sender,
    subject: row.subject,
    receivedAt: row.received_at,
    matchedLink: row.matched_link,
    action: row.action as SignupEmailEvent["action"],
  };
}

export function listSignupEmailEvents(platformId: string): SignupEmailEvent[] {
  const rows = db
    .prepare("SELECT * FROM signup_email_events WHERE platform_id = ? ORDER BY received_at DESC")
    .all(platformId) as unknown as EventRow[];
  return rows.map(mapEvent);
}

/**
 * All platforms currently waiting on this exact address — not just one.
 * `signup_email` isn't unique across platforms (nothing stops using the same
 * address for two signups at once), so a single `.get()` here would pick a
 * match nondeterministically and misroute the email entirely when two
 * platforms are both waiting on it.
 */
function findProgressBySignupEmail(email: string): PlatformSignupProgress[] {
  const rows = db
    .prepare("SELECT * FROM platform_signup_progress WHERE signup_email = ?")
    .all(email.trim().toLowerCase()) as unknown as ProgressRow[];
  return rows.map(mapProgress);
}

function matchConfirmationLink(definition: PlatformDefinition, body: string): string | null {
  if (!definition.confirmationLinkPattern) return null;
  const [pattern, flags] = definition.confirmationLinkPattern;
  try {
    return body.match(new RegExp(pattern, flags))?.[0] ?? null;
  } catch {
    // A malformed pattern in a platform definition must not take webhook
    // delivery down with it — worst case, the link goes unmatched and the
    // human reads the raw email instead.
    return null;
  }
}

/**
 * A bare GET on the confirmation link — the smallest possible action, the
 * same one a human clicking it performs, nothing more. Only ever called when
 * the operator explicitly opted into `autoFollow` for this specific signup
 * attempt; the default path leaves this link for a human to click.
 */
async function followConfirmationLink(link: string): Promise<void> {
  try {
    const res = await fetch(link, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[signupInbox] confirmation link returned HTTP ${res.status}: ${link}`);
    }
  } catch (err) {
    console.error("[signupInbox] could not follow confirmation link:", err instanceof Error ? err.message : err);
  }
}

/**
 * Given an already verified+fetched inbound email, checks whether it matches
 * a platform signup in progress (by recipient address) and, if so, records it
 * and either surfaces or auto-follows the confirmation link. Returns true
 * when the email was claimed here — the caller must not also treat it as a
 * customer-support inbound.
 */
export function handleSignupConfirmationEmail(email: ResendInboundEmail): boolean {
  let claimed = false;
  for (const recipient of email.recipients) {
    for (const progress of findProgressBySignupEmail(recipient)) {
      const platform = getPlatform(progress.platformId);
      if (!platform) continue;

      const matchedLink = matchConfirmationLink(platform.definition, email.body);
      const autoFollow = progress.autoFollow && !!matchedLink;

      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR IGNORE INTO signup_email_events
           (id, platform_id, sender, subject, received_at, matched_link, action, event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        progress.platformId,
        email.sender.email,
        email.subject,
        now,
        matchedLink,
        autoFollow ? "auto_followed" : "surfaced",
        email.eventId
      );

      if (autoFollow && matchedLink) void followConfirmationLink(matchedLink);
      claimed = true;
    }
  }
  return claimed;
}
