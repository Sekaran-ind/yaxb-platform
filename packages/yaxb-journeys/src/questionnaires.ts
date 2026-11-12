// Questionnaires: a named set of questions that journeys can reuse, the third level under
// Service → Journey → Questionnaire. A journey's ask step uses one with `questionnaire: <id>`
// instead of listing `fields`; the questions are copied into the step when the journey compiles,
// so the runner, slot filling and summaries see ordinary fields.
//
//   kind: questionnaire
//   id: visit-intake
//   version: 1
//   title: Visit intake
//   summary: A few questions before you see the nurse.
//   sections:                         pages of the form; the preview shows them in the adaptive nav
//     - id: about-you
//       title: About you
//       summary: optional line under the title
//       fields: [ … ]                 the same fields as a journey step (fields.ts)
//
// A questionnaire with one page may give `fields:` directly instead of `sections:`. Field ids are
// unique across the whole questionnaire, so answers read `answers.<step>.<field>` as before.
import { load } from "js-yaml";
import { fieldListProblems, type Field } from "./fields.js";

export type QuestionnaireSection = { id: string; title: string; summary?: string; fields: Field[] };

export type Questionnaire = {
  kind: "questionnaire";
  id: string;
  version: number;
  title: string;
  summary?: string;
  icon?: string;
  sections: QuestionnaireSection[];
};

const KEYS = new Set(["kind", "id", "version", "title", "summary", "icon", "sections", "fields"]);
const SECTION_KEYS = new Set(["id", "title", "summary", "fields"]);
const ID = /^[a-z][a-z0-9-]{0,63}$/;

export function questionnaireProblems(doc: unknown): string[] {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["a questionnaire is a YAML mapping"];
  const q = doc as Record<string, unknown>;
  const problems: string[] = [];
  if (q.kind !== "questionnaire") problems.push("kind must be 'questionnaire'");
  for (const k of ["id", "title"]) if (!q[k]) problems.push(`${k} is required`);
  if (typeof q.id === "string" && !ID.test(q.id)) problems.push("id must be lower-case words joined by '-'");
  if (q.version !== undefined && (!Number.isInteger(q.version) || (q.version as number) < 1)) problems.push("version is a whole number from 1");
  for (const k of Object.keys(q)) if (!KEYS.has(k)) problems.push(`unknown key '${k}'`);
  if (q.sections !== undefined && q.fields !== undefined) return [...problems, "use sections or fields, not both"];
  if (q.sections === undefined && q.fields === undefined) return [...problems, "sections (or fields, for a one-page questionnaire) is required"];
  if (q.fields !== undefined) return [...problems, ...fieldListProblems("", q.fields)];

  if (!Array.isArray(q.sections) || !q.sections.length) return [...problems, "sections must be a list with at least one section"];
  const sectionIds = new Set<string>();
  for (const [i, raw] of (q.sections as unknown[]).entries()) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const at = `section ${typeof s.id === "string" ? `'${s.id}'` : i}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`section ${i}: a section is a mapping`);
      continue;
    }
    if (typeof s.id !== "string" || !ID.test(s.id)) problems.push(`${at}: id is required (lower-case words joined by '-')`);
    else if (sectionIds.has(s.id)) problems.push(`${at} is listed twice`);
    else sectionIds.add(s.id);
    if (!s.title) problems.push(`${at}: title is required`);
    for (const k of Object.keys(s)) if (!SECTION_KEYS.has(k)) problems.push(`${at}: unknown key '${k}'`);
  }
  // Fields are checked together: ids are unique across sections, and `when` may read any of them.
  const all = (q.sections as { fields?: unknown }[]).flatMap((s) => (Array.isArray(s?.fields) ? s.fields : []));
  for (const [i, raw] of (q.sections as unknown[]).entries()) {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (!Array.isArray(s.fields) || !s.fields.length) problems.push(`section ${typeof s.id === "string" ? `'${s.id}'` : i}: fields must be a list with at least one field`);
  }
  if (all.length) problems.push(...fieldListProblems("", all));
  return problems;
}

export type QuestionnaireResult = { ok: true; questionnaire: Questionnaire } | { ok: false; problems: string[] };

export function compileQuestionnaire(source: string | object): QuestionnaireResult {
  let doc: unknown;
  try {
    doc = typeof source === "string" ? load(source) : source;
  } catch (e) {
    return { ok: false, problems: [`YAML: ${(e as Error).message}`] };
  }
  const problems = questionnaireProblems(doc);
  if (problems.length) return { ok: false, problems };
  const q = doc as Record<string, unknown>;
  const sections = (q.fields !== undefined ? [{ id: "main", title: q.title, fields: q.fields }] : q.sections) as QuestionnaireSection[];
  const { fields: _fields, ...rest } = q;
  return { ok: true, questionnaire: { ...(rest as Omit<Questionnaire, "sections" | "version">), version: (q.version as number | undefined) ?? 1, sections } };
}

/** Every question, in order. */
export const questionnaireFields = (q: Questionnaire): Field[] => q.sections.flatMap((s) => s.fields);
