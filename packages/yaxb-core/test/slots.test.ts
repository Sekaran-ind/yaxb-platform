// Slot filling: a visitor's words against the fields of the step on screen (journeys/slots.ts),
// and the model pass (kiosk.extract) with a schema-constrained answer that is checked again.
import { describe, expect, it } from "vitest";
import { createKiosk } from "../src/agent/index.js";
import { journeyById } from "../src/content/index.js";
import type { Embed } from "../src/knowledge/semantic.js";
import { checkExtracted, clausesOf, fieldProblem, fieldsJsonSchema, matchFields, mergeEntities, type Entity } from "../src/journeys/index.js";
import { LANGUAGES } from "../src/schemas/index.js";
import { createMemoryModerationStore, createMemoryThreadStore } from "../src/stores/index.js";
import { ScriptedModel } from "./scripted-model.js";

// The check-in journey is a Service Catalogue seed now (content/catalogue/visits.service.yaml).
const fields = journeyById("visit-check-in")!.steps.details!.fields!;
const byField = (fills: { field: string; value: unknown; via: string }[]) => Object.fromEntries(fills.map((f) => [f.field, [f.value, f.via]]));

const STOP = new Set("a an and are as at be can do does for from how i if in is it me my of on or the to what when with you your have had has".split(" "));
// Shared words make similar vectors; "cough", "pain" and "fever" are symptoms, as a real model knows.
const SYNONYMS: Record<string, string> = { cough: "troubling", pain: "troubling", fever: "troubling", headache: "troubling", awful: "bad", terrible: "bad" };
const fakeEmbed: Embed = async (texts) =>
  texts.map((t) => {
    const v = new Array<number>(256).fill(0);
    for (let w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (STOP.has(w)) continue;
      w = SYNONYMS[w] ?? w;
      let h = 0;
      for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 256;
      v[h]! += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });
const fakeNer = async (text: string): Promise<Entity[]> =>
  [
    ...(text.includes("Ravi Kumar") ? [{ type: "person" as const, text: "Ravi Kumar", score: 0.99 }] : []),
    ...(text.includes("Chennai") ? [{ type: "location" as const, text: "Chennai", score: 0.98 }] : []),
  ];
const helpers = { embed: fakeEmbed, meaning: { minScore: 0.2, margin: 0.05 }, ner: fakeNer, languages: LANGUAGES };

describe("slot filling", () => {
  it("fills fields named as keys, clinux style, with typed values", async () => {
    const m = await matchFields(fields, "Temperature 38.5, days 3, severity severe", helpers);
    expect(byField(m.fills)).toEqual({ temperature: [38.5, "label"], days: [3, "label"], severity: ["severe", "label"] });
    expect(m.missing).toEqual(["symptom"]);
  });

  it("reads a sentence: names and places by NER, the rest by meaning, and asks nothing it can't read", async () => {
    const m = await matchFields(fields, "My name is Ravi Kumar, I live in Chennai. I have had a bad cough, for 3 days, it is severe, visit today", helpers);
    const f = byField(m.fills);
    expect(f.name).toEqual(["Ravi Kumar", "label"]);
    expect(f.city).toEqual(["Chennai", "entity"]);
    expect(f.symptom).toEqual(["I have had a bad cough", "meaning"]);
    expect(f.days).toEqual([3, "meaning"]);
    expect(f.severity?.[0]).toBe("severe");
    expect(f.visit_date).toEqual([new Date().toISOString().slice(0, 10), "pattern"]);
    expect(m.missing).toEqual([]);
  });

  it("never takes free text as a closed-list answer: it asks which option", async () => {
    const m = await matchFields(fields, "severity mild or moderate", helpers);
    expect(m.fills.find((f) => f.field === "severity")).toBeUndefined();
    expect(m.confirm).toEqual([{ field: "severity", label: "How bad is it", typed: "mild or moderate", options: [{ value: "mild", label: "Mild" }, { value: "moderate", label: "Moderate" }] }]);
  });

  it("leaves a field empty rather than guess", async () => {
    const m = await matchFields(fields, "hello there", helpers);
    expect(m.found).toBe(false);
    expect(m.missing).toEqual(["symptom"]);
  });

  it("merges NER word pieces into whole entities, Tamil included", () => {
    const tokens = [
      { entity: "B-PER", word: "ர", score: 1 },
      { entity: "I-PER", word: "##வி", score: 0.97 },
      { entity: "I-PER", word: "க", score: 1 },
      { entity: "I-PER", word: "##ுமார்", score: 1 },
      { entity: "O", word: ",", score: 1 },
      { entity: "B-LOC", word: "சென்னை", score: 0.99 },
    ];
    expect(mergeEntities(tokens)).toEqual([
      { type: "person", text: "ரவி குமார்", score: 0.99 },
      { type: "location", text: "சென்னை", score: 0.99 },
    ]);
  });

  it("splits clauses on punctuation and joining words, Tamil and Hindi too", () => {
    expect(clausesOf("bad cough and fever, for 3 days")).toEqual(["bad cough", "fever", "for 3 days"]);
    expect(clausesOf("இருமல் மற்றும் காய்ச்சல்")).toEqual(["இருமல்", "காய்ச்சல்"]);
  });

  it("checks number and date answers when the form is submitted", () => {
    const days = fields.find((f) => f.id === "days")!;
    const date = fields.find((f) => f.id === "visit_date")!;
    expect(fieldProblem(days, "3")).toBeNull();
    expect(fieldProblem(days, "three")).toBe("How many days must be a number.");
    expect(fieldProblem(date, "2026-11-12")).toBeNull();
    expect(fieldProblem(date, "12/11/2026")).toBe("Visit date must be a date.");
  });
});

describe("the model pass", () => {
  it("constrains the answer with a JSON schema: the fields' types, options as an enum, nothing else", () => {
    const schema = fieldsJsonSchema(fields, { languages: ["eng_Latn"] });
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(fields.map((f) => f.id));
    expect(schema.properties.severity).toMatchObject({ enum: ["mild", "moderate", "severe", null] });
    expect(schema.properties.days).toMatchObject({ type: ["number", "null"] });
    expect(schema.properties.visit_date).toMatchObject({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
  });

  it("checks the model's answer again: wrong types, unknown options and extra keys are dropped", () => {
    const fills = checkExtracted(fields, { name: "Ravi", days: "3", severity: "awful", temperature: 38.5, visit_date: "tomorrow", extra: "x", symptom: null });
    expect(fills).toEqual([
      { field: "name", label: "Your name", value: "Ravi", via: "model" },
      { field: "temperature", label: "Temperature", value: 38.5, via: "model" },
    ]);
  });

  it("kiosk.extract: looks the fields up itself and returns checked fills", async () => {
    // The fake model fails structured output (as a provider without it would): the plain-JSON fallback answers.
    const model = new ScriptedModel([{ text: "(structured attempt)" }, { text: '{"name":"ரவி","city":"சென்னை","symptom":"இருமல்","days":3,"severity":"moderate","temperature":null,"visit_date":null}' }]);
    const kiosk = createKiosk({ env: { ANTHROPIC_API_KEY: "k" }, threads: createMemoryThreadStore(), moderation: createMemoryModerationStore(), modelFactory: async () => model, webSearch: null, embed: null });
    const selection = { provider: "anthropic", model: "claude-sonnet-5-5", temperature: 0 };
    const out = await kiosk.extract({ journey: "visit-check-in", step: "details", text: "என் பெயர் ரவி, சென்னையில் இருக்கிறேன், மூன்று நாட்களாக இருமல்", selection });
    expect(out).toEqual({
      fills: [
        { field: "name", label: "Your name", value: "ரவி", via: "model" },
        { field: "city", label: "City", value: "சென்னை", via: "model" },
        { field: "symptom", label: "Main symptom", value: "இருமல்", via: "model" },
        { field: "days", label: "How many days", value: 3, via: "model" },
        { field: "severity", label: "How bad is it", value: "moderate", via: "model" },
      ],
    });
    const system = JSON.stringify(model.calls.at(-1)!.find((m) => m.getType() === "system")?.content);
    expect(system).toContain("Never guess");
    expect(await kiosk.extract({ journey: "no-such-journey", step: "details", text: "x", selection })).toEqual({ error: "That form isn't available." });
  });
});

describe("passwords", () => {
  const withPassword = [...fields, { id: "pin", type: "password" as const, label: "Your PIN" }];
  it("are never filled from what was said, nor asked of the model", async () => {
    const m = await matchFields(withPassword, "my PIN is 4321, my name is Ravi");
    expect(m.fills.some((f) => f.field === "pin")).toBe(false);
    expect(Object.keys(fieldsJsonSchema(withPassword).properties)).not.toContain("pin");
    expect(checkExtracted(withPassword, { pin: "4321" })).toEqual([]);
  });
});
