// Journeys: a guided flow of steps, authored as YAML with the same step keys as clinux-core's
// journeys (SPEC-30), so a journey can move between the kiosk and Cübo when the two unify.
//
//   kind: journey
//   id: summarise-source
//   version: 1
//   title / summary / icon / category
//   start: pick
//   steps:
//     <id>:
//       ask: <prompt>                   waits for the visitor: `fields` describe the form
//       fields: [{ id, type, label, required, options, placeholder, default,
//                  description, keywords, entity }]   the last three guide slot filling (slots.ts)
//       service: <name>                 runs a handler the surface registers, with `with:` input
//       with: { text: "{{answers.pick.source.text}}" }
//       onError: fail | continue        a service's failure ends the run (default) or moves on
//       decide: [{ if, to }, …, { to }] branches, no handler
//       final: true                     the end; `result: { title, text, ok }` (templates allowed)
//       next: <step> | [{ if, to }, …, { to }]
//       label / stage / icon            the step's line in the progress list
//
// Field types: text, textarea, select, boolean, number, date (YYYY-MM-DD), source (a notebook
// source), language. entity: person | location | organization | email | phone.
// Service names are dotted: `agent.ask`, `offline.summarize`, `notebook.remember`. The core
// doesn't know them; the surface passes handlers to createRunner, and compileJourney can be told
// which names exist so a journey with a typo fails at build time, not mid-run.
import { load } from "js-yaml";
import { conditionProblem, holds, placeholders, render, type Scope } from "./expressions.js";

export * from "./expressions.js";
export * from "./slots.js";
export * from "./summary.js";

export const FIELD_TYPES = ["text", "textarea", "select", "boolean", "number", "date", "source", "language"] as const;
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
};

export type Branch = { if?: string; to: string };

export type Step = {
  id: string;
  ask?: string;
  fields?: Field[];
  service?: string;
  with?: unknown;
  onError?: "fail" | "continue";
  decide?: Branch[];
  final?: boolean;
  result?: { title?: string; text?: string; ok?: boolean | string };
  next?: string | Branch[];
  label?: string;
  stage?: string;
  icon?: string;
  submitLabel?: string;
};

export type Journey = {
  kind: "journey";
  id: string;
  version: number;
  title: string;
  summary?: string;
  icon?: string;
  category?: string;
  start: string;
  steps: Record<string, Step>;
};

const JOURNEY_KEYS = new Set(["kind", "id", "version", "title", "summary", "icon", "category", "start", "steps"]);
const STEP_KEYS = new Set(["ask", "fields", "service", "with", "onError", "decide", "final", "result", "next", "label", "stage", "icon", "submitLabel"]);
const FIELD_KEYS = new Set(["id", "type", "label", "required", "options", "placeholder", "default", "description", "keywords", "entity"]);
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SERVICE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-zA-Z0-9-]*)+$/;
const SCOPE_ROOTS = new Set(["answers", "steps", "context"]);

