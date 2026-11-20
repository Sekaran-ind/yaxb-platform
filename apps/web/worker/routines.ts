// Routines on the server (RTN-1..5, 7, 13): the published routines of each business, run by the
// Cron Trigger's sweep (schedules and dates), by events (kiosks' events stored on the server, or
// forwarded to /api/routines/events), or by an administrator's "Run now". Each run claims its id in
// service_events first, so a retried event or an overlapping sweep never runs a routine twice.
// A message to a role becomes a notice in My work; a summary reads the service's events on the
// server; a connector call goes through the connector's SSRF guard with its sealed secrets; a record
// is an outcome event on the routine. Nothing pays (the core refuses it), and every run is logged as
// routine.* events, facts only.
import { compileBundle, parseDocument, serviceDates } from "@sekaran-ind/yaxb-journeys";
import { JOURNEY_SERVICES } from "@sekaran-ind/yaxb-core/content";
import { callConnector } from "@sekaran-ind/yaxb-core/connectors";
import { unseal } from "@sekaran-ind/yaxb-core/identity";
import { serviceMetrics, type ServiceEvent } from "@sekaran-ind/yaxb-core/metrics";
import {
  FAMILY_APPROVER,
  sendPending,
  sendWebhook,
  webhookKey,
  type RoutineApproval,
  dryRunHandlers,
  isDue,
  localClock,
  matchesEvent,
  runEvents,
  runRoutine,
  summaryText,
  type Routine,
  type RoutineHandlers,
  type RoutineInput,
  type RoutineRun,
} from "@sekaran-ind/yaxb-core/routines";
import { createD1RoutineStore } from "@sekaran-ind/yaxb-core/stores/d1";
import { dohResolver } from "@sekaran-ind/yaxb-core/web/pages";
import type { LibraryEntry } from "@sekaran-ind/yaxb-core/library";
import { currentEdition, db, dbFor, EDITIONS, withEdition } from "./edition";
import { settings, type Bindings } from "./env";
import { cases, catalogue, connectorCalled, connectorSecrets, currentTenant, serviceEvents, tenantContext } from "./kiosk";

const DAY = 86_400_000;
/** At most this many routine runs from one batch of events. */
const MAX_EVENT_RUNS = 20;

export const routineStore = (env: Bindings) => createD1RoutineStore(db(env));

/** What a business's routines need: its published services, connectors and routines. */
export async function routineContext(env: Bindings) {
  const lib = await catalogue(env);
  const [pub, routines, connectors] = await Promise.all([lib.published([], { all: true }), lib.publishedRoutines(), lib.publishedConnectors()]);
  return { pub, routines, connectors };
}
export type RoutineContext = Awaited<ReturnType<typeof routineContext>>;

/** A published service by its own id (as routines name it) or its entry id. */
const serviceOf = (ctx: RoutineContext, id: string) => ctx.pub.services.find((s) => s.id === id || s.entry_id === id) ?? null;

/** A service's journeys for the metrics: screens in order and outcomes with their labels (as the dashboard). */
function metricsJourneys(yaml: string) {
  return compileBundle(yaml, { services: JOURNEY_SERVICES }).journeys.map((j) => ({
    id: j.id,
    title: j.title,
    steps: Object.entries(j.steps).map(([id, st]) => ({ id, label: st.label ?? id })),
    outcomes: Object.values(j.steps).flatMap((st) => (st.result?.outcome ? [{ id: st.result.outcome, label: st.result.title && !st.result.title.includes("{{") ? st.result.title : st.result.outcome }] : [])),
  }));
}

/** A service's key date by id (date triggers), from its published YAML. */
function dateOf(ctx: RoutineContext, service: string, id: string): string | null {
  const s = serviceOf(ctx, service);
  if (!s) return null;
  const p = parseDocument(s.yaml);
  return p.ok ? (serviceDates(p.doc.dates).find((d) => d.id === id)?.date ?? null) : null;
}

