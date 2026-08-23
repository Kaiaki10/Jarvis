"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { WorkflowCharacterRecord, WorkflowRecord } from "@jarvis/shared";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { AnimatedItem, AnimatedList, Overlay } from "@/components/motion";

/**
 * Rough guide only. Channel limits are enforced server-side at publish time;
 * this exists so an over-long exemplar is visible while you are writing it,
 * since a sample that breaks a limit teaches the model to break it too.
 */
const EXEMPLAR_GUIDE = 280;

/**
 * Exemplars carry an id purely so the list can animate.
 *
 * Keying by array index would animate the wrong row out — remove the first of
 * three and React sees two rows where there were three, so the *last* one plays
 * the exit while the first appears to have been overwritten. An id that belongs
 * to the row survives reordering and makes the animation report what happened.
 */
interface Exemplar {
  id: string;
  text: string;
}

let exemplarSeq = 0;
function toExemplar(text: string): Exemplar {
  return { id: `exemplar-${exemplarSeq++}`, text };
}

export function CharacterSheetEditor({
  open,
  workflow,
  character,
  onClose,
  onSaved,
}: {
  /** Stays mounted while closing, so the panel can animate out. */
  open: boolean;
  workflow: WorkflowRecord;
  character: WorkflowCharacterRecord | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(character?.name ?? "");
  const [persona, setPersona] = useState(character?.persona ?? "");
  const [voiceRules, setVoiceRules] = useState(character?.voiceRules ?? "");
  const [exemplars, setExemplars] = useState<Exemplar[]>(() =>
    (character?.exemplars ?? [""]).map(toExemplar)
  );
  const [disclosure, setDisclosure] = useState(character?.disclosure ?? "AI-generated.");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && disclosure.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveWorkflowCharacter(workflow.id, {
        name: name.trim(),
        persona: persona.trim(),
        voiceRules: voiceRules.trim(),
        exemplars: exemplars.map((e) => e.text.trim()).filter(Boolean),
        disclosure: disclosure.trim(),
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay open={open} onDismiss={onClose}>
      <Card>
        <CardHeader
          title={character ? `Character — ${character.name}` : "Create a character"}
          description="The voice this workflow writes in. Applies to every draft it generates."
          action={
            <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          }
        />

        <div className="space-y-4 px-5 pb-5">
          <Field label="Name" hint="Who is speaking.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jarvis"
              className="w-full"
            />
          </Field>

          <Field label="Persona" hint="Point of view, and what they care about.">
            <Textarea
              rows={3}
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="The system itself, writing in the first person about being built."
              className="w-full"
            />
          </Field>

          <Field label="Voice rules" hint="What to avoid matters as much as what to do.">
            <Textarea
              rows={4}
              value={voiceRules}
              onChange={(e) => setVoiceRules(e.target.value)}
              placeholder="Short sentences. Lead with the concrete detail. No hype vocabulary."
              className="w-full"
            />
          </Field>

          <Field
            label="Example posts"
            hint="The field that does the most work — a model matches a voice far better from a sample than from a description of one. Keep them within the channel limit; length is copied too."
          >
            <div className="space-y-2">
              <AnimatedList className="space-y-2">
                {exemplars.map((exemplar, index) => {
                  const over = exemplar.text.trim().length > EXEMPLAR_GUIDE;
                  return (
                    <AnimatedItem key={exemplar.id} className="space-y-1">
                      <div className="flex items-start gap-2">
                        <Textarea
                          rows={3}
                          value={exemplar.text}
                          onChange={(e) =>
                            setExemplars((prev) =>
                              prev.map((v) =>
                                v.id === exemplar.id ? { ...v, text: e.target.value } : v
                              )
                            )
                          }
                          placeholder="Paste a post that already sounds right."
                          className="w-full flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove example ${index + 1}`}
                          onClick={() =>
                            setExemplars((prev) => prev.filter((v) => v.id !== exemplar.id))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </Button>
                      </div>
                      <div className={`px-1 text-micro ${over ? "text-warning" : "text-muted"}`}>
                        {exemplar.text.trim().length} characters
                        {over && ` — over ${EXEMPLAR_GUIDE}; drafts will copy this length`}
                      </div>
                    </AnimatedItem>
                  );
                })}
              </AnimatedList>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted"
                onClick={() => setExemplars((prev) => [...prev, toExemplar("")])}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Add example
              </Button>
            </div>
          </Field>

          <Field
            label="Disclosure"
            hint="Required. Appears on every post. Presenting an AI character as a real person is deceptive under FTC rules, so this is not optional."
          >
            <Input
              value={disclosure}
              onChange={(e) => setDisclosure(e.target.value)}
              placeholder="AI-generated."
              className="w-full"
            />
          </Field>

          {error && <p className="text-label text-danger">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" className="text-muted" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={!canSave} onClick={() => void save()}>
              {saving ? "Saving…" : "Save character"}
            </Button>
          </div>
        </div>
      </Card>
    </Overlay>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-label font-medium text-foreground">{label}</div>
      {hint && <p className="text-micro leading-relaxed text-muted">{hint}</p>}
      {children}
    </div>
  );
}
