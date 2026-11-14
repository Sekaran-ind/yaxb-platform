// Service and journey metrics (MET-1..6). A service records what happens to its journeys, only when
// it has storage attached (`storage`: the organisation's box, or the server on the paid plan); with
// none, nothing leaves the devices and there is no dashboard or activity log.
//
// An event is a fact, never content: which journey, which screen, when, how long, whether it ended
// well, which role took it over. A visitor is never named: a run is a random id that lives only as
// long as that run. Staff actions (picking a request up, closing it, reassigning it) carry the
// member's name, for the activity log.
import { z } from "zod";

export const SERVICE_STORAGE = ["none", "box", "server"] as const;
export type ServiceStorage = (typeof SERVICE_STORAGE)[number];

export const EVENT_KINDS = [
  "journey.started",
  "screen.reached",
  "journey.finished",
  "journey.handed",
  "journey.stopped",
  "step.failed",
  "form.words",
  "request.picked_up",
  "request.answered",
  "request.closed",
  "request.declined",
  "request.reassigned",
  // The Legal Guardian (CON-6): a person agreed to (or declined) a role's consent form, by version.
  "consent.given",
  "consent.declined",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Actions people take, for the activity log (the rest are the journeys' own progress). */
export const STAFF_KINDS: readonly EventKind[] = ["request.picked_up", "request.answered", "request.closed", "request.declined", "request.reassigned"];

const ID = z.string().min(1).max(80);
export const serviceEventSchema = z.strictObject({
  id: z.string().min(8).max(64),
  /** The catalogue entry (service). */
  service: ID,
  journey: ID,
  kind: z.enum(EVENT_KINDS),
  /** The screen (step) it concerns. */
  step: ID.nullable(),
  /** The role it was handed to, or whose member acted. */
  role: ID.nullable(),
  /** A random id for one run of a journey (a request keeps its case id). Never a person. */
  run: ID,
  at: z.string().max(40),
  /** Milliseconds: since the run started (finished, stopped), or the wait (picked up). */
  ms: z.number().int().min(0).max(366 * 86_400_000).nullable(),
  ok: z.boolean().nullable(),
  /** A staff member's name, for their own actions; never a visitor's. */
  actor: z.string().max(80).nullable(),
});
export type ServiceEvent = z.infer<typeof serviceEventSchema>;
export const eventBatchSchema = z.array(serviceEventSchema).min(1).max(200);

export function newEvent(e: Omit<ServiceEvent, "id" | "at" | "step" | "role" | "ms" | "ok" | "actor"> & Partial<Pick<ServiceEvent, "step" | "role" | "ms" | "ok" | "actor">>, now = new Date()): ServiceEvent {
  return { id: crypto.randomUUID(), at: now.toISOString(), step: null, role: null, ms: null, ok: null, actor: null, ...e };
}

/** Somewhere to keep events: the box, or the server's D1. */
export interface EventStore {
  add(events: readonly ServiceEvent[]): Promise<void>;
  /** A service's events since a time, oldest first. */
  list(service: string, opts?: { since?: string; limit?: number }): Promise<ServiceEvent[]>;
}

export function createMemoryEventStore(): EventStore {
  const all: ServiceEvent[] = [];
  return {
    async add(events) {
      const seen = new Set(all.map((e) => e.id));
      for (const e of events) if (!seen.has(e.id)) all.push({ ...e });
    },
    list: async (service, { since, limit = 10_000 } = {}) =>
      all
        .filter((e) => e.service === service && (!since || e.at >= since))
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-limit)
        .map((e) => ({ ...e })),
  };
}

// ---- the numbers ---------------------------------------------------------------------------------

export type Funnel = { step: string; label: string; reached: number; stoppedHere: number }[];
export type JourneyMetrics = {
  journey: string;
  title: string;
  started: number;
  finished: number;
  /** Finished out of started, 0..1 (null with nothing started). */
  completion: number | null;
  /** Finished with a good result, out of finished. */
  success: number | null;
  medianMs: number | null;
  handed: number;
  /** Median wait from a hand-over to the role picking it up, by role. */
  waits: { role: string; medianMs: number | null; picked: number }[];
  reassigned: number;
  failed: { step: string; count: number }[];
  /** Forms filled from people's own words. */
  words: number;
  funnel: Funnel;
};
export type ServiceMetrics = {
  started: number;
  finished: number;
  completion: number | null;
  handed: number;
  /** Requests still with someone: handed over, not yet closed or declined. */
  open: number;
  closed: number;
  declined: number;
  /** Starts and finishes per week (Monday, UTC), oldest first. */
  weeks: { week: string; started: number; finished: number }[];
  journeys: JourneyMetrics[];
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
const ratio = (a: number, b: number) => (b ? a / b : null);
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/**
 * The dashboard's numbers from a service's events. `journeys` names them and gives each journey's
 * screens in run order (for the funnel); journeys with events but not listed still count.
 */
export function serviceMetrics(events: readonly ServiceEvent[], journeys: readonly { id: string; title: string; steps: { id: string; label: string }[] }[] = []): ServiceMetrics {
  const byJourney = new Map<string, ServiceEvent[]>();
  for (const e of events) byJourney.set(e.journey, [...(byJourney.get(e.journey) ?? []), e]);
  const ids = [...new Set([...journeys.map((j) => j.id), ...byJourney.keys()])];
  const count = (es: readonly ServiceEvent[], k: EventKind) => es.filter((e) => e.kind === k).length;

  const perJourney: JourneyMetrics[] = ids.map((id) => {
    const es = byJourney.get(id) ?? [];
    const def = journeys.find((j) => j.id === id);
    const started = count(es, "journey.started");
    const finishedEs = es.filter((e) => e.kind === "journey.finished");
    // The funnel: how many runs reached each screen, and how many stopped there.
    const runsAt = new Map<string, Set<string>>();
    for (const e of es) if (e.kind === "screen.reached" && e.step) runsAt.set(e.step, (runsAt.get(e.step) ?? new Set()).add(e.run));
    const stops = new Map<string, number>();
    for (const e of es) if (e.kind === "journey.stopped" && e.step) stops.set(e.step, (stops.get(e.step) ?? 0) + 1);
    const steps = def?.steps.length ? def.steps : [...runsAt.keys()].map((s) => ({ id: s, label: s }));
    const roles = [...new Set(es.filter((e) => e.kind === "journey.handed" && e.role).map((e) => e.role!))];
    const failed = new Map<string, number>();
    for (const e of es) if (e.kind === "step.failed" && e.step) failed.set(e.step, (failed.get(e.step) ?? 0) + 1);
    return {
      journey: id,
      title: def?.title ?? id,
      started,
      finished: finishedEs.length,
      completion: ratio(finishedEs.length, started),
      success: ratio(finishedEs.filter((e) => e.ok !== false).length, finishedEs.length),
      medianMs: median(finishedEs.flatMap((e) => (e.ms === null ? [] : [e.ms]))),
      handed: count(es, "journey.handed"),
      waits: roles.map((role) => {
        const picked = es.filter((e) => e.kind === "request.picked_up" && e.role === role);
        return { role, medianMs: median(picked.flatMap((e) => (e.ms === null ? [] : [e.ms]))), picked: picked.length };
      }),
      reassigned: count(es, "request.reassigned"),
      failed: [...failed].map(([step, n]) => ({ step, count: n })),
      words: count(es, "form.words"),
      funnel: steps.map((s) => ({ step: s.id, label: s.label, reached: runsAt.get(s.id)?.size ?? 0, stoppedHere: stops.get(s.id) ?? 0 })),
    };
  });

  const weeks = new Map<string, { started: number; finished: number }>();
  for (const e of events) {
    if (e.kind !== "journey.started" && e.kind !== "journey.finished") continue;
    const w = weekOf(e.at);
    const row = weeks.get(w) ?? { started: 0, finished: 0 };
    if (e.kind === "journey.started") row.started++;
    else row.finished++;
    weeks.set(w, row);
  }
  // A request is a run that was handed over; it is open until it is closed or declined.
  const handedRuns = new Set(events.filter((e) => e.kind === "journey.handed").map((e) => e.run));
  const closedRuns = new Set(events.filter((e) => e.kind === "request.closed").map((e) => e.run));
  const declinedRuns = new Set(events.filter((e) => e.kind === "request.declined").map((e) => e.run));
  const started = count(events, "journey.started");
  const finished = count(events, "journey.finished");
  return {
    started,
    finished,
    completion: ratio(finished, started),
    handed: handedRuns.size,
    open: [...handedRuns].filter((r) => !closedRuns.has(r) && !declinedRuns.has(r)).length,
    closed: closedRuns.size,
    declined: declinedRuns.size,
    weeks: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v })),
    journeys: perJourney,
  };
}

/** The activity log: what people did (staff actions), newest first. */
export function activityLog(events: readonly ServiceEvent[]) {
  return events
    .filter((e) => STAFF_KINDS.includes(e.kind))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => ({ at: e.at, actor: e.actor, kind: e.kind, journey: e.journey, step: e.step, role: e.role, request: e.run }));
}
