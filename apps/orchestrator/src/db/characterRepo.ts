import type { WorkflowCharacterRecord } from "@jarvis/shared";
import { db } from "./db.js";

interface CharacterRow {
  workflow_id: string;
  name: string;
  persona: string;
  voice_rules: string;
  exemplars: string;
  appearance: string;
  reference_image_ids: string;
  disclosure: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Stored JSON that fails to parse is treated as empty rather than crashing a run. */
function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function mapCharacter(row: CharacterRow): WorkflowCharacterRecord {
  return {
    workflowId: row.workflow_id,
    name: row.name,
    persona: row.persona,
    voiceRules: row.voice_rules,
    exemplars: parseList(row.exemplars),
    appearance: row.appearance,
    referenceImageIds: parseList(row.reference_image_ids),
    disclosure: row.disclosure,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getCharacter(workflowId: string): WorkflowCharacterRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM workflow_characters WHERE workflow_id = ?`)
    .get(workflowId) as unknown as CharacterRow | undefined;
  return row ? mapCharacter(row) : undefined;
}

export function listCharacters(agentId?: string): WorkflowCharacterRecord[] {
  const rows = (
    agentId
      ? db
          .prepare(
            `SELECT c.* FROM workflow_characters c
             JOIN workflows w ON w.id = c.workflow_id
             WHERE w.agent_id = ?`
          )
          .all(agentId)
      : db.prepare(`SELECT * FROM workflow_characters`).all()
  ) as unknown as CharacterRow[];
  return rows.map(mapCharacter);
}

/**
 * What counts as a different voice.
 *
 * `appearance` and `referenceImageIds` are excluded: they steer image
 * generation, not writing, so changing them must not invalidate the attribution
 * of text that was written before. Bumping on every save would make version
 * numbers count edits rather than voices, and stage 5 would be correlating
 * performance against noise.
 */
function voiceChanged(
  before: WorkflowCharacterRecord,
  after: { name: string; persona: string; voiceRules: string; exemplars: string[]; disclosure: string }
): boolean {
  return (
    before.name !== after.name ||
    before.persona !== after.persona ||
    before.voiceRules !== after.voiceRules ||
    before.disclosure !== after.disclosure ||
    JSON.stringify(before.exemplars) !== JSON.stringify(after.exemplars)
  );
}

/** Keeps a copy of a version, so "v3 outperformed v4" is answerable later. */
function snapshotVersion(character: WorkflowCharacterRecord): void {
  db.prepare(
    `INSERT INTO workflow_character_versions
       (workflow_id, version, name, persona, voice_rules, exemplars, appearance, disclosure, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workflow_id, version) DO NOTHING`
  ).run(
    character.workflowId,
    character.version,
    character.name,
    character.persona,
    character.voiceRules,
    JSON.stringify(character.exemplars),
    character.appearance,
    character.disclosure,
    new Date().toISOString()
  );
}

/** Every version this workflow's character has had, newest first. */
export function listCharacterVersions(workflowId: string): Array<{ version: number; name: string; createdAt: string }> {
  return db
    .prepare(
      `SELECT version, name, created_at FROM workflow_character_versions
       WHERE workflow_id = ? ORDER BY version DESC`
    )
    .all(workflowId) as unknown as Array<{ version: number; name: string; createdAt: string }>;
}

export function saveCharacter(input: {
  workflowId: string;
  name: string;
  persona?: string;
  voiceRules?: string;
  exemplars?: string[];
  appearance?: string;
  referenceImageIds?: string[];
  disclosure: string;
}): WorkflowCharacterRecord {
  const now = new Date().toISOString();
  const existing = getCharacter(input.workflowId);

  const resolved = {
    name: input.name,
    persona: input.persona ?? existing?.persona ?? "",
    voiceRules: input.voiceRules ?? existing?.voiceRules ?? "",
    exemplars: input.exemplars ?? existing?.exemplars ?? [],
    disclosure: input.disclosure,
  };

  // The previous version is snapshotted before being overwritten, not after —
  // otherwise the live row has already changed and the copy would record the
  // new sheet under the old number.
  const bump = existing ? voiceChanged(existing, resolved) : false;
  if (existing && bump) snapshotVersion(existing);
  const version = existing ? existing.version + (bump ? 1 : 0) : 1;

  db.prepare(
    `INSERT INTO workflow_characters
       (workflow_id, name, persona, voice_rules, exemplars, appearance, reference_image_ids, disclosure, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workflow_id) DO UPDATE SET
       name = excluded.name,
       persona = excluded.persona,
       voice_rules = excluded.voice_rules,
       exemplars = excluded.exemplars,
       appearance = excluded.appearance,
       reference_image_ids = excluded.reference_image_ids,
       disclosure = excluded.disclosure,
       version = excluded.version,
       updated_at = excluded.updated_at`
  ).run(
    input.workflowId,
    resolved.name,
    resolved.persona,
    resolved.voiceRules,
    JSON.stringify(resolved.exemplars),
    input.appearance ?? existing?.appearance ?? "",
    JSON.stringify(input.referenceImageIds ?? existing?.referenceImageIds ?? []),
    resolved.disclosure,
    version,
    existing?.createdAt ?? now,
    now
  );

  const saved = getCharacter(input.workflowId)!;
  // The current version is snapshotted too, so a workflow that never changes
  // its voice still has v1 on record rather than an empty history.
  snapshotVersion(saved);
  return saved;
}

export function deleteCharacter(workflowId: string): void {
  db.prepare(`DELETE FROM workflow_characters WHERE workflow_id = ?`).run(workflowId);
}

/**
 * The character's contribution to a generation prompt.
 *
 * Exemplars come last and are labelled as voice samples rather than subject
 * matter — the failure mode otherwise is a model that rewrites the examples
 * instead of writing new content in their voice.
 */
export function characterBrief(character: WorkflowCharacterRecord | undefined): string {
  if (!character) return "";

  const parts = [`You are writing as ${character.name}.`];
  if (character.persona.trim()) parts.push(character.persona.trim());
  if (character.voiceRules.trim()) parts.push(`Voice rules:\n${character.voiceRules.trim()}`);

  if (character.exemplars.length) {
    parts.push(
      "Existing posts in this voice. Match their rhythm, diction and level of " +
        "detail. Do not reuse their subject matter, and do not rewrite them — " +
        "they are here to show how this character sounds:\n\n" +
        character.exemplars.map((sample, i) => `[${i + 1}]\n${sample}`).join("\n\n")
    );
  }

  parts.push(
    `Disclosure that applies to this character: ${character.disclosure.trim()}. ` +
      `Never write anything that implies ${character.name} is a human being.`
  );

  return parts.join("\n\n");
}