/** What's wrong with a journey document ([] when nothing). `services`, when given, are the handler names that exist. */
export function journeyProblems(doc: unknown, { services }: { services?: readonly string[] } = {}): string[] {
  const problems: string[] = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["a journey is a YAML mapping"];
  const j = doc as Record<string, unknown>;
  if (j.kind !== "journey") problems.push("kind must be 'journey'");
  for (const k of ["id", "title", "start"]) if (!j[k]) problems.push(`${k} is required`);
  for (const k of Object.keys(j)) if (!JOURNEY_KEYS.has(k)) problems.push(`unknown key '${k}'`);
  if (typeof j.id === "string" && !ID.test(j.id)) problems.push("id must be lower-case words joined by '-'");
  const steps = j.steps;
  if (!steps || typeof steps !== "object" || Array.isArray(steps) || !Object.keys(steps).length) {
    problems.push("steps is required");
    return problems;
  }
  const ids = new Set(Object.keys(steps));
  if (typeof j.start === "string" && !ids.has(j.start)) problems.push(`start: no step '${j.start}'`);

  const checkTarget = (at: string, to: unknown) => {
    if (typeof to !== "string" || !ids.has(to)) problems.push(`${at}: no step '${String(to)}'`);
  };
  const checkBranches = (at: string, list: unknown) => {
    if (!Array.isArray(list) || !list.length) return problems.push(`${at} must be a list of { if, to }`);
    list.forEach((b, i) => {
      const br = b as Branch;
      checkTarget(`${at}[${i}]`, br?.to);
      if (br?.if !== undefined) {
        const p = typeof br.if === "string" ? conditionProblem(br.if) : "must be text";
        if (p) problems.push(`${at}[${i}].if: ${p}`);
      }
    });
    const last = list[list.length - 1] as Branch | undefined;
    if (last?.if !== undefined) problems.push(`${at}: the last branch must have no 'if' (the fallback)`);
  };
  const checkTemplate = (at: string, t: unknown) => {
    for (const p of placeholders(t)) {
      if (!SCOPE_ROOTS.has(p.split(".")[0]!)) problems.push(`${at}: {{${p}}} must start with answers., steps. or context.`);
    }
  };

  for (const [id, raw] of Object.entries(steps as Record<string, unknown>)) {
    const at = `step '${id}'`;
    if (!ID.test(id)) problems.push(`${at}: ids are lower-case words joined by '-'`);
    if (!raw || typeof raw !== "object") {
      problems.push(`${at} must be a mapping`);
      continue;
    }
    const s = raw as Record<string, unknown>;
    for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) problems.push(`${at}: unknown key '${k}'`);
    // ask, then service, then decide may combine (decide is the step's way out); final stands alone.
    const kinds = ["ask", "service", "decide", "final"].filter((k) => s[k] !== undefined);
    if (kinds.length === 0) problems.push(`${at} needs one of ask, service, decide, final`);
    if (s.final !== undefined && kinds.length > 1) problems.push(`${at}: a final step can't also ${kinds.filter((k) => k !== "final").join(" or ")}`);
    if (s.decide !== undefined && s.next !== undefined) problems.push(`${at}: use decide or next, not both`);
    if (s.ask !== undefined) {
      if (!Array.isArray(s.fields) || !s.fields.length) problems.push(`${at}: an ask step needs fields`);
      else
        s.fields.forEach((f: unknown, i: number) => {
          const fa = `${at} field ${i}`;
          const fd = f as Record<string, unknown>;
          if (!fd?.id || !ID.test(String(fd.id).replace(/_/g, "-"))) problems.push(`${fa}: id is required`);
          if (!FIELD_TYPES.includes(fd?.type as FieldType)) problems.push(`${fa}: type must be one of ${FIELD_TYPES.join(", ")}`);
          if (!fd?.label) problems.push(`${fa}: label is required`);
          if (fd?.type === "select" && (!Array.isArray(fd.options) || !fd.options.length)) problems.push(`${fa}: a select needs options`);
          if (fd?.entity !== undefined && !FIELD_ENTITIES.includes(fd.entity as FieldEntity)) problems.push(`${fa}: entity must be one of ${FIELD_ENTITIES.join(", ")}`);
          if (fd?.keywords !== undefined && (!Array.isArray(fd.keywords) || fd.keywords.some((k) => typeof k !== "string"))) problems.push(`${fa}: keywords must be a list of words`);
          if (fd?.description !== undefined && typeof fd.description !== "string") problems.push(`${fa}: description must be text`);
          for (const k of Object.keys(fd ?? {})) if (!FIELD_KEYS.has(k)) problems.push(`${fa}: unknown key '${k}'`);
        });
    }
    if (s.service !== undefined) {
      if (typeof s.service !== "string" || !SERVICE.test(s.service)) problems.push(`${at}: service must be a dotted name like agent.ask`);
      else if (services && !services.includes(s.service)) problems.push(`${at}: no service '${s.service}'`);
      checkTemplate(at, s.with);
    }
    if (s.onError !== undefined && s.onError !== "fail" && s.onError !== "continue") problems.push(`${at}: onError is fail or continue`);
    if (s.decide !== undefined) checkBranches(`${at} decide`, s.decide);
    if (s.final !== undefined) {
      if (s.next !== undefined) problems.push(`${at}: a final step has no next`);
      checkTemplate(at, s.result);
    } else if (s.decide === undefined) {
      if (s.next === undefined) problems.push(`${at}: next is required`);
      else if (typeof s.next === "string") checkTarget(`${at} next`, s.next);
      else checkBranches(`${at} next`, s.next);
    }
  }
  return problems;
}

export type CompileResult = { ok: true; journey: Journey } | { ok: false; problems: string[] };

export function compileJourney(source: string | object, options: { services?: readonly string[] } = {}): CompileResult {
  let doc: unknown;
  try {
    doc = typeof source === "string" ? load(source) : source;
  } catch (e) {
    return { ok: false, problems: [`YAML: ${(e as Error).message}`] };
  }
  const problems = journeyProblems(doc, options);
  if (problems.length) return { ok: false, problems };
  const j = doc as Omit<Journey, "steps"> & { steps: Record<string, Omit<Step, "id">> };
  const steps = Object.fromEntries(Object.entries(j.steps).map(([id, s]) => [id, { ...s, id }]));
  return { ok: true, journey: { ...j, version: j.version ?? 1, steps } as Journey };
}

// ---- running --------------------------------------------------------------------------------------

export type ServiceHandler = (input: unknown, ctx: { journey: Journey; step: Step; scope: Scope; signal?: AbortSignal }) => Promise<unknown>;

export type RunStatus = "idle" | "asking" | "running" | "done" | "failed";

export type RunState = {
  status: RunStatus;
  current: string | null;
  /** The step waiting for the visitor (status "asking"). */
  prompt: { step: string; text: string; fields: Field[]; submitLabel?: string } | null;
  answers: Record<string, Record<string, unknown>>;
  steps: Record<string, unknown>;
  /** Steps passed, in order, for the progress list. */
  trail: { step: string; label: string; stage?: string; ok: boolean }[];
  result: { title: string; text: string; ok: boolean } | null;
  error: string | null;
};

const MAX_TRANSITIONS = 200;

