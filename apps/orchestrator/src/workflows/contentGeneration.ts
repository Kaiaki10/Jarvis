import { z } from "zod";
import { CHANNEL_BODY_LIMITS } from "@jarvis/shared";
import type { WorkflowRecord, ContentFormat, MarketingChannel } from "@jarvis/shared";
import {
  createContentItem,
  finishWorkflowGenerationRun,
  getWorkflow,
  getWorkflowGenerationRunBySession,
} from "../db/workflowRepo.js";

const draftSchema = z.object({
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000),
  format: z.enum(["social_post", "email", "article", "ad"]),
  channel: z.enum(["x", "linkedin", "instagram", "facebook", "email", "blog"]),
}).strict();

const responseSchema = z.object({ drafts: z.array(draftSchema).min(1).max(12) }).strict();

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "result" in result && typeof result.result === "string") {
    return result.result;
  }
  return "";
}

export function parseGeneratedDrafts(result: unknown) {
  const text = resultText(result);
  const tagged = text.match(/<jarvis-content-drafts>\s*([\s\S]*?)\s*<\/jarvis-content-drafts>/i)?.[1];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = tagged ?? fenced ?? text.trim();
  if (!candidate) throw new Error("The generation run returned no draft data.");
  return responseSchema.parse(JSON.parse(candidate)).drafts;
}

export function workflowGenerationPrompt(input: {
  campaign: WorkflowRecord;
  count: number;
  formats: ContentFormat[];
  channels: MarketingChannel[];
  direction?: string;
  /** The workflow's voice, when it has one. See CHARACTER_PLAN.md. */
  characterBrief?: string;
}): string {
  const { campaign } = input;

  /**
   * Stated numerically, and as a hard limit rather than a style note.
   * "Match the channel's constraints" produced drafts of 300–800 characters
   * against X's 280 — every one rejected by the publish gate. A voice sample
   * makes this worse rather than better, since matching an over-long exemplar
   * faithfully reproduces its length.
   */
  const limited = input.channels
    .map((channel) => [channel, CHANNEL_BODY_LIMITS[channel]] as const)
    .filter((entry): entry is readonly [MarketingChannel, number] => Boolean(entry[1]));
  const limits = limited.length
    ? limited
        .map(
          ([channel, limit]) =>
            `- HARD LIMIT: ${channel} bodies must be ${limit} characters or fewer, including any disclosure line. A draft over ${limit} cannot be published and will be rejected. Count before you finish.\n`
        )
        .join("")
    : "";

  const voice = input.characterBrief?.trim()
    ? `

---

${input.characterBrief.trim()}

---
`
    : "";
  return `You are Jarvis's campaign content strategist. Create exactly ${input.count} polished, meaningfully distinct content drafts.

The campaign brief below is complete and authoritative. Do not seek more context, inspect files, delegate work, or explain what information you wish you had. Where the brief is intentionally high-level, write useful high-level copy without inventing details.

Campaign: ${campaign.name}
Objective: ${campaign.objective}
Audience: ${campaign.audience}
Offer: ${campaign.offer}
Primary success metric: ${campaign.primaryMetric}
Allowed channels: ${input.channels.join(", ")}
Requested formats: ${input.formats.join(", ")}
Additional direction: ${input.direction?.trim() || "Use the strongest angle for this audience and objective."}${voice}

Requirements:
${limits}- Match each channel's natural voice and constraints.
- Give every draft a clear hook, useful substance, and a specific call to action.
- Do not claim facts, results, testimonials, scarcity, or guarantees that were not provided.
- Do not publish, schedule, use tools, or modify files. Produce reviewable drafts only.
- Return no commentary outside the required tagged JSON block.

Return exactly this shape:
<jarvis-content-drafts>
{"drafts":[{"title":"Short internal title","body":"Complete publishable copy","format":"social_post|email|article|ad","channel":"x|linkedin|instagram|facebook|email|blog"}]}
</jarvis-content-drafts>`;
}

/** Converts a completed generation session into durable reviewable content. */
export function reconcileWorkflowGeneration(input: { sessionId: string; result: unknown; ok: boolean }): boolean {
  const run = getWorkflowGenerationRunBySession(input.sessionId);
  if (!run || run.status !== "running") return false;
  if (!input.ok) {
    finishWorkflowGenerationRun(input.sessionId, "failed", "The Jarvis generation run failed.");
    return true;
  }

  try {
    const campaign = getWorkflow(run.workflowId);
    if (!campaign) throw new Error("The campaign no longer exists.");
    const drafts = parseGeneratedDrafts(input.result);
    for (const draft of drafts.slice(0, run.requestedCount)) {
      if (!campaign.channels.includes(draft.channel)) {
        throw new Error(`Jarvis returned a draft for unapproved channel ${draft.channel}.`);
      }
      createContentItem({
        workflowId: campaign.id,
        ...draft,
        status: "draft",
        sessionId: input.sessionId,
      });
    }
    finishWorkflowGenerationRun(input.sessionId, "completed");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    finishWorkflowGenerationRun(input.sessionId, "failed", detail);
  }
  return true;
}
