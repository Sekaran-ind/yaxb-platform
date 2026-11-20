// Routines (RTN-1..5, 7, 13): work the kiosk does on its own, on a schedule, on a date or when
// something happens, written as a catalogue entry and approved by a reviewer like a service.
//
//   kind: routine
//   id: late-alert
//   title: Late check-in alert
//   on:                                       one trigger:
//     event: { service: attendance, kind: journey.outcome, outcome: attendance.late }
//     # schedule: { every: week, on: mon, at: "09:00" }   every hour | day | week | month
//     # date: { service: hall, date: annual-day, before: 1, at: "09:00" }
//   when: "event.outcome == 'attendance.late'"   optional: the journeys' condition language
//   actions:
//     - message: { to: manager, text: "Someone checked in late at {{event.time}}." }
//     - summary: { service: attendance, days: 7, as: week }        then {{results.week}}
//     - connector: { call: connector.stock-sheet.add, with: { item: "{{event.outcome}}" } }
//     - record: { outcome: alert.sent }
//
// Templates read `event` (kind, service, journey, outcome, actor, step, at, date, time), `now` (date,
// time, weekday), `routine` (id, title) and `results` (what earlier actions kept with `as`). Times are
// the business's own clock (`utc_offset` minutes, India's by default). Nothing pays (RTN-13): an action
// whose handler reads like a payment is refused when the routine is checked, and again when it runs.
import { load } from "js-yaml";
import { conditionProblem, holds, render, type Scope } from "@sekaran-ind/yaxb-journeys/journeys";
import { EVENT_KINDS, type EventKind, type ServiceEvent, type ServiceMetrics } from "../metrics/index.js";

export const ROUTINE_EVERY = ["hour", "day", "week", "month"] as const;
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const ROUTINE_ACTIONS = ["message", "summary", "connector", "record"] as const;
export type RoutineActionType = (typeof ROUTINE_ACTIONS)[number];

export type ScheduleTrigger = { every: (typeof ROUTINE_EVERY)[number]; at?: string; minute?: number; on?: (typeof WEEKDAYS)[number] | number };
export type EventTrigger = { service: string; kind: EventKind; journey?: string; outcome?: string };
export type DateTrigger = { service: string; date: string; before: number; at: string };
export type RoutineTrigger = { schedule: ScheduleTrigger } | { event: EventTrigger } | { date: DateTrigger };

export type RoutineAction =
  | { type: "message"; to: string; text: string }
  | { type: "summary"; service: string; days: number; as?: string }
  | { type: "connector"; call: string; with: Record<string, unknown>; as?: string }
  | { type: "record"; outcome: string };

export type Routine = {
  kind: "routine";
  id: string;
  title: string;
  summary?: string;
  on: RoutineTrigger;
  when?: string;
  actions: RoutineAction[];
  /** Minutes east of UTC for the business's clock (India: 330). */
  utc_offset: number;
};

/** A routine's people: who may publish one (RTN-7). Reviewers approve them like services. */
export const ROUTINE_AUTHORS = ["administrator", "automator"] as const;
/** At most this many actions in one routine. */
export const MAX_ACTIONS = 10;
/** A scheduled run more than this late (the Worker was down) is skipped, not run late. */
export const MAX_LATE_MS = 2 * 60 * 60_000;
/** India's clock, the default. */
export const DEFAULT_UTC_OFFSET = 330;

const ID = /^[a-z][a-z0-9-]{0,47}$/;
const AS = /^[a-z][a-z0-9_]{0,31}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const OUTCOME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const HANDLER = /^connector\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const KEYS = new Set(["kind", "id", "title", "summary", "on", "when", "actions", "utc_offset"]);
/** Words that mean money leaving (RTN-13). */
const PAYS = /(^|[^a-z])(pay|pays|payment|payments|payout|paid|transfer|refund|upi|charge|purchase|buy|checkout|invoice-pay)([^a-z]|$)/i;

/** Whether a handler or label reads like a payment (RTN-13: nothing pays automatically). */
export const looksLikePayment = (text: string) => PAYS.test(text.replace(/[._]/g, " "));

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const templateProblem = (at: string, v: unknown) => (typeof v === "string" && v.trim() ? null : `${at} is required`);

