// Cases (LIB-12, LIB-33..38): a catalogue journey that passes between people is stored as a case,
// with its own thread, so its state lasts from one person to the next. A journey screen may name
// the role that answers it (`role:`); when the run reaches such a screen, or ends with roles that
// finish it (`roles.complete`), the kiosk hands it over: the case holds the run so far, and members
// with that role find it in their work queue when they sign in, carry on from where it stopped, add
// notes to its thread, and close it.
//
// The server decides where a case stands. It replays the stored answers and service results on the
// journey itself (yaxb-journeys `replay`), so a client can't skip a screen, answer one that isn't
// theirs, or say who acts next. The journey is kept with the case as it was when the case started,
// so a new revision of the service doesn't change a case in progress.
//
// Answers can hold personal details: a case is shown only to the person who started it, members
// with a role the journey names, and administrators. Password answers are never stored. A kiosk is
// often shared, so a visitor's cases are never listed: a visitor opens theirs by its reference
// ("R-7KQ4MX", shown when they hand it over), like a parcel's tracking code, and acts on it as the
// person who started it. Members open cases by id from their work queue.
import { canInitiate, mayAnswer, replay, type Journey, type RunActor, type RunSnapshot } from "@sekaran-ind/yaxb-journeys/journeys";
import { z } from "zod";

export type CaseStatus = "waiting" | "to_finish" | "done" | "declined";

export const CASE_STATUSES: readonly CaseStatus[] = ["waiting", "to_finish", "done", "declined"];

/** Someone acting on a case: a member (their roles), an administrator, or a visitor (guest:<session>). */
export type CaseActor = { id: string; name: string; roles: readonly string[]; admin: boolean; guest?: boolean; device?: string };

export type Case = {
  id: string;
  /** What people quote: "R-7KQ4MX". */
  ref: string;
  entry_id: string;
  service_id: string;
  service_title: string;
  journey_id: string;
  journey_title: string;
  revision: number | null;
  status: CaseStatus;
  /** The screen waiting (status waiting), and its role: null for the person who started it. */
  waiting_step: string | null;
  waiting_role: string | null;
  /** Who closes it once the journey has ended (the journey's roles.complete). */
  finish_roles: string[];
  /** Every role the journey names: who may see the case. */
  roles: string[];
  started_by: string;
  started_by_name: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  result: { title: string; text: string; ok: boolean } | null;
  run: RunSnapshot;
  journey: Journey;
  /** The device a visitor started it on: their later screens come back there (devices storage). */
  starter_device?: string | null;
  /** One member it is assigned to (a moderator's reassignment), instead of everyone with the role. */
  assignee?: string | null;
  assignee_name?: string | null;
};

/** A case in a list: everything but the run and the journey. */
export type CaseSummary = Omit<Case, "run" | "journey">;

export type CaseEventKind = "started" | "answered" | "note" | "finished" | "declined" | "reassigned";

/** One line of a case's thread. */
export type CaseEvent = { id: string; case_id: string; at: string; actor_id: string; actor_name: string; kind: CaseEventKind; step: string | null; text: string | null };

export interface CaseStore {
  put(c: Case): Promise<void>;
  get(id: string): Promise<Case | null>;
  byRef(ref: string): Promise<Case | null>;
  /** Open cases, and closed ones started by `startedBy`, newest first. */
  list(opts: { open: boolean; startedBy?: string; limit: number }): Promise<CaseSummary[]>;
  addEvent(e: CaseEvent): Promise<void>;
  events(caseId: string): Promise<CaseEvent[]>;
}

export class CaseError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const MAX_CASE_NOTE = 1000;
/** The stored run's size (answers and service results), as JSON. */
export const MAX_CASE_RUN = 64 * 1024;
export const CASES_IN_LIST = 200;

