# Characters — congruity for generated content

Jarvis can write and publish. What it cannot do is sound like the same entity
twice, or look like anything at all. A **character** is the thing that makes a
workflow's output recognisably one voice: who is speaking, how they sound, and —
once image generation exists — what they look like.

Written 2026-08-21 from research into current practice. Plan of record; when
reality diverges, change this file in the same commit and say why.

## The finding that shapes the text half

Claude matches a voice best when given a **writing sample**, not adjectives.
Describing tone ("plain, concrete, no hype") constrains far less than showing
three posts that already sound right. So a character sheet carries **exemplars**,
not just rules, and they are the highest-value field in it.

Supporting evidence for the model choice: Claude wins voice fidelity and
tone-matching decisively among current models — Opus 5 tops EQ-Bench Creative
Writing, Fable 5 holds the highest Arena Elo for long-form writing and
tone-matching. Gemini 3 Pro leads human-preference creative writing and is far
cheaper; GPT-5.5 is stronger on punchy hooks. Congruity is the goal here, so
Claude is the right family, and **Opus 5** the right member — Fable's advantage
is real but draws on separate usage credits rather than the subscription.

### A gap this closes

Content generation passed no model at all, so it ran on the CLI default
(Sonnet 5) while the better model sat unused in the picker. Every draft written
so far was produced by the wrong model for the job.

## The finding that shapes the visual half

**Character creation is a curated one-time act; character use is what gets
automated.** This is what makes quality and autonomy compatible instead of
opposed.

The gold-standard method is a **turnaround sheet**: one character from multiple
consistent angles — front in a neutral pose with arms away from the body so the
outfit reads, a close-up face at neutral expression, left and right profiles,
back — composited into a single reference image. More angles give the
consistency method more to work with.

Producing a good one means generating candidates and hand-picking the best
frames. That is a human act, done once. Afterwards the sheet is locked and every
future image is generated against it.

**Nano Banana Pro** (`gemini-3-pro-image`) is the production engine: rated first
for character consistency, accepts up to 14 reference images, and beats
Midjourney v7 9.50 to 8.62 on CuriousRefuge's 29-prompt test. Midjourney is the
stronger aesthetic instrument but needs `--cref` hacks for consistency; Flux 1.1
Pro is the most literal prompt-follower. LoRA training gives the tightest
identity lock and is rejected here — it needs a training pipeline, a GPU, and
hand-picking per shot, none of which an unattended system can do.

## Disclosure is a design input, not a footnote

The FTC finalised AI Transparency in Advertising rules in early 2026:
presenting an AI-generated persona as a real human without disclosure is
deceptive under Section 5, and synthetic endorsers carry the same obligations as
human ones. X added AI content labels in early 2026.

So `disclosure` is a **required** field on the character sheet, and it travels
with the character rather than being remembered per post. A character that is
openly an AI is not a compliance burden here — for a build-in-public autonomous
business it is on-message.

## Schema

`workflow_characters`, one per workflow:

| Column | Why |
|---|---|
| `workflow_id` PK | One voice per operation |
| `name` | Who is speaking |
| `persona` | Point of view, what they care about |
| `voice_rules` | Constraints — what to avoid as much as what to do |
| `exemplars` | JSON array of sample posts. The highest-value field |
| `appearance` | Description, for image prompts |
| `reference_image_ids` | JSON array — the locked turnaround, empty until images exist |
| `disclosure` | Required. Never optional |

## Sequencing

1. **Character sheet plus Opus 5 generation.** *(Done 2026-08-21.)* Generation
   reads persona, voice rules and exemplars, and runs on Opus by default.
2. **Congruity check.** *(Done 2026-08-21 — and it found a bug.)* The character
   improved voice immediately, and made a pre-existing defect worse: every draft
   ever generated — all eight — exceeded X's 280 characters, so none of them
   could ever publish. The prompt said only "match each channel's constraints"
   while the publish gate enforced a hard 280, and voice-matching against
   over-long exemplars faithfully reproduced their length. Drafts grew from
   ~350 characters to ~780.

   Fixed by sharing one `CHANNEL_BODY_LIMITS` between generation and publishing,
   stating it numerically as a hard limit, noting that the disclosure line
   counts against it, and shortening the exemplars. Regenerated drafts land at
   270–273 characters.

   The general lesson, worth keeping: **an exemplar teaches everything about
   itself, length included.** A voice sample that breaks a constraint teaches
   the model to break it too. Sample quality is not only about tone.
3. **Gemini connection.** New platform definition, credentials, test call.
   Blocked on a Google API key with billing — image output has no free tier.
4. **Turnaround sheet capture.** Curate once, store as locked references.
5. **`generate_image` tool.** Nano Banana Pro against the locked references,
   behind a hard per-workflow cap.

## What this deliberately does not do

- **No image generation before a spend cap exists.** It would be the first tool
  that spends money per call, and the approval gate covers *publishing*, not
  *generating*. Budget envelopes are planned and unbuilt; wiring paid generation
  before them would leave the one control that matters missing.
- **No LoRA training.** See above — incompatible with unattended operation.
- **No character reuse across workflows** yet. One character per workflow keeps
  the ownership rule identical to accounts, which is the rule that stops one
  workflow's output reaching another's audience.
- **No undisclosed persona.** Not a configuration option.
