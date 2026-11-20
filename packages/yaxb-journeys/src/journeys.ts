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
//       level: 0..4                     how sure the kiosk must be of who answers (IDN-30); the
//                                       journey's own `level` holds for every step
//       guard: { allow, reason }        RTN-9: an ask step's answers are taken only when `allow` (a
//       guard: { call, with, within, reason }  condition) holds, or a service answers yes within
//                                       `within` ms; otherwise the person sees `reason` and stays.
//                                       A call's answer is kept in `steps["guard:<id>"]` (RTN-11).
//
// Service names are dotted: `agent.ask`, `offline.summarize`, `notebook.remember`. The core
// doesn't know them; the surface passes handlers to createRunner, and compileJourney can be told
// which names exist so a journey with a typo fails at build time, not mid-run.
import { load } from "js-yaml";
import { conditionProblem, placeholders, type Scope } from "./expressions.js";
import { fieldListProblems, type Field } from "./fields.js";
import { questionnaireFields, type Questionnaire } from "./questionnaires.js";
import { journeyRoleProblems, MANAGER_OF_REQUESTER, ROLE_ID, VISITOR_ROLE, type JourneyRoles } from "./roles.js";

export * from "./expressions.js";
export * from "./fields.js";
export * from "./questionnaires.js";
export * from "./roles.js";

export type Branch = { if?: string; to: string };
/** A guard hook (RTN-9): a condition, or a service's yes or no within a time limit. */
export type StepGuard = { allow?: string; call?: string; with?: unknown; within?: number; reason: string };
/** The longest a guard's call may take, and the default. */
export const GUARD_MAX_MS = 10_000;
export const GUARD_DEFAULT_MS = 5_000;
/** Where a guard's answer is kept with the run, so replaying it never calls the hook again (RTN-11). */
export const guardKey = (step: string) => `guard:${step}`;

export type Step = {
  id: string;
  ask?: string;
  fields?: Field[];
  service?: string;
  with?: unknown;
  onError?: "fail" | "continue";
  decide?: Branch[];
  final?: boolean;
  /** `outcome`: what the journey achieved, an id the dashboards count (OUT-1), never templated. */
  result?: { title?: string; text?: string; ok?: boolean | string; outcome?: string };
  next?: string | Branch[];
  label?: string;
  stage?: string;
  icon?: string;
  submitLabel?: string;
  /**
   * Who answers this step: a role id (a member with that role, on their own device), or absent
   * for the person who started the journey. When the run reaches a step its current actor can't
   * answer, it waits there: the journey is handed over (a case, which the host stores).
   */
  role?: string;
  /** How sure the kiosk must be of who answers this step (IDN-30): more than the journey's, for an approval. */
  level?: number;
  /**
   * flow: parallel only (JRN-46): the tasks this one waits for. Without any, a task is available
   * as soon as the journey starts.
   */
  after?: string[];
  /** The questionnaire this ask step uses; its questions are in `fields`. */
  questionnaire?: string;
  /** RTN-9: what must hold, or answer yes, before this step's answers are taken. */
  guard?: StepGuard;
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
  /**
   * sequence (the default): one step after another from `start`. parallel (JRN-46): the steps that
   * ask or run a service are tasks, available together unless they wait for others (`after`);
   * when every task is done the journey carries on from its first other step (a decision or a result).
   */
  flow?: "sequence" | "parallel";
  /**
   * How sure the kiosk must be of who answers (IDN-30, ASSURANCE_LEVELS): every step that asks needs
   * at least this; a step may ask for more. Absent: 0, anyone.
   */
  level?: number;
  start: string;
  steps: Record<string, Step>;
};