/** The summary action: read-only, so a dry run uses it too. */
function summaryHandler(env: Bindings, ctx: RoutineContext, at: Date): RoutineHandlers["summary"] {
  return async (service, days) => {
    const s = serviceOf(ctx, service);
    if (!s) throw new Error(`There's no published service ${service}.`);
    if (s.storage !== "server") throw new Error(`${s.title} keeps no records on the server, so there's nothing to summarise.`);
    const events = (await serviceEvents(env).list(s.entry_id, { since: new Date(at.getTime() - days * DAY).toISOString() })).filter((e) => e.at <= at.toISOString());
    return { text: summaryText(s.title, days, serviceMetrics(events, metricsJourneys(s.yaml))) };
  };
}

/** A routine's webhook signing key (RTN-8): derived per edition, business and routine, never stored. */
export const signingKey = (env: Bindings, entryId: string) => webhookKey(settings(env).SESSION_SECRET, `${currentEdition()}|${currentTenant()}|${entryId}`);

/** RTN-12: in Family, a connector call or a webhook waits for a parent, whatever the routine says. */
const mustApprove = () => (currentEdition() === "family" ? FAMILY_APPROVER : undefined);

/** The real handlers for one run of a routine. */
function liveHandlers(env: Bindings, ctx: RoutineContext, entry: LibraryEntry, r: Routine, runId: string, at: Date): RoutineHandlers {
  const tenant = currentTenant();
  return {
    async webhook(url, body) {
      await sendWebhook(url, body, await signingKey(env, entry.id), { resolve: dohResolver() });
    },
    async approval(role, p) {
      await routineStore(env).addApproval({ ...p, id: crypto.randomUUID(), tenant_id: tenant, routine_id: entry.id, routine_title: r.title, run_id: runId, role, created_at: new Date().toISOString(), decision: null, decided_by: null, decided_at: null });
    },
    async message(role, text) {
      await routineStore(env).addNotice({ id: crypto.randomUUID(), tenant_id: tenant, routine_id: entry.id, role, text, created_at: new Date().toISOString(), done_at: null, done_by: null });
    },
    summary: summaryHandler(env, ctx, at),
    async connector(handler, input) {
      const [, id, op] = handler.split(".");
      const found = ctx.connectors.find((c) => c.connector.id === id);
      if (!found || !op || !found.connector.operations.some((o) => o.id === op)) throw new Error(`There's no published connector operation ${handler}.`);
      const secrets: Record<string, string> = {};
      for (const s of await connectorSecrets(env).list(tenant, found.connector.id)) secrets[s.name] = await unseal(settings(env).SESSION_SECRET, s.sealed);
      const started = Date.now();
      try {
        const out = await callConnector(found.connector, op, input, secrets, { resolve: dohResolver() });
        await connectorCalled(env, found.entry.id, op, out.ok, out.ms, runId);
        return out;
      } catch (e) {
        await connectorCalled(env, found.entry.id, op, false, Date.now() - started, runId);
        throw e;
      }
    },
    async record(outcome) {
      await serviceEvents(env).add([{ id: crypto.randomUUID(), service: entry.id, journey: r.id, kind: "journey.outcome", step: null, role: null, run: runId, at: at.toISOString(), ms: null, ok: null, actor: null, outcome }]);
    },
  };
}

/** A connector operation's label, so a payment hidden behind a plain handler name is still refused (RTN-13). */
function operationLabel(ctx: RoutineContext) {
  return (handler: string) => {
    const [, id, op] = handler.split(".");
    return ctx.connectors.find((c) => c.connector.id === id)?.connector.operations.find((o) => o.id === op)?.label;
  };
}

async function hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Claim a run: its routine.started event goes in first, with an id made from the run's id, and
 * only the request whose insert lands goes on. D1's run() reports changes in `meta`; node:sqlite's
 * (the tests) at the top.
 */
async function claim(env: Bindings, entry: LibraryEntry, r: Routine, run: { id: string; trigger: string; at: string }): Promise<boolean> {
  const res = (await db(env)
    .prepare("INSERT OR IGNORE INTO service_events (id, service, journey, kind, step, role, run, at, ms, ok, actor, outcome) VALUES (?1, ?2, ?3, 'routine.started', ?4, NULL, ?5, ?6, NULL, NULL, NULL, NULL)")
    .bind(`rs-${run.id}`, entry.id, r.id, run.trigger, run.id, run.at)
    .run()) as { meta?: { changes?: number }; changes?: number };
  return (res.meta?.changes ?? res.changes ?? 0) > 0;
}

