// Fields: one question on a form. Journey ask steps and questionnaires use the same fields.
//
//   - id: severity
//     type: select                  text, textarea, password, select, boolean, number, date, source, language
//     label: How bad is it
//     required: true
//     options: [{ value: mild, label: Mild }, …]      a select needs options
//     placeholder / default
//     description / keywords / entity                  guide slot filling (yaxb-core's slots)
//     when: "values.fever == true"                     ask it only when this holds
//
// `when` uses the journeys' safe condition language. It can read `values.<field>` (this form),
// `answers.<step>.<field>` (earlier steps) and `context.*`. A hidden field is never required and
// its answer is kept as null.
//
// A `password` field is a masked input. Slot filling never fills it (from speech or the model), and
// run summaries show it masked; it is still in `answers`, so a result template could show it.
import { conditionPaths, conditionProblem, holds, type Scope } from "./expressions.js";

export const FIELD_TYPES = ["text", "textarea", "password", "select", "boolean", "number", "date", "source", "language"] as const;
export const FIELD_ENTITIES = ["person", "location", "organization", "email", "phone"] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];

export type Field = {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  default?: unknown;
  /** What the field is about, in plain words: slot filling matches what the visitor says against it. */
  description?: string;
  /** Other words a visitor uses for the field ("temp", "fever"). */
  keywords?: string[];
  /** What kind of thing the value is, for slot filling (a name, a place, an email…). */
  entity?: FieldEntity;
  /** Ask this question only when the condition holds. */
  when?: string;
};

const FIELD_KEYS = new Set(["id", "type", "label", "required", "options", "placeholder", "default", "description", "keywords", "entity", "when"]);
const FIELD_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const WHEN_ROOTS = new Set(["values", "answers", "context"]);

/** What's wrong with a list of fields ([] when nothing). `at` (such as "step 'ask'") prefixes each message. */
export function fieldListProblems(at: string, fields: unknown): string[] {
  const pre = at ? `${at} ` : "";
  if (!Array.isArray(fields) || !fields.length) return [`${at ? `${at}: ` : ""}fields must be a list with at least one field`];
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const f of fields) {
    const id = (f as Record<string, unknown> | null)?.id;
    if (typeof id === "string") {
      if (ids.has(id)) problems.push(`${at ? `${at}: ` : ""}field '${id}' is listed twice`);
      ids.add(id);
    }
  }
  fields.forEach((f: unknown, i: number) => {
    const fd = (f ?? {}) as Record<string, unknown>;
    const fa = `${pre}field ${typeof fd.id === "string" ? `'${fd.id}'` : i}`;
    if (!fd || typeof f !== "object" || Array.isArray(f)) return problems.push(`${pre}field ${i}: a field is a mapping`);
    if (typeof fd.id !== "string" || !FIELD_ID.test(fd.id)) problems.push(`${fa}: id is required (lower-case letters, digits, '-' or '_')`);
    if (!FIELD_TYPES.includes(fd.type as FieldType)) problems.push(`${fa}: type must be one of ${FIELD_TYPES.join(", ")}`);
    if (!fd.label) problems.push(`${fa}: label is required`);
    if (fd.type === "select") {
      if (!Array.isArray(fd.options) || !fd.options.length) problems.push(`${fa}: a select needs options`);
      else if (fd.options.some((o) => !o || typeof o !== "object" || typeof (o as { value?: unknown }).value !== "string" || !(o as { label?: unknown }).label))
        problems.push(`${fa}: every option needs a value (text) and a label`);
    }
    if (fd.entity !== undefined && !FIELD_ENTITIES.includes(fd.entity as FieldEntity)) problems.push(`${fa}: entity must be one of ${FIELD_ENTITIES.join(", ")}`);
    if (fd.keywords !== undefined && (!Array.isArray(fd.keywords) || fd.keywords.some((k) => typeof k !== "string"))) problems.push(`${fa}: keywords must be a list of words`);
    if (fd.description !== undefined && typeof fd.description !== "string") problems.push(`${fa}: description must be text`);
    if (fd.when !== undefined) {
      const p = typeof fd.when === "string" ? conditionProblem(fd.when) : "must be text";
      if (p) problems.push(`${fa}: when: ${p}`);
      else
        for (const path of conditionPaths(fd.when as string)) {
          const [root, name] = path.split(".");
          if (!WHEN_ROOTS.has(root!)) problems.push(`${fa}: when: '${path}' must start with values., answers. or context.`);
          else if (root === "values" && !ids.has(name ?? "")) problems.push(`${fa}: when: no field '${name ?? ""}' on this form`);
          else if (root === "values" && name === fd.id) problems.push(`${fa}: when can't depend on the field itself`);
        }
    }
    for (const k of Object.keys(fd)) if (!FIELD_KEYS.has(k)) problems.push(`${fa}: unknown key '${k}'`);
  });
  return problems;
}

/** Whether a field is asked, given this form's values and the run's scope. */
export function fieldVisible(field: Field, values: Record<string, unknown>, scope: Scope = {}): boolean {
  return !field.when || holds(field.when, { ...scope, values });
}

/** A field's missing or malformed answer, or null. */
export function fieldProblem(field: Field, value: unknown): string | null {
  const empty = value === undefined || value === null || value === "";
  if (empty) return field.required ? `${field.label} is required.` : null;
  if (field.type === "select" && !field.options?.some((o) => o.value === value)) return `Choose one of the options for ${field.label}.`;
  if ((field.type === "text" || field.type === "textarea" || field.type === "password") && typeof value !== "string") return `${field.label} must be text.`;
  if (field.type === "boolean" && typeof value !== "boolean") return `${field.label} must be yes or no.`;
  if (field.type === "number" && !Number.isFinite(typeof value === "string" ? Number(value) : value)) return `${field.label} must be a number.`;
  if (field.type === "date" && !(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))) return `${field.label} must be a date.`;
  return null;
}

/** Problems with a form's answers, skipping hidden fields. */
export function formProblems(fields: Field[], values: Record<string, unknown>, scope: Scope = {}): string[] {
  return fields
    .filter((f) => fieldVisible(f, values, scope))
    .map((f) => fieldProblem(f, values[f.id]))
    .filter((p): p is string => Boolean(p));
}

/** The answers to keep: each visible field's value (or its default), hidden ones as null. */
export function keptAnswers(fields: Field[], values: Record<string, unknown>, scope: Scope = {}): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.id, fieldVisible(f, values, scope) ? (values[f.id] ?? f.default ?? null) : null]));
}