function compileTrigger(on: unknown, problems: string[]): RoutineTrigger | null {
  if (!isObj(on)) return void problems.push("on is required: one of schedule, event or date"), null;
  const keys = Object.keys(on);
  if (keys.length !== 1) return void problems.push("on has exactly one of schedule, event or date"), null;
  const [k] = keys as [string];
  const t = on[k];
  if (!isObj(t)) return void problems.push(`on.${k} is a mapping`), null;
  if (k === "schedule") {
    const every = t.every as ScheduleTrigger["every"];
    if (!ROUTINE_EVERY.includes(every)) return void problems.push("on.schedule.every is hour, day, week or month"), null;
    const s: ScheduleTrigger = { every };
    if (every === "hour") {
      const minute = t.minute ?? 0;
      if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 59) problems.push("on.schedule.minute is 0 to 59");
      else s.minute = minute;
    } else {
      if (typeof t.at !== "string" || !TIME.test(t.at)) problems.push('on.schedule.at is a time like "09:00"');
      else s.at = t.at;
    }
    if (every === "week") {
      if (!WEEKDAYS.includes(t.on as never)) problems.push("on.schedule.on is a weekday: sun, mon, tue, wed, thu, fri or sat");
      else s.on = t.on as ScheduleTrigger["on"];
    } else if (every === "month") {
      if (typeof t.on !== "number" || !Number.isInteger(t.on) || t.on < 1 || t.on > 28) problems.push("on.schedule.on is a day of the month, 1 to 28");
      else s.on = t.on;
    } else if (t.on !== undefined) problems.push(`on.schedule.on is only for every: week or month`);
    return { schedule: s };
  }
  if (k === "event") {
    if (typeof t.service !== "string" || !ID.test(t.service)) problems.push("on.event.service is the service's id");
    if (!EVENT_KINDS.includes(t.kind as EventKind)) problems.push(`on.event.kind is one of: ${EVENT_KINDS.join(", ")}`);
    if (t.journey !== undefined && (typeof t.journey !== "string" || !ID.test(t.journey))) problems.push("on.event.journey is a journey's id");
    if (t.outcome !== undefined && (typeof t.outcome !== "string" || !OUTCOME.test(t.outcome))) problems.push("on.event.outcome is an outcome id");
    return { event: { service: String(t.service), kind: t.kind as EventKind, ...(t.journey ? { journey: String(t.journey) } : {}), ...(t.outcome ? { outcome: String(t.outcome) } : {}) } };
  }
  if (k === "date") {
    if (typeof t.service !== "string" || !ID.test(t.service)) problems.push("on.date.service is the service with the date");
    if (typeof t.date !== "string" || !ID.test(t.date)) problems.push("on.date.date is the id of one of the service's key dates");
    const before = t.before ?? 0;
    if (typeof before !== "number" || !Number.isInteger(before) || before < 0 || before > 60) problems.push("on.date.before is 0 to 60 days");
    const at = t.at ?? "09:00";
    if (typeof at !== "string" || !TIME.test(at)) problems.push('on.date.at is a time like "09:00"');
    return { date: { service: String(t.service), date: String(t.date), before: Number(before), at: String(at) } };
  }
  problems.push(`on.${k} isn't a trigger: use schedule, event or date`);
  return null;
}