/** A field's missing or malformed answer, or null. */
export function fieldProblem(field: Field, value: unknown): string | null {
  const empty = value === undefined || value === null || value === "";
  if (empty) return field.required ? `${field.label} is required.` : null;
  if (field.type === "select" && !field.options?.some((o) => o.value === value)) return `Choose one of the options for ${field.label}.`;
  if ((field.type === "text" || field.type === "textarea") && typeof value !== "string") return `${field.label} must be text.`;
  if (field.type === "boolean" && typeof value !== "boolean") return `${field.label} must be yes or no.`;
  if (field.type === "number" && !Number.isFinite(typeof value === "string" ? Number(value) : value)) return `${field.label} must be a number.`;
  if (field.type === "date" && !(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))) return `${field.label} must be a date.`;
  return null;
}

/**
 * Runs a journey: services run on their own, ask steps wait for `answer()`. `onChange` gets every
 * new state. Handlers are the surface's; a missing one fails the run with a clear message.
 */
export function createRunner(
  journey: Journey,
  { services = {}, context = {}, onChange }: { services?: Record<string, ServiceHandler>; context?: Scope; onChange?: (s: RunState) => void } = {},
) {
  let state: RunState = { status: "idle", current: null, prompt: null, answers: {}, steps: {}, trail: [], result: null, error: null };
  let controller: AbortController | null = null;

  const set = (patch: Partial<RunState>) => {
    state = { ...state, ...patch };
    onChange?.(state);
    return state;
  };
  const scope = (): Scope => ({ answers: state.answers, steps: state.steps, context });
  const nextOf = (step: Step): string | null => {
    const n = step.decide ?? step.next;
    if (n === undefined) return null;
    if (typeof n === "string") return n;
    return n.find((b) => b.if === undefined || holds(b.if, scope()))?.to ?? null;
  };
  const record = (step: Step, ok: boolean) =>
    (state = { ...state, trail: [...state.trail, { step: step.id, label: step.label ?? step.id, stage: step.stage, ok }] });

  async function advance(from: string | null): Promise<RunState> {
    let id = from;
    for (let i = 0; i < MAX_TRANSITIONS && id; i++) {
      const step = journey.steps[id];
      if (!step) return set({ status: "failed", current: id, error: `The journey has no step "${id}".` });
      if (step.final) {
        record(step, true);
        const r = (render(step.result ?? {}, scope()) ?? {}) as { title?: unknown; text?: unknown; ok?: unknown };
        const ok = r.ok === undefined ? true : r.ok === true || r.ok === "true";
        return set({ status: "done", current: id, prompt: null, result: { title: String(r.title ?? journey.title), text: String(r.text ?? ""), ok } });
      }
      if (step.ask !== undefined && !(id in state.answers)) {
        return set({ status: "asking", current: id, prompt: { step: id, text: step.ask, fields: step.fields ?? [], submitLabel: step.submitLabel } });
      }
      if (step.service) {
        const handler = Object.hasOwn(services, step.service) ? services[step.service] : undefined;
        set({ status: "running", current: id, prompt: null });
        try {
          if (!handler) throw new Error(`"${step.service}" isn't available here.`);
          controller = new AbortController();
          const out = await handler(render(step.with ?? {}, scope()), { journey, step, scope: scope(), signal: controller.signal });
          state = { ...state, steps: { ...state.steps, [id]: typeof out === "string" ? { text: out } : (out ?? {}) } };
          record(step, true);
        } catch (e) {
          if (controller?.signal.aborted) return set({ status: "failed", error: "Stopped." });
          const message = e instanceof Error ? e.message : String(e);
          state = { ...state, steps: { ...state.steps, [id]: { error: message } } };
          record(step, false);
          if (step.onError !== "continue") return set({ status: "failed", current: id, error: message });
        } finally {
          controller = null;
        }
      } else {
        record(step, true);
      }
      id = nextOf(step);
    }
    return set({ status: "failed", error: id ? "The journey went round in circles." : "The journey stopped without an ending." });
  }

  return {
    get state() {
      return state;
    },
    start: () => {
      state = { status: "idle", current: null, prompt: null, answers: {}, steps: {}, trail: [], result: null, error: null };
      return advance(journey.start);
    },
    /** Answer the current ask step. Returns problems instead of advancing when an answer is missing. */
    async answer(values: Record<string, unknown>): Promise<RunState | { problems: string[] }> {
      if (state.status !== "asking" || !state.prompt) return { problems: ["Nothing is waiting for an answer."] };
      const step = journey.steps[state.prompt.step]!;
      const problems = (step.fields ?? []).map((f) => fieldProblem(f, values[f.id])).filter((p): p is string => Boolean(p));
      if (problems.length) return { problems };
      const kept = Object.fromEntries((step.fields ?? []).map((f) => [f.id, values[f.id] ?? f.default ?? null]));
      state = { ...state, answers: { ...state.answers, [step.id]: kept } };
      if (step.service) return advance(step.id);
      record(step, true);
      return advance(nextOf(step));
    },
    stop() {
      controller?.abort();
      return set({ status: "failed", error: "Stopped." });
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;