const answers = z.record(z.string().max(64), z.record(z.string().max(64), z.unknown()));
export const caseStartSchema = z.object({ entry: z.string().min(1).max(64), journey: z.string().min(1).max(64), answers, steps: z.record(z.string().max(64), z.unknown()).default({}) }).strict();
export const caseActSchema = z.object({ answers, steps: z.record(z.string().max(64), z.unknown()).default({}) }).strict();
export const caseNoteSchema = z.object({ text: z.string().trim().min(1, "Write a note first.").max(MAX_CASE_NOTE) }).strict();
export const caseReassignSchema = z.object({ member: z.string().min(1).max(80), name: z.string().trim().min(1).max(80), reason: z.string().trim().max(MAX_CASE_NOTE).optional() }).strict();
export const caseFinishSchema = z.object({ decision: z.enum(["done", "declined"]), note: z.string().trim().max(MAX_CASE_NOTE).optional() }).strict();

/** The published journey a case runs, and the service it belongs to. */
export type CaseJourney = { journey: Journey; entry_id: string; service_id: string; service_title: string; revision: number | null };

export type CaseOptions = {
  /** Finds a published catalogue journey (null when there is none, or it isn't published). */
  journeyFor(entry: string, journey: string): Promise<CaseJourney | null>;
  now?: () => Date;
  id?: () => string;
};

const REF_CHARS = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A case's reference, as people type it (upper case; the Worker upper-cases what it is given). */
export const CASE_REF = /^R-[2-9A-HJ-NP-TV-Z]{6}$/;
function newRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `R-${[...bytes].map((b) => REF_CHARS[b % REF_CHARS.length]).join("")}`;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new CaseError(r.error.issues[0]?.message ?? "Check the details.");
  return r.data;
}

/** Every role the journey names (its starters other than visitors, its screens' and its finishers'). */
export function rolesOf(journey: Journey): string[] {
  const out = new Set<string>([...(journey.roles?.initiate ?? []), ...(journey.roles?.complete ?? [])]);
  for (const s of Object.values(journey.steps)) if (s.role) out.add(s.role);
  out.delete("visitor");
  return [...out];
}

const passwordFields = (journey: Journey) => new Map(Object.entries(journey.steps).map(([id, s]) => [id, new Set((s.fields ?? []).filter((f) => f.type === "password").map((f) => f.id))]));

/** The run as it is stored: passwords never are (a marker keeps a required answer present). */
function storable(journey: Journey, run: RunSnapshot): RunSnapshot {
  const pw = passwordFields(journey);
  const answers = Object.fromEntries(
    Object.entries(run.answers).map(([step, values]) => [step, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, pw.get(step)?.has(k) && v ? "••••••" : v]))]),
  );
  return { ...run, answers };
}

export const summaryOf = ({ run: _r, journey: _j, ...rest }: Case): CaseSummary => rest;

/** May this person see the case? Its starter, an administrator, or a member with a role it names. */
export const mayView = (c: Pick<Case, "started_by" | "roles">, a: CaseActor) => a.admin || c.started_by === a.id || c.roles.some((r) => a.roles.includes(r));

/** Is it this person's turn? */
export function isTurnOf(c: Pick<Case, "status" | "waiting_role" | "started_by" | "finish_roles" | "assignee">, a: CaseActor): boolean {
  // Assigned to one member: theirs (an administrator may still close it).
  if (c.assignee && c.status !== "done" && c.status !== "declined") return c.assignee === a.id || (c.status === "to_finish" && a.admin);
  if (c.status === "waiting") return c.waiting_role ? a.roles.includes(c.waiting_role) : c.started_by === a.id;
  if (c.status === "to_finish") return a.admin || c.finish_roles.some((r) => a.roles.includes(r));
  return false;
}

/** May this person reassign a case: a moderator or an administrator. */
export const mayReassign = (a: CaseActor) => a.admin || a.roles.includes("moderator") || a.roles.includes("administrator");

/** The actor's part of the journey, for the runner. */
export const runActor = (c: Pick<Case, "started_by">, a: CaseActor): RunActor => ({ starter: c.started_by === a.id, roles: a.roles });