function compileAction(raw: unknown, i: number, problems: string[]): RoutineAction | null {
  const at = `action ${i + 1}`;
  if (!isObj(raw) || Object.keys(raw).length !== 1) return void problems.push(`${at} is one of: ${ROUTINE_ACTIONS.join(", ")}`), null;
  const [type] = Object.keys(raw) as [string];
  const a = raw[type];
  if (!isObj(a)) return void problems.push(`${at}: ${type} is a mapping`), null;
  const as = a.as;
  if (as !== undefined && (typeof as !== "string" || !AS.test(as))) problems.push(`${at}: as is a short name (lower-case, _)`);
  switch (type) {
    case "message": {
      if (typeof a.to !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(a.to)) problems.push(`${at}: message.to is a role's id`);
      const p = templateProblem(`${at}: message.text`, a.text);
      if (p) problems.push(p);
      else if (String(a.text).length > 1000) problems.push(`${at}: message.text is at most 1000 characters`);
      return { type, to: String(a.to), text: String(a.text ?? "") };
    }
    case "summary": {
      if (typeof a.service !== "string" || !ID.test(a.service)) problems.push(`${at}: summary.service is the service's id`);
      const days = a.days ?? 7;
      if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 31) problems.push(`${at}: summary.days is 1 to 31`);
      return { type, service: String(a.service), days: Number(days), ...(typeof as === "string" ? { as } : {}) };
    }
    case "connector": {
      if (typeof a.call !== "string" || !HANDLER.test(a.call)) problems.push(`${at}: connector.call is connector.<id>.<operation>`);
      else if (looksLikePayment(a.call)) problems.push(`${at}: a routine never pays or moves money (${a.call}); a person does that`);
      if (a.with !== undefined && !isObj(a.with)) problems.push(`${at}: connector.with is a mapping`);
      return { type, call: String(a.call), with: isObj(a.with) ? a.with : {}, ...(typeof as === "string" ? { as } : {}) };
    }
    case "record": {
      if (typeof a.outcome !== "string" || !OUTCOME.test(a.outcome)) problems.push(`${at}: record.outcome is an outcome id like alert.sent`);
      return { type, outcome: String(a.outcome) };
    }
    case "journey":
    case "agent":
      problems.push(`${at}: ${type} actions aren't available yet`);
      return null;
    default:
      problems.push(`${at}: '${type}' isn't an action; use ${ROUTINE_ACTIONS.join(", ")}`);
      return null;
  }
}

/** A routine document, checked (RTN-1). */
export function compileRoutine(doc: unknown): { ok: true; routine: Routine; problems: [] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!isObj(doc)) return { ok: false, problems: ["a routine is a YAML mapping"] };
  if (doc.kind !== "routine") problems.push("kind must be 'routine'");
  if (typeof doc.id !== "string" || !ID.test(doc.id)) problems.push("id is required (lower-case words joined by '-')");
  if (typeof doc.title !== "string" || !doc.title.trim()) problems.push("title is required");
  for (const k of Object.keys(doc)) if (!KEYS.has(k)) problems.push(`unknown key '${k}'`);
  const on = compileTrigger(doc.on, problems);
  if (doc.when !== undefined) {
    if (typeof doc.when !== "string") problems.push("when is a condition");
    else {
      const p = conditionProblem(doc.when);
      if (p) problems.push(`when: ${p}`);
    }
  }
  const offset = doc.utc_offset ?? DEFAULT_UTC_OFFSET;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < -720 || offset > 840) problems.push("utc_offset is minutes east of UTC (India: 330)");
  const actions: RoutineAction[] = [];
  if (!Array.isArray(doc.actions) || !doc.actions.length) problems.push("actions is a list of at least one action");
  else if (doc.actions.length > MAX_ACTIONS) problems.push(`at most ${MAX_ACTIONS} actions`);
  else
    doc.actions.forEach((raw, i) => {
      const a = compileAction(raw, i, problems);
      if (a) actions.push(a);
    });
  const named = actions.flatMap((a) => ("as" in a && a.as ? [a.as] : []));
  if (new Set(named).size !== named.length) problems.push("two actions keep their result with the same 'as'");
  if (problems.length || !on) return { ok: false, problems };
  return {
    ok: true,
    routine: { kind: "routine", id: String(doc.id), title: String(doc.title), ...(typeof doc.summary === "string" ? { summary: doc.summary } : {}), on, ...(typeof doc.when === "string" ? { when: doc.when } : {}), actions, utc_offset: Number(offset) },
    problems: [],
  };
}

export function parseRoutine(yaml: string) {
  let doc: unknown;
  try {
    doc = load(yaml);
  } catch (e) {
    return { ok: false as const, problems: [`The YAML can't be read: ${(e as Error).message.split("\n")[0]}`] };
  }
  return compileRoutine(doc);
}

// ---- when it runs (RTN-2) --------------------------------------------------------------------------

const MIN = 60_000;
const DAY = 86_400_000;
const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
/** Local midnight (as a UTC instant) of the local day holding `t`. */
const localMidnight = (t: number, offset: number) => Math.floor((t + offset * MIN) / DAY) * DAY - offset * MIN;