/** Log a run as events; its started event is the claim, already in. */
async function logRun(env: Bindings, entry: LibraryEntry, run: RoutineRun) {
  await serviceEvents(env).add(runEvents(run, entry.id).filter((e) => e.kind !== "routine.started"));
}

export type RunRequest = { entry: LibraryEntry; routine: Routine; input: RoutineInput; key: string };

/**
 * Run a published routine once for real: claimed by `key` (the same key never runs twice), with
 * the business's settings and today's usage, then logged. Null when another run had the claim.
 */
export async function runOnce(env: Bindings, ctx: RoutineContext, req: RunRequest): Promise<RoutineRun | null> {
  const { entry, routine: r, input } = req;
  const id = await hex(`${entry.id}|${req.key}`);
  if (!(await claim(env, entry, r, { id, trigger: input.trigger, at: input.at.toISOString() }))) return null;
  const store = routineStore(env);
  const tenant = currentTenant();
  const day = localClock(input.at, r.utc_offset).date;
  let run: RoutineRun;
  try {
    const [s, usage] = await Promise.all([store.settings(tenant), store.usage(tenant, day)]);
    run = await runRoutine(r, input, liveHandlers(env, ctx, entry, r, id, input.at), { settings: s, usage, use: (w) => store.use(tenant, day, w), operationLabel: operationLabel(ctx), mustApprove: mustApprove(), id });
  } catch (e) {
    run = { id, routine: r.id, trigger: input.trigger, dry: false, at: input.at.toISOString(), status: "failed", steps: [], reason: (e as Error).message.slice(0, 200) };
  }
  await logRun(env, entry, run);
  return run;
}

/** A dry run (RTN-3): stand-ins for messages, connectors and records; the summary is read for real (it changes nothing). */
export async function dryRun(env: Bindings, ctx: RoutineContext, r: Routine, input: RoutineInput): Promise<RoutineRun> {
  return runRoutine(r, input, { ...dryRunHandlers, summary: summaryHandler(env, ctx, input.at) }, { dry: true, operationLabel: operationLabel(ctx), mustApprove: mustApprove() });
}

/**
 * A member decides an action waiting for approval (RTN-6). Approved, it is sent now, under the
 * routine's rules and today's limits, and logged as the run's action; a routine no longer published
 * sends nothing. Null when it wasn't open (someone else decided first).
 */
export async function decideApproval(env: Bindings, id: string, decision: "approved" | "declined", by: string): Promise<{ approval: RoutineApproval; sent: { ok: boolean; note: string } | null } | null> {
  const store = routineStore(env);
  const tenant = currentTenant();
  const a = await store.decideApproval(tenant, id, decision, by, new Date().toISOString());
  if (!a) return null;
  if (decision === "declined") return { approval: a, sent: null };
  const ctx = await routineContext(env);
  const found = ctx.routines.find((x) => x.entry.id === a.routine_id);
  if (!found) return { approval: a, sent: { ok: false, note: "The routine isn't published any more, so nothing was sent." } };
  const now = new Date();
  const day = localClock(now, found.routine.utc_offset).date;
  const [s, usage] = await Promise.all([store.settings(tenant), store.usage(tenant, day)]);
  const step = await sendPending(a, liveHandlers(env, ctx, found.entry, found.routine, a.run_id, now), { settings: s, usage, use: (w) => store.use(tenant, day, w), operationLabel: operationLabel(ctx) });
  await serviceEvents(env).add([{ id: crypto.randomUUID(), service: found.entry.id, journey: found.routine.id, kind: "routine.action", step: `${a.action}-${a.type}`, role: null, run: a.run_id, at: now.toISOString(), ms: null, ok: step.ok, actor: null, outcome: null }]);
  return { approval: a, sent: { ok: step.ok, note: step.note } };
}

/** A made-up event for a dry run of an event routine: what its trigger names, now. */
export function sampleEvent(r: Routine, at: Date): RoutineInput["event"] {
  if (!("event" in r.on)) return null;
  const t = r.on.event;
  return { kind: t.kind, service: t.service, journey: t.journey ?? t.service, outcome: t.outcome ?? null, actor: null, step: null, at: at.toISOString() };
}

/**
 * Events in, routines out: every published routine an event sets off runs once per event (the
 * event's id is the claim). Events from routines themselves never set one off. At most
 * MAX_EVENT_RUNS runs per batch.
 */
