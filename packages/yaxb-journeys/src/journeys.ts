// Journeys: a guided flow of steps, authored as YAML with the same step keys as clinux-core's
// journeys (SPEC-30), so a journey can move between the kiosk and Cübo when the two unify.
//
//   kind: journey
//   id: summarise-source
//   version: 1
//   title / summary / icon / category
//   roles: { initiate: [visitor], complete: [nurse] }   who starts it and who finishes it (roles.ts)
//   start: pick
//   steps:
//     <id>:
//       ask: <prompt>                   waits for the visitor: `fields` describe the form
//       fields: [{ id, type, label, required, options, placeholder, default,
//                  description, keywords, entity, when }]   see fields.ts
//       questionnaire: <id>            instead of fields: a questionnaire's questions (questionnaires.ts)
//       service: <name>                 runs a handler the surface registers, with `with:` input
//       with: { text: "{{answers.pick.source.text}}" }
//       onError: fail | continue        a service's failure ends the run (default) or moves on
//       decide: [{ if, to }, …, { to }] branches, no handler
//       final: true                     the end; `result: { title, text, ok }` (templates allowed)
//       next: <step> | [{ if, to }, …, { to }]
//       label / stage / icon            the step's line in the progress list
//
// Service names are dotted: `agent.ask`, `offline.summarize`, `notebook.remember`. The core
// doesn't know them; the surface passes handlers to createRunner, and compileJourney can be told
// which names exist so a journey with a typo fails at build time, not mid-run.
import { load } from "js-yaml";
import { conditionProblem, holds, placeholders, render, type Scope } from "./expressions.js";
import { fieldListProblems, formProblems, keptAnswers, type Field } from "./fields.js";
import { questionnaireFields, type Questionnaire } from "./questionnaires.js";
import { journeyRoleProblems, type JourneyRoles } from "./roles.js";

export * from "./expressions.js";
export * from "./fields.js";
export * from "./questionnaires.js";
export * from "./roles.js";

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
  /** The questionnaire this ask step uses; its questions are in `fields`. */
  questionnaire?: string;
  /** The questionnaire's pages, by field id (absent for a step with its own fields). */
  sections?: StepSection[];
};

export type StepSection = { id: string; title: string; summary?: string; fields: string[] };

export type Journey = {
  kind: "journey";
  id: string;
  version: number;
  title: string;
  summary?: string;
  icon?: string;
  category?: string;
  /** Who may start the journey and who finishes it (roles.ts). */
  roles?: JourneyRoles;
  start: string;
  steps: Record<string, Step>;
};

const JOURNEY_KEYS = new Set(["kind", "id", "version", "title", "summary", "icon", "category", "roles", "start", "steps"]);
const STEP_KEYS = new Set(["ask", "fields", "questionnaire", "service", "with", "onError", "decide", "final", "result", "next", "label", "stage", "icon", "submitLabel"]);
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SERVICE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-zA-Z0-9-]*)+$/;
const SCOPE_ROOTS = new Set(["answers", "steps", "context"]);

export type JourneyOptions = {
  /** The handler names that exist; any dotted name is accepted when absent. */
  services?: readonly string[];
  /** Questionnaires that ask steps may use. */
  questionnaires?: readonly Questionnaire[];
  /** Role ids that exist; any well-formed id is accepted when absent. */
  roles?: readonly string[];
};

/** What's wrong with a journey document ([] when nothing). */
export function journeyProblems(doc: unknown, { services, questionnaires = [], roles }: JourneyOptions = {}): string[] {
  const problems: string[] = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["a journey is a YAML mapping"];
  const j = doc as Record<string, unknown>;
  if (j.kind !== "journey") problems.push("kind must be 'journey'");
  for (const k of ["id", "title", "start"]) if (!j[k]) problems.push(`${k} is required`);
  for (const k of Object.keys(j)) if (!JOURNEY_KEYS.has(k)) problems.push(`unknown key '${k}'`);
  if (typeof j.id === "string" && !ID.test(j.id)) problems.push("id must be lower-case words joined by '-'");
  problems.push(...journeyRoleProblems(j.roles, roles));
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
    const kinds = ["ask", "service", "decide", "final"].filter((k) => s[k] !== undefined || (k === "ask" && s.questionnaire !== undefined));
    if (kinds.length === 0) problems.push(`${at} needs one of ask, service, decide, final`);
    if (s.final !== undefined && kinds.length > 1) problems.push(`${at}: a final step can't also ${kinds.filter((k) => k !== "final").join(" or ")}`);
    if (s.decide !== undefined && s.next !== undefined) problems.push(`${at}: use decide or next, not both`);
    if (s.questionnaire !== undefined) {
      if (s.fields !== undefined) problems.push(`${at}: use fields or questionnaire, not both`);
      else if (typeof s.questionnaire !== "string" || !questionnaires.some((q) => q.id === s.questionnaire)) problems.push(`${at}: no questionnaire '${String(s.questionnaire)}'`);
    } else if (s.ask !== undefined) {
      if (s.fields === undefined) problems.push(`${at}: an ask step needs fields or a questionnaire`);
      else problems.push(...fieldListProblems(at, s.fields));
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

export function compileJourney(source: string | object, options: JourneyOptions = {}): CompileResult {
  let doc: unknown;
  try {
    doc = typeof source === "string" ? load(source) : source;
  } catch (e) {
    return { ok: false, problems: [`YAML: ${(e as Error).message}`] };
  }
  const problems = journeyProblems(doc, options);
  if (problems.length) return { ok: false, problems };
  const j = doc as Omit<Journey, "steps"> & { steps: Record<string, Omit<Step, "id">> };
  const steps = Object.fromEntries(
    Object.entries(j.steps).map(([id, s]) => {
      const q = s.questionnaire ? options.questionnaires?.find((x) => x.id === s.questionnaire) : undefined;
      if (!q) return [id, { ...s, id }];
      // A questionnaire's questions become the step's own; its pages stay as sections.
      const sections = q.sections.map((sec) => ({ id: sec.id, title: sec.title, ...(sec.summary ? { summary: sec.summary } : {}), fields: sec.fields.map((f) => f.id) }));
      return [id, { ...s, id, ask: s.ask ?? q.summary ?? q.title, fields: questionnaireFields(q), sections }];
    }),
  );
  return { ok: true, journey: { ...j, version: j.version ?? 1, steps } as Journey };
}

// ---- running --------------------------------------------------------------------------------------

export type ServiceHandler = (input: unknown, ctx: { journey: Journey; step: Step; scope: Scope; signal?: AbortSignal }) => Promise<unknown>;

export type RunStatus = "idle" | "asking" | "running" | "done" | "failed";

export type RunState = {
  status: RunStatus;
  current: string | null;
  /** The step waiting for the visitor (status "asking"). */
  prompt: { step: string; text: string; fields: Field[]; sections?: StepSection[]; submitLabel?: string } | null;
  answers: Record<string, Record<string, unknown>>;
  steps: Record<string, unknown>;
  /** Steps passed, in order, for the progress list. */
  trail: { step: string; label: string; stage?: string; ok: boolean }[];
  result: { title: string; text: string; ok: boolean } | null;
  error: string | null;
};

const MAX_TRANSITIONS = 200;

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
        return set({ status: "asking", current: id, prompt: { step: id, text: step.ask, fields: step.fields ?? [], sections: step.sections, submitLabel: step.submitLabel } });
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
      const problems = formProblems(step.fields ?? [], values, scope());
      if (problems.length) return { problems };
      const kept = keptAnswers(step.fields ?? [], values, scope());
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