/** The first time a schedule fires strictly after `after`, on the business's clock. */
export function nextScheduled(s: ScheduleTrigger, after: Date, offset = DEFAULT_UTC_OFFSET): Date {
  const t = after.getTime();
  if (s.every === "hour") {
    const hour = Math.floor((t + offset * MIN) / 3_600_000) * 3_600_000 - offset * MIN;
    let at = hour + (s.minute ?? 0) * MIN;
    if (at <= t) at += 3_600_000;
    return new Date(at);
  }
  const atMin = hm(s.at ?? "09:00");
  let day = localMidnight(t, offset);
  for (let i = 0; i < 400; i++, day += DAY) {
    const fire = day + atMin * MIN;
    if (fire <= t) continue;
    const local = new Date(day + offset * MIN);
    if (s.every === "week" && WEEKDAYS[local.getUTCDay()] !== s.on) continue;
    if (s.every === "month" && local.getUTCDate() !== s.on) continue;
    return new Date(fire);
  }
  throw new Error("no next time");
}

/** When a date trigger fires: `before` days ahead of the service's date, at `at` (business clock). */
export function dateFiresAt(d: DateTrigger, dateIso: string, offset = DEFAULT_UTC_OFFSET): Date {
  const [y, m, dd] = dateIso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd - d.before) + hm(d.at) * MIN - offset * MIN);
}

export type Due = { due: true; at: Date } | { due: false; next: Date | null; skipped?: Date };
/**
 * Whether a time-triggered routine should run now. `since` is its last run, or when it was approved.
 * A run more than MAX_LATE_MS late is skipped (and the next one waited for).
 */
export function isDue(r: Routine, since: Date, now: Date, dates: (service: string, id: string) => string | null = () => null): Due {
  let at: Date | null = null;
  if ("schedule" in r.on) at = nextScheduled(r.on.schedule, since, r.utc_offset);
  else if ("date" in r.on) {
    const iso = dates(r.on.date.service, r.on.date.date);
    at = iso ? dateFiresAt(r.on.date, iso, r.utc_offset) : null;
    if (at && at.getTime() <= since.getTime()) return { due: false, next: null };
  } else return { due: false, next: null };
  if (!at) return { due: false, next: null };
  if (at.getTime() > now.getTime()) return { due: false, next: at };
  if (now.getTime() - at.getTime() > MAX_LATE_MS) return { due: false, next: "schedule" in r.on ? nextScheduled(r.on.schedule, now, r.utc_offset) : null, skipped: at };
  return { due: true, at };
}

/** Whether an event sets off a routine (RTN-8's notify hooks use the same). */
export function matchesEvent(r: Routine, e: Pick<ServiceEvent, "service" | "kind" | "journey" | "outcome">, serviceIdOf: (entry: string) => string | null = (x) => x): boolean {
  if (!("event" in r.on)) return false;
  const t = r.on.event;
  return t.kind === e.kind && (serviceIdOf(e.service) ?? e.service) === t.service && (!t.journey || t.journey === e.journey) && (!t.outcome || t.outcome === e.outcome);
}

// ---- limits (RTN-5) --------------------------------------------------------------------------------

export type RoutineLimits = { runsPerDay: number; messagesPerDay: number; connectorCallsPerDay: number };
export const DEFAULT_ROUTINE_LIMITS: RoutineLimits = { runsPerDay: 200, messagesPerDay: 100, connectorCallsPerDay: 200 };
export type RoutineUsage = { day: string; runs: number; messages: number; connector_calls: number };
export const emptyUsage = (day: string): RoutineUsage => ({ day, runs: 0, messages: 0, connector_calls: 0 });
export type RoutineSettings = { paused: boolean; limits: RoutineLimits };
export const DEFAULT_ROUTINE_SETTINGS: RoutineSettings = { paused: false, limits: DEFAULT_ROUTINE_LIMITS };

/** Limits as an administrator set them, within bounds. */
export function routineLimits(v: unknown): RoutineLimits {
  const o = isObj(v) ? v : {};
  const n = (k: keyof RoutineLimits, max: number) => {
    const x = o[k];
    return typeof x === "number" && Number.isInteger(x) && x >= 0 ? Math.min(x, max) : DEFAULT_ROUTINE_LIMITS[k];
  };
  return { runsPerDay: n("runsPerDay", 5000), messagesPerDay: n("messagesPerDay", 1000), connectorCallsPerDay: n("connectorCallsPerDay", 5000) };
}

// ---- running (RTN-1, 3, 4) -------------------------------------------------------------------------

