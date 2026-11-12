// Slot filling in the kiosk: what the visitor says or types, read against the fields of the
// journey step on screen (yaxb-core journeys/slots). The label, pattern, entity (local NER) and
// meaning (sentence-transformer) passes run on this device; the model pass is a request to the
// Worker, made only when the visitor asks for it. Results are suggestions the form shows, never
// answers given on the visitor's behalf.
import { matchFields, MEANING_THRESHOLDS, type Field, type SlotFill, type SlotMatch } from "@sekaran-ind/yaxb-core/journeys";
import { LANGUAGES, type AgentSettings } from "@sekaran-ind/yaxb-core/settings";
import { embedTexts, recognizeEntities } from "./offline";
import { modelFor } from "./semantic";

/** Read `text` against a step's fields, on this device. */
export async function matchOnDevice(fields: readonly Field[], text: string, settings: Pick<AgentSettings, "knowledge" | "language">, signal?: AbortSignal): Promise<SlotMatch> {
  const model = modelFor(settings, text);
  const wantsNer = fields.some((f) => f.entity === "person" || f.entity === "location" || f.entity === "organization");
  return matchFields(fields, text, {
    embed: (texts) => embedTexts(model, texts, signal),
    meaning: MEANING_THRESHOLDS[model],
    ner: wantsNer ? (t) => recognizeEntities(t, signal) : undefined,
    languages: LANGUAGES,
  });
}

/** The model pass: the Worker's AI model fills what's left, constrained to the fields' schema. */
export async function extractWithModel(journey: string, step: string, text: string, selection: { provider: string; model: string }, signal?: AbortSignal): Promise<SlotFill[]> {
  const res = await fetch("/api/agent/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journey, step, text, ...selection }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as { fills?: SlotFill[]; error?: string } | null;
  if (!res.ok || !body?.fills) throw new Error(body?.error ?? "The assistant couldn't read that.");
  return body.fills;
}