const JOURNEY_KEYS = new Set(["kind", "id", "version", "title", "summary", "icon", "category", "roles", "flow", "level", "start", "steps"]);
const STEP_KEYS = new Set(["ask", "fields", "questionnaire", "service", "with", "onError", "decide", "final", "result", "next", "label", "stage", "icon", "submitLabel", "role", "after", "level", "guard"]);
const ID = /^[a-z][a-z0-9-]{0,63}$/;
/** An outcome id: lower-case words joined by '-', optionally dotted (registration.approved). */
export const OUTCOME_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
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
  if (j.flow !== undefined && j.flow !== "sequence" && j.flow !== "parallel") problems.push("flow is sequence or parallel");
  if (j.level !== undefined && !isLevel(j.level)) problems.push(LEVEL_PROBLEM);
  const parallel = j.flow === "parallel";
  const all = steps as Record<string, Record<string, unknown>>;
  const taskIds = new Set(Object.keys(all).filter((id) => {
    const s = all[id];
    return s && typeof s === "object" && s.final === undefined && s.decide === undefined && (s.ask !== undefined || s.questionnaire !== undefined || s.service !== undefined);
  }));
  if (parallel) {
    if (!taskIds.size) problems.push("a parallel journey needs at least one step that asks or runs a service (a task)");
    if (!Object.keys(all).some((id) => !taskIds.has(id))) problems.push("a parallel journey needs a step to end on once every task is done (a decision or a result)");
    // after: other tasks, and no task waiting on itself, round a circle.
    const deps = (id: string) => (Array.isArray(all[id]?.after) ? (all[id]!.after as unknown[]).filter((x): x is string => typeof x === "string") : []);
    const seen = new Set<string>();
    const visiting = new Set<string>();
    const loops = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (seen.has(id)) return false;
      visiting.add(id);
      const found = deps(id).some((d) => taskIds.has(d) && loops(d));
      visiting.delete(id);
      seen.add(id);
      return found;
    };
    for (const id of taskIds) if (loops(id)) {
      problems.push(`step '${id}': its after goes round in a circle`);
      break;
    }
  }

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
    if (s.role !== undefined) {
      if (typeof s.role !== "string" || !ROLE_ID.test(s.role)) problems.push(`${at}: role is a role id (lower-case words joined by '-')`);
      else if (s.role === VISITOR_ROLE) problems.push(`${at}: leave role out for the person who started the journey`);
      else if (roles && s.role !== MANAGER_OF_REQUESTER && !roles.includes(s.role)) problems.push(`${at}: no role '${s.role}'`);
      if (s.ask === undefined && s.questionnaire === undefined) problems.push(`${at}: only a step with questions is answered by a role`);
    }
    if (s.onError !== undefined && s.onError !== "fail" && s.onError !== "continue") problems.push(`${at}: onError is fail or continue`);
    if (s.level !== undefined) {
      if (!isLevel(s.level)) problems.push(`${at}: ${LEVEL_PROBLEM}`);
      else if (s.ask === undefined && s.questionnaire === undefined) problems.push(`${at}: only a step with questions needs a level`);
    }
    if (s.guard !== undefined) problems.push(...guardProblems(at, s.guard, s.ask !== undefined || s.questionnaire !== undefined, parallel, services, checkTemplate));
    if (s.after !== undefined) {
      if (!parallel) problems.push(`${at}: after is for parallel journeys (flow: parallel)`);
      else if (!taskIds.has(id)) problems.push(`${at}: only a task (a step that asks or runs a service) waits with after`);
      else if (!Array.isArray(s.after) || !s.after.every((x) => typeof x === "string")) problems.push(`${at}: after is a list of step ids`);
      else for (const d of s.after as string[]) if (d === id) problems.push(`${at}: a task can't wait for itself`);
      else if (!taskIds.has(d)) problems.push(`${at}: after: no task '${d}'`);
    }
    // A parallel journey's tasks have no way out of their own: the journey goes on when all are done.
    if (parallel && taskIds.has(id)) {
      if (s.next !== undefined) problems.push(`${at}: a task in a parallel journey has no next`);
      continue;
    }
    if (s.decide !== undefined) checkBranches(`${at} decide`, s.decide);
    if (s.final !== undefined) {
      if (s.next !== undefined) problems.push(`${at}: a final step has no next`);
      checkTemplate(at, s.result);
      const outcome = (s.result as { outcome?: unknown } | undefined)?.outcome;
      if (outcome !== undefined && (typeof outcome !== "string" || !OUTCOME_ID.test(outcome))) problems.push(`${at}: outcome is an id such as registration-approved (lower-case words, '-' or '.')`);
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

/** `guard`: the call is the step's guard hook (RTN-9), not its service. */
export type ServiceHandler = (input: unknown, ctx: { journey: Journey; step: Step; scope: Scope; signal?: AbortSignal; guard?: boolean }) => Promise<unknown>;

/** step_up (IDN-32): the person may answer the step but must sign in more strongly first. */
export type RunStatus = "idle" | "asking" | "waiting" | "step_up" | "running" | "done" | "failed";

/**
 * Who is running the journey: the person who started it (`starter`), and their roles. A runner
 * with an actor stops at a step someone else answers (status "waiting"); without one, it asks every
 * step (built-in journeys, and the designer's plain preview).
 */
export type RunActor = {
  starter: boolean;
  roles: readonly string[];
  /** How sure the kiosk is of who this is (IDN-30): 0 anonymous … 3 a passkey. Absent: 0. */
  level?: number;
};

// ---- assurance levels (IDN-30) ---------------------------------------------------------------------

/** How sure the kiosk is of who someone is. A service states the level it needs, never how to check it. */
export const ASSURANCE_LEVELS = [
  { level: 0, label: "Anyone", detail: "No sign-in." },
  { level: 1, label: "A returning person", detail: "Signed in, even with a recovery code." },
  { level: 2, label: "A verified email or phone", detail: "Signed in with Google (or, later, a code by SMS or email)." },
  { level: 3, label: "A strong sign-in", detail: "Signed in with a passkey." },
  { level: 4, label: "A verified real-world identity", detail: "For regulated services; not offered yet." },
] as const;
export const MAX_LEVEL = 4;
const LEVEL_PROBLEM = "level is a whole number from 0 (anyone) to 4";
const isLevel = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_LEVEL;
/** The level a step needs: the journey's, or the step's own when that is more. */
export const levelNeeded = (journey: Pick<Journey, "level">, step: Pick<Step, "level">) => Math.max(journey.level ?? 0, step.level ?? 0);
/** May this actor answer at that level? */
export const sureEnough = (journey: Pick<Journey, "level">, step: Pick<Step, "level">, actor: Pick<RunActor, "level">) => (actor.level ?? 0) >= levelNeeded(journey, step);

/** The part of a run that is stored and handed over: enough to resume it anywhere. */
export type RunSnapshot = { current: string | null; answers: Record<string, Record<string, unknown>>; steps: Record<string, unknown>; trail: RunState["trail"] };

/** May this actor answer the step? A step with a role needs that role; one without, the starter. */
export const mayAnswer = (step: Pick<Step, "role">, actor: RunActor) => (step.role ? actor.roles.includes(step.role) : actor.starter);

export type RoleNeed = { role: string; for: ("start" | "answer" | "finish")[] };

/** Every role a journey needs a person for: its starters (other than visitors), its steps' roles and its finishers. */
export function journeyRolesNeeded(journey: Pick<Journey, "roles" | "steps">): RoleNeed[] {
  const out = new Map<string, Set<"start" | "answer" | "finish">>();
  const add = (role: string, why: "start" | "answer" | "finish") => {
    if (role === VISITOR_ROLE) return;
    if (!out.has(role)) out.set(role, new Set());
    out.get(role)!.add(why);
  };
  const initiate = journey.roles?.initiate ?? [];
  if (!initiate.includes(VISITOR_ROLE)) for (const r of initiate) add(r, "start");
  for (const s of Object.values(journey.steps)) if (s.role) add(s.role, "answer");
  for (const r of journey.roles?.complete ?? []) add(r, "finish");
  return [...out].map(([role, why]) => ({ role, for: [...why] }));
}

export type RunState = {
  status: RunStatus;
  current: string | null;
  /** The step someone else answers (status "waiting"): its role, or null for the person who started it. */
  waiting: { step: string; role: string | null } | null;
  /** The step that needs a stronger sign-in (status "step_up"), and the level it needs (IDN-32). */
  stepUp?: { step: string; level: number } | null;
  /** The step waiting for the visitor (status "asking"). */
  prompt: { step: string; text: string; fields: Field[]; sections?: StepSection[]; submitLabel?: string } | null;
  answers: Record<string, Record<string, unknown>>;
  steps: Record<string, unknown>;
  /** Steps passed, in order, for the progress list. */
  trail: { step: string; label: string; stage?: string; ok: boolean }[];
  result: { title: string; text: string; ok: boolean; outcome: string | null } | null;
  error: string | null;
  /** flow: parallel (JRN-46): every task and where it stands, while the tasks are open. */
  tasks?: TaskState[];
  /** RTN-9: the asking step's last answers were stopped by its guard, with the reason the person sees. */
  refused?: { step: string; reason: string } | null;
};

/** A parallel journey's task: waiting for others (pending), ready to work on, being asked, waiting for its role, running, or done. */
export type TaskState = { step: string; label: string; role: string | null; status: "pending" | "ready" | "asking" | "waiting" | "step_up" | "running" | "done"; after: string[] };

/**
 * The trail as progress to show: the screens that asked something and the services that ran.
 * Decisions and plain hops are the journey's own workings, never something a person did, and the
 * result shows on its own, so they stay out of the chips (untitled, they would show their ids,
 * "route" or "done").
 */
export function progressOf(journey: Pick<Journey, "steps">, trail: RunState["trail"]): RunState["trail"] {
  return trail.filter((t) => {
    const s = journey.steps[t.step];
    return !s || (!s.final && (s.ask !== undefined || Boolean(s.service)));
  });
}

// The runner (createRunner, replay, journeyTasks, afterTasks) runs every journey on its XState
// machine: see run.ts.
export * from "./run.js";

/** What's wrong with a step's guard (RTN-9). */
function guardProblems(at: string, g: unknown, asks: boolean, parallel: boolean, services: readonly string[] | undefined, checkTemplate: (at: string, v: unknown) => void): string[] {
  const out: string[] = [];
  if (!g || typeof g !== "object" || Array.isArray(g)) return [`${at}: guard is { allow, reason } or { call, with, reason }`];
  const x = g as Record<string, unknown>;
  for (const k of Object.keys(x)) if (!["allow", "call", "with", "within", "reason"].includes(k)) out.push(`${at}: guard: unknown key '${k}'`);
  if (!asks) out.push(`${at}: only a step with questions has a guard`);
  if (parallel) out.push(`${at}: a guard works in a journey that runs in sequence`);
  if ((x.allow === undefined) === (x.call === undefined)) out.push(`${at}: a guard has allow (a condition) or call (a service), one of them`);
  if (x.allow !== undefined) {
    const p = typeof x.allow === "string" ? conditionProblem(x.allow) : "allow is a condition";
    if (p) out.push(`${at}: guard: ${p}`);
  }
  if (x.call !== undefined) {
    if (typeof x.call !== "string" || !SERVICE.test(x.call)) out.push(`${at}: guard: call must be a dotted name like connector.stock.check`);
    else if (services && !services.includes(x.call)) out.push(`${at}: guard: no service '${x.call}'`);
    checkTemplate(`${at} guard`, x.with);
  }
  if (x.within !== undefined && (typeof x.within !== "number" || !Number.isInteger(x.within) || x.within < 100 || x.within > GUARD_MAX_MS)) out.push(`${at}: guard: within is milliseconds, 100 to ${GUARD_MAX_MS}`);
  if (typeof x.reason !== "string" || !x.reason.trim() || x.reason.length > 300) out.push(`${at}: guard: reason is what the person sees when it stops them (up to 300 characters)`);
  return out;
}
