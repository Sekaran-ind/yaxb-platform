// Slot filling for journey questions: what a visitor says or types ("I'm Ravi, I've had a bad
// cough for 3 days, temperature 38.5") read against the fields of the step on screen, and nothing
// else (clinux-core's scoped slot filling, SPEC-12 §4.2-4.3: a step's fields are its section).
// It never writes: it returns suggestions the form shows for the visitor to check, and a closed
// list never takes free text as its answer.
//
// Passes, each only for fields the earlier ones left empty:
//   1. label    the field's label or keywords used as a key: "temperature 38.5" (as clinux-core)
//   2. pattern  typed values: email, phone, date, and a field's own language names
//   3. entity   a local NER model (people, places, organisations) for fields with `entity`
//   4. meaning  the sentence-transformer: each clause against each field's label + description,
//               filled only when one field is clearly the best match
//   5. model    (the surface's choice) the AI model, constrained by fieldsJsonSchema: with Ollama
//               and llama.cpp that schema is compiled to a GBNF grammar, so it can only produce
//               the fields' types and options; checkExtracted validates the result again.
// The models are injected (the browser runs them), so this module is plain code.
import type { Field } from "./index.js";
import { similarity, type Embed } from "../knowledge/semantic.js";

export type Entity = { type: "person" | "location" | "organization"; text: string; score: number };
export type SlotVia = "label" | "pattern" | "entity" | "meaning" | "model";
export type SlotFill = { field: string; label: string; value: unknown; via: SlotVia; text?: string };
/** A closed list the text points at, without naming one option: the visitor picks. */
export type SlotConfirm = { field: string; label: string; typed: string; options: { value: string; label: string }[] };
export type SlotMatch = {
  fills: SlotFill[];
  confirm: SlotConfirm[];
  /** Required fields still empty: what to ask next (or hand to the model pass). */
  missing: string[];
  found: boolean;
};

export type SlotHelpers = {
  embed?: Embed;
  /** For the meaning pass: the best field must reach minScore and beat the next by margin. */
  meaning?: { minScore: number; margin: number };
  ner?: (text: string) => Promise<Entity[]>;
  /** The visitor's languages, for language fields: [{ code, label, native }]. */
  languages?: readonly { code: string; label: string; native: string }[];
};

/** Calibrated per sentence-transformer (clause vs. field description). */
export const MEANING_THRESHOLDS = { minilm: { minScore: 0.45, margin: 0.08 }, labse: { minScore: 0.6, margin: 0.05 } } as const;

/**
 * Picking an option by meaning: on MiniLM the right option leads by 0.08 or more; on LaBSE its
 * wrong picks lead by 0.025 or less. Below this margin the field is left for the visitor or the model.
 */
export const OPTION_BY_MEANING = { minScore: 0.4, margin: 0.07 } as const;

const fold = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%°/.\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const TODAY = () => new Date().toISOString().slice(0, 10);

/** Fields slot filling can fill: notebook-source pickers are chosen on screen. */
const fillable = (fields: readonly Field[]) => fields.filter((f) => f.type !== "source");