export type RoutineInput = { event?: Pick<ServiceEvent, "kind" | "service" | "journey" | "outcome" | "actor" | "step" | "at"> | null; at: Date; trigger: "schedule" | "event" | "date" | "manual" };
export interface RoutineHandlers {
  message(role: string, text: string): Promise<void>;
  summary(service: string, days: number): Promise<{ text: string }>;
  connector(handler: string, input: Record<string, unknown>): Promise<unknown>;
  record(outcome: string): Promise<void>;
}
export type RoutineStep = { action: number; type: RoutineActionType; ok: boolean; note: string };
export type RoutineRun = {
  id: string;
  routine: string;
  trigger: RoutineInput["trigger"];
  dry: boolean;
  at: string;
  status: "done" | "failed" | "skipped" | "limited" | "paused";
  steps: RoutineStep[];
  /** Why it stopped or was skipped. */
  reason?: string;
  /** In a dry run: what each action would have done, with its words (never stored). */
  preview?: string[];
};

const pad = (n: number) => String(n).padStart(2, "0");
/** The business's clock at a moment: date, time and weekday. */
export function localClock(t: Date, offset = DEFAULT_UTC_OFFSET) {
  const l = new Date(t.getTime() + offset * MIN);
  return { date: `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`, time: `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`, weekday: WEEKDAYS[l.getUTCDay()]! };
}

export function routineScope(r: Routine, input: RoutineInput, results: Record<string, unknown>): Scope {
  const e = input.event;
  const when = e ? localClock(new Date(e.at), r.utc_offset) : null;
  return {
    routine: { id: r.id, title: r.title },
    now: localClock(input.at, r.utc_offset),
    event: e ? { kind: e.kind, service: e.service, journey: e.journey, outcome: e.outcome, actor: e.actor, step: e.step, at: e.at, date: when!.date, time: when!.time } : {},
    results,
  };
}

/** Stand-ins for a dry run (RTN-3): nothing is sent, called or recorded. */
export const dryRunHandlers: RoutineHandlers = {
  message: async () => {},
  summary: async (service, days) => ({ text: `(the summary of ${service} over ${days} days)` }),
  connector: async (handler) => ({ preview: true, handler }),
  record: async () => {},
};

const describe = (a: RoutineAction, scope: Scope): string => {
  switch (a.type) {
    case "message":
      return `Message ${a.to}: ${String(render(a.text, scope))}`;
    case "summary":
      return `Summarise ${a.service} over the last ${a.days} days${a.as ? ` (kept as ${a.as})` : ""}`;
    case "connector":
      return `Call ${a.call} with ${JSON.stringify(render(a.with, scope))}`;
    case "record":
      return `Record the outcome ${a.outcome}`;
  }
};

export type RunOptions = {
  dry?: boolean;
  settings?: RoutineSettings;
  usage?: RoutineUsage;
  /** Count what the run used (runs, messages, connector calls); called before each. */
  use?: (what: "runs" | "messages" | "connector_calls") => Promise<void> | void;
  /** The connector operation's label, to refuse payments a handler's name doesn't show (RTN-13). */
  operationLabel?: (handler: string) => string | undefined;
  id?: string;
};

/**
 * Run a routine's actions in order. A failing action stops the run. Limits are checked before the
 * run and before each message and connector call; a paused business runs nothing (RTN-5). A dry run
 * uses the stand-ins unless others are given, and keeps the words it would have sent in `preview`.
 */
