// Routines (RTN-1..5, 13): the document, when it runs, a dry run, limits, the run log, and the store.
import { describe, expect, it } from "vitest";
import { newEvent, serviceMetrics } from "../src/metrics/index.js";
import {
  createMemoryRoutineStore,
  DEFAULT_ROUTINE_SETTINGS,
  isDue,
  matchesEvent,
  nextScheduled,
  parseRoutine,
  ROUTINE_STARTERS,
  routineLimits,
  runEvents,
  runRoutine,
  runsFromEvents,
  summaryText,
  FAMILY_APPROVER,
  FAMILY_ROUTINES,
  sendPending,
  sendWebhook,
  webhookKey,
  webhookSignature,
  type PendingAction,
  type Routine,
  type RoutineHandlers,
} from "../src/routines/index.js";
import { createD1EventStore, createD1RoutineStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const routine = (yaml: string): Routine => {
  const r = parseRoutine(yaml);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.routine;
};
const [MONDAY, LATE] = ROUTINE_STARTERS.map((s) => routine(s.yaml)) as [Routine, Routine];

function recorder() {
  const sent: { role: string; text: string }[] = [];
  const calls: string[] = [];
  const pending: ({ role: string } & PendingAction)[] = [];
  const handlers: RoutineHandlers = {
    message: async (role, text) => void sent.push({ role, text }),
    summary: async (service, days) => ({ text: `${service}: ${days} days, 3 late` }),
    connector: async (h) => (calls.push(h), { ok: true }),
    webhook: async (url) => void calls.push(`webhook ${url}`),
    record: async () => {},
    approval: async (role, p) => void pending.push({ role, ...p }),
  };
  return { sent, calls, pending, handlers };
}

describe("a routine document (RTN-1, RTN-13)", () => {
  it("compiles the starters", () => {
    expect(MONDAY.on).toEqual({ schedule: { every: "week", on: "mon", at: "09:00" } });
    expect(LATE.actions).toEqual([{ type: "message", to: "manager", text: "A late check-in at {{event.time}} on {{event.date}}." }]);
    expect(MONDAY.utc_offset).toBe(330);
  });

  it("names every problem", () => {
    const r = parseRoutine(`kind: routine
id: Bad Id
on: { schedule: { every: fortnight } }
when: "event.kind =="
actions:
  - message: { to: manager }
  - journey: { id: x }
  - shout: { loud: true }
`);
    expect(r.ok).toBe(false);
    const all = r.problems.join("\n");
    expect(all).toMatch(/id is required/);
    expect(all).toMatch(/title is required/);
    expect(all).toMatch(/every is hour, day, week or month/);
    expect(all).toMatch(/^when: /m);
    expect(all).toMatch(/message.text is required/);
    expect(all).toMatch(/journey actions aren't available yet/);
    expect(all).toMatch(/'shout' isn't an action/);
  });

  it("never pays (RTN-13)", () => {
    const r = parseRoutine(`kind: routine
id: rent
title: Rent
on: { schedule: { every: month, on: 1, at: "10:00" } }
actions:
  - connector: { call: connector.bank.pay-rent }
`);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/never pays or moves money/);
  });
});

describe("when a routine runs (RTN-2)", () => {
  it("finds the next Monday 09:00 on India's clock", () => {
    // Friday 20 November 2026, 10:00 in India.
    const fri = new Date("2026-11-20T04:30:00Z");
    expect(nextScheduled((MONDAY.on as { schedule: never }).schedule, fri, 330).toISOString()).toBe("2026-11-23T03:30:00.000Z");
    // Exactly at the time: the next week.
    expect(nextScheduled((MONDAY.on as { schedule: never }).schedule, new Date("2026-11-23T03:30:00Z"), 330).toISOString()).toBe("2026-11-30T03:30:00.000Z");
    expect(nextScheduled({ every: "hour", minute: 15 }, new Date("2026-11-20T04:30:00Z"), 330).toISOString()).toBe("2026-11-20T04:45:00.000Z");
    expect(nextScheduled({ every: "month", on: 1, at: "08:00" }, fri, 330).toISOString()).toBe("2026-12-01T02:30:00.000Z");
    expect(nextScheduled({ every: "day", at: "23:30" }, fri, 330).toISOString()).toBe("2026-11-20T18:00:00.000Z");
  });

  it("runs once when due, and skips a run that is hours late", () => {
    const since = new Date("2026-11-20T04:30:00Z");
    expect(isDue(MONDAY, since, new Date("2026-11-23T03:00:00Z"))).toMatchObject({ due: false });
    expect(isDue(MONDAY, since, new Date("2026-11-23T03:40:00Z"))).toEqual({ due: true, at: new Date("2026-11-23T03:30:00Z") });
    const late = isDue(MONDAY, since, new Date("2026-11-23T09:00:00Z"));
    expect(late).toMatchObject({ due: false, skipped: new Date("2026-11-23T03:30:00Z"), next: new Date("2026-11-30T03:30:00Z") });
  });

  it("fires a date trigger days before a service's date, once", () => {
    const r = routine(`kind: routine
id: annual-day
title: Annual day reminder
on: { date: { service: hall, date: annual-day, before: 2, at: "09:00" } }
actions: [{ message: { to: manager, text: "Annual day in two days." } }]
`);
    const dates = (s: string, d: string) => (s === "hall" && d === "annual-day" ? "2026-12-10" : null);
    const since = new Date("2026-11-20T00:00:00Z");
    expect(isDue(r, since, new Date("2026-12-08T03:31:00Z"), dates)).toEqual({ due: true, at: new Date("2026-12-08T03:30:00Z") });
    // Once it has run, never again.
    expect(isDue(r, new Date("2026-12-08T03:31:00Z"), new Date("2026-12-08T03:40:00Z"), dates)).toMatchObject({ due: false });
    expect(isDue(r, since, new Date("2026-12-08T03:31:00Z"), () => null)).toMatchObject({ due: false, next: null });
  });

  it("matches an event by service, kind and outcome", () => {
    const e = { service: "entry-1", kind: "journey.outcome" as const, journey: "check-in", outcome: "attendance.late" };
    const idOf = (x: string) => (x === "entry-1" ? "attendance" : null);
    expect(matchesEvent(LATE, e, idOf)).toBe(true);
    expect(matchesEvent(LATE, { ...e, outcome: "attendance.in" }, idOf)).toBe(false);
    expect(matchesEvent(MONDAY, e, idOf)).toBe(false);
  });
});

describe("running a routine (RTN-1, 3, 4, 5)", () => {
  const at = new Date("2026-11-23T03:30:00Z");
  const event = newEvent({ service: "entry-1", journey: "check-in", kind: "journey.outcome", run: "run-1", outcome: "attendance.late" }, new Date("2026-11-23T04:20:00Z"));

  it("sends a summary to a role", async () => {
    const { sent, handlers } = recorder();
    const run = await runRoutine(MONDAY, { at, trigger: "schedule" }, handlers);
    expect(run.status).toBe("done");
    expect(sent).toEqual([{ role: "manager", text: "attendance: 7 days, 3 late" }]);
    expect(run.steps.map((s) => s.note)).toEqual(["summary of attendance, 7 days", "message to manager"]);
  });

  it("fills an alert from the event, on the business's clock", async () => {
    const { sent, handlers } = recorder();
    await runRoutine(LATE, { at, event, trigger: "event" }, handlers);
    expect(sent[0]!.text).toBe("A late check-in at 09:50 on 2026-11-23.");
  });

  it("shows what a dry run would do, and sends nothing (RTN-3)", async () => {
    const run = await runRoutine(LATE, { at, event, trigger: "manual" }, (await import("../src/routines/index.js")).dryRunHandlers, { dry: true, settings: { ...DEFAULT_ROUTINE_SETTINGS, paused: true } });
    expect(run.status).toBe("done");
    expect(run.preview).toEqual(["Message manager: A late check-in at 09:50 on 2026-11-23."]);
  });

  it("skips when its condition doesn't hold", async () => {
    const r = { ...LATE, when: "event.actor" };
    const { sent, handlers } = recorder();
    expect((await runRoutine(r, { at, event, trigger: "event" }, handlers)).status).toBe("skipped");
    expect(sent).toEqual([]);
  });

  it("stops at the day's limits, and when paused (RTN-5)", async () => {
    const { sent, handlers } = recorder();
    const settings = { paused: false, limits: routineLimits({ messagesPerDay: 1 }) };
    const usage = { day: "2026-11-23", runs: 0, messages: 1, connector_calls: 0 };
    const limited = await runRoutine(LATE, { at, event, trigger: "event" }, handlers, { settings, usage });
    expect(limited).toMatchObject({ status: "limited", reason: expect.stringMatching(/messages/) });
    expect((await runRoutine(LATE, { at, event, trigger: "event" }, handlers, { settings: { ...settings, paused: true } })).status).toBe("paused");
    expect(sent).toEqual([]);
    expect(routineLimits({ runsPerDay: 1e9, messagesPerDay: -1 })).toEqual({ runsPerDay: 5000, messagesPerDay: 100, connectorCallsPerDay: 200 });
  });

  it("refuses a connector operation labelled as a payment when it runs (RTN-13)", async () => {
    const r = routine(`kind: routine
id: sync
title: Sync
on: { schedule: { every: day, at: "18:00" } }
actions: [{ connector: { call: connector.books.send } }]
`);
    const { calls, handlers } = recorder();
    const run = await runRoutine(r, { at, trigger: "schedule" }, handlers, { operationLabel: () => "Make a payment" });
    expect(run.status).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("logs each run as events, with no words (RTN-4)", async () => {
    const { handlers } = recorder();
    const run = await runRoutine(MONDAY, { at, trigger: "schedule" }, handlers, { id: "run-9" });
    const events = runEvents(run, "entry-r");
    expect(events.map((e) => [e.kind, e.step, e.ok])).toEqual([
      ["routine.started", "schedule", null],
      ["routine.action", "1-summary", true],
      ["routine.action", "2-message", true],
      ["routine.finished", "done", true],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/late/);
    const store = createD1EventStore(sqliteD1());
    await store.add(events);
    expect(runsFromEvents(await store.list("entry-r"))).toEqual([{ id: "run-9", at: events[0]!.at, trigger: "schedule", status: "done", steps: [{ step: "1-summary", ok: true }, { step: "2-message", ok: true }] }]);
  });

  it("keeps an event's outcome on D1", async () => {
    const store = createD1EventStore(sqliteD1());
    await store.add([event]);
    expect((await store.list("entry-1"))[0]!.outcome).toBe("attendance.late");
  });

  it("keeps an action marked approve for that role, sending nothing yet (RTN-6)", async () => {
    const r = routine(`kind: routine
id: stock-out
title: Stock out
on:
  event: { service: stock, kind: journey.outcome, outcome: stock.out }
actions:
  - webhook: { url: "https://hooks.example.com/stock", with: { item: "{{event.journey}}" }, approve: manager }
  - message: { to: manager, text: "Stock ran out." }
`);
    const rec = recorder();
    const run = await runRoutine(r, { at: new Date("2026-11-23T05:00:00Z"), trigger: "event", event: { kind: "journey.outcome", service: "stock", journey: "count", outcome: "stock.out", actor: null, step: null, at: "2026-11-23T05:00:00Z" } }, rec.handlers);
    expect(run.status).toBe("done");
    expect(rec.calls).toEqual([]);
    expect(rec.sent).toHaveLength(1);
    expect(rec.pending).toHaveLength(1);
    const p = rec.pending[0]!;
    expect(p).toMatchObject({ role: "manager", action: 1, type: "webhook", payload: { url: "https://hooks.example.com/stock" } });
    expect(p.payload.body).toMatchObject({ routine: "stock-out", run: run.id, trigger: "event", event: { kind: "journey.outcome", outcome: "stock.out" }, data: { item: "count" } });
    expect(run.steps[0]).toMatchObject({ ok: true, note: "waiting for manager to approve" });

    // Approved: sent now, under the same limits.
    expect(await sendPending(p, rec.handlers)).toMatchObject({ ok: true });
    expect(rec.calls).toEqual(["webhook https://hooks.example.com/stock"]);
    expect(await sendPending(p, rec.handlers, { settings: { ...DEFAULT_ROUTINE_SETTINGS, paused: true } })).toMatchObject({ ok: false });

    // An approval can't keep a result, and a summary never waits.
    expect(parseRoutine(`kind: routine
id: x
title: X
on: { schedule: { every: day, at: "09:00" } }
actions:
  - connector: { call: connector.a.b, as: out, approve: manager }
  - summary: { service: s, approve: manager }
  - webhook: { url: "http://plain.example.com" }
`).problems).toEqual(["action 1: an action that waits for approval can't keep its result (as)", "action 2: only a message, a connector call or a webhook waits for approval", "action 3: webhook.url is an https address"]);
  });

  it("in Family, outside sends wait for a parent, and the switches are plain routines (RTN-12)", async () => {
    const r = routine(`kind: routine
id: f
title: F
on: { schedule: { every: day, at: "09:00" } }
actions:
  - message: { to: administrator, text: Hello }
  - webhook: { url: "https://hooks.example.com/f" }
`);
    const rec = recorder();
    await runRoutine(r, { at: new Date(), trigger: "schedule" }, rec.handlers, { mustApprove: FAMILY_APPROVER });
    expect(rec.sent).toHaveLength(1);
    expect(rec.calls).toEqual([]);
    expect(rec.pending.map((p) => p.role)).toEqual(["administrator"]);
    for (const f of FAMILY_ROUTINES) {
      const c = parseRoutine(f.yaml);
      expect(c.ok, f.id).toBe(true);
      if (c.ok) expect(c.routine.actions.every((a) => a.type === "message")).toBe(true);
    }
    // The school note skips the nights before Saturday and Sunday.
    const school = routine(FAMILY_ROUTINES.find((f) => f.id === "family-school")!.yaml);
    const friday = await runRoutine(school, { at: new Date("2026-11-20T14:30:00Z"), trigger: "schedule" }, rec.handlers, { dry: true });
    const thursday = await runRoutine(school, { at: new Date("2026-11-19T14:30:00Z"), trigger: "schedule" }, rec.handlers, { dry: true });
    expect([friday.status, thursday.status]).toEqual(["skipped", "done"]);
  });

  it("signs a webhook, and refuses private addresses (RTN-8)", async () => {
    const key = await webhookKey("s".repeat(40), "business|t1|e1");
    expect(key).toBe(await webhookKey("s".repeat(40), "business|t1|e1"));
    expect(key).not.toBe(await webhookKey("s".repeat(40), "business|t1|e2"));
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: String(init.body) };
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const resolve = async () => ["93.184.216.34"];
    await sendWebhook("https://hooks.example.com/in", { routine: "r", data: { n: 1 } }, key, { fetchImpl, resolve, now: () => new Date("2026-11-23T05:00:00Z") });
    const got = seen as unknown as { headers: Record<string, string>; body: string };
    expect(got.headers["X-Anjal-Timestamp"]).toBe("1795410000");
    expect(got.headers["X-Anjal-Signature"]).toBe(`sha256=${await webhookSignature(key, "1795410000", got.body)}`);
    await expect(sendWebhook("https://10.0.0.5/in", {}, key, { fetchImpl, resolve })).rejects.toThrow();
    await expect(sendWebhook("https://inside.example.com/in", {}, key, { fetchImpl, resolve: async () => ["192.168.1.4"] })).rejects.toThrow();
    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(sendWebhook("https://hooks.example.com/in", {}, key, { fetchImpl: failing, resolve })).rejects.toThrow(/answered 500/);
  });

  it("says a service's week in words", () => {
    const m = serviceMetrics([event, newEvent({ service: "entry-1", journey: "check-in", kind: "journey.started", run: "run-1" })]);
    expect(summaryText("Attendance", 7, m)).toBe("Attendance, the last 7 days: 1 started, 0 finished (0%). Outcomes: attendance.late 1.");
  });
});

for (const [name, make] of [
  ["memory", () => createMemoryRoutineStore()],
  ["D1", () => createD1RoutineStore(sqliteD1())],
] as const) {
  describe(`the routine store on ${name}`, () => {
    it("keeps approvals per role until one member decides (RTN-6)", async () => {
      const s = make();
      const a = (id: string, role: string) => ({ id, tenant_id: "t1", routine_id: "e1", routine_title: "Stock alert", run_id: "r1", role, action: 1, type: "webhook" as const, summary: "Send to hooks.example.com", payload: { url: "https://hooks.example.com/x", body: { n: 1 } }, created_at: new Date().toISOString(), decision: null, decided_by: null, decided_at: null });
      await s.addApproval(a("a1", "manager"));
      await s.addApproval(a("a2", "accountant"));
      expect((await s.approvals("t1", ["manager"])).map((x) => [x.id, x.payload])).toEqual([["a1", { url: "https://hooks.example.com/x", body: { n: 1 } }]]);
      expect(await s.approvals("t2", ["manager"])).toEqual([]);
      expect(await s.decideApproval("t1", "a1", "approved", "Asha", new Date().toISOString())).toMatchObject({ id: "a1", decision: null });
      expect(await s.decideApproval("t1", "a1", "declined", "Ravi", new Date().toISOString())).toBeNull();
      expect(await s.approvals("t1", ["manager"])).toEqual([]);
    });

    it("keeps notices per tenant and role, settings and the day's usage", async () => {
      const s = make();
      const n = (id: string, tenant: string, role: string, created_at: string) => ({ id, tenant_id: tenant, routine_id: "late-alert", role, text: `notice ${id}`, created_at, done_at: null, done_by: null });
      await s.addNotice(n("1", "t1", "manager", "2026-11-23T04:00:00Z"));
      await s.addNotice(n("2", "t1", "manager", "2026-11-23T05:00:00Z"));
      await s.addNotice(n("3", "t1", "nurse", "2026-11-23T05:00:00Z"));
      await s.addNotice(n("4", "t2", "manager", "2026-11-23T05:00:00Z"));
      expect((await s.notices("t1", ["manager"])).map((x) => x.id)).toEqual(["2", "1"]);
      expect(await s.notices("t1", [])).toEqual([]);
      expect(await s.doneNotice("t2", "1", "Asha", "2026-11-23T06:00:00Z")).toBe(false);
      expect(await s.doneNotice("t1", "1", "Asha", "2026-11-23T06:00:00Z")).toBe(true);
      expect(await s.doneNotice("t1", "1", "Asha", "2026-11-23T06:00:00Z")).toBe(false);
      expect((await s.notices("t1", ["manager"])).map((x) => x.id)).toEqual(["2"]);
      expect((await s.notices("t1", ["manager"], { all: true })).find((x) => x.id === "1")).toMatchObject({ done_by: "Asha" });

      expect(await s.settings("t1")).toEqual(DEFAULT_ROUTINE_SETTINGS);
      await s.putSettings("t1", { paused: true, limits: routineLimits({ messagesPerDay: 5 }) });
      expect(await s.settings("t1")).toMatchObject({ paused: true, limits: { messagesPerDay: 5 } });
      expect((await s.settings("t2")).paused).toBe(false);

      await s.use("t1", "2026-11-23", "runs");
      await s.use("t1", "2026-11-23", "runs");
      await s.use("t1", "2026-11-23", "messages");
      expect(await s.usage("t1", "2026-11-23")).toEqual({ day: "2026-11-23", runs: 2, messages: 1, connector_calls: 0 });
      expect((await s.usage("t1", "2026-11-24")).runs).toBe(0);
    });
  });
}
