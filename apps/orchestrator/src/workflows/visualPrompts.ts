import { z } from "zod";
import type { BrandRecord, VisualPromptKind, VisualPromptRecord } from "@jarvis/shared";
import {
  createVisualPrompt,
  finishPromptGeneration,
  finishVisualPromptRun,
  getVisualPrompt,
  getVisualPromptRunBySession,
  listKeptPrompts,
  listVisualPrompts,
  markPromptGenerating,
} from "../db/brandRepo.js";

const promptSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8_000),
  kind: z.enum(["image", "video", "voiceover"]),
  model: z.string().trim().max(200).nullable().optional(),
}).strict();

const responseSchema = z.object({ prompts: z.array(promptSchema).min(1).max(12) }).strict();

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "result" in result && typeof result.result === "string") {
    return result.result;
  }
  return "";
}

export function parseVisualPrompts(result: unknown) {
  const text = resultText(result);
  const tagged = text.match(/<jarvis-visual-prompts>\s*([\s\S]*?)\s*<\/jarvis-visual-prompts>/i)?.[1];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = tagged ?? fenced ?? text.trim();
  if (!candidate) throw new Error("The generation run returned no prompt data.");
  return responseSchema.parse(JSON.parse(candidate)).prompts;
}

export function visualPromptGenerationPrompt(input: {
  brand: BrandRecord;
  count: number;
  kinds: VisualPromptKind[];
  direction?: string;
}): string {
  const kept = listKeptPrompts(input.brand.id);
  const recent = listVisualPrompts(input.brand.id)
    .filter((prompt) => prompt.status === "generated")
    .slice(0, 4);
  const exemplars = kept.length
    ? `
Proven style for this brand — match this look and feel. These are prompts the owner rated "keep":
${kept.map((prompt, index) => `${index + 1}. [${prompt.kind}] ${prompt.title}: ${prompt.body.slice(0, 600)}`).join("\n")}`
    : `
No proven style exists yet for this brand — this batch sets the visual foundation. Keep it cohesive: shared palette, lighting, and composition language across every prompt.`;
  const continuity = recent.length
    ? `
Recent outputs to stay consistent with (same brand world, new angles — do not repeat them):
${recent.map((prompt, index) => `${index + 1}. ${prompt.title} (${prompt.kind})`).join("\n")}`
    : "";

  return `You are Jarvis's visual strategist. Write exactly ${input.count} Artlist generation prompts/scripts.

The brand brief below is complete and authoritative. Do not seek more context, inspect files, delegate work, or explain what information you wish you had. Where the brief is intentionally high-level, write useful high-level prompts without inventing brand facts.

Brand: ${input.brand.name}
What it is: ${input.brand.description || "No description yet — write versatile, on-brand-agnostic prompts."}
${input.brand.website ? `Website: ${input.brand.website}` : ""}${exemplars}${continuity}

Requested kinds: ${input.kinds.join(", ")}
Additional direction: ${input.direction?.trim() || "The strongest visual angles for this brand."}

Requirements:
- Each prompt must be self-contained: subject, setting, style, palette, lighting, composition, mood. Artlist sees only the prompt, not this brief.
- Prompts are scripts, not generations: nothing is generated now. A human reviews each one, and only approved prompts ever run on Artlist.
- Do not claim facts, results, testimonials, or guarantees that were not provided.
- Do not publish, generate, use tools, or modify files. Produce reviewable prompts only.
- Return no commentary outside the required tagged JSON block.

Return exactly this shape:
<jarvis-visual-prompts>
{"prompts":[{"title":"Short internal title","body":"Complete Artlist-ready prompt","kind":"image|video|voiceover","model":null}]}
</jarvis-visual-prompts>`;
}

/** Converts a completed scripts session into durable reviewable prompts. */
export function reconcileVisualPromptScripts(input: { sessionId: string; result: unknown; ok: boolean }): boolean {
  const run = getVisualPromptRunBySession(input.sessionId);
  if (!run || run.status !== "running" || run.kind !== "scripts") return false;
  if (!input.ok) {
    finishVisualPromptRun(input.sessionId, "failed", "The Jarvis generation run failed.");
    return true;
  }
  try {
    const drafts = parseVisualPrompts(input.result);
    for (const draft of drafts) {
      createVisualPrompt({
        brandId: run.brandId,
        title: draft.title,
        body: draft.body,
        kind: draft.kind,
        model: draft.model ?? null,
        sessionId: input.sessionId,
      });
    }
    finishVisualPromptRun(input.sessionId, "completed");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    finishVisualPromptRun(input.sessionId, "failed", detail);
  }
  return true;
}

/**
 * The exact instruction for executing one approved prompt on Artlist.
 *
 * No model judgement is involved at run time: the body below is the approved
 * text verbatim, and the session is pinned to the Artlist connection alone, so
 * it has no publishing tool to reach for even if asked. The Artlist tool call
 * itself still pauses for the spend confirmation — approving the prompt
 * authorizes *what* to generate, the tap confirms *spending* on it.
 */
export function visualPromptExecutionPrompt(prompt: VisualPromptRecord, brand: BrandRecord): string {
  return `Generate this approved brand visual on Artlist exactly as scripted. Do not rewrite, reinterpret, or combine it with anything else.

Brand: ${brand.name}
Kind: ${prompt.kind}${prompt.model ? ` (model: ${prompt.model})` : ""}
Approved prompt (use verbatim):
---
${prompt.body}
---

Steps:
1. Generate with Artlist using the prompt above${prompt.model ? ` and the model ${prompt.model}` : ""}. The generation tool will pause for the spend approval — that is expected.
2. Save the finished file with import_media_url and report the stored filename exactly.
3. Do not publish, schedule, post, or use any other tool. If generation fails, report that plainly and stop.`;
}

/**
 * Converts a completed execution session back into prompt state.
 *
 * Success means Artlist produced and imported a file (the session reports the
 * stored filename; the file itself is linked when the operator confirms it —
 * the session's prose is not trusted as a filename). Failure returns the
 * prompt to `approved` so it can be retried without re-review: the approval
 * was for *what* to generate, and a failed run never spent it.
 */
export function reconcileVisualPromptExecution(input: { sessionId: string; ok: boolean }): boolean {
  const run = getVisualPromptRunBySession(input.sessionId);
  if (!run || run.status !== "running" || run.kind !== "execute" || !run.visualPromptId) return false;
  if (!input.ok) {
    finishVisualPromptRun(input.sessionId, "failed", "The Artlist execution run failed.");
    finishPromptGeneration(run.visualPromptId, false);
    return true;
  }
  finishVisualPromptRun(input.sessionId, "completed");
  finishPromptGeneration(run.visualPromptId, true);
  return true;
}

/**
 * Marks an approved prompt as generating. Refuses anything else — this is the
 * server-side enforcement of "no approval, no spend".
 */
export function beginPromptExecution(promptId: string): VisualPromptRecord | undefined {
  const prompt = getVisualPrompt(promptId);
  if (!prompt || prompt.status !== "approved") return undefined;
  return markPromptGenerating(promptId);
}

export function listBrandPromptsForGeneration(brandId: string): VisualPromptRecord[] {
  return listVisualPrompts(brandId);
}