export function createCaseService(store: CaseStore, options: CaseOptions) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const id = () => options.id?.() ?? crypto.randomUUID();
  const event = (c: Case, a: CaseActor, kind: CaseEventKind, step: string | null = null, text: string | null = null) =>
    store.addEvent({ id: id(), case_id: c.id, at: now(), actor_id: a.id, actor_name: a.guest ? "Visitor" : a.name, kind, step, text });

  /** Where the replayed run stands, as the case's status. */
  function position(journey: Journey, state: Awaited<ReturnType<typeof replay>> & { ok: true }) {
    const s = state.state;
    if (s.status === "done") {
      const finish = (journey.roles?.complete ?? []).filter((r) => r !== "visitor");
      return { status: (finish.length ? "to_finish" : "done") as CaseStatus, waiting_step: null, waiting_role: null, result: s.result };
    }
    const step = s.prompt!.step;
    return { status: "waiting" as CaseStatus, waiting_step: step, waiting_role: journey.steps[step]?.role ?? null, result: null };
  }

  /** A case by id (members) or reference, and who the actor is on it: a visitor with the reference of a visitor's case is its starter. */
  async function load(key: string, actor: CaseActor): Promise<{ c: Case; a: CaseActor }> {
    const byRef = CASE_REF.test(key);
    const c = byRef ? await store.byRef(key) : await store.get(key);
    if (c) {
      if (actor.guest) {
        if (byRef && c.started_by.startsWith("guest:")) return { c, a: { ...actor, id: c.started_by } };
      } else if (mayView(c, actor)) return { c, a: actor };
    }
    throw new CaseError("There is no case with that reference, or it isn't yours to see.", 404);
  }

  const sized = (run: Pick<RunSnapshot, "answers" | "steps">) => {
    if (JSON.stringify(run).length > MAX_CASE_RUN) throw new CaseError("The answers are too long to keep.", 413);
  };

  return {
    /**
     * Hand a run over: the starter has answered their screens and the journey now needs someone
     * else (a screen another role answers, or roles that finish it).
     */
    async start(a: CaseActor, input: unknown): Promise<{ case: CaseSummary }> {
      const p = parse(caseStartSchema, input);
      sized(p);
      const found = await options.journeyFor(p.entry, p.journey);
      if (!found) throw new CaseError("That journey isn't in the published catalogue.", 404);
      const { journey } = found;
      if (!canInitiate(journey, a.roles)) throw new CaseError("Your roles can't start this journey.", 403);
      const r = await replay(journey, p);
      if (!r.ok) throw new CaseError(r.problems[0] ?? "The answers don't fit the journey.");
      const starter: RunActor = { starter: true, roles: a.roles };
      const notMine = r.answered.find((s) => !mayAnswer(journey.steps[s]!, starter));
      if (notMine) throw new CaseError(`The screen "${journey.steps[notMine]?.label ?? notMine}" is answered by someone else.`, 403);
      const at = position(journey, r);
      if (at.status === "waiting" && at.waiting_role === null) throw new CaseError("Finish your part of the journey first.");
      if (at.status === "done") throw new CaseError("This journey ends here: there is nothing to hand over.");
      const t = now();
      let ref = newRef();
      for (let i = 0; i < 5 && (await store.byRef(ref)); i++) ref = newRef();
      const c: Case = {
        id: id(),
        ref,
        entry_id: found.entry_id,
        service_id: found.service_id,
        service_title: found.service_title,
        journey_id: journey.id,
        journey_title: journey.title,
        revision: found.revision,
        ...at,
        finish_roles: (journey.roles?.complete ?? []).filter((x) => x !== "visitor"),
        roles: rolesOf(journey),
        started_by: a.id,
        started_by_name: a.guest ? "A visitor" : a.name,
        starter_device: a.guest ? (a.device ?? null) : null,
        assignee: null,
        assignee_name: null,
        created_at: t,
        updated_at: t,
        closed_at: null,
        run: storable(journey, { current: r.state.current, answers: p.answers, steps: p.steps, trail: r.state.trail }),
        journey,
      };
      await store.put(c);
      await event(c, a, "started", null, r.answered.map((s) => journey.steps[s]?.label ?? s).join(", ") || null);
      return { case: summaryOf(c) };
    },

    /** Answer the screens that are this person's turn, from where the case stopped. */
    async act(actor: CaseActor, key: string, input: unknown): Promise<{ case: CaseSummary }> {
      const p = parse(caseActSchema, input);
      const { c, a } = await load(key, actor);
      if (c.status !== "waiting" || !isTurnOf(c, a)) throw new CaseError("It isn't your turn on this case.", 409);
      const answers = { ...c.run.answers };
      for (const [k, v] of Object.entries(p.answers)) {
        if (Object.hasOwn(answers, k)) throw new CaseError("Those screens are answered already.", 409);
        answers[k] = v;
      }
      const steps = { ...c.run.steps };
      for (const [k, v] of Object.entries(p.steps)) if (!Object.hasOwn(steps, k)) steps[k] = v;
      sized({ answers, steps });
      const r = await replay(c.journey, { answers, steps });
      if (!r.ok) throw new CaseError(r.problems[0] ?? "The answers don't fit the journey.");
      const me = runActor(c, a);
      const fresh = r.answered.filter((s) => !Object.hasOwn(c.run.answers, s));
      if (!fresh.length) throw new CaseError("Answer the screen first.");
      const notMine = fresh.find((s) => !mayAnswer(c.journey.steps[s]!, me));
      if (notMine) throw new CaseError(`The screen "${c.journey.steps[notMine]?.label ?? notMine}" is answered by someone else.`, 403);
      const at = position(c.journey, r);
      const t = now();
      const next: Case = {
        ...c,
        ...at,
        assignee: null,
        assignee_name: null,
        updated_at: t,
        closed_at: at.status === "done" ? t : null,
        run: storable(c.journey, { current: r.state.current, answers, steps, trail: r.state.trail }),
      };
      await store.put(next);
      await event(next, a, "answered", fresh[0] ?? null, fresh.map((s) => c.journey.steps[s]?.label ?? s).join(", "));
      return { case: summaryOf(next) };
    },

    /**
     * Give an open case to one member (a moderator or an administrator), when whoever has it has gone
     * quiet. The member must hold the role whose turn it is, or one that finishes it.
     */
    async reassign(actor: CaseActor, key: string, input: unknown, memberRoles: readonly string[]): Promise<{ case: CaseSummary }> {
      const p = parse(caseReassignSchema, input);
      if (!mayReassign(actor)) throw new CaseError("Only a moderator or an administrator can reassign a case.", 403);
      // A moderator reassigns from the board (who holds what, since when) without reading the case.
      const c = CASE_REF.test(key) ? await store.byRef(key) : await store.get(key);
      if (!c) throw new CaseError("There is no case with that reference.", 404);
      const a = actor;
      if (c.status === "done" || c.status === "declined") throw new CaseError("This case is closed already.", 409);
      const needs = c.status === "waiting" ? (c.waiting_role ? [c.waiting_role] : []) : c.finish_roles;
      if (!needs.length) throw new CaseError("It is waiting for the person who started it: only they can carry on.", 409);
      if (!needs.some((r) => memberRoles.includes(r))) throw new CaseError("That member doesn't have the role this case needs.", 422);
      const t = now();
      const next: Case = { ...c, assignee: p.member, assignee_name: p.name, updated_at: t };
      await store.put(next);
      await event(next, a, "reassigned", null, `To ${p.name}${p.reason ? `: ${p.reason}` : ""}`);
      return { case: summaryOf(next) };
    },

    /** A note on the case's thread, from anyone who may see it. */
    async note(actor: CaseActor, key: string, input: unknown): Promise<{ event: CaseEvent }> {
      const { text } = parse(caseNoteSchema, input);
      const { c, a } = await load(key, actor);
      const e: CaseEvent = { id: id(), case_id: c.id, at: now(), actor_id: a.id, actor_name: a.guest ? "Visitor" : a.name, kind: "note", step: null, text };
      await store.addEvent(e);
      await store.put({ ...c, updated_at: e.at });
      return { event: e };
    },

    /** Close a case: a finisher when the journey has ended, or decline it (a finisher or an administrator) at any time. */
    async finish(actor: CaseActor, key: string, input: unknown): Promise<{ case: CaseSummary }> {
      const p = parse(caseFinishSchema, input);
      const { c, a } = await load(key, actor);
      if (c.status === "done" || c.status === "declined") throw new CaseError("This case is closed already.", 409);
      const finisher = a.admin || c.finish_roles.some((r) => a.roles.includes(r));
      if (p.decision === "done" && (c.status !== "to_finish" || !finisher)) throw new CaseError(c.status === "to_finish" ? "Only the roles that finish this journey can close it." : "The journey hasn't reached its end yet.", 409);
      if (p.decision === "declined" && !(finisher || (c.waiting_role !== null && a.roles.includes(c.waiting_role)))) throw new CaseError("Only the role whose turn it is, a finisher or an administrator can decline it.", 403);
      if (p.decision === "declined" && !p.note) throw new CaseError("Say why it is declined: the person who started it reads this.");
      const t = now();
      const next: Case = { ...c, status: p.decision, updated_at: t, closed_at: t };
      await store.put(next);
      await event(next, a, p.decision === "done" ? "finished" : "declined", null, p.note ?? null);
      return { case: summaryOf(next) };
    },

    /**
     * The work queue: cases waiting for this person, the ones they started, and the other open cases
     * they may see. Nothing for a visitor: on a shared kiosk the next person would see it.
     */
    async list(a: CaseActor): Promise<{ mine: CaseSummary[]; started: CaseSummary[]; others: CaseSummary[] }> {
      if (a.guest) return { mine: [], started: [], others: [] };
      const open = await store.list({ open: true, limit: CASES_IN_LIST });
      const own = await store.list({ open: false, startedBy: a.id, limit: CASES_IN_LIST });
      const seen = new Set<string>();
      const mine = open.filter((c) => isTurnOf(c, a) && seen.add(c.id));
      const started = [...own, ...open.filter((c) => c.started_by === a.id)].filter((c) => !seen.has(c.id) && seen.add(c.id));
      const others = open.filter((c) => !seen.has(c.id) && mayView(c, a) && seen.add(c.id));
      return { mine, started, others };
    },

    /** One case: the stored run, the journey, the thread, and whether it is this person's turn. */
    async get(actor: CaseActor, key: string) {
      const { c, a } = await load(key, actor);
      const turn = isTurnOf(c, a);
      return { case: c, events: await store.events(c.id), turn, actor: runActor(c, a), mayFinish: c.status === "to_finish" && turn, mayDecline: (c.status === "waiting" || c.status === "to_finish") && (a.admin || c.finish_roles.some((r) => a.roles.includes(r)) || (c.waiting_role !== null && a.roles.includes(c.waiting_role))) };
    },
  };
}