export async function runRoutine(r: Routine, input: RoutineInput, handlers: RoutineHandlers, opts: RunOptions = {}): Promise<RoutineRun> {
  const dry = Boolean(opts.dry);
  const run: RoutineRun = { id: opts.id ?? crypto.randomUUID(), routine: r.id, trigger: input.trigger, dry, at: input.at.toISOString(), status: "done", steps: [], ...(dry ? { preview: [] } : {}) };
  const settings = opts.settings ?? DEFAULT_ROUTINE_SETTINGS;
  const usage = { ...(opts.usage ?? emptyUsage(localClock(input.at, r.utc_offset).date)) };
  if (!dry && settings.paused) return { ...run, status: "paused", reason: "Routines are paused for this business." };
  const results: Record<string, unknown> = {};
  const scope = () => routineScope(r, input, results);
  if (r.when && !holds(r.when, scope())) return { ...run, status: "skipped", reason: "Its condition didn't hold." };
  const over = (k: "runs" | "messages" | "connector_calls", limit: number) => !dry && usage[k] >= limit;
  if (over("runs", settings.limits.runsPerDay)) return { ...run, status: "limited", reason: "The day's limit on routine runs is reached." };
  if (!dry) {
    usage.runs++;
    await opts.use?.("runs");
  }
  for (const [i, a] of r.actions.entries()) {
    const step = (ok: boolean, note: string) => run.steps.push({ action: i + 1, type: a.type, ok, note });
    run.preview?.push(describe(a, scope()));
    try {
      if (a.type === "message") {
        if (over("messages", settings.limits.messagesPerDay)) return { ...run, status: "limited", reason: "The day's limit on messages is reached." };
        const text = String(render(a.text, scope())).slice(0, 1000);
        if (!dry) usage.messages++, await opts.use?.("messages");
        await handlers.message(a.to, text);
        step(true, `message to ${a.to}`);
      } else if (a.type === "summary") {
        const s = await handlers.summary(a.service, a.days);
        if (a.as) results[a.as] = s.text;
        step(true, `summary of ${a.service}, ${a.days} days`);
      } else if (a.type === "connector") {
        const label = opts.operationLabel?.(a.call);
        if (looksLikePayment(a.call) || (label && looksLikePayment(label))) throw new Error("A routine never pays or moves money; a person does that.");
        if (over("connector_calls", settings.limits.connectorCallsPerDay)) return { ...run, status: "limited", reason: "The day's limit on connector calls is reached." };
        if (!dry) usage.connector_calls++, await opts.use?.("connector_calls");
        const out = await handlers.connector(a.call, render(a.with, scope()) as Record<string, unknown>);
        if (a.as) results[a.as] = out;
        step(true, `called ${a.call}`);
      } else {
        await handlers.record(a.outcome);
        step(true, `recorded ${a.outcome}`);
      }
    } catch (e) {
      step(false, (e as Error).message.slice(0, 200));
      return { ...run, status: "failed", reason: `Action ${i + 1} failed.` };
    }
  }
  return run;
}

// ---- the run log as events (RTN-4) -------------------------------------------------------------------

/**
 * A run as service events (routine.started, one routine.action per action, then routine.finished or
 * routine.failed), so a routine's dashboard and activity log read like a service's. `entry` is the
 * routine's catalogue entry. Facts only: the action's type and number, never its words.
 */
export function runEvents(run: RoutineRun, entry: string): ServiceEvent[] {
  const base = { service: entry, journey: run.routine, run: run.id, role: null, actor: null, outcome: null };
  const t = new Date(run.at).getTime();
  const at = (i: number) => new Date(t + i).toISOString();
  const out: ServiceEvent[] = [{ ...base, id: crypto.randomUUID(), kind: "routine.started", at: at(0), step: run.trigger, ms: null, ok: null }];
  run.steps.forEach((s, i) => out.push({ ...base, id: crypto.randomUUID(), kind: "routine.action", at: at(i + 1), step: `${s.action}-${s.type}`, ms: null, ok: s.ok }));
  const ended = run.status === "done" ? "routine.finished" : "routine.failed";
  out.push({ ...base, id: crypto.randomUUID(), kind: ended, at: at(run.steps.length + 1), step: run.status, ms: null, ok: run.status === "done", outcome: null });
  return out;
}

