// Access to a step, like Unix's rwx: who may read what was answered at it (r), answer it (w), and run
// its action (x). Part of the service design, on a step (a screen, in a nested service):
//
//   - id: notes
//     role: nurse                          who is expected to answer it (as before)
//     access:
//       nurse: rw                          the nurse reads and writes
//       doctor: r                          the doctor reads
//       starter: r                         whoever started the journey (Unix's owner)
//       any: r                             everyone who may see the case (Unix's other)
//       starter: "-"                       "-" is nothing: it takes away what a subject would have by default
//
// Subjects are role ids, `starter` (the person who started the journey) and `any` (everyone who may see
// the case, Unix's "other"). Bits are `r`, `w` and `x` in that order ("r", "rw", "rwx", "wx"...), or "-".
//   r  read the answers given at this step. Without it they are hidden from that person.
//   w  answer the step. Only a step with questions.
//   x  run the step's action: a step that calls a service (a connector, from the worklist). Not
//      enforced yet: the runner still runs service steps itself.
// A step with no `access` works as before: its `role` (or, without one, the starter) answers it, and
// everyone who may see the case reads it. Once a step has `access`, only what it lists is granted, plus
// the defaults for subjects it doesn't list: its `role` has rwx, the starter has rwx on a step with no
// `role` and r on one that has a role. A subject it does list replaces its default. Administrators
// always read (they are accountable for the service); they don't write unless the step lets them.
import { ROLE_ID, VISITOR_ROLE } from "./roles.js";

export const ACCESS_STARTER = "starter";
export const ACCESS_ANY = "any";
const BITS = /^(-|(?=.)r?w?x?)$/;

export type AccessBits = { r: boolean; w: boolean; x: boolean };
export type StepAccess = Record<string, string>;
type Who = { starter: boolean; roles: readonly string[] };

const bits = (s: string): AccessBits => ({ r: s.includes("r"), w: s.includes("w"), x: s.includes("x") });
const NONE: AccessBits = { r: false, w: false, x: false };
const ALL: AccessBits = { r: true, w: true, x: true };
const union = (a: AccessBits, b: AccessBits): AccessBits => ({ r: a.r || b.r, w: a.w || b.w, x: a.x || b.x });

/** What this actor may do at the step. */
export function accessOf(step: { role?: string; access?: StepAccess }, actor: Who): AccessBits {
  const access = step.access;
  if (!access) {
    // As before: the step's role (or the starter, when it has none) answers; everyone who sees the case reads.
    const answers = step.role ? actor.roles.includes(step.role) : actor.starter;
    return { r: true, w: answers, x: answers };
  }
  let out = NONE;
  const listed = (subject: string) => Object.prototype.hasOwnProperty.call(access, subject);
  // The defaults of subjects the step doesn't list.
  if (step.role && !listed(step.role) && actor.roles.includes(step.role)) out = union(out, ALL);
  if (!listed(ACCESS_STARTER) && actor.starter) out = union(out, step.role ? { r: true, w: false, x: false } : ALL);
  for (const [subject, granted] of Object.entries(access)) {
    const applies = subject === ACCESS_ANY || (subject === ACCESS_STARTER ? actor.starter : actor.roles.includes(subject));
    if (applies && typeof granted === "string") out = union(out, bits(granted));
  }
  return out;
}

/** Problems with a step's `access`. `known` are the role ids that exist; `step` says what the step can do. */
export function accessProblems(at: string, value: unknown, step: { questions: boolean; service: boolean }, known?: readonly string[]): string[] {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${at}: access maps a role (or starter, or any) to what it may do, like nurse: rw`];
  const problems: string[] = [];
  for (const [subject, granted] of Object.entries(value)) {
    if (subject === VISITOR_ROLE) problems.push(`${at}: access for '${VISITOR_ROLE}': use any (everyone who may see the case) or starter (whoever started it)`);
    else if (subject !== ACCESS_ANY && subject !== ACCESS_STARTER && !ROLE_ID.test(subject)) problems.push(`${at}: access '${subject}' is a role id, starter or any`);
    else if (known && subject !== ACCESS_ANY && subject !== ACCESS_STARTER && !known.includes(subject)) problems.push(`${at}: access names role '${subject}', which isn't one of this service's roles`);
    if (typeof granted !== "string" || !BITS.test(granted)) problems.push(`${at}: access for '${subject}' is r, w and x in that order (r, rw, rwx, wx...), or - for nothing`);
    else {
      if (granted.includes("w") && !step.questions) problems.push(`${at}: access '${subject}' writes (w), but only a step with questions can be answered`);
      if (granted.includes("x") && !step.service) problems.push(`${at}: access '${subject}' runs (x), but only a step that calls a service has an action`);
    }
  }
  return problems;
}

/** The answers and service results of the steps this actor may not read, left out. Returns what was left out too. */
export function redactRun<R extends { answers: Record<string, Record<string, unknown>>; steps: Record<string, unknown> }>(steps: Record<string, { role?: string; access?: StepAccess }>, run: R, actor: Who & { admin?: boolean }): { run: R; hidden: string[] } {
  if (actor.admin) return { run, hidden: [] };
  const hidden = Object.keys(steps).filter((id) => steps[id]!.access && !accessOf(steps[id]!, actor).r && (id in run.answers || id in run.steps));
  if (!hidden.length) return { run, hidden };
  const keep = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([id]) => !hidden.includes(id)));
  return { run: { ...run, answers: keep(run.answers), steps: keep(run.steps) }, hidden };
}