export type CaseService = ReturnType<typeof createCaseService>;
export * from "./transfer.js";

export function createMemoryCaseStore(): CaseStore {
  const cases = new Map<string, Case>();
  const events: CaseEvent[] = [];
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    async put(c) {
      cases.set(c.id, copy(c));
    },
    get: async (id) => (cases.has(id) ? copy(cases.get(id)!) : null),
    byRef: async (ref) => copy([...cases.values()].find((c) => c.ref === ref) ?? null),
    async list({ open, startedBy, limit }) {
      return [...cases.values()]
        .filter((c) => (open ? c.status === "waiting" || c.status === "to_finish" : true) && (startedBy === undefined || c.started_by === startedBy))
        .sort((x, y) => y.updated_at.localeCompare(x.updated_at))
        .slice(0, limit)
        .map((c) => summaryOf(copy(c)));
    },
    async addEvent(e) {
      events.push({ ...e });
    },
    events: async (caseId) => events.filter((e) => e.case_id === caseId).map((e) => ({ ...e })),
  };
}

/** Whether a role has someone to act on it: a member who has signed in, one invited who hasn't yet, or nobody. */
export type Staffing = "ready" | "invited" | "nobody";

/**
 * For each role, whether the team has someone with it (LIB-37): a member whose key works and who
 * has signed in, or one invited who hasn't yet. Administrators count for every role only where
 * they hold it: a journey's screen for an organiser needs an organiser.
 */
export function staffingOf(roles: readonly string[], members: readonly { roles: readonly string[]; status: "active" | "invited" | "suspended" | "expired" }[]): Record<string, Staffing> {
  const out: Record<string, Staffing> = {};
  for (const r of roles) {
    const holders = members.filter((m) => m.roles.includes(r));
    out[r] = holders.some((m) => m.status === "active") ? "ready" : holders.some((m) => m.status === "invited") ? "invited" : "nobody";
  }
  return out;
}