/** Runs read back from a routine's events, newest first. */
export function runsFromEvents(events: readonly ServiceEvent[]): { id: string; at: string; trigger: string; status: string; steps: { step: string; ok: boolean }[] }[] {
  const runs = new Map<string, { id: string; at: string; trigger: string; status: string; steps: { step: string; ok: boolean }[] }>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!e.kind.startsWith("routine.")) continue;
    const r = runs.get(e.run) ?? { id: e.run, at: e.at, trigger: "", status: "running", steps: [] };
    if (e.kind === "routine.started") r.trigger = e.step ?? "";
    else if (e.kind === "routine.action") r.steps.push({ step: e.step ?? "", ok: Boolean(e.ok) });
    else r.status = e.step ?? (e.ok ? "done" : "failed");
    runs.set(e.run, r);
  }
  return [...runs.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/** The last time a routine started, from its events. */
export const lastStarted = (events: readonly ServiceEvent[]) => events.filter((e) => e.kind === "routine.started").reduce<string | null>((m, e) => (!m || e.at > m ? e.at : m), null);

// ---- summaries ------------------------------------------------------------------------------------------

const pct = (x: number | null) => (x === null ? "" : ` (${Math.round(x * 100)}%)`);
/** A service's numbers in a sentence or two, for a summary message. */
export function summaryText(title: string, days: number, m: ServiceMetrics): string {
  const parts = [`${title}, the last ${days} days: ${m.started} started, ${m.finished} finished${pct(m.completion)}.`];
  if (m.outcomes.length) parts.push(`Outcomes: ${m.outcomes.slice(0, 6).map((o) => `${o.label} ${o.count}`).join(", ")}.`);
  if (m.handed) parts.push(`Requests: ${m.open} open, ${m.closed} closed, ${m.declined} declined.`);
  return parts.join(" ");
}

// ---- notices: a message to a role (RTN-1) ------------------------------------------------------------

export type RoutineNotice = { id: string; tenant_id: string; routine_id: string; role: string; text: string; created_at: string; done_at: string | null; done_by: string | null };
/** Notices are kept this long. */
export const NOTICE_DAYS = 30;

export interface RoutineStore {
  addNotice(n: RoutineNotice): Promise<void>;
  /** Open notices for any of these roles, newest first. */
  notices(tenant: string, roles: readonly string[], opts?: { all?: boolean; limit?: number }): Promise<RoutineNotice[]>;
  doneNotice(tenant: string, id: string, by: string, at: string): Promise<boolean>;
  settings(tenant: string): Promise<RoutineSettings>;
  putSettings(tenant: string, s: RoutineSettings): Promise<void>;
  usage(tenant: string, day: string): Promise<RoutineUsage>;
  use(tenant: string, day: string, what: "runs" | "messages" | "connector_calls"): Promise<void>;
}

export function createMemoryRoutineStore(): RoutineStore {
  const notices: RoutineNotice[] = [];
  const settings = new Map<string, RoutineSettings>();
  const usage = new Map<string, RoutineUsage>();
  return {
    async addNotice(n) {
      notices.push({ ...n });
    },
    async notices(tenant, roles, { all = false, limit = 100 } = {}) {
      return notices
        .filter((n) => n.tenant_id === tenant && roles.includes(n.role) && (all || !n.done_at))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((n) => ({ ...n }));
    },
    async doneNotice(tenant, id, by, at) {
      const n = notices.find((x) => x.tenant_id === tenant && x.id === id && !x.done_at);
      if (!n) return false;
      n.done_at = at;
      n.done_by = by;
      return true;
    },
    settings: async (tenant) => structuredClone(settings.get(tenant) ?? DEFAULT_ROUTINE_SETTINGS),
    async putSettings(tenant, s) {
      settings.set(tenant, structuredClone(s));
    },
    usage: async (tenant, day) => ({ ...(usage.get(`${tenant}|${day}`) ?? emptyUsage(day)) }),
    async use(tenant, day, what) {
      const k = `${tenant}|${day}`;
      const u = usage.get(k) ?? emptyUsage(day);
      u[what]++;
      usage.set(k, u);
    },
  };
}

// ---- starters ------------------------------------------------------------------------------------------

/** Two routines to start from (the plan's gate: the Monday summary and a late check-in alert). */
export const ROUTINE_STARTERS: readonly { id: string; title: string; yaml: string }[] = [
  {
    id: "monday-summary",
    title: "Monday summary",
    yaml: `kind: routine
id: monday-summary
title: Monday summary
summary: Every Monday morning, last week's numbers for a service go to its managers.
on:
  schedule: { every: week, on: mon, at: "09:00" }
actions:
  - summary: { service: attendance, days: 7, as: week }
  - message: { to: manager, text: "{{results.week}}" }
`,
  },
  {
    id: "late-alert",
    title: "Late check-in alert",
    yaml: `kind: routine
id: late-alert
title: Late check-in alert
summary: Tells the managers when someone checks in late.
on:
  event: { service: attendance, kind: journey.outcome, outcome: attendance.late }
actions:
  - message: { to: manager, text: "A late check-in at {{event.time}} on {{event.date}}." }
`,
  },
];