export async function fireEvents(env: Bindings, events: readonly ServiceEvent[], ctx?: RoutineContext): Promise<RoutineRun[]> {
  const relevant = events.filter((e) => !e.kind.startsWith("routine."));
  if (!relevant.length) return [];
  const c = ctx ?? (await routineContext(env));
  const listening = c.routines.filter((x) => "event" in x.routine.on);
  if (!listening.length) return [];
  const idOf = (entry: string) => c.pub.services.find((s) => s.entry_id === entry)?.id ?? null;
  const out: RoutineRun[] = [];
  for (const e of relevant)
    for (const { entry, routine } of listening) {
      if (out.length >= MAX_EVENT_RUNS || !matchesEvent(routine, e, idOf)) continue;
      const run = await runOnce(env, c, { entry, routine, input: { event: e, at: new Date(e.at), trigger: "event" }, key: `event|${e.id}` });
      if (run) out.push(run);
    }
  return out;
}

/** When a time routine last ran (or was skipped) on its own: manual runs don't count. */
async function lastTimed(env: Bindings, entry: string): Promise<string | null> {
  const row = await db(env).prepare("SELECT MAX(at) AS at FROM service_events WHERE service = ?1 AND kind = 'routine.started' AND step IN ('schedule', 'date')").bind(entry).first<{ at: string | null }>();
  return row?.at ?? null;
}

/** One business's time routines: each runs if due, or is logged as skipped when the Worker missed it by too much. */
export async function sweepTenant(env: Bindings, now = new Date()): Promise<RoutineRun[]> {
  const ctx = await routineContext(env);
  const out: RoutineRun[] = [];
  for (const { entry, routine: r } of ctx.routines) {
    if ("event" in r.on) continue;
    const trigger = "schedule" in r.on ? "schedule" : "date";
    const since = new Date((await lastTimed(env, entry.id)) ?? entry.reviewed_at ?? entry.updated_at);
    const due = isDue(r, since, now, (service, id) => dateOf(ctx, service, id));
    if (due.due) {
      const run = await runOnce(env, ctx, { entry, routine: r, input: { at: due.at, trigger }, key: `${trigger}|${due.at.toISOString()}` });
      if (run) out.push(run);
    } else if (due.skipped) {
      const id = await hex(`${entry.id}|${trigger}|${due.skipped.toISOString()}`);
      const run: RoutineRun = { id, routine: r.id, trigger, dry: false, at: due.skipped.toISOString(), status: "skipped", steps: [], reason: "It was missed by more than two hours, so it waits for its next time." };
      if (await claim(env, entry, r, run)) {
        await logRun(env, entry, run);
        out.push(run);
      }
    }
  }
  return out;
}

/**
 * The Cron Trigger (every 15 minutes, RTN-2): every edition's businesses with a published routine.
 * One business's failure is logged and never stops the others.
 */
export async function sweep(env: Bindings, now = new Date()): Promise<number> {
  let runs = 0;
  for (const edition of EDITIONS) {
    let database: D1Database;
    try {
      database = dbFor(env as unknown as Record<string, unknown>, edition);
    } catch {
      continue;
    }
    const { results } = await database
      .prepare("SELECT DISTINCT tenant_id FROM library_entries WHERE kind = 'routine' AND published_yaml IS NOT NULL AND status != 'archived'")
      .all<{ tenant_id: string }>();
    // DEP-3: dependencies past their time, in each business's central cases (a business's list is its own).
    const owners = await database.prepare("SELECT DISTINCT tenant_id FROM cases WHERE status IN ('waiting', 'to_finish') AND links IS NOT NULL").all<{ tenant_id: string }>().catch(() => ({ results: [] as { tenant_id: string }[] }));
    for (const { tenant_id } of owners.results)
      await withEdition(edition, () => tenantContext.run(tenant_id, () => cases(env).expire(now))).catch((e) => console.error(JSON.stringify({ msg: "case expiry failed", edition, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" })));
    for (const { tenant_id } of results) {
      try {
        runs += (await withEdition(edition, () => tenantContext.run(tenant_id, () => sweepTenant(env, now)))).length;
      } catch (e) {
        console.error(JSON.stringify({ msg: "routine sweep failed", edition, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : "unknown" }));
      }
    }
  }
  return runs;
}