function dateFrom(text: string): string | null {
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return TODAY();
  if (/\btomorrow\b/.test(t)) return new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  if (/\byesterday\b/.test(t)) return new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const dmy = t.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/); // India writes day first
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return null;
}
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /(?:\+?\d[\d\s-]{8,14}\d)/;
const NEGATION = /\b(no|not|never|none|without|don'?t|doesn'?t|didn'?t|haven'?t|isn'?t)\b|இல்லை|नहीं|नही|లేదు|ഇല്ല|ಇಲ್ಲ|না/i;

function optionIn(field: Field, text: string): { value: string } | { typed: string; options: { value: string; label: string }[] } | null {
  const opts = field.options ?? [];
  const t = ` ${fold(text)} `;
  const word = fold(text.split(/[,;.]/)[0]);
  const exact = opts.find((o) => fold(o.label) === word || fold(o.value) === word);
  if (exact) return { value: exact.value };
  const named = opts.filter((o) => t.includes(` ${fold(o.label)} `) || t.includes(` ${fold(o.value)} `));
  if (named.length === 1) return { value: named[0]!.value };
  if (named.length > 1) return { typed: text.trim(), options: named.map(({ value, label }) => ({ value, label })) };
  return null;
}

function languageIn(text: string, languages: SlotHelpers["languages"]) {
  const t = ` ${fold(text)} `;
  return languages?.find((l) => t.includes(` ${fold(l.label)} `) || (l.native && text.includes(l.native)))?.code ?? null;
}

/** A value for a field from the words after its label (or a clause about it). */
function valueFor(field: Field, segment: string, helpers: SlotHelpers): { value: unknown } | { typed: string; options: { value: string; label: string }[] } | null {
  const s = segment.replace(/^[\s:=,-]*(?:is|was|of|at|to|as|about|around)?\b[\s:=,-]*/i, "").trim();
  if (!s) return null;
  switch (field.type) {
    case "number": {
      const m = s.match(/-?\d+(?:[.,]\d+)?/);
      return m ? { value: Number(m[0].replace(",", ".")) } : null;
    }
    case "date": {
      const d = dateFrom(s);
      return d ? { value: d } : null;
    }
    case "boolean":
      if (/^(yes|y|true|present|positive)\b/i.test(s)) return { value: true };
      if (/^(no|n|false|absent|negative|none)\b/i.test(s)) return { value: false };
      return null;
    case "select":
      return optionIn(field, s);
    case "language": {
      const code = languageIn(s, helpers.languages);
      return code ? { value: code } : null;
    }
    default: {
      if (field.entity === "email") return s.match(EMAIL) ? { value: s.match(EMAIL)![0] } : null;
      if (field.entity === "phone") return s.match(PHONE) ? { value: s.match(PHONE)![0].replace(/[\s-]/g, "") } : null;
      // A one-line field ends at a comma ("Ravi Kumar, I live in Chennai"); a textarea at the sentence.
      const end = field.type === "textarea" ? /[;\n]|\.(?:\s|$)/ : /[,;\n]|\.(?:\s|$)/;
      const v = s.split(end)[0]!.trim();
      return v ? { value: v } : null;
    }
  }
}

/** Is a label used as a key ("pulse 72") rather than as a word in a sentence? (clinux-core) */
function usedAsKey(before: string) {
  const b = before.trimEnd();
  if (!b) return true;
  if (/[,;:.\n(]$/.test(b)) return true;
  if (/\b(and|also|then|with|plus|my|the)$/i.test(b)) return true;
  return /\d[a-z%°/\]]*$/i.test(b);
}

/** Clauses of a message, for the meaning pass. */
export function clausesOf(text: string): string[] {
  return text
    .split(/[,;.!?\n]+|\s+(?:and|but|also)\s+|\s*மற்றும்\s*|\s*और\s*/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
}

/** Merge a token-classification model's B-/I- tokens (word pieces start with ##) into entities. */
export function mergeEntities(tokens: readonly { entity: string; word: string; score: number }[]): Entity[] {
  const map: Record<string, Entity["type"]> = { PER: "person", LOC: "location", ORG: "organization" };
  const out: (Entity & { n: number })[] = [];
  let cur: (Entity & { n: number }) | null = null;
  for (const t of tokens) {
    const [bio, tag] = t.entity.split("-") as [string, string];
    const type = map[tag ?? ""];
    if (!type) {
      cur = null;
      continue;
    }
    const piece = t.word.startsWith("##") ? t.word.slice(2) : t.word;
    if (bio === "I" && cur && cur.type === type) {
      cur.text += t.word.startsWith("##") ? piece : ` ${piece}`;
      cur.score += t.score;
      cur.n += 1;
    } else {
      cur = { type, text: piece, score: t.score, n: 1 };
      out.push(cur);
    }
  }
  return out.map(({ type, text, score, n }) => ({ type, text, score: Math.round((score / n) * 100) / 100 }));
}

/** Reads `text` against a step's fields; see the header for the passes. */
export async function matchFields(fields: readonly Field[], text: string, helpers: SlotHelpers = {}): Promise<SlotMatch> {
  const all = fillable(fields);
  const message = String(text ?? "").slice(0, 2000);
  const out: SlotMatch = { fills: [], confirm: [], missing: [], found: false };
  const done = new Set<string>();
  const fill = (f: Field, value: unknown, via: SlotVia, from?: string) => {
    if (done.has(f.id)) return;
    done.add(f.id);
    out.fills.push({ field: f.id, label: f.label, value, via, ...(from ? { text: from } : {}) });
  };
  const confirm = (f: Field, c: { typed: string; options: { value: string; label: string }[] }) => {
    if (done.has(f.id)) return;
    done.add(f.id);
    out.confirm.push({ field: f.id, label: f.label, ...c });
  };
  const apply = (f: Field, v: ReturnType<typeof valueFor>, via: SlotVia, from?: string) => {
    if (!v) return;
    if ("options" in v) confirm(f, v);
    else fill(f, v.value, via, from);
  };

  // 1. labels used as keys, longest first ("body temperature" before "temperature")
  const lower = message.toLowerCase();
  const aliases: { alias: string; field: Field }[] = [];
  for (const f of all) {
    const set = new Set([fold(f.label), fold(f.label.replace(/\(.*?\)/g, "")), ...(f.keywords ?? []).map(fold)]);
    set.delete("");
    for (const alias of set) aliases.push({ alias, field: f });
  }
  aliases.sort((a, b) => b.alias.length - a.alias.length);
  const taken: [number, number][] = [];
  const mentions: { start: number; end: number; field: Field }[] = [];
  for (const { alias, field } of aliases) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(alias)})(?=$|[^\\p{L}\\p{N}])`, "giu");
    for (const m of lower.matchAll(re)) {
      const start = m.index + m[1]!.length;
      const end = start + m[2]!.length;
      if (taken.some(([a, b]) => start < b && end > a) || !usedAsKey(lower.slice(0, start))) continue;
      taken.push([start, end]);
      mentions.push({ start, end, field });
    }
  }
  mentions.sort((a, b) => a.start - b.start);
  mentions.forEach((m, i) => {
    const segment = message.slice(m.end, mentions[i + 1]?.start ?? message.length);
    apply(m.field, valueFor(m.field, segment, helpers), "label", message.slice(m.start, m.end + segment.length).trim());
  });

  // 2. patterns: typed values the text holds without naming the field
  for (const f of all.filter((x) => !done.has(x.id))) {
    if (f.entity === "email" && EMAIL.test(message)) fill(f, message.match(EMAIL)![0], "pattern");
    else if (f.entity === "phone" && PHONE.test(message)) fill(f, message.match(PHONE)![0].replace(/[\s-]/g, ""), "pattern");
    else if (f.type === "date" && dateFrom(message)) fill(f, dateFrom(message), "pattern");
    else if (f.type === "language" && languageIn(message, helpers.languages)) fill(f, languageIn(message, helpers.languages), "pattern");
    else if (f.type === "select") {
      // One of the field's options named as a word ("it is severe"); several named: left to the passes below.
      const v = optionIn(f, message);
      if (v && "value" in v) fill(f, v.value, "pattern");
    }
  }

  // 3. entities (local NER)
  const wantsEntity = all.filter((f) => !done.has(f.id) && (f.entity === "person" || f.entity === "location" || f.entity === "organization"));
  if (wantsEntity.length && helpers.ner) {
    const entities = (await helpers.ner(message)).filter((e) => e.score >= 0.6);
    for (const f of wantsEntity) {
      const e = entities.find((x) => x.type === f.entity);
      if (e) fill(f, e.text, "entity");
    }
  }

  // 4. meaning: each open field gets the clause that matches it clearly best, one clause per field
  const open = all.filter((f) => !done.has(f.id) && f.type !== "date" && f.type !== "language" && !f.entity);
  if (open.length && helpers.embed && helpers.meaning) {
    const clauses = clausesOf(message);
    if (clauses.length) {
      const { minScore, margin } = helpers.meaning;
      const vectors = await helpers.embed([...open.map((f) => [f.label, f.description].filter(Boolean).join(". ")), ...clauses]);
      const fv = vectors.slice(0, open.length);
      const cv = vectors.slice(open.length);
      // For each clause, its best field must lead the runner-up by `margin`; then the best clause per field wins.
      const claims = cv
        .map((c, ci) => {
          const ranked = fv.map((f, fi) => ({ fi, score: similarity(f, c) })).sort((a, b) => b.score - a.score);
          const [best, next] = ranked;
          return best && best.score >= minScore && best.score - (next?.score ?? 0) >= margin ? { ci, fi: best.fi, score: best.score } : null;
        })
        .filter((x): x is { ci: number; fi: number; score: number } => x !== null)
        .sort((a, b) => b.score - a.score);
      const usedClauses = new Set<number>();
      for (const c of claims) {
        const f = open[c.fi]!;
        if (done.has(f.id) || usedClauses.has(c.ci)) continue;
        const clause = clauses[c.ci]!;
        let v: ReturnType<typeof valueFor>;
        if (f.type === "boolean") v = { value: !NEGATION.test(clause) };
        else if (f.type === "text" || f.type === "textarea") v = { value: clause };
        else v = valueFor(f, clause, helpers);
        // A choice the words describe without naming it ("elaborate answers" -> "A fuller
        // explanation"): the option closest in meaning, only when it clearly leads.
        if (!v && f.type === "select" && f.options?.length) {
          const [cv2, ...ov] = await helpers.embed([clause, ...f.options.map((o) => o.label)]);
          const ranked = ov.map((o, i) => ({ i, s: similarity(o, cv2!) })).sort((a, b) => b.s - a.s);
          if (ranked[0] && ranked[0].s >= OPTION_BY_MEANING.minScore && ranked[0].s - (ranked[1]?.s ?? 0) >= OPTION_BY_MEANING.margin) v = { value: f.options[ranked[0].i]!.value };
        }
        if (!v) continue;
        usedClauses.add(c.ci);
        apply(f, v, "meaning", clause);
      }
    }
  }

  out.found = out.fills.length + out.confirm.length > 0;
  out.missing = all.filter((f) => f.required && !done.has(f.id)).map((f) => f.id);
  return out;
}

// ---- 5. the model pass: a JSON schema the model's output must follow -------------------------------

/**
 * A JSON Schema for the fields: each one its type (choices as an enum of option values), null when
 * the text doesn't say. Sent as a structured-output schema; Ollama and llama.cpp compile it to a
 * GBNF grammar, so the model can only produce these keys, types and options.
 */
export function fieldsJsonSchema(fields: readonly Field[], { languages = [] as readonly string[] } = {}) {
  const properties: Record<string, unknown> = {};
  for (const f of fillable(fields)) {
    const description = [f.label, f.description].filter(Boolean).join(". ").slice(0, 300);
    let type: Record<string, unknown>;
    switch (f.type) {
      case "number":
        type = { type: ["number", "null"] };
        break;
      case "boolean":
        type = { type: ["boolean", "null"] };
        break;
      case "date":
        type = { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
        break;
      case "select":
        type = { enum: [...(f.options ?? []).map((o) => o.value), null] };
        break;
      case "language":
        type = languages.length ? { enum: [...languages, null] } : { type: ["string", "null"] };
        break;
      default:
        type = { type: ["string", "null"], maxLength: f.type === "textarea" ? 1000 : 200 };
    }
    properties[f.id] = { ...type, description };
  }
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as const;
}

/** The model's answer, checked against the fields again (the grammar is not trusted alone). */
export function checkExtracted(fields: readonly Field[], raw: unknown, { languages = [] as readonly string[] } = {}): SlotFill[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const out: SlotFill[] = [];
  for (const f of fillable(fields)) {
    const v = obj[f.id];
    if (v === null || v === undefined || v === "") continue;
    let ok: unknown = undefined;
    if (f.type === "number" && typeof v === "number" && Number.isFinite(v)) ok = v;
    else if (f.type === "boolean" && typeof v === "boolean") ok = v;
    else if (f.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ok = v;
    else if (f.type === "select" && typeof v === "string" && (f.options ?? []).some((o) => o.value === v)) ok = v;
    else if (f.type === "language" && typeof v === "string" && (!languages.length || languages.includes(v))) ok = v;
    else if ((f.type === "text" || f.type === "textarea") && typeof v === "string") ok = v.trim().slice(0, f.type === "textarea" ? 1000 : 200);
    if (ok !== undefined && ok !== "") out.push({ field: f.id, label: f.label, value: ok, via: "model" });
  }
  return out;
}
